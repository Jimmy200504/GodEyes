"""Mac: receive board JPEGs, solve ArUco/RANSAC, and serve pose + preview locally."""
import argparse
import json
from pathlib import Path
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
from websockets.sync.client import connect
from websockets.exceptions import WebSocketException
from aruco_pose import DICTIONARY
from frame_stream import MAX_MESSAGE, unpack_frame
from pose_pipeline import PosePipeline
from relay import Store, make_server, make_websocket_server

ROOT = Path(__file__).resolve().parents[1]


class FrameProcessor:
    def __init__(self, calibration, board, marker_m=.053):
        self.calibration, self.board, self.marker_m = calibration, board, marker_m
        self.pipeline = None
        self.session = None
        self.seq = -1
        params = cv2.aruco.DetectorParameters()
        params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self.detector = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(DICTIONARY), params)
        # Validate calibration before starting any network services.
        PosePipeline(marker_m, calibration, False, board)

    def process(self, message):
        meta, jpeg = unpack_frame(message)
        if meta['session'] != self.session:
            self.pipeline = PosePipeline(self.marker_m, self.calibration, False, self.board)
            self.pipeline.start = 0  # Source-relative capture timestamps; no cross-host clock subtraction.
            self.session, self.seq = meta['session'], -1
        if meta['seq'] <= self.seq:
            raise ValueError('out-of-order frame')
        self.seq = meta['seq']
        begun = time.monotonic()
        frame = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        decoded = time.monotonic()
        if frame is None or frame.shape[:2] != (480, 640):
            raise ValueError('invalid JPEG or decoded resolution')
        corners, ids, _ = self.detector.detectMarkers(frame)
        detected = time.monotonic()
        packet, residual = self.pipeline.update(corners, ids, (640, 480), meta['capture_ns'] / 1e9)
        solved = time.monotonic()
        packet['source'] = 'aruco-B-mac'
        if ids is not None:
            cv2.aruco.drawDetectedMarkers(frame, corners, ids)
        preview = cv2.resize(frame, (320, 240), interpolation=cv2.INTER_AREA)
        ok, encoded = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if not ok:
            raise ValueError('preview encode failed')
        timings = dict(decode=round((decoded-begun)*1000, 2),
                       detect=round((detected-decoded)*1000, 2),
                       pose=round((solved-detected)*1000, 2))
        return packet, encoded.tobytes(), dict(
            ids=[] if ids is None else ids.flatten().tolist(),
            used_ids=packet['used_ids'], target_ids=packet['target_ids'],
            pose_tracking=packet['tracking'], pose_reason=packet['tracking_reason'],
            reprojection_error_px=residual, timings_ms=timings)


class Preview:
    def __init__(self):
        self.lock = threading.Lock()
        self.jpeg = None
        self.updated = None
        self.state = dict(ids=[], fps=0, error='waiting for board frames')


def make_preview_server(preview, port, reset=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            if self.path != "/reset" or reset is None:
                self.send_error(404)
                return
            reset.set()
            body = b'{"reset_pending":true}'
            self.send_response(202)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split('?', 1)[0]
            with preview.lock:
                if path == '/status':
                    body = json.dumps(dict(preview.state, age_ms=None if preview.updated is None else
                        round((time.monotonic()-preview.updated)*1000))).encode()
                    code, mime = 200, 'application/json'
                elif path == '/frame.jpg':
                    body = preview.jpeg or b''
                    code, mime = (200 if body else 503), 'image/jpeg'
                elif path == '/calibration':
                    code, mime = 200, 'text/plain; charset=utf-8'
                    body = 'Mac experiment uses the saved C270 calibration; live calibration is available in board pose mode.'.encode()
                else:
                    code, mime, body = 404, 'text/plain', b'Not found'
            try:
                self.send_response(code)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def receive(url, processor, store, preview):
    last_report = time.monotonic()
    frames = total_bytes = stale = skipped = 0
    last_seq, last_session = -1, None
    while True:
        try:
            with connect(url, proxy=None, compression=None, max_size=MAX_MESSAGE,
                         max_queue=1, open_timeout=3, close_timeout=.5) as connection:
                while True:
                    started = time.monotonic()
                    connection.send('next')
                    message = connection.recv(timeout=3)
                    received = time.monotonic()
                    meta, _ = unpack_frame(message)
                    request_ms = (received-started)*1000
                    # Conservative age bound includes request travel and waiting for a frame.
                    # No assumption that board and Mac clocks are synchronized.
                    captured_bound = started - meta['age_ns']/1e9
                    if received-captured_bound > .25:
                        stale += 1
                        with preview.lock:
                            preview.state.update(error='frame older than 250 ms (conservative bound)', stale_frames=stale)
                        continue
                    try:
                        packet, jpeg, status = processor.process(message)
                    except cv2.error as error:
                        # A connected camera cannot fix a processing bug by reconnecting.
                        raise RuntimeError('Frame processing failed after receiving camera data: ' + str(error)) from error
                    now = time.monotonic()
                    if now-captured_bound > .25:
                        stale += 1
                        with preview.lock:
                            preview.state.update(status, error='processing exceeded 250 ms age budget',
                                                 stale_frames=stale,
                                                 age_upper_bound_ms=round((now-captured_bound)*1000, 2))
                        continue
                    if meta['session'] == last_session:
                        skipped += max(0, meta['seq']-last_seq-1)
                    last_seq, last_session = meta['seq'], meta['session']
                    with store.lock:
                        store.put(packet)
                        # Preserve image age in relay output rather than resetting it at solve time.
                        store.received = captured_bound
                    frames += 1
                    total_bytes += len(message)
                    elapsed = now-last_report
                    with preview.lock:
                        preview.jpeg, preview.updated = jpeg, captured_bound
                        preview.state = dict(status, error=None, fps=round(frames/elapsed, 1),
                            request_frame_ms=round(request_ms, 2),
                            age_upper_bound_ms=round((now-captured_bound)*1000, 2),
                            stream_mbps=round(total_bytes*8/elapsed/1e6, 2),
                            board_capture_ms=meta.get('capture_ms'), board_encode_ms=meta.get('encode_ms'),
                            stale_frames=stale, skipped_frames=skipped)
                        report = dict(preview.state)
                    if elapsed >= 2:
                        print(json.dumps(report), flush=True)
                        frames = total_bytes = 0
                        last_report = now
        except (OSError, WebSocketException, TimeoutError, ValueError, cv2.error) as error:
            with preview.lock:
                preview.state.update(error=str(error))
            print('Frame stream reconnecting: ' + str(error), flush=True)
            time.sleep(.5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frames', default='ws://127.0.0.1:8781/frames')
    parser.add_argument('--calibration', default=str(ROOT/'pose/calibrations/logitech-c270-640x480.json'))
    parser.add_argument('--board', default=str(ROOT/'public/markers/aruco-board-A4-55mm-ids0-3.json'))
    parser.add_argument('--marker-m', type=float, default=.053)
    parser.add_argument('--http-port', type=int, default=8765)
    parser.add_argument('--preview-port', type=int, default=8766)
    parser.add_argument('--ws-port', type=int, default=8767)
    args = parser.parse_args()
    processor = FrameProcessor(args.calibration, args.board, args.marker_m)
    store, preview = Store(), Preview()
    servers = []
    try:
        for create in (lambda: make_server('127.0.0.1', args.http_port, store),
                       lambda: make_preview_server(preview, args.preview_port),
                       lambda: make_websocket_server(store, '127.0.0.1', args.ws_port)):
            server = create()
            threading.Thread(target=server.serve_forever, daemon=True).start()
            servers.append(server)
        print('Mac pose receiver ready; run the local website on port 5181.', flush=True)
        receive(args.frames, processor, store, preview)
    except KeyboardInterrupt:
        pass
    finally:
        for server in servers:
            server.shutdown()
            if hasattr(server, 'server_close'):
                server.server_close()


if __name__ == '__main__':
    main()
