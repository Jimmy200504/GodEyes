#!/usr/bin/env python3
"""CPU monocular VO: ORB, two-view initialization, bounded map and PnP."""
import math
import time
import uuid

import cv2
import numpy as np


def matches(a, b):
    if a is None or b is None or len(a) < 2 or len(b) < 2:
        return np.empty((0, 2), dtype=int)
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(a, b, k=2)
    good = sorted((m for pair in pairs if len(pair) == 2
                   for m, n in [pair] if m.distance < .75 * n.distance),
                  key=lambda m: m.distance)
    used, result = set(), []
    for m in good:
        if m.trainIdx not in used:
            used.add(m.trainIdx)
            result.append((m.queryIdx, m.trainIdx))
    return np.asarray(result, dtype=int).reshape(-1, 2)


def triangulate(K, A, B, a, b):
    """Return finite, positive-depth points with parallax and reprojection gates."""
    h = cv2.triangulatePoints(K @ A, K @ B, a.T, b.T).T
    safe = np.abs(h[:, 3]) > 1e-9
    xyz = h[:, :3] / np.where(safe, h[:, 3], 1)[:, None]
    valid = safe & np.isfinite(xyz).all(axis=1)
    for T, pixels in [(A, a), (B, b)]:
        cam = xyz @ T[:, :3].T + T[:, 3]
        proj = cam @ K.T
        uv = proj[:, :2] / np.maximum(proj[:, 2:3], 1e-9)
        valid &= (cam[:, 2] > .01) & (np.linalg.norm(uv - pixels, axis=1) < 2.5)
    ca = -A[:, :3].T @ A[:, 3]
    cb = -B[:, :3].T @ B[:, 3]
    va, vb = xyz - ca, xyz - cb
    cosine = np.sum(va * vb, axis=1) / np.maximum(
        np.linalg.norm(va, axis=1) * np.linalg.norm(vb, axis=1), 1e-12)
    valid &= np.arccos(np.clip(cosine, -1, 1)) > np.deg2rad(1)
    return xyz[valid], valid


def bootstrap(K, a, b):
    if len(a) < 25:
        return None
    E, mask = cv2.findEssentialMat(a, b, K, method=cv2.RANSAC,
                                  prob=.999, threshold=1.0)
    if E is None or E.shape != (3, 3):
        return None
    _, R, t, mask = cv2.recoverPose(E, a, b, K, mask=mask)
    keep = mask.ravel() != 0
    if keep.sum() < 25:
        return None
    A = np.column_stack((np.eye(3), np.zeros(3)))
    B = np.column_stack((R, t))
    xyz, gate = triangulate(K, A, B, a[keep], b[keep])
    indices = np.flatnonzero(keep)[gate]
    if len(xyz) < 25:
        return None
    # Arbitrary units: initial median point depth = 1, not one unit per frame.
    scale = np.median(xyz[:, 2])
    xyz /= scale
    B[:, 3] /= scale
    return xyz, B, indices


def solve_pose(K, xyz, pixels):
    if len(xyz) < 12:
        return None
    ok, r, t, indices = cv2.solvePnPRansac(
        xyz, pixels, K, None, iterationsCount=100,
        reprojectionError=2.5, confidence=.99, flags=cv2.SOLVEPNP_EPNP)
    if not ok or indices is None or len(indices) < max(12, len(xyz) * .45):
        return None
    ids = indices.ravel()
    r, t = cv2.solvePnPRefineLM(xyz[ids], pixels[ids], K, None, r, t)
    R = cv2.Rodrigues(r)[0]
    camera = xyz[ids] @ R.T + t.ravel()
    projected = cv2.projectPoints(xyz[ids], r, t, K, None)[0].reshape(-1, 2)
    error = np.median(np.linalg.norm(projected - pixels[ids], axis=1))
    if not np.isfinite(error) or error > 2.5 or np.mean(camera[:, 2] > 0) < .95:
        return None
    return np.column_stack((R, t)), len(ids), float(error)


def quaternion(R):
    v = cv2.Rodrigues(R)[0].ravel()
    angle = np.linalg.norm(v)
    if angle < 1e-10:
        return [0., 0., 0., 1.]
    return [*map(float, v * (math.sin(angle / 2) / angle)), math.cos(angle / 2)]


def track_flow(previous, current, pixels, initial=None):
    """Forward/backward LK with photometric, consistency and image-bound gates."""
    if len(pixels) == 0:
        return np.empty((0, 2)), np.zeros(0, dtype=bool)
    points = np.asarray(pixels, np.float32).reshape(-1, 1, 2)
    options = dict(winSize=(21, 21), maxLevel=3,
                   criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, .01))
    guess = None if initial is None else np.asarray(initial, np.float32).reshape(-1, 1, 2).copy()
    forward, good, error = cv2.calcOpticalFlowPyrLK(
        previous, current, points, guess,
        flags=0 if guess is None else cv2.OPTFLOW_USE_INITIAL_FLOW, **options)
    if forward is None:
        return np.empty((0, 2)), np.zeros(len(pixels), dtype=bool)
    backward, back_good, _ = cv2.calcOpticalFlowPyrLK(current, previous, forward, None, **options)
    if backward is None:
        return np.empty((0, 2)), np.zeros(len(pixels), dtype=bool)
    new = forward.reshape(-1, 2)
    h, w = current.shape
    keep = ((good.ravel() == 1) & (back_good.ravel() == 1)
            & np.isfinite(new).all(axis=1)
            & (np.linalg.norm(backward.reshape(-1, 2) - pixels, axis=1) < 1.)
            & (error.ravel() < 20.)
            & (new[:, 0] >= 4) & (new[:, 0] < w-4)
            & (new[:, 1] >= 4) & (new[:, 1] < h-4))
    return new[keep].astype(np.float64), keep


def midpoint_image(previous, current):
    """Approximate half-time image using low-resolution bidirectional dense flow."""
    h, w = previous.shape
    size = (w//2, h//2)
    a = cv2.resize(previous, size, interpolation=cv2.INTER_AREA)
    b = cv2.resize(current, size, interpolation=cv2.INTER_AREA)
    args = (None, .5, 3, 21, 3, 5, 1.2, 0)
    forward = cv2.resize(cv2.calcOpticalFlowFarneback(a, b, *args), (w, h))*2
    backward = cv2.resize(cv2.calcOpticalFlowFarneback(b, a, *args), (w, h))*2
    grid = np.stack(np.meshgrid(np.arange(w), np.arange(h)), axis=-1).astype(np.float32)
    # Approximate inverse half-warps; occlusions may ghost, so this image is only
    # a search aid, never an independently measured frame or mapping keyframe.
    left = cv2.remap(previous, grid-.5*forward, None, cv2.INTER_LINEAR)
    right = cv2.remap(current, grid-.5*backward, None, cv2.INTER_LINEAR)
    return cv2.addWeighted(left, .5, right, .5, 0)


def track_midpoint(previous, current, pixels):
    mid = midpoint_image(previous, current)
    half, keep = track_flow(previous, mid, pixels)
    endpoint, second = track_flow(mid, current, half)
    ids = np.flatnonzero(keep)[second]
    # Verify and refine on the two REAL images, including real-image backward LK.
    verified, final = track_flow(previous, current, pixels[ids], initial=endpoint)
    mask = np.zeros(len(pixels), dtype=bool)
    mask[ids[final]] = True
    return verified, mask, mid


class Tracker:
    def __init__(self, K, features=800, max_points=2000, optical_flow=True, synthetic_bridge=False, lost_reset_seconds=2.):
        if not math.isfinite(lost_reset_seconds) or lost_reset_seconds < 0:
            raise ValueError('lost_reset_seconds must be finite and >= 0')
        self.lost_reset_seconds = lost_reset_seconds
        self.K = K
        self.orb = cv2.ORB_create(nfeatures=features, fastThreshold=12)
        self.max_points = max_points
        self.optical_flow = optical_flow
        self.synthetic_bridge = synthetic_bridge
        self.reset()

    def reset(self):
        self.session = str(uuid.uuid4())
        self.previous_session_id = None
        self.reset_reason = None
        self.auto_resets = 0
        self.lost_since_ns = None
        self.lost_duration_ms = 0.
        self.last_tracking_frame = -2
        self.point_hits = np.empty(0, dtype=int)
        self.point_seen = np.empty(0, dtype=int)
        self.local_map_points = self.points_pruned = 0
        self.xyz = self.desc = self.reference = None
        self.anchor_desc = None
        self.keyframes = []
        self.recovery_views = []
        self.bridge_ms = 0.
        self.bridge_tracks = self.bridge_attempted = 0
        self.bridge_attempts_total = self.bridge_successes_total = 0
        self.feature_count = self.map_matches = 0
        self.tracking_reason = None
        self.last_input_ns = None
        self.input_gap_ms = self.flow_age_ms = None
        self.last_keyframe_frame = 0
        self.new_points = 0
        self.mapping_ms = 0.
        self.descriptor_updates = 0
        self.T = np.column_stack((np.eye(3), np.zeros(3)))
        self.frame = 0
        self.sequence = 0
        self.clear_flow()
        self.seed_xyz = np.empty((0, 3))
        self.seed_pixels = np.empty((0, 2))
        self.tracking_method = 'none'
        self.flow_tracks = 0

    def clear_flow(self):
        self.previous_gray = None
        self.previous_ns = None
        self.previous_xyz = np.empty((0, 3))
        self.previous_pixels = np.empty((0, 2))

    def process(self, gray, capture_ns=None):
        flow = None
        self.input_gap_ms = ((capture_ns-self.last_input_ns)/1e6
                             if capture_ns is not None and self.last_input_ns is not None else None)
        self.flow_age_ms = ((capture_ns-self.previous_ns)/1e6
                            if capture_ns is not None and self.previous_ns is not None else None)
        self.last_input_ns = capture_ns
        if (capture_ns is not None and self.previous_ns is not None
                and not 0 < capture_ns-self.previous_ns <= 200_000_000):
            self.clear_flow()
        if self.optical_flow and self.previous_gray is not None:
            tracked, keep = track_flow(self.previous_gray, gray, self.previous_pixels)
            flow = self.previous_xyz[keep], tracked
        keypoints, desc = self.orb.detectAndCompute(gray, None)
        pixels = np.asarray([k.pt for k in keypoints], dtype=np.float64).reshape(-1, 2)
        def bridge():
            points, keep, _ = track_midpoint(self.previous_gray, gray, self.previous_pixels)
            return self.previous_xyz[keep], points
        fallback = bridge if self.synthetic_bridge and self.previous_gray is not None and self.optical_flow else None
        sample = self.update(pixels, desc, flow, fallback)
        sample = self.check_lost_timeout(sample, pixels, desc, capture_ns)
        if sample['valid'] and self.optical_flow:
            self.previous_gray = gray.copy()
            self.previous_ns = capture_ns
            self.previous_xyz = self.seed_xyz.copy()
            self.previous_pixels = self.seed_pixels.copy()
        elif not self.optical_flow:
            self.clear_flow()
        # A failed frame never becomes the next LK reference. Keep the last good
        # image only within the existing 200 ms source-time bound for recovery.
        elif capture_ns is None or self.previous_ns is None:
            self.clear_flow()
        return sample

    def check_lost_timeout(self, sample, pixels, desc, capture_ns):
        # Source time measures sustained observed loss; no frames means no reset.
        if sample['status'] != 'lost' or capture_ns is None:
            self.lost_since_ns = None
            self.lost_duration_ms = 0.
        else:
            if self.lost_since_ns is None or capture_ns < self.lost_since_ns:
                self.lost_since_ns = capture_ns
            self.lost_duration_ms = (capture_ns-self.lost_since_ns)/1e6
            if self.lost_reset_seconds > 0 and self.lost_duration_ms >= self.lost_reset_seconds*1000:
                old_session, count = self.session, self.auto_resets+1
                self.reset()
                self.previous_session_id = old_session
                self.reset_reason = 'lost_timeout'
                self.auto_resets = count
                # Reuse real current features as the new initialization reference.
                sample = self.update(pixels, desc)
        sample.update(lost_duration_ms=self.lost_duration_ms, auto_resets=self.auto_resets,
                      reset_reason=self.reset_reason, previous_session_id=self.previous_session_id)
        return sample

    def ensure_point_quality(self):
        if len(self.point_hits) != len(self.xyz):
            self.point_hits = np.ones(len(self.xyz), dtype=int)
            self.point_seen = np.full(len(self.xyz), self.frame, dtype=int)

    def append_points(self, xyz, descriptors):
        self.ensure_point_quality()
        room = max(0, self.max_points-len(xyz))
        if len(self.xyz) > room:
            # Keep reliable, recently observed points rather than removing by age alone.
            age = np.maximum(0, self.frame-self.point_seen)
            score = 3*np.log1p(np.minimum(self.point_hits, 10)) + 5*np.exp(-age/30)
            keep = np.sort(np.argsort(score, kind='stable')[-room:]) if room else np.empty(0, dtype=int)
            self.points_pruned += len(self.xyz)-len(keep)
            self.xyz, self.desc = self.xyz[keep], self.desc[keep]
            self.anchor_desc = self.anchor_desc[keep]
            self.point_hits, self.point_seen = self.point_hits[keep], self.point_seen[keep]
        self.xyz = np.concatenate((self.xyz, xyz))
        self.desc = np.concatenate((self.desc, descriptors))
        self.anchor_desc = np.concatenate((self.anchor_desc, descriptors))
        self.point_hits = np.concatenate((self.point_hits, np.ones(len(xyz), dtype=int)))
        self.point_seen = np.concatenate((self.point_seen, np.full(len(xyz), self.frame, dtype=int)))

    def local_point_ids(self):
        if self.last_tracking_frame != self.frame-1:
            return np.arange(len(self.xyz))
        cam = self.xyz @ self.T[:, :3].T + self.T[:, 3]
        projected = cam @ self.K.T
        uv = projected[:, :2] / np.maximum(projected[:, 2:3], 1e-9)
        ids = np.flatnonzero((cam[:, 2] > .01) & (uv[:, 0] >= -80) & (uv[:, 0] < 720)
                            & (uv[:, 1] >= -80) & (uv[:, 1] < 560))
        return ids if len(ids) >= 12 else np.arange(len(self.xyz))

    def seed_flow(self, xyz, pixels):
        # Copy 3D points, rather than map indices: bounded-map pruning can shift
        # indices between frames. Only geometrically supported points may persist.
        camera = xyz @ self.T[:, :3].T + self.T[:, 3]
        projected = camera @ self.K.T
        uv = projected[:, :2] / np.maximum(projected[:, 2:3], 1e-9)
        keep = (camera[:, 2] > .01) & (np.linalg.norm(uv-pixels, axis=1) < 2.5)
        chosen, cells = [], set()
        for index in np.flatnonzero(keep):
            cell = tuple(np.floor(pixels[index] / 8).astype(int))
            if cell not in cells:
                cells.add(cell)
                chosen.append(index)
            if len(chosen) >= 250:
                break
        self.seed_xyz, self.seed_pixels = xyz[chosen].copy(), pixels[chosen].copy()

    def update(self, pixels, desc, flow=None, bridge=None):
        self.frame += 1
        self.bridge_ms = 0.
        self.bridge_tracks = self.bridge_attempted = 0
        self.feature_count = len(pixels)
        self.map_matches = 0
        self.local_map_points = self.points_pruned = 0
        self.tracking_reason = None
        self.tracking_method = 'none'
        self.descriptor_updates = 0
        self.new_points = 0
        self.mapping_ms = 0.
        self.flow_tracks = 0 if flow is None else len(flow[0])
        self.seed_xyz, self.seed_pixels = np.empty((0, 3)), np.empty((0, 2))
        if self.xyz is None:
            if desc is None or len(pixels) < 25:
                return self.packet('initializing')
            if self.reference is None:
                self.reference = (pixels.copy(), desc.copy(), self.T.copy())
            a, d, A = self.reference
            pairs = matches(d, desc)
            result = bootstrap(self.K, a[pairs[:, 0]], pixels[pairs[:, 1]])
            if result is None:
                # Reselect only when reference overlap is lost, not during stillness.
                if len(pairs) < 25:
                    self.reference = (pixels.copy(), desc.copy(), self.T.copy())
                return self.packet('initializing')
            self.xyz, self.T, ids = result
            self.desc = desc[pairs[ids, 1]].copy()
            self.anchor_desc = self.desc.copy()
            self.keyframes = [(a.copy(), d.copy(), A.copy()),
                              (pixels.copy(), desc.copy(), self.T.copy())]
            self.last_keyframe_frame = self.frame
            self.reference = (pixels.copy(), desc.copy(), self.T.copy())
            self.seed_flow(self.xyz, pixels[pairs[ids, 1]])
            self.remember_view(pixels, desc)
            self.ensure_point_quality()
            self.last_tracking_frame = self.frame
            self.tracking_method = 'orb-initialize'
            return self.packet('tracking', len(ids))
        self.ensure_point_quality()
        local_ids = self.local_point_ids()
        self.local_map_points = len(local_ids)
        pairs = matches(self.desc[local_ids], desc)
        pairs[:, 0] = local_ids[pairs[:, 0]]
        self.map_matches = len(pairs)
        matched_xyz, matched_pixels = self.xyz[pairs[:, 0]], pixels[pairs[:, 1]]
        result = solve_pose(self.K, matched_xyz, matched_pixels)
        if result is not None:
            self.tracking_method = 'orb-local' if len(local_ids) < len(self.xyz) else 'orb'
        elif len(local_ids) < len(self.xyz):
            pairs = matches(self.desc, desc)
            self.map_matches = max(self.map_matches, len(pairs))
            matched_xyz, matched_pixels = self.xyz[pairs[:, 0]], pixels[pairs[:, 1]]
            result = solve_pose(self.K, matched_xyz, matched_pixels)
            if result is not None:
                self.tracking_method = 'orb'
        if result is None and self.anchor_desc is not None and not np.array_equal(self.anchor_desc, self.desc):
            anchor_pairs = matches(self.anchor_desc, desc)
            self.map_matches = max(self.map_matches, len(anchor_pairs))
            anchor_result = solve_pose(self.K, self.xyz[anchor_pairs[:, 0]], pixels[anchor_pairs[:, 1]])
            if anchor_result is not None:
                result = anchor_result
                pairs = anchor_pairs
                matched_xyz, matched_pixels = self.xyz[pairs[:, 0]], pixels[pairs[:, 1]]
                self.tracking_method = 'orb-relocalize'
        if result is None and flow is not None:
            result = solve_pose(self.K, *flow)
            if result is not None:
                self.tracking_method = 'optical-flow'
        if result is None:
            recovered = self.recover_view(pixels, desc)
            if recovered is not None:
                result, pairs = recovered
                matched_xyz, matched_pixels = self.xyz[pairs[:, 0]], pixels[pairs[:, 1]]
                self.tracking_method = 'keyframe-relocalize'
        if result is None and bridge is not None:
            started = time.perf_counter()
            self.bridge_attempted = 1
            self.bridge_attempts_total += 1
            bridged = bridge()
            self.bridge_tracks = len(bridged[0])
            result = solve_pose(self.K, *bridged)
            self.bridge_ms = (time.perf_counter()-started)*1000
            if result is not None:
                flow = bridged
                self.tracking_method = 'synthetic-bridge'
                self.bridge_successes_total += 1
        if result is None:
            self.tracking_reason = ('insufficient_correspondences'
                                    if max(self.map_matches, self.flow_tracks, self.bridge_tracks) < 12
                                    else 'pose_geometry_rejected')
            return self.packet('lost')
        self.T, inliers, error = result
        self.last_tracking_frame = self.frame
        # Refresh only descriptor matches supported by the accepted 3D pose.
        # Keep immutable birth descriptors as a bounded recovery appearance bank.
        supported_pixels = np.empty((0, 2))
        if desc is not None and len(pairs):
            camera = matched_xyz @ self.T[:, :3].T + self.T[:, 3]
            projected = camera @ self.K.T
            uv = projected[:, :2] / np.maximum(projected[:, 2:3], 1e-9)
            supported = (camera[:, 2] > .01) & (np.linalg.norm(uv-matched_pixels, axis=1) < 1.5)
            if self.anchor_desc is None:
                self.anchor_desc = self.desc.copy()
            self.point_hits[pairs[supported, 0]] += 1
            self.point_seen[pairs[supported, 0]] = self.frame
            self.desc[pairs[supported, 0]] = desc[pairs[supported, 1]]
            self.descriptor_updates = int(supported.sum())
            supported_pixels = matched_pixels[supported]
        # Prefer fresh ORB observations; flow carries existing 3D correspondences
        # across frames where descriptors fail. It does not invent new depth.
        if flow is not None:
            self.seed_flow(np.concatenate((matched_xyz, flow[0])),
                           np.concatenate((matched_pixels, flow[1])))
        else:
            self.seed_flow(matched_xyz, matched_pixels)
        if self.frame % 5 == 0 and desc is not None and len(pixels) >= 25:
            started = time.perf_counter()
            self.extend_map(pixels, desc, supported_pixels)
            self.mapping_ms = (time.perf_counter() - started) * 1000
        return self.packet('tracking', inliers, error)

    def remember_view(self, pixels, desc):
        """Keep independent 3D observations: active-map FIFO must not erase them."""
        pairs = matches(self.desc, desc)
        if len(pairs) < 12:
            return
        xyz = self.xyz[pairs[:, 0]]
        cam = xyz @ self.T[:, :3].T + self.T[:, 3]
        projected = cam @ self.K.T
        uv = projected[:, :2] / np.maximum(projected[:, 2:3], 1e-9)
        good = (cam[:, 2] > .01) & (np.linalg.norm(uv-pixels[pairs[:, 1]], axis=1) < 1.5)
        chosen, cells = [], set()
        for index in np.flatnonzero(good):
            cell = tuple(np.floor(pixels[pairs[index, 1]] / 8).astype(int))
            if cell not in cells:
                chosen.append(index)
                cells.add(cell)
            if len(chosen) >= min(250, self.max_points):
                break
        if len(chosen) >= 12:
            self.recovery_views.append((xyz[chosen].copy(), desc[pairs[chosen, 1]].copy()))
            self.recovery_views = self.recovery_views[:1] + self.recovery_views[1:][-5:]

    def recover_view(self, pixels, desc):
        candidates = []
        for xyz, descriptors in self.recovery_views:
            pairs = matches(descriptors, desc)
            self.map_matches = max(self.map_matches, len(pairs))
            if len(pairs) >= 12:
                candidates.append((len(pairs), xyz, descriptors, pairs))
        for _, xyz, descriptors, pairs in sorted(candidates, key=lambda item: -item[0])[:2]:
            result = solve_pose(self.K, xyz[pairs[:, 0]], pixels[pairs[:, 1]])
            if result is not None:
                # Switch the working point set, retaining the same world coordinates
                # and session. This is not a new map or a loop-closure correction.
                self.xyz = xyz.copy()
                self.desc = descriptors.copy()
                self.anchor_desc = descriptors.copy()
                self.point_hits = np.ones(len(xyz), dtype=int)
                self.point_seen = np.full(len(xyz), self.frame, dtype=int)
                return result, pairs
        return None

    def extend_map(self, pixels, desc, supported_pixels):
        """Bounded keyframe search. Never create depth from rotation alone."""
        if not self.keyframes and self.reference is not None:
            self.keyframes = [tuple(x.copy() for x in self.reference)]
        center = -self.T[:, :3].T @ self.T[:, 3]
        candidates = []
        for a, d, A in self.keyframes:
            baseline = np.linalg.norm(center + A[:, :3].T @ A[:, 3])
            # Prefer nearby viewing directions, but require translation too.
            cosine = np.clip((np.trace(self.T[:, :3] @ A[:, :3].T)-1)/2, -1, 1)
            angle = np.arccos(cosine)
            if baseline > .025 and angle < np.deg2rad(60):
                candidates.append((angle, a, d, A))
        best_xyz, best_ids = np.empty((0, 3)), np.empty(0, dtype=int)
        # Existing geometrically supported ORB/LK observations are already mapped.
        known_pixels = np.concatenate((supported_pixels, self.seed_pixels))
        if len(known_pixels):
            occupied = np.min(np.sum((pixels[:, None]-known_pixels[None, :])**2, axis=2), axis=1) < 16
        else:
            occupied = np.zeros(len(pixels), dtype=bool)
        for _, a, d, A in sorted(candidates, key=lambda item: item[0])[:3]:
            pairs = matches(d, desc)
            pairs = pairs[~occupied[pairs[:, 1]]]
            if len(pairs) < 8:
                continue
            xyz, gate = triangulate(self.K, A, self.T, a[pairs[:, 0]], pixels[pairs[:, 1]])
            if len(xyz) > len(best_xyz):
                best_xyz, best_ids = xyz, pairs[gate, 1]
        # Bound additions and spread them across the image rather than one patch.
        chosen, cells = [], set()
        for i, pixel in enumerate(pixels[best_ids]):
            cell = tuple(np.floor(pixel / 8).astype(int))
            if cell not in cells:
                cells.add(cell)
                chosen.append(i)
            if len(chosen) >= min(150, self.max_points):
                break
        if chosen:
            xyz, ids = best_xyz[chosen], best_ids[chosen]
            if self.anchor_desc is None:
                self.anchor_desc = self.desc.copy()
            self.append_points(xyz, desc[ids])
            self.new_points = len(xyz)
            # Newly triangulated observations can support LK on the very next frame.
            self.seed_flow(np.concatenate((xyz, self.seed_xyz)),
                           np.concatenate((pixels[ids], self.seed_pixels)))
        if self.keyframes:
            A = self.keyframes[-1][2]
            moved = np.linalg.norm(center + A[:, :3].T @ A[:, 3]) > .025
            turned = (np.trace(self.T[:, :3] @ A[:, :3].T)-1)/2 < np.cos(np.deg2rad(8))
        else:
            moved = turned = True
        if (moved or turned) and self.frame - self.last_keyframe_frame >= 5:
            self.keyframes.append((pixels.copy(), desc.copy(), self.T.copy()))
            # Keep the initial view for returns and five recent views for expansion.
            self.keyframes = self.keyframes[:1] + self.keyframes[1:][-5:]
            self.last_keyframe_frame = self.frame
            self.remember_view(pixels, desc)

    def packet(self, status, inliers=0, error=None):
        self.sequence += 1
        valid = status == 'tracking'
        # Convert BOTH world and camera basis: OpenCV right/down/forward -> right/up/back.
        S = np.diag([1., -1., -1.])
        Rwc = self.T[:, :3].T
        position = S @ (-Rwc @ self.T[:, 3])
        return dict(format_version='camera_vo_v1', session_id=self.session,
                    sequence=self.sequence, status=status, valid=valid,
                    position=position.tolist() if valid else None,
                    orientation_xyzw=quaternion(S @ Rwc @ S) if valid else None,
                    coordinate_frame='right_up_back', units='arbitrary',
                    inliers=inliers, map_points=0 if self.xyz is None else len(self.xyz),
                    tracking_method=self.tracking_method, flow_tracks=self.flow_tracks,
                    descriptor_updates=self.descriptor_updates,
                    feature_count=self.feature_count, map_matches=self.map_matches,
                    recovery_views=len(self.recovery_views), tracking_reason=self.tracking_reason,
                    input_gap_ms=self.input_gap_ms, flow_age_ms=self.flow_age_ms,
                    keyframes=len(self.keyframes), new_points=self.new_points,
                    mapping_ms=round(self.mapping_ms, 2),
                    bridge_attempted=self.bridge_attempted, bridge_tracks=self.bridge_tracks,
                    bridge_ms=round(self.bridge_ms, 2), synthetic_bridge_enabled=self.synthetic_bridge,
                    bridge_attempts_total=self.bridge_attempts_total,
                    bridge_successes_total=self.bridge_successes_total,
                    lost_duration_ms=self.lost_duration_ms, auto_resets=self.auto_resets,
                    previous_session_id=self.previous_session_id, reset_reason=self.reset_reason,
                    local_map_points=self.local_map_points, points_pruned=self.points_pruned,
                    reprojection_error_px=error)
