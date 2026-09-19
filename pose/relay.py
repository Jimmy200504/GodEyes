"""Development pose receiver, run on the rendering computer (Python stdlib)."""
import argparse
import json
import math
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def validate(p):
    if not isinstance(p, dict):
        raise ValueError("pose must be an object")
    if p.get("version") != 1 or p.get("frame") != "opencv-c2w":
        raise ValueError("expected version 1, opencv-c2w")
    for key in ("session_id", "map_id", "source"):
        if not isinstance(p.get(key), str) or not 0 < len(p[key]) <= 128:
            raise ValueError("invalid " + key)
    for key in ("seq", "capture_monotonic_ns"):
        if type(p.get(key)) is not int or p[key] < 0 or p[key] > 2**53 - 1:
            raise ValueError("invalid " + key)
    if p.get("tracking") not in ("initializing", "tracking", "lost", "relocalizing"):
        raise ValueError("invalid tracking state")
    if p.get("scale") not in ("metric", "arbitrary", "estimated"):
        raise ValueError("invalid scale")
    for key, count in (("position", 3), ("quaternion_xyzw", 4)):
        a = p.get(key)
        if not isinstance(a, list) or len(a) != count or not all(type(v) in (int, float) and math.isfinite(v) for v in a):
            raise ValueError("invalid " + key)
    if abs(math.hypot(*p["quaternion_xyzw"]) - 1) > 0.001:
        raise ValueError("quaternion must be normalized")
    return p


class Store:
    def __init__(self):
        self.lock = threading.Condition()
        self.revision = 0
        self.pose = None
        self.received = 0

    def put(self, p):
        validate(p)
        with self.lock:
            if self.pose and self.pose["session_id"] == p["session_id"] and p["seq"] <= self.pose["seq"]:
                raise ValueError("out-of-order sequence")
            self.pose, self.received = p, time.monotonic()
            self.revision += 1
            self.lock.notify_all()

    def get(self):
        with self.lock:
            age = (time.monotonic() - self.received) * 1000 if self.pose else None
            return {"pose": self.pose, "age_ms": age}


    def wait(self, revision, timeout=.1):
        with self.lock:
            self.lock.wait_for(lambda: self.revision != revision, timeout)
            return self.revision, self.get()


def make_websocket_server(store, host, port):
    from websockets.sync.server import serve
    from websockets.exceptions import ConnectionClosed

    def handler(connection):
        if connection.request.path == '/api/pose/publish':
            try:
                for message in connection:
                    store.put(json.loads(message))
                    connection.send('{"accepted":true}')
            except (ConnectionClosed, ValueError):
                connection.close(1008, 'invalid pose')
            return
        if connection.request.path != '/api/pose/ws':
            connection.close(1008, 'unknown path')
            return
        revision, rtt = -1, 0
        try:
            while True:
                revision, data = store.wait(revision)
                sent = time.monotonic()
                data.update(sent_monotonic_ms=sent*1000, transport_rtt_ms=rtt)
                connection.send(json.dumps(data, separators=(',', ':'), allow_nan=False))
                # One in-flight update per client. Slow clients skip superseded poses.
                ack = json.loads(connection.recv(timeout=1))
                if ack != {'ack': data['sent_monotonic_ms']}:
                    connection.close(1008, 'expected acknowledgement')
                    return
                rtt = (time.monotonic()-sent)*1000
        except (ConnectionClosed, TimeoutError, ValueError):
            connection.close()

    return serve(handler, host, port, compression=None, max_size=4096,
                 max_queue=1, close_timeout=1)


def make_server(host, port, store=None):
    store = store or Store()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, body):
            data = json.dumps(body, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path != "/api/pose":
                return self.reply(404, {"error": "not found"})
            self.reply(200, store.get())

        def do_POST(self):
            if self.path != "/api/pose":
                return self.reply(404, {"error": "not found"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096:
                    raise ValueError("body must be 1..4096 bytes")
                self.connection.settimeout(2)
                store.put(json.loads(self.rfile.read(size)))
            except (ValueError, OSError) as error:
                return self.reply(400, {"error": str(error)})
            self.reply(200, {"accepted": True})

    return ThreadingHTTPServer((host, port), Handler)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument('--ws-port', type=int, default=8767)
    args = parser.parse_args()
    print(f"Pose receiver http://{args.host}:{args.port}/api/pose", flush=True)
    store = Store()
    http = make_server(args.host, args.port, store)
    with make_websocket_server(store, args.host, args.ws_port) as websocket:
        worker = threading.Thread(target=websocket.serve_forever, daemon=True)
        worker.start()
        try:
            http.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            websocket.shutdown()
            http.server_close()
