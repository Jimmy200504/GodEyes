"""Real local WebSocket contract; no camera or NPU required."""
import json
import threading
import time
import unittest

from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect
from gesture_control import STOP
from gesture_server import LatestGesture, make_server


class TransportTests(unittest.TestCase):
    def test_pull_translation_stop_expiry_and_invalid_requests(self):
        latest = LatestGesture()
        with make_server(latest, '127.0.0.1', 0) as server:
            port = server.socket.getsockname()[1]
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with connect(f'ws://127.0.0.1:{port}/api/gesture/ws') as socket:
                    latest.put('Point', dict(STOP, sideways=-1), time.monotonic())
                    socket.send('next')
                    packet = json.loads(socket.recv(timeout=2))
                    self.assertEqual(packet['command']['sideways'], -1)
                    self.assertEqual(packet['status'], 'tracking')
                    self.assertEqual(packet['version'], 2)
                    latest.put('None', STOP, time.monotonic())
                    socket.send('next')
                    packet = json.loads(socket.recv(timeout=2))
                    self.assertEqual(packet['gesture'], 'None')
                    self.assertEqual(packet['command'], STOP)
                    self.assertEqual(packet['motion_hold_ms'], 0)
                    latest.put('Close', STOP, time.monotonic())
                    socket.send('next')
                    self.assertEqual(json.loads(socket.recv(timeout=2))['command'], STOP)
                    latest.put('Point', dict(STOP, sideways=-1), time.monotonic() - 1)
                    socket.send('next')
                    packet = json.loads(socket.recv(timeout=2))
                    self.assertEqual(packet['command'], STOP)
                    self.assertEqual(packet['status'], 'stale')
                    socket.send('invalid')
                    with self.assertRaises(ConnectionClosed):
                        socket.recv(timeout=2)
                with connect(f'ws://127.0.0.1:{port}/wrong') as socket:
                    with self.assertRaises(ConnectionClosed):
                        socket.recv(timeout=2)
            finally:
                server.shutdown()
                thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
