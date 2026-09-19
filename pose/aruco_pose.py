"""Single fixed marker, metric camera-to-world pose. No camera/network side effects."""
import json
from pathlib import Path
import cv2
import numpy as np

DICTIONARY = cv2.aruco.DICT_4X4_50


def load_calibration(path):
    data = json.loads(Path(path).read_text())
    k = np.asarray(data["camera_matrix"], dtype=np.float64)
    dist = np.asarray(data["dist_coeffs"], dtype=np.float64).reshape(-1)
    size = data["image_size"]
    if (k.shape != (3, 3) or not np.isfinite(k).all() or k[0, 0] <= 0 or k[1, 1] <= 0
            or not np.allclose(k[2], [0, 0, 1]) or dist.size not in (4, 5, 8, 12, 14)
            or not np.isfinite(dist).all() or len(size) != 2
            or any(type(v) is not int or v <= 0 for v in size)):
        raise ValueError("invalid camera calibration")
    return k, dist, tuple(size)


def square_points(side):
    if not np.isfinite(side) or side <= 0:
        raise ValueError("marker side must be positive, in meters")
    h = side / 2
    # IPPE_SQUARE requires this exact order; ArUco corners are TL, TR, BR, BL.
    return np.array([[-h, h, 0], [h, h, 0], [h, -h, 0], [-h, -h, 0]], np.float64)


def quaternion_xyzw(r):
    # Symmetric eigenvalue construction avoids numerical trouble at 180 degrees.
    a, b, c = r[0]; d, e, f = r[1]; g, h, i = r[2]
    matrix = np.array([[a-e-i, b+d, c+g, h-f],
                       [b+d, e-a-i, f+h, c-g],
                       [c+g, f+h, i-a-e, d-b],
                       [h-f, c-g, d-b, a+e+i]]) / 3
    _, vectors = np.linalg.eigh(matrix)
    q = vectors[:, -1]
    return q if q[3] >= 0 else -q


def solve_marker(corners, side, k, dist, max_error=2.0):
    points = square_points(side)
    pixels = np.asarray(corners, np.float64).reshape(4, 2)
    if not np.isfinite(pixels).all():
        return None
    ok, rotations, translations, _ = cv2.solvePnPGeneric(
        points, pixels, k, dist, flags=cv2.SOLVEPNP_IPPE_SQUARE)
    if not ok:
        return None
    candidates = []
    for rvec, tvec in zip(rotations, translations):
        rotation, _ = cv2.Rodrigues(rvec)
        translation = tvec.reshape(3)
        if not np.isfinite(rotation).all() or not np.isfinite(translation).all():
            continue
        if np.any((points @ rotation.T + translation)[:, 2] <= 0):
            continue
        projected, _ = cv2.projectPoints(points, rvec, tvec, k, dist)
        error = float(np.sqrt(np.mean(np.sum((projected.reshape(4, 2) - pixels)**2, axis=1))))
        if error <= max_error:
            candidates.append((error, rotation, translation))
    if not candidates:
        return None
    error, rotation, translation = min(candidates, key=lambda c: c[0])
    c2w_r = rotation.T
    return dict(position=(-c2w_r @ translation).tolist(),
                quaternion_xyzw=quaternion_xyzw(c2w_r).tolist(), reprojection_error_px=error)


class MarkerTracker:
    def __init__(self, marker_id, side, k, dist, max_error=2.0, min_side=20):
        if not 0 <= marker_id < 50:
            raise ValueError("DICT_4X4_50 marker id must be 0..49")
        square_points(side)
        self.marker_id, self.side, self.k, self.dist = marker_id, side, k, dist
        self.max_error, self.min_side = max_error, min_side
        params = cv2.aruco.DetectorParameters()
        params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self.detector = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(DICTIONARY), params)

    def estimate(self, image):
        corners, ids, _ = self.detector.detectMarkers(image)
        if ids is None:
            return None
        matches = np.flatnonzero(ids.flatten() == self.marker_id)
        if len(matches) != 1:  # Duplicate printed IDs are not an unambiguous world reference.
            return None
        pixels = corners[matches[0]].reshape(4, 2)
        if np.min(np.linalg.norm(pixels - np.roll(pixels, 1, axis=0), axis=1)) < self.min_side:
            return None
        return solve_marker(pixels, self.side, self.k, self.dist, self.max_error)
