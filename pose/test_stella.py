"""Bridge contracts only; the Mac setup runs a separate real-worker smoke test."""
import json
from unittest.mock import patch
import unittest

import cv2
import numpy as np
from frame_stream import pack_frame
from mac_frame_pose import ROOT
from mac_frame_slam import SlamFrameProcessor
from stella_backend import StellaSlam, adapt_reply, camera_settings
from test_frame_stream import metadata


def reply(**changes):
    return dict(dict(state='Tracking', map_id=1, map_points=100, tracked_points=35,
                     position=[1., -2., 3.], quaternion_xyzw=[0., .6, 0., .8]), **changes)


class StellaTests(unittest.TestCase):
    def test_c2w_and_epoch(self):
        packet, sample = adapt_reply(reply(), 'session', 2, 123)
        self.assertEqual(packet['position'], [1., -2., 3.])
        self.assertEqual(packet['quaternion_xyzw'], [0., .6, 0., .8])
        self.assertEqual(packet['source'], 'stella-vslam-local')
        self.assertEqual(sample['inliers'], 35)
        self.assertNotEqual(packet['map_id'], adapt_reply(reply(map_id=2), 'session', 3, 456)[0]['map_id'])

    def test_lost_pose_is_never_reused(self):
        for state, expected in [('Initializing', 'initializing'), ('Lost', 'lost'), ('unknown', 'lost')]:
            packet, _ = adapt_reply(reply(state=state), 's', 1, 1)
            self.assertEqual(packet['tracking'], expected)
            self.assertEqual(packet['position'], [0., 0., 0.])
        self.assertEqual(adapt_reply(reply(position=None), 's', 1, 1)[0]['tracking'], 'lost')
        with self.assertRaises(RuntimeError):
            adapt_reply(reply(position=[float('nan'), 0, 0]), 's', 1, 1)

    def test_rectified_calibration_uses_nested_yaml(self):
        K = np.array([[700., 0, 321.], [0, 701., 260.], [0, 0, 1.]])
        camera = json.loads(camera_settings(K))['Camera']
        self.assertEqual((camera['fx'], camera['fy'], camera['cx'], camera['cy']), (700, 701, 321, 260))
        self.assertEqual(camera['color_order'], 'Gray')
        self.assertEqual([camera[k] for k in ('k1', 'k2', 'k3', 'p1', 'p2')], [0]*5)

    def test_jpeg_reset_and_source_time(self):
        class FakeWorker:
            def __init__(self, *args, **kwargs):
                self.requests = []
            def track(self, gray, capture_ns, reset):
                self.requests.append((gray.shape, capture_ns, reset))
                return reply()
            def close(self):
                self.closed = True
        with patch('stella_backend.Worker', FakeWorker):
            # Existing files stand in for executable/vocabulary; FakeWorker is explicit.
            factory = lambda K, _: StellaSlam(K, __file__, __file__)
            processor = SlamFrameProcessor(ROOT/'pose/calibrations/logitech-c270-640x480.json',
                                           orb_factory=factory, backend_name='stella-vslam')
            worker = processor.orb.worker
            try:
                jpeg = cv2.imencode('.jpg', np.zeros((480, 640, 3), np.uint8))[1].tobytes()
                first, _, status = processor.process(pack_frame(metadata(3), jpeg))
                self.assertEqual(status['backend'], 'stella-vslam')
                self.assertEqual(status['stella_state'], 'Tracking')
                second = processor.process(pack_frame(metadata(4), jpeg))[0]
                restarted = processor.process(pack_frame(metadata(0, 'new'), jpeg))[0]
                self.assertEqual(worker.requests, [((480, 640), 150_000_000, True),
                                                  ((480, 640), 200_000_000, False),
                                                  ((480, 640), 0, True)])
                self.assertEqual(first['session_id'], second['session_id'])
                self.assertNotEqual(first['session_id'], restarted['session_id'])
                processor.reset.set()
                processor.process(pack_frame(metadata(1, 'new'), jpeg))
                self.assertTrue(worker.requests[-1][2])
            finally:
                processor.close()
            self.assertTrue(worker.closed)


if __name__ == '__main__':
    unittest.main()
