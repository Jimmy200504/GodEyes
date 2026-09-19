import json
import threading
import unittest
from websockets.sync.client import connect
from relay import Store, make_websocket_server
from test_relay import POSE

class WebSocketTests(unittest.TestCase):
    def setUp(self):
        self.store=Store()
        self.server=make_websocket_server(self.store,'127.0.0.1',0)
        self.worker=threading.Thread(target=self.server.serve_forever,daemon=True);self.worker.start()
        self.url=f'ws://127.0.0.1:{self.server.socket.getsockname()[1]}'
    def tearDown(self):
        self.server.shutdown();self.worker.join(timeout=2)
    def test_publish_and_push_latest_without_backlog(self):
        with connect(self.url+'/api/pose/publish',proxy=None) as publisher, connect(self.url+'/api/pose/ws',proxy=None) as viewer:
            initial=json.loads(viewer.recv(timeout=1));self.assertIsNone(initial['pose'])
            for seq in range(10):
                publisher.send(json.dumps(dict(POSE,seq=seq)))
                self.assertTrue(json.loads(publisher.recv(timeout=1))['accepted'])
            viewer.send(json.dumps({'ack':initial['sent_monotonic_ms']}))
            latest=json.loads(viewer.recv(timeout=1));self.assertEqual(latest['pose']['seq'],9)
            viewer.send(json.dumps({'ack':latest['sent_monotonic_ms']}))
            publisher.send(json.dumps(dict(POSE,seq=10,tracking='lost')));publisher.recv(timeout=1)
            update=json.loads(viewer.recv(timeout=1));self.assertEqual(update['pose']['tracking'],'lost')
    def test_reconnect_gets_current_pose_and_age(self):
        self.store.put(dict(POSE,seq=12))
        for _ in range(2):
            with connect(self.url+'/api/pose/ws',proxy=None) as viewer:
                latest=json.loads(viewer.recv(timeout=1))
                self.assertEqual(latest['pose']['seq'],12)
                self.assertGreaterEqual(latest['age_ms'],0)
    def test_reject_duplicate_publisher_sequence(self):
        with connect(self.url+'/api/pose/publish',proxy=None) as publisher:
            publisher.send(json.dumps(POSE));publisher.recv(timeout=1)
            publisher.send(json.dumps(POSE))
            from websockets.exceptions import ConnectionClosed
            with self.assertRaises(ConnectionClosed):publisher.recv(timeout=1)
