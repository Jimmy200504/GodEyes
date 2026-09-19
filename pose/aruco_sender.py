"""Head-mounted webcam -> fixed B -> metric pose API. CPU only."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import queue
import threading
import time
import uuid
from urllib.request import Request, urlopen
from urllib.error import URLError
import cv2
import sys
from aruco_pose import MarkerTracker, load_calibration


class LatestSender:
    def __init__(self, url):
        self.url = url
        self.delivery = dict(sent=0, errors=0, roundtrip_ms=None, capture_to_ack_ms=None)
        self.pending = queue.Queue(maxsize=1)
        self.stop = threading.Event()
        self.worker = threading.Thread(target=self.run, daemon=True)
        self.worker.start()

    def put(self, packet, captured):
        try:
            self.pending.get_nowait()
        except queue.Empty:
            pass
        self.pending.put_nowait((packet, captured))

    def run(self):
        last_warning = -float("inf")
        connection = None
        if self.url.startswith(("ws://", "wss://")):
            from websockets.sync.client import connect
            from websockets.exceptions import WebSocketException
        else:
            WebSocketException = URLError
        while not self.stop.is_set():
            try:
                packet, captured = self.pending.get(timeout=0.1)
            except queue.Empty:
                continue
            if time.monotonic() - captured > 0.25:
                continue
            try:
                started = time.monotonic()
                payload = json.dumps(packet, allow_nan=False)
                if self.url.startswith(('ws://', 'wss://')):
                    if connection is None:
                        connection = connect(self.url, proxy=None, open_timeout=.5,
                            close_timeout=.1, compression=None, max_size=1024)
                    connection.send(payload)
                    reply = json.loads(connection.recv(timeout=.25))
                    if reply.get('accepted') is not True:
                        raise ValueError('pose rejected')
                else:
                    request = Request(self.url, data=payload.encode(),
                        headers={"Content-Type": "application/json"}, method="POST")
                    with urlopen(request, timeout=0.25) as response:
                        response.read()
                now = time.monotonic()
                self.delivery = dict(sent=self.delivery['sent']+1, errors=self.delivery['errors'],
                    roundtrip_ms=round((now-started)*1000,2), capture_to_ack_ms=round((now-captured)*1000,2))
            except (URLError, OSError, WebSocketException, ValueError) as error:
                self.delivery = dict(self.delivery, errors=self.delivery['errors']+1)
                if connection is not None:
                    connection.close()
                    connection = None
                if time.monotonic() - last_warning > 5:
                    print(f"Pose receiver unavailable; retrying latest pose: {error}", flush=True)
                    last_warning = time.monotonic()

        if connection is not None:
            connection.close()

    def close(self):
        self.stop.set()
        self.worker.join(timeout=1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", default="0", help="camera index or /dev/video path")
    parser.add_argument("--calibration", required=True)
    parser.add_argument("--marker-m", type=float, default=0.053, help="measured BLACK square edge in meters (default: 0.053, measured printed B)")
    parser.add_argument("--id", type=int, default=0)
    parser.add_argument("--map-id", default="screen-B", help="change if physical B moves")
    parser.add_argument("--url", default="ws://127.0.0.1:8767/api/pose/publish")
    parser.add_argument("--max-error-px", type=float, default=2)
    parser.add_argument("--preview", action="store_true", help="requires GUI; Q exits")
    args = parser.parse_args()
    if not math.isfinite(args.max_error_px) or args.max_error_px <= 0:
        parser.error("--max-error-px must be positive and finite")
    k, dist, size = load_calibration(args.calibration)
    tracker = MarkerTracker(args.id, args.marker_m, k, dist, args.max_error_px)
    camera = int(args.camera) if args.camera.isdecimal() else args.camera
    cap = cv2.VideoCapture(camera, cv2.CAP_V4L2 if sys.platform.startswith("linux") else cv2.CAP_ANY)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, size[0]); cap.set(cv2.CAP_PROP_FRAME_HEIGHT, size[1])
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Best effort: backend may ignore this.
    if not cap.isOpened():
        cap.release()
        raise SystemExit("Cannot open camera")
    sender = LatestSender(args.url)
    session, start, seq = str(uuid.uuid4()), time.monotonic(), 0
    calibration_hash = hashlib.sha256(Path(args.calibration).read_bytes()).hexdigest()[:12]
    map_id = f"{args.map_id}:4x4-50:{args.id}:{args.marker_m}:{calibration_hash}"
    if len(map_id) > 128:
        sender.close(); cap.release()
        raise SystemExit("map-id is too long")
    previous_state = None
    last = dict(position=[0., 0., 0.], quaternion_xyzw=[0., 0., 0., 1.])
    try:
        while True:
            ok, frame = cap.read()
            captured = time.monotonic()
            if not ok:
                raise RuntimeError("Camera read failed; receiver will freeze stale pose")
            if (frame.shape[1], frame.shape[0]) != size:
                raise RuntimeError(f"Camera resolution differs from calibration {size}; refusing wrong intrinsics")
            estimate = tracker.estimate(frame)
            state = "tracking" if estimate else "lost"
            if estimate:
                last = estimate
            packet = dict(version=1, frame="opencv-c2w", source="aruco-B", session_id=session,
                map_id=map_id, seq=seq, capture_monotonic_ns=int((captured-start)*1e9),
                tracking=state, scale="metric", position=last["position"],
                quaternion_xyzw=last["quaternion_xyzw"])
            sender.put(packet, captured)
            seq += 1
            if state != previous_state:
                print(state, flush=True)
                previous_state = state
            if args.preview:
                cv2.putText(frame, state, (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 1,
                            (0, 255, 0) if estimate else (0, 0, 255), 2)
                cv2.imshow("ArUco B tracking", frame)
                if cv2.waitKey(1) & 0xff == ord("q"):
                    break
    except KeyboardInterrupt:
        pass
    finally:
        cap.release(); sender.close()
        if args.preview:
            cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
