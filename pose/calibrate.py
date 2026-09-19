"""Calibrate from checkerboard photos captured at the tracking resolution/focus."""
import argparse
import glob
import json
from pathlib import Path
import cv2
import numpy as np


def calibrate(paths, columns, rows, square_size):
    if columns < 2 or rows < 2 or not np.isfinite(square_size) or square_size <= 0:
        raise ValueError("invalid inner-corner grid or square size")
    points = np.zeros((rows * columns, 3), np.float32)
    points[:, :2] = np.mgrid[:columns, :rows].T.reshape(-1, 2) * square_size
    objects, images, used = [], [], []
    size = None
    for path in paths:
        image = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise ValueError(f"cannot read {path}")
        current_size = (image.shape[1], image.shape[0])
        if size is not None and current_size != size:
            raise ValueError("all calibration images must have the same dimensions")
        size = current_size
        found, corners = cv2.findChessboardCornersSB(image, (columns, rows))
        if found:
            objects.append(points.copy()); images.append(corners); used.append(path)
    if len(images) < 12:
        raise ValueError(f"need at least 12 detected checkerboard views; got {len(images)}")
    rms, k, dist, _, _ = cv2.calibrateCamera(objects, images, size, None, None)
    if not np.isfinite(rms) or not np.isfinite(k).all() or not np.isfinite(dist).all():
        raise ValueError("calibration failed")
    return dict(camera_matrix=k.tolist(), dist_coeffs=dist.flatten().tolist(),
                image_size=list(size), rms_reprojection_px=float(rms), images_used=used)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", required=True, help="quoted glob, e.g. calibration/*.jpg")
    parser.add_argument("--columns", type=int, default=9, help="INNER corners, not squares")
    parser.add_argument("--rows", type=int, default=6)
    parser.add_argument("--square-m", type=float, required=True)
    parser.add_argument("--output", default="camera.json")
    args = parser.parse_args()
    try:
        result = calibrate(sorted(glob.glob(args.images)), args.columns, args.rows, args.square_m)
        Path(args.output).write_text(json.dumps(result, indent=2))
        print(f"Saved {args.output}; RMS={result['rms_reprojection_px']:.3f} px. Inspect calibration quality before use.")
    except ValueError as error:
        parser.exit(1, str(error) + "\n")
