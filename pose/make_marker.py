"""Generate B with a white margin; measure the BLACK square after printing."""
import argparse
import cv2
from aruco_pose import DICTIONARY

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--id", type=int, default=0, choices=range(50))
    parser.add_argument("--output", default="marker-B.png")
    args = parser.parse_args()
    marker = cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(DICTIONARY), args.id, 600)
    marker = cv2.copyMakeBorder(marker, 100, 100, 100, 100, cv2.BORDER_CONSTANT, value=255)
    if not cv2.imwrite(args.output, marker):
        raise SystemExit("could not write marker")
    print(f"Saved {args.output}; measure black square outer edge, excluding white margin.")
