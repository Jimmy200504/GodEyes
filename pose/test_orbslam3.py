"""Bridge contract tests; these do not claim to run the native SLAM algorithm."""
import sys
import unittest

import cv2
import numpy as np
from frame_stream import pack_frame
from mac_frame_slam import SlamFrameProcessor
from mac_frame_pose import ROOT
from orbslam3_backend import Worker, OrbSlam3, adapt_reply, camera_settings
from test_frame_stream import metadata


def reply(state=2, **changes):
    return dict(dict(state=state, map_id=7, map_revision=0, map_points=100,
                     tracked_points=45, capture_ns=50_000_000,
                     position=[1., -2., 3.], quaternion_xyzw=[0., .6, 0., .8]), **changes)


class OrbBridgeTests(unittest.TestCase):
    def test_optical_pose_is_not_converted_twice(self):
        packet, status = adapt_reply(reply(), 'test', 3, 50_000_000)
        self.assertEqual(packet['position'], [1., -2., 3.])
        self.assertEqual(packet['quaternion_xyzw'], [0., .6, 0., .8])
        self.assertEqual(packet['scale'], 'arbitrary')
        self.assertEqual(packet['source'], 'orb-slam3-local')
        self.assertEqual(status['inliers'], 45)

    def test_lost_states_and_missing_pose_never_report_tracking(self):
        for state, expected in [(0, 'initializing'), (1, 'initializing'),
                                (3, 'relocalizing'), (4, 'lost'), (-1, 'lost')]:
            packet, _ = adapt_reply(reply(state, position=None, quaternion_xyzw=None), 's', 1, 1)
            self.assertEqual(packet['tracking'], expected)
        packet, _ = adapt_reply(reply(position=None), 's', 2, 2)
        self.assertEqual(packet['tracking'], 'lost')
        with self.assertRaises(RuntimeError):
            adapt_reply(reply(position=[float('nan'), 0., 0.]), 's', 2, 2)

    def test_auto_map_switch_and_loop_correction_change_epoch(self):
        original = adapt_reply(reply(), 's', 1, 1)[0]['map_id']
        for changes in [dict(map_id=8), dict(map_revision=1)]:
            changed = adapt_reply(reply(**changes), 's', 2, 2)[0]['map_id']
            self.assertNotEqual(original, changed)

    def test_reset_restarts_session_and_signals_native_worker(self):
        class FakeWorker:
            def track(self, gray, capture_ns, reset):
                self.last = capture_ns, reset
                return reply(capture_ns=capture_ns)
        backend = OrbSlam3.__new__(OrbSlam3)
        backend.worker = FakeWorker()
        backend.reset()
        gray = np.zeros((480, 640), np.uint8)
        first = backend.process(gray, 100)[0]
        self.assertEqual(backend.worker.last, (100, True))
        second = backend.process(gray, 200)[0]
        self.assertEqual(backend.worker.last, (200, False))
        self.assertEqual(first['session_id'], second['session_id'])
        backend.reset()
        reset = backend.process(gray, 0)[0]
        self.assertEqual(backend.worker.last, (0, True))
        self.assertNotEqual(first['session_id'], reset['session_id'])

    def test_rectified_settings_do_not_apply_distortion_twice(self):
        K = np.array([[700., 0, 321.], [0, 701., 260.], [0, 0, 1.]])
        config = cv2.FileStorage(camera_settings(K, 1200), cv2.FILE_STORAGE_READ | cv2.FILE_STORAGE_MEMORY)
        self.assertEqual(config.getNode('Camera1.fx').real(), 700.)
        self.assertEqual(config.getNode('Camera1.cy').real(), 260.)
        self.assertEqual(config.getNode('ORBextractor.nFeatures').real(), 1200)
        for name in ('k1', 'k2', 'p1', 'p2', 'k3'):
            self.assertEqual(config.getNode('Camera1.'+name).real(), 0)
        config.release()

    def test_jpeg_pipeline_passes_source_time_and_restarts_backend(self):
        class FakeBackend:
            def __init__(self, K, features):
                self.resets = 0
            def reset(self):
                self.resets += 1
            def process(self, gray, capture_ns):
                self.last = gray, capture_ns
                return adapt_reply(reply(), f's{self.resets}', capture_ns, capture_ns)
            def close(self):
                self.closed = True
        processor = SlamFrameProcessor(str(ROOT/'pose/calibrations/logitech-c270-640x480.json'),
                                       orb_factory=FakeBackend)
        jpeg = cv2.imencode('.jpg', np.zeros((480, 640, 3), np.uint8))[1].tobytes()
        packet, _, status = processor.process(pack_frame(metadata(3), jpeg))
        self.assertEqual(packet['capture_monotonic_ns'], 150_000_000)
        self.assertEqual(processor.orb.last[0].shape, (480, 640))
        self.assertEqual(status['backend'], 'orb-slam3')
        self.assertEqual(processor.orb.resets, 1)
        processor.process(pack_frame(metadata(4), jpeg))
        self.assertEqual(processor.orb.resets, 1)
        processor.process(pack_frame(metadata(0, 'restart'), jpeg))
        self.assertEqual(processor.orb.last[1], 0)
        self.assertEqual(processor.orb.resets, 2)
        processor.close()
        self.assertTrue(processor.orb.closed)

    def test_binary_pipe_roundtrip_and_timestamp_mismatch(self):
        code = '''
import sys, struct, json
print('{"ready":true,"protocol":1}', flush=True)
while True:
    header = sys.stdin.buffer.read(16)
    if not header: break
    flags, size, ns = struct.unpack('!IIQ', header)
    image = sys.stdin.buffer.read(size)
    print(json.dumps(dict(capture_ns=ns if flags else ns+1,
                          flags=flags, size=len(image), pixel=image[0])), flush=True)
'''
        worker = Worker([sys.executable, '-u', '-c', code], startup_timeout=5)
        try:
            sample = worker.track(np.full((480, 640), 33, np.uint8), 456, reset=True)
            self.assertEqual(sample, dict(capture_ns=456, flags=1, size=307200, pixel=33))
            with self.assertRaises(RuntimeError):
                worker.track(np.zeros((480, 640), np.uint8), 789)
        finally:
            worker.close()

    def test_dead_worker_fails_instead_of_reusing_pose(self):
        worker = Worker([sys.executable, '-u', '-c',
                         'print(\'{"ready":true,"protocol":1}\', flush=True)'], startup_timeout=5)
        try:
            with self.assertRaises(RuntimeError):
                worker.track(np.zeros((480, 640), np.uint8), 0)
        finally:
            worker.close()

    def test_stalled_reply_has_a_deadline(self):
        worker = Worker([sys.executable, '-u', '-c', '''
import sys, time
print('{"ready":true,"protocol":1}', flush=True)
sys.stdin.buffer.read(16 + 640*480)
time.sleep(30)
'''], startup_timeout=5)
        try:
            with self.assertRaisesRegex(RuntimeError, 'timed out'):
                worker.track(np.zeros((480, 640), np.uint8), 0, timeout=.1)
        finally:
            worker.process.terminate()
            worker.close()


if __name__ == '__main__':
    unittest.main()
