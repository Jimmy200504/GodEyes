import threading
import unittest
from urllib.request import Request, urlopen
import cv2
import numpy as np
from frame_stream import pack_frame
from mac_frame_pose import ROOT, Preview, make_preview_server
from mac_frame_slam import SlamFrameProcessor
from test_frame_stream import metadata
from relay import validate


class LocalSlamTests(unittest.TestCase):
    def test_stream_timestamp_order_restart_and_reset(self):
        processor = SlamFrameProcessor(str(ROOT/'pose/calibrations/logitech-c270-640x480.json'))
        jpeg = cv2.imencode('.jpg', np.zeros((480, 640), np.uint8))[1].tobytes()
        packet, preview, status = processor.process(pack_frame(metadata(3), jpeg))
        validate(packet)
        self.assertEqual(packet['capture_monotonic_ns'], 150_000_000)
        self.assertEqual(packet['scale'], 'arbitrary')
        self.assertEqual(status['processing_size'], [320, 240])
        self.assertEqual(status['capture_size'], [640, 480])
        self.assertEqual(packet['tracking'], 'initializing')
        self.assertEqual(cv2.imdecode(np.frombuffer(preview, np.uint8), 1).shape[:2], (240, 320))
        with self.assertRaises(ValueError):
            processor.process(pack_frame(metadata(3), jpeg))
        with self.assertRaises(ValueError):
            processor.process(pack_frame(metadata(4), b'bad jpeg'))
        # A corrupt image does not consume the sequence or mutate the map.
        next_packet = processor.process(pack_frame(metadata(4), jpeg))[0]
        self.assertEqual(packet['map_id'], next_packet['map_id'])
        restarted = processor.process(pack_frame(metadata(0, 'restart'), jpeg))[0]
        self.assertNotEqual(packet['map_id'], restarted['map_id'])
        processor.reset.set()
        reset = processor.process(pack_frame(metadata(1, 'restart'), jpeg))[0]
        self.assertNotEqual(restarted['map_id'], reset['map_id'])
        self.assertFalse(processor.reset.is_set())

    def test_color_and_monochrome_jpeg_use_the_same_slam_protocol(self):
        # Use genuinely different B/G/R channels, not just a gray image in a
        # three-channel array, to catch color-input shape/conversion regressions.
        color = np.zeros((480, 640, 3), np.uint8)
        color[:, :213, 0] = 255
        color[:, 213:426, 1] = 255
        color[:, 426:, 2] = 255
        processor = SlamFrameProcessor(str(ROOT/'pose/calibrations/logitech-c270-640x480.json'))
        try:
            for seq, (image, pixel_format) in enumerate([
                (color, 'bgr8'), (cv2.cvtColor(color, cv2.COLOR_BGR2GRAY), 'gray8'),
            ]):
                with self.subTest(pixel_format=pixel_format):
                    jpeg = cv2.imencode('.jpg', image)[1].tobytes()
                    packet, preview, status = processor.process(pack_frame(
                        dict(metadata(seq), pixel_format=pixel_format), jpeg))
                    validate(packet)
                    self.assertEqual(status['processing_size'], [320, 240])
                    self.assertEqual(cv2.imdecode(np.frombuffer(preview, np.uint8), cv2.IMREAD_UNCHANGED).shape, (240, 320))
                    # Gesture service's IMREAD_COLOR produces the same input
                    # shape for either stream; gray channels must be identical.
                    gesture_frame = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
                    self.assertEqual(gesture_frame.shape, (480, 640, 3))
                    if pixel_format == 'gray8':
                        np.testing.assert_array_equal(gesture_frame[:, :, 0], gesture_frame[:, :, 1])
                        np.testing.assert_array_equal(gesture_frame[:, :, 1], gesture_frame[:, :, 2])
        finally:
            processor.close()

    def test_intrinsics_and_optional_features_survive_downsampling(self):
        path = str(ROOT/'pose/calibrations/logitech-c270-640x480.json')
        full = SlamFrameProcessor(path, process_width=640, synthetic_bridge=True)
        small = SlamFrameProcessor(path, process_width=320, synthetic_bridge=True)
        np.testing.assert_allclose(small.tracker.K, np.diag([.5, .5, 1.]) @ full.tracker.K)
        self.assertEqual(small.maps[0].shape[:2], (240, 320))
        with self.assertRaises(ValueError):
            SlamFrameProcessor(path, process_width=0)
        with self.assertRaises(ValueError):
            SlamFrameProcessor(path, orb_factory=lambda *args: None, process_width=320)

    def test_reset_endpoint_queues_reset(self):
        event = threading.Event()
        server = make_preview_server(Preview(), 0, event)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            url = f'http://127.0.0.1:{server.server_port}/reset'
            with urlopen(Request(url, method='POST'), timeout=2) as response:
                self.assertEqual(response.status, 202)
            self.assertTrue(event.is_set())
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)
