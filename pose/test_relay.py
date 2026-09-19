import copy
import json
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from relay import make_server, validate, Store

POSE = dict(version=1, frame="opencv-c2w", session_id="test", map_id="room", source="test",
    seq=0, capture_monotonic_ns=0, tracking="tracking", scale="metric",
    position=[0, 0, 0], quaternion_xyzw=[0, 0, 0, 1])

class RelayTests(unittest.TestCase):
    def test_invalid_geometry(self):
        for key, value in (("position", [float('nan'), 0, 0]), ("quaternion_xyzw", [0, 0, 0, 0]),
                           ("frame", "w2c"), ("seq", True), ("scale", "unknown")):
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate(dict(POSE, **{key: value}))

    def test_ordering_and_restart(self):
        store = Store()
        store.put(copy.deepcopy(POSE))
        with self.assertRaises(ValueError):
            store.put(copy.deepcopy(POSE))
        store.put(dict(POSE, session_id="restart"))
        self.assertGreaterEqual(store.get()["age_ms"], 0)

    def test_http_roundtrip(self):
        server = make_server("127.0.0.1", 0)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        url = f"http://127.0.0.1:{server.server_port}/api/pose"
        try:
            with urlopen(url) as response:
                self.assertIsNone(json.load(response)["pose"])
            req = Request(url, data=json.dumps(POSE).encode(), method="POST")
            with urlopen(req) as response:
                self.assertTrue(json.load(response)["accepted"])
            with urlopen(url) as response:
                self.assertEqual(json.load(response)["pose"], POSE)
            with self.assertRaises(HTTPError) as error:
                urlopen(req)
            self.assertEqual(error.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

if __name__ == "__main__":
    unittest.main()
