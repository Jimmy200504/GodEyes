"""Fixed planar ArUco board: all visible markers share one world frame."""
import json
from pathlib import Path
import numpy as np
import cv2
from aruco_pose import solve_points


def load_board(path, marker_m):
    data = json.loads(Path(path).read_text())
    nominal = data.get('marker_size_m', 0)
    if data.get('dictionary') != 'DICT_4X4_50' or not np.isfinite(nominal) or nominal <= 0:
        raise ValueError('invalid board dictionary/marker size')
    if not np.isfinite(marker_m) or marker_m <= 0:
        raise ValueError('invalid actual marker size')
    board = {}
    for marker in data['markers']:
        marker_id = marker['id']
        points = np.asarray(marker['corners_m'],np.float64)
        if type(marker_id) is not int or not 0 <= marker_id < 50 or marker_id in board:
            raise ValueError('invalid/duplicate board id')
        if points.shape != (4,3) or not np.isfinite(points).all() or not np.allclose(points[:,2],0):
            raise ValueError('board must contain finite planar corners')
        if not np.allclose(np.linalg.norm(points-np.roll(points,1,axis=0),axis=1),nominal):
            raise ValueError('board corner edge lengths do not match marker size')
        board[marker_id] = points * (marker_m / nominal)
    if not board:
        raise ValueError('empty board')
    return board


def estimate_board(corners, ids, board, k, dist, min_side=20):
    values = [] if ids is None else [int(v) for v in ids.flatten()]
    objects, pixels, used = [], [], []
    known = False
    for index, marker_id in enumerate(values):
        if marker_id not in board or values.count(marker_id) != 1:
            continue
        known = True
        image = np.asarray(corners[index],np.float64).reshape(4,2)
        if not np.isfinite(image).all() or np.min(np.linalg.norm(image-np.roll(image,1,axis=0),axis=1)) < min_side:
            continue
        objects.extend(board[marker_id]); pixels.extend(image); used.append(marker_id)
    if not used:
        return None, [], 'marker_too_small' if known else 'marker_missing_or_duplicate'
    objects = np.asarray(objects, np.float64)
    pixels = np.asarray(pixels, np.float64)
    # Four corners have no useful redundancy. With multiple tags, prefer a
    # majority consensus, then use the planar solver on those corners only.
    if len(used) > 1:
        try:
            ok, _, _, inliers = cv2.solvePnPRansac(
                objects, pixels, k, dist, iterationsCount=100,
                reprojectionError=3.0, confidence=0.99, flags=cv2.SOLVEPNP_AP3P)
        except cv2.error:
            ok, inliers = False, None
        if ok and inliers is not None:
            indices = np.unique(inliers.reshape(-1))
            if len(indices) >= max(6, len(objects) // 2 + 1):
                pose = solve_points(objects[indices], pixels[indices], k, dist, max_error=3.0)
                if pose is not None:
                    accepted = sorted({used[int(i) // 4] for i in indices})
                    return pose, accepted, None
    # Preserve the permissive fallback: lack of consensus is not a new lost gate.
    pose = solve_points(objects,pixels,k,dist,max_error=float("inf"))
    return (pose,sorted(used),None) if pose else (None,[],'pose_quality_rejected')
