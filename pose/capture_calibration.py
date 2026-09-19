"""Desktop capture helper: SPACE saves a checkerboard image, Q exits."""
import argparse
import time
from pathlib import Path
import cv2
import sys

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--output", default="calibration")
    args = parser.parse_args()
    folder = Path(args.output)
    folder.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(args.camera, cv2.CAP_V4L2 if sys.platform.startswith("linux") else cv2.CAP_ANY)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
    try:
        if not cap.isOpened():
            raise SystemExit("Cannot open camera")
        print("SPACE: save, Q: exit. Keep lens focus fixed for calibration AND tracking.")
        while True:
            ok, frame = cap.read()
            if not ok:
                raise SystemExit("Camera read failed")
            if (frame.shape[1], frame.shape[0]) != (args.width, args.height):
                raise SystemExit("Camera did not accept requested dimensions")
            cv2.imshow("Calibration capture: SPACE saves, Q exits", frame)
            key = cv2.waitKey(1) & 0xff
            if key == ord("q"):
                break
            if key == ord(" "):
                path = folder / f"view-{time.time_ns()}.png"
                if not cv2.imwrite(str(path), frame):
                    raise SystemExit("Could not save image")
                print(path)
    finally:
        cap.release()
        cv2.destroyAllWindows()
