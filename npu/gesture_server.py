#!/usr/bin/env python3
"""Run the compiled hand models on i.MX93 and publish expiring navigation commands.

Consumes pose/frame_stream.py's shared JPEG stream instead of opening the camera.
"""
import argparse
import json
from pathlib import Path
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pose'))
sys.path.insert(0, str(ROOT / 'npu' / 'references' / 'gesture'))
sys.path.insert(0, str(ROOT / 'npu'))

from gesture_control import GestureGate, STOP  # noqa: E402


class LatestGesture:
    def __init__(self, backend='unknown'):
        self.backend = backend
        self.lock = threading.Lock()
        self.packet = None
        self.captured = 0.0

    def put(self, gesture, command, captured, status='tracking', confidence=None, inference_ms=None, control_hint=None, hand_present=False, diagnostics=None):
        with self.lock:
            if gesture in ('Close', 'None', 'Unknown') or status != 'tracking':
                command = dict(STOP)
            self.packet = dict(version=2, gesture=gesture, command=command, status=status,
                               backend=self.backend, confidence=confidence, inference_ms=inference_ms, control_hint=control_hint, hand_present=hand_present, diagnostics=diagnostics)
            self.captured = captured

    def get(self):
        with self.lock:
            age = (time.monotonic() - self.captured) * 1000
            if self.packet is None:
                return dict(version=2, gesture='None', command=dict(STOP), age_ms=0.0,
                            status='waiting', backend=self.backend, confidence=None, inference_ms=None)
            if age >= 250:
                return dict(self.packet, command=dict(STOP), motion_hold_ms=0, age_ms=max(0.0, age), status='stale')
            return dict(self.packet, motion_hold_ms=0, age_ms=max(0.0, age))


def load_models(cpu=False):
    from hand_tracker import HandTracker
    from gesture_classifier import Classifier
    models = ROOT / 'npu' / 'models' / 'gesture'
    suffix = '.tflite' if cpu else '_vela.tflite'
    folder = models if cpu else models / 'vela'
    delegate = None if cpu else '/usr/lib/libethosu_delegate.so'
    if not cpu and not Path('/dev/ethosu0').exists():
        raise RuntimeError('NPU device /dev/ethosu0 is unavailable; run this service on the i.MX93 board')
    tracker = HandTracker(
        str(folder / ('palm_detection_full_quant' + suffix)),
        str(folder / ('hand_landmark_full_quant' + suffix)),
        str(ROOT / 'npu/references/gesture/anchors.csv'),
        external_delegate=delegate, num_hands=1,
    )
    return tracker, Classifier(str(models / 'keypoint_classifier.tflite'))


def classifier_landmarks(landmarks):
    """Rotate a copy to wrist-down orientation; keep raw coordinates for control."""
    import numpy as np
    relative = np.asarray(landmarks, dtype=float) - landmarks[0]
    up = relative[9]
    length = np.linalg.norm(up)
    if length < 1e-6:
        return relative
    up = up / length
    right = np.array([-up[1], up[0]])
    return np.column_stack((relative @ right, -(relative @ up)))


def infer_frame(frame, tracker, classifier):
    import numpy as np
    started = time.monotonic()
    detections = tracker(frame)
    diagnostics = getattr(tracker, 'diagnostics', {})
    diagnostics['tracking_ms'] = round((time.monotonic() - started) * 1000, 2)
    if not detections:
        return 'None', 0.0, None, None
    landmarks = detections[0][0]
    # Reject collapsed or nonfinite landmarks before classifier normalization.
    if not np.isfinite(landmarks).all() or np.max(np.abs(landmarks - landmarks[0])) < 1e-6:
        return 'Unknown', 0.0, [], None
    started = time.monotonic()
    scores = np.asarray(classifier(classifier_landmarks(landmarks))).reshape(-1)
    diagnostics['classification_ms'] = round((time.monotonic() - started) * 1000, 2)
    if scores.shape != (3,) or not np.isfinite(scores).all():
        return 'Unknown', 0.0, [], None
    index = int(np.argmax(scores))
    confidence = float(scores[index])
    return ('Open', 'Close', 'Point')[index], confidence, landmarks.tolist(), float(detections[0][2])


def inference_loop(args, tracker, classifier, latest, stop):
    import cv2
    import numpy as np
    from websockets.sync.client import connect
    from frame_stream import unpack_frame, MAX_MESSAGE
    gate = GestureGate()
    while not stop.is_set():
        try:
            with connect(args.frames, compression=None, max_size=MAX_MESSAGE, max_queue=1,
                         open_timeout=2, close_timeout=.5) as connection:
                last_key = None
                while not stop.is_set():
                    requested = time.monotonic()
                    connection.send('next')
                    meta, jpeg = unpack_frame(connection.recv(timeout=2))
                    received = time.monotonic()
                    if meta.get('pixel_format') == 'gray8':
                        raise ValueError('Gesture input is grayscale; use --dual-stream and /frames/color')
                    # Include request/transport time conservatively; clocks need not match.
                    captured = requested - meta['age_ns'] / 1e9
                    key = (meta['session'], meta['seq'])
                    if key == last_key:
                        continue
                    if time.monotonic() - captured >= .25:
                        latest.put('None', dict(STOP), time.monotonic(), status='stale')
                        continue
                    last_key = key
                    frame = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
                    if frame is None or frame.shape[:2] != (480, 640):
                        raise ValueError('invalid camera JPEG')
                    inference_started = time.monotonic()
                    gesture, confidence, landmarks, _ = infer_frame(frame, tracker, classifier)
                    inference_ms = (time.monotonic() - inference_started) * 1000
                    diagnostics = dict(getattr(tracker, 'diagnostics', {}),
                                       frame_roundtrip_ms=round((received-requested)*1000, 2),
                                       source_age_ms=round(meta['age_ns']/1e6, 2),
                                       decode_ms=round((inference_started-received)*1000, 2))
                    command = gate.update(gesture, confidence, landmarks, args.mirror)
                    if confidence < .75 and gesture != 'None':
                        gesture = 'Unknown'
                    latest.put(gesture, command, captured, confidence=confidence if gesture != 'None' else None,
                               inference_ms=round(inference_ms, 2), control_hint=gate.hint, hand_present=landmarks is not None,
                               diagnostics=diagnostics)
        except Exception as error:
            latest.put('None', dict(STOP), time.monotonic(), status='error')
            print(f'Gesture input stopped: {error}', file=sys.stderr, flush=True)
            stop.wait(.5)


def make_server(latest, host, port):
    from websockets.exceptions import ConnectionClosed
    from websockets.sync.server import serve

    def handler(connection):
        if connection.request.path != '/api/gesture/ws':
            connection.close(1008, 'unknown path')
            return
        try:
            while True:
                message = connection.recv(timeout=30)
                if message != 'next':
                    connection.close(1008, 'expected next')
                    return
                # Limit polling to 30 Hz; inference runs once for all viewers.
                time.sleep(1 / 30)
                connection.send(json.dumps(latest.get(), allow_nan=False))
        except (ConnectionClosed, TimeoutError):
            connection.close()

    return serve(handler, host, port, compression=None, max_size=64, max_queue=1, close_timeout=.5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frames', default='ws://127.0.0.1:8781/frames/color')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8782)
    parser.add_argument('--mirror', action='store_true', help='reverse camera left/right for a front-facing camera')
    parser.add_argument('--check-models', action='store_true', help='run one blank frame and exit')
    parser.add_argument('--cpu', action='store_true', help='explicit development fallback using original models; NOT NPU validation')
    args = parser.parse_args()
    tracker, classifier = load_models(args.cpu)
    if args.check_models:
        import numpy as np
        print(infer_frame(np.zeros((480, 640, 3), dtype=np.uint8), tracker, classifier))
        return
    latest, stop = LatestGesture('CPU' if args.cpu else 'NPU'), threading.Event()
    with make_server(latest, args.host, args.port) as server:
        worker = threading.Thread(target=inference_loop, args=(args, tracker, classifier, latest, stop), daemon=True)
        worker.start()
        print(f'Gesture control ws://{args.host}:{args.port}/api/gesture/ws ({"CPU" if args.cpu else "NPU"})', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            stop.set()
            worker.join(timeout=3)


if __name__ == '__main__':
    main()
