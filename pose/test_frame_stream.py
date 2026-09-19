import json
from pathlib import Path
import struct
import tempfile
import threading
import time
import unittest
import cv2
import numpy as np
from websockets.sync.client import connect
from aruco_pose import DICTIONARY, square_points
from frame_stream import LatestFrame, make_frame_server, pack_frame, unpack_frame
from mac_frame_pose import FrameProcessor
from relay import validate


def metadata(seq=0, session='test'):
    return dict(version=1, session=session, seq=seq, capture_ns=seq*50_000_000,
                age_ns=0, width=640, height=480)


class FrameStreamTests(unittest.TestCase):
    def test_reject_malformed_frames(self):
        for message in ('text', b'', struct.pack('!I', 9000)+b'x',
                        pack_frame(dict(metadata(), width=320), b'jpeg'),
                        pack_frame(dict(metadata(), capture_ns=-1), b'jpeg')):
            with self.subTest(message=message), self.assertRaises(ValueError):
                unpack_frame(message)

    def test_latest_only_and_capture_failure(self):
        frames = LatestFrame()
        for seq in range(10):
            frames.put(metadata(seq), bytes([seq]), time.monotonic()-.01)
        meta, jpeg = frames.after(0)
        self.assertEqual(meta['seq'], 9)
        self.assertEqual(jpeg, b'\x09')
        self.assertGreaterEqual(meta['age_ns'], 10_000_000)
        with self.assertRaises(TimeoutError):
            frames.after(9, timeout=.01)
        frames.error = 'camera disconnected'
        with self.assertRaises(RuntimeError):
            frames.after(0)

    def test_websocket_skips_backlog_and_reconnects(self):
        frames = LatestFrame()
        server = make_frame_server(frames, port=0)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        url = f'ws://127.0.0.1:{server.socket.getsockname()[1]}/frames'
        try:
            frames.put(metadata(), b'jpeg', time.monotonic())
            with connect(url, proxy=None) as connection:
                connection.send('next')
                self.assertEqual(unpack_frame(connection.recv(timeout=1))[0]['seq'], 0)
                for seq in range(1, 20):
                    frames.put(metadata(seq), b'jpeg', time.monotonic())
                connection.send('next')
                self.assertEqual(unpack_frame(connection.recv(timeout=1))[0]['seq'], 19)
            with connect(url, proxy=None) as connection:
                connection.send('next')
                self.assertEqual(unpack_frame(connection.recv(timeout=1))[0]['seq'], 19)
        finally:
            server.shutdown()
            worker.join(timeout=2)

    def test_jpeg_detection_pose_timestamps_and_restart(self):
        k = np.array([[800.,0,320],[0,800.,240],[0,0,1]])
        r, t = np.array([2.8,.1,.1]), np.array([0.,0.,.5])
        marker = cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(DICTIONARY),0,200)
        pixels = cv2.projectPoints(square_points(.053),r,t,k,np.zeros(5))[0]
        transform = cv2.getPerspectiveTransform(np.float32([[0,0],[199,0],[199,199],[0,199]]),
                                                pixels.reshape(4,2).astype(np.float32))
        image = cv2.warpPerspective(marker,transform,(640,480),borderValue=255)
        jpeg = cv2.imencode('.jpg',image,[cv2.IMWRITE_JPEG_QUALITY,90])[1].tobytes()
        with tempfile.TemporaryDirectory() as folder:
            calibration = Path(folder)/'camera.json'
            calibration.write_text(json.dumps(dict(camera_matrix=k.tolist(),dist_coeffs=[0]*5,image_size=[640,480])))
            processor = FrameProcessor(str(calibration), None)
            message = pack_frame(metadata(3),jpeg)
            packet, preview, status = processor.process(message)
            validate(packet)
            self.assertEqual(packet['tracking'],'tracking')
            self.assertEqual(packet['capture_monotonic_ns'],150_000_000)
            self.assertEqual(status['used_ids'],[0])
            self.assertEqual(cv2.imdecode(np.frombuffer(preview,np.uint8),1).shape[:2],(240,320))
            np.testing.assert_allclose(packet['position'],-cv2.Rodrigues(r)[0].T@t,atol=.035)
            with self.assertRaises(ValueError):
                processor.process(message)
            restarted = processor.process(pack_frame(metadata(0,'restart'),jpeg))[0]
            self.assertNotEqual(restarted['session_id'],packet['session_id'])
            self.assertEqual(restarted['capture_monotonic_ns'],0)
            with self.assertRaises(ValueError):
                processor.process(pack_frame(metadata(1,'restart'),b'not jpeg'))


if __name__ == '__main__':
    unittest.main()
