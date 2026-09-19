"""Quick webcam detection check, no calibration or pose receiver required."""
import argparse
import cv2
import sys
from aruco_pose import DICTIONARY


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", default="/dev/video2")
    parser.add_argument("--id", type=int, default=0, choices=range(50))
    parser.add_argument("--headless", action="store_true", help="print state only; Ctrl-C exits")
    args = parser.parse_args()
    cap = cv2.VideoCapture(int(args.camera) if args.camera.isdecimal() else args.camera, cv2.CAP_V4L2 if sys.platform.startswith("linux") else cv2.CAP_ANY)
    detector = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(DICTIONARY),
                                    cv2.aruco.DetectorParameters())
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    previous = None
    try:
        if not args.headless:
            cv2.namedWindow("ArUco B check - Q exits", cv2.WINDOW_NORMAL)
            cv2.resizeWindow("ArUco B check - Q exits", 800, 600)
        if not cap.isOpened():
            raise SystemExit("Cannot open camera")
        while True:
            ok, frame = cap.read()
            if not ok:
                raise SystemExit("Camera read failed")
            corners, ids, _ = detector.detectMarkers(frame)
            found = ids is not None and list(ids.flatten()).count(args.id) == 1
            state = "B detected (detection only, no depth)" if found else "B missing or duplicate ID"
            if state != previous:
                print(state, flush=True)
                previous = state
            if not args.headless:
                if ids is not None:
                    cv2.aruco.drawDetectedMarkers(frame, corners, ids)
                cv2.putText(frame, state, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, .6,
                            (0, 255, 0) if found else (0, 0, 255), 2)
                cv2.imshow("ArUco B check - Q exits", frame)
                if cv2.waitKey(1) & 0xff == ord("q"):
                    break
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        if not args.headless:
            cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
