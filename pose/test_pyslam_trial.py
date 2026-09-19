import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

import yaml

from pyslam_trial import ROOT, instrument, prepare_config, summarize


class TrialTests(unittest.TestCase):
    def test_loss_metrics_separate_initialization_recovery_and_trailing_loss(self):
        rows = [dict(timestamp=t, state=s, track_ms=ms) for t, s, ms in [
            (0, 'NOT_INITIALIZED', 1), (1, 'OK', 2), (2, 'LOST', 3),
            (3, 'LOST', 4), (4, 'OK', 5), (5, 'LOST', 6), (7, 'LOST', 7)]]
        result = summarize(rows)
        self.assertEqual(result['recovered_lost_durations_s'], [2])
        self.assertEqual(result['unrecovered_lost_observed_s'], 2)
        self.assertEqual(result['tracking_ok_fraction'], 2/7)
        self.assertEqual(result['track_ms_p95'], 7)
        self.assertEqual(result['track_ms_median'], 4)

    def test_no_rows_is_not_success(self):
        self.assertIsNone(summarize([])['tracking_ok_fraction'])
        self.assertIsNone(summarize([])['track_ms_p95'])

    def test_instrumentation_preserves_single_track_call_and_records_state(self):
        source = ('def step():\n' +
                  '    if True:\n        if True:\n            if True:\n                if True:\n                    if True:\n'
                  '                        slam.track(img, img_right, depth, img_id, timestamp)  # main SLAM function\n')
        calls = []
        slam = types.SimpleNamespace(track=lambda *args: calls.append(args),
                                     tracking=types.SimpleNamespace(state=types.SimpleNamespace(name='OK')))
        with tempfile.TemporaryDirectory() as temp:
            metrics = Path(temp)/'metrics.jsonl'
            import time, os
            namespace = dict(slam=slam, img='real image', img_right=None, depth=None,
                             img_id=3, timestamp=1.5, time=time, os=os, json=json)
            with patch.dict(os.environ, GODEYES_TRIAL_METRICS=str(metrics)):
                exec(instrument(source), namespace)
                namespace['step']()
            self.assertEqual(calls, [('real image', None, None, 3, 1.5)])
            self.assertEqual(json.loads(metrics.read_text())['state'], 'OK')
        with self.assertRaises(ValueError):
            instrument('new upstream call')

    def fixture(self, temp):
        base = Path(temp)
        upstream, rec, out = base/'upstream', base/'recording', base/'output'
        for directory in (upstream, rec, out):
            directory.mkdir()
        (upstream/'config.yaml').write_text('{}')
        (rec/'recording.json').write_text(json.dumps({'frames': 2, 'capture_fps': 15.0}))
        (rec/'times.txt').write_text('0\n0.067\n')
        for i in range(2):
            (rec/f'{i:06d}.jpg').write_bytes(b'placeholder')
        (rec/'calibration.json').write_bytes((ROOT/'pose/calibrations/logitech-c270-640x480.json').read_bytes())
        return upstream, rec, out

    def test_camera_preserves_distortion_and_capture_timestamps(self):
        with tempfile.TemporaryDirectory() as temp:
            upstream, rec, out = self.fixture(temp)
            config = yaml.safe_load(prepare_config(upstream, rec, out).read_text())
            camera = yaml.safe_load((out/'camera.yaml').read_text())
            calibration = json.loads((rec/'calibration.json').read_text())
            self.assertEqual(camera['Camera.k3'], calibration['dist_coeffs'][4])
            self.assertEqual(camera['Camera.fx'], calibration['camera_matrix'][0][0])
            self.assertEqual(camera['Camera.RGB'], 0)
            self.assertEqual(config['FOLDER_DATASET']['timestamps'], 'times.txt')
            self.assertTrue(config['GLOBAL_PARAMETERS']['kUseLoopClosing'])
            self.assertFalse(config['GLOBAL_PARAMETERS']['kUseDepthEstimatorInFrontEnd'])

    def test_corrupt_or_incomplete_recording_rejected(self):
        for timestamps in ('0\n', '1\n0\n', '0\nnan\n', '0\n0\n'):
            with self.subTest(timestamps=timestamps), tempfile.TemporaryDirectory() as temp:
                upstream, rec, out = self.fixture(temp)
                (rec/'times.txt').write_text(timestamps)
                with self.assertRaises(ValueError):
                    prepare_config(upstream, rec, out)


if __name__ == '__main__':
    unittest.main()
