"""Board: capture + JPEG only, with one latest frame and pull-paced WebSocket delivery."""
import argparse
import json
import struct
import threading
import time
import uuid

import cv2
from websockets.exceptions import ConnectionClosed
from websockets.sync.server import serve

MAX_MESSAGE = 2 * 1024 * 1024


def pack_frame(meta, jpeg):
    header = json.dumps(meta, allow_nan=False, separators=(',', ':')).encode()
    return struct.pack('!I', len(header)) + header + jpeg


def unpack_frame(message):
    if not isinstance(message, bytes) or not 4 < len(message) <= MAX_MESSAGE:
        raise ValueError('invalid frame message')
    size = struct.unpack('!I', message[:4])[0]
    if not 0 < size <= 4096 or 4 + size >= len(message):
        raise ValueError('invalid frame header')
    meta = json.loads(message[4:4 + size])
    if not isinstance(meta, dict) or meta.get('version') != 1:
        raise ValueError('unsupported frame protocol')
    for key in ('seq', 'capture_ns', 'age_ns'):
        if type(meta.get(key)) is not int or not 0 <= meta[key] < 2**53:
            raise ValueError('invalid ' + key)
    if not isinstance(meta.get('session'), str) or not 0 < len(meta['session']) <= 128:
        raise ValueError('invalid session')
    if (meta.get('width'), meta.get('height')) != (640, 480):
        raise ValueError('expected 640x480 frame')
    return meta, message[4 + size:]


class LatestFrame:
    def __init__(self):
        self.condition = threading.Condition()
        self.latest = None
        self.error = None

    def put(self, meta, jpeg, captured):
        with self.condition:
            self.latest = (meta, jpeg, captured)
            self.condition.notify_all()

    def after(self, seq, timeout=2):
        with self.condition:
            ready = self.condition.wait_for(
                lambda: self.error or (self.latest is not None and self.latest[0]['seq'] > seq), timeout)
            if self.error:
                raise RuntimeError(self.error)
            if not ready:
                raise TimeoutError('no new camera frame')
            meta, jpeg, captured = self.latest
            return dict(meta, age_ns=max(0, int((time.monotonic() - captured) * 1e9))), jpeg


def make_frame_server(frames, host='127.0.0.1', port=8781, color_frames=None):
    def handler(connection):
        source = frames if connection.request.path == '/frames' else (
            color_frames if connection.request.path == '/frames/color' else None)
        if source is None:
            connection.close(1008, 'unknown path')
            return
        seq = -1
        try:
            while True:
                if connection.recv(timeout=30) != 'next':
                    connection.close(1008, 'expected next')
                    return
                meta, jpeg = source.after(seq)
                connection.send(pack_frame(meta, jpeg))
                seq = meta['seq']
        except (ConnectionClosed, TimeoutError, RuntimeError):
            connection.close()
    return serve(handler, host, port, compression=None, max_size=64, max_queue=1, close_timeout=.5)


def capture_loop(device, quality, frames, stop, grayscale=False, color_frames=None):
    cap = cv2.VideoCapture(device, cv2.CAP_V4L2)
    start, session = time.monotonic(), str(uuid.uuid4())
    try:
        if not cap.isOpened():
            raise RuntimeError('cannot open camera (possibly occupied)')
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        seq = 0
        report = start
        while not stop.is_set():
            begun = time.monotonic()
            ok, frame = cap.read()
            captured = time.monotonic()
            if not ok or frame.shape[:2] != (480, 640):
                raise RuntimeError('camera read failed or resolution is not 640x480')
            # One capture, two independently consumed latest-frame slots. Only
            # the gray JPEG is requested by the Mac SLAM connection.
            streams = [(frames, grayscale)]
            if color_frames is not None:
                streams = [(frames, True), (color_frames, False)]
            encoded = []
            for destination, gray in streams:
                pixels = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if gray else frame
                ok, jpeg = cv2.imencode('.jpg', pixels, [cv2.IMWRITE_JPEG_QUALITY, quality])
                if not ok:
                    raise RuntimeError('JPEG encode failed')
                now = time.monotonic()
                meta = dict(version=1, session=session, seq=seq,
                            capture_ns=int((captured-start)*1e9), width=640, height=480,
                            pixel_format='gray8' if gray else 'bgr8',
                            capture_ms=round((captured-begun)*1000, 2),
                            encode_ms=round((now-captured)*1000, 2))
                encoded.append((destination, meta, jpeg.tobytes()))
            for destination, meta, jpeg in encoded:
                destination.put(meta, jpeg, captured)
            seq += 1
            if now - report >= 2:
                print(json.dumps(dict(meta, jpeg_bytes=len(jpeg))), flush=True)
                report = now
    except Exception as error:
        for destination in (frames, color_frames):
            if destination is not None:
                with destination.condition:
                    destination.error = str(error)
                    destination.condition.notify_all()
        print('Camera error: ' + str(error), flush=True)
    finally:
        cap.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--camera', default='/dev/video2')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8781)
    parser.add_argument('--dual-stream', action='store_true', help='Gray /frames for SLAM and color /frames/color for local gestures from one capture')
    parser.add_argument('--grayscale', action='store_true', help='Encode monochrome JPEG for Mac-side SLAM')
    parser.add_argument('--quality', type=int, choices=range(1, 101), default=90, metavar='1..100')
    args = parser.parse_args()
    frames, stop = LatestFrame(), threading.Event()
    color_frames = LatestFrame() if args.dual_stream else None
    device = int(args.camera) if args.camera.isdecimal() else args.camera
    with make_frame_server(frames, args.host, args.port, color_frames) as server:
        worker = threading.Thread(target=capture_loop, args=(device, args.quality, frames, stop, args.grayscale, color_frames), daemon=True)
        worker.start()
        if args.dual_stream:
            print(f'Gray SLAM: /frames; color gestures: /frames/color (one camera)', flush=True)
        print(f'JPEG stream ws://{args.host}:{args.port}/frames (no pose computation)', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            stop.set()
            worker.join(timeout=2)


if __name__ == '__main__':
    main()
