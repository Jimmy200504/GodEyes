"""Markerless CPU sparse-map experiment -> existing GodEyes pose relay.

This initial SLAM branch implements VO and bounded mapping, without loop closure/BA.
"""
import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
from aruco_pose import load_calibration
from aruco_sender import LatestSender
from slam_tracker import Tracker


def adapt_pose(sample, captured_ns):
    # Prototype uses right/up/back for both bases. Restore optical c2w convention
    # expected by RemotePoseTracker; do not convert the basis twice in the renderer.
    position = sample['position'] or [0., 0., 0.]
    q = sample['orientation_xyzw'] or [0., 0., 0., 1.]
    return dict(version=1, frame='opencv-c2w', source='cpu-sparse-vo',
                session_id=sample['session_id'], map_id='sparse-' + sample['session_id'],
                seq=sample['sequence'], capture_monotonic_ns=captured_ns,
                tracking=sample['status'] if sample['status'] in ('tracking', 'initializing') else 'lost',
                reset_reason=sample.get('reset_reason'), previous_session_id=sample.get('previous_session_id'),
                scale='arbitrary', position=[position[0], -position[1], -position[2]],
                quaternion_xyzw=[q[0], -q[1], -q[2], q[3]])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--camera', default='/dev/video2')
    p.add_argument('--calibration', required=True)
    p.add_argument('--url', default='ws://127.0.0.1:8867/api/pose/publish')
    p.add_argument('--port', type=int, default=8866)
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--features', type=int, default=800)
    p.add_argument('--threads', type=int, default=2)
    args = p.parse_args()
    if args.features < 50 or args.threads < 1:
        p.error('features must be >= 50 and threads >= 1')
    cv2.setNumThreads(args.threads)
    K, dist, size = load_calibration(args.calibration)
    source = int(args.camera) if args.camera.isdecimal() else args.camera
    cap = cv2.VideoCapture(source, cv2.CAP_V4L2)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, size[0])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, size[1])
    cap.set(cv2.CAP_PROP_FPS, 30)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    if not cap.isOpened():
        raise SystemExit('Cannot open camera')
    tracker = Tracker(K, args.features)
    maps = cv2.initUndistortRectifyMap(K, dist, None, K, size, cv2.CV_16SC2)
    sender = LatestSender(args.url)
    lock = threading.Lock()
    state = dict(jpeg=None, captured=None, status=dict(error=None, ids=[], fps=0))
    reset = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, code, data, content_type='application/json'):
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            with lock:
                jpeg, captured, status = state['jpeg'], state['captured'], dict(state['status'])
            if self.path == '/frame.jpg':
                return self.reply(200, jpeg, 'image/jpeg') if jpeg else self.reply(503, b'{}')
            if self.path == '/status':
                status['age_ms'] = (time.monotonic()-captured)*1000 if captured else None
                status['delivery'] = sender.delivery
                return self.reply(200, json.dumps(status).encode())
            self.reply(404, b'{}')

        def do_POST(self):
            if self.path != '/reset':
                return self.reply(404, b'{}')
            reset.set()
            self.reply(202, b'{"reset_pending":true}')

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    start = time.monotonic()
    previous = start
    previous_status = None
    last_preview = 0.
    try:
        while True:
            ok, frame = cap.read()
            captured = time.monotonic()
            if not ok:
                raise RuntimeError('Camera read failed')
            if (frame.shape[1], frame.shape[0]) != size:
                raise RuntimeError('Camera resolution differs from calibration')
            if reset.is_set():
                tracker.reset()
                reset.clear()
            began = time.monotonic()
            gray = cv2.remap(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), *maps, cv2.INTER_LINEAR)
            sample = tracker.process(gray)
            packet = adapt_pose(sample, int((captured-start)*1e9))
            sender.put(packet, captured)
            elapsed = time.monotonic()-began
            status = dict(ids=[], error=None, fps=1/max(captured-previous, 1e-6),
                          pose_tracking=sample['status'], map_points=sample['map_points'],
                          inliers=sample['inliers'], processing_ms=elapsed*1000,
                          reprojection_error_px=sample['reprojection_error_px'],
                          session_id=sample['session_id'])
            previous = captured
            jpeg = None
            if captured-last_preview >= .2:
                # Draw map projections, without another feature detection pass.
                preview = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
                if sample['valid'] and tracker.xyz is not None:
                    T = tracker.T
                    xyz = tracker.xyz @ T[:, :3].T + T[:, 3]
                    visible = xyz[:, 2] > .01
                    uv = xyz[visible] @ K.T
                    uv = uv[:, :2] / uv[:, 2:3]
                    for x, y in uv:
                        if 0 <= x < size[0] and 0 <= y < size[1]:
                            cv2.circle(preview, (int(x), int(y)), 2, (70, 230, 170), -1)
                cv2.putText(preview, sample['status'], (12, 28), cv2.FONT_HERSHEY_SIMPLEX, .7, (0, 220, 255), 2)
                success, encoded = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 70])
                if success:
                    jpeg = encoded.tobytes()
                last_preview = captured
            with lock:
                state.update(captured=captured, status=status)
                if jpeg is not None:
                    state['jpeg'] = jpeg
            if sample['status'] != previous_status:
                print(json.dumps(status), flush=True)
                previous_status = sample['status']
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        sender.close()
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
