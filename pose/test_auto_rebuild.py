import unittest
import cv2
import numpy as np
from slam_tracker import Tracker
from slam_sender import adapt_pose


class AutoRebuildTests(unittest.TestCase):
    def setUp(self):
        cv2.setRNGSeed(71)
        rng = np.random.default_rng(71)
        self.K = np.array([[500., 0, 320], [0, 500., 240], [0, 0, 1.]])
        self.xyz = rng.uniform([-1, -1, 4], [1, 1, 8], (100, 3))
        self.desc = rng.integers(0, 256, (100, 32), dtype=np.uint8)
        self.tracker = Tracker(self.K, optical_flow=False)
        self.tracker.xyz, self.tracker.desc = self.xyz.copy(), self.desc.copy()
        self.tracker.anchor_desc = self.desc.copy()
        self.gray = np.zeros((480, 640), np.uint8)
        self.observe()
        self.assertTrue(self.tracker.process(self.gray, 0)['valid'])

    def observe(self, center=0., blank=False):
        pixels = cv2.projectPoints(self.xyz, np.zeros(3), np.array([-center, 0., 0.]), self.K, None)[0].reshape(-1, 2)
        keypoints = [] if blank else [cv2.KeyPoint(float(x), float(y), 7) for x, y in pixels]
        desc = None if blank else self.desc
        class Observations:
            def detectAndCompute(self, *_): return keypoints, desc
        self.tracker.orb = Observations()

    def test_sustained_loss_resets_once_then_real_views_initialize(self):
        original = self.tracker.session
        self.observe(blank=True)
        self.assertEqual(self.tracker.process(self.gray, 100_000_000)['status'], 'lost')
        before = self.tracker.process(self.gray, 2_099_000_000)
        self.assertEqual(before['status'], 'lost')
        rebuilt = self.tracker.process(self.gray, 2_100_000_000)
        self.assertEqual(rebuilt['status'], 'initializing')
        self.assertEqual(rebuilt['auto_resets'], 1)
        self.assertNotEqual(rebuilt['session_id'], original)
        packet = adapt_pose(rebuilt, 2_100_000_000)
        self.assertEqual(packet['previous_session_id'], original)
        self.assertEqual(packet['reset_reason'], 'lost_timeout')
        self.assertEqual(self.tracker.process(self.gray, 10_000_000_000)['auto_resets'], 1)
        self.observe()
        self.assertEqual(self.tracker.process(self.gray, 10_100_000_000)['status'], 'initializing')
        self.observe(.5)
        restored = self.tracker.process(self.gray, 10_200_000_000)
        self.assertTrue(restored['valid'], restored)
        self.assertEqual(restored['session_id'], rebuilt['session_id'])

    def test_short_recovery_cancels_timer_and_disabled_mode_never_resets(self):
        original = self.tracker.session
        self.observe(blank=True)
        self.tracker.process(self.gray, 100_000_000)
        self.observe()
        self.assertTrue(self.tracker.process(self.gray, 1_900_000_000)['valid'])
        self.observe(blank=True)
        self.assertEqual(self.tracker.process(self.gray, 2_200_000_000)['lost_duration_ms'], 0)
        self.assertEqual(self.tracker.session, original)
        self.tracker.lost_reset_seconds = 0
        self.assertEqual(self.tracker.process(self.gray, 100_000_000_000)['status'], 'lost')
        self.assertEqual(self.tracker.session, original)

    def test_clock_reversal_restarts_loss_timer_and_manual_reset_clears_flags(self):
        self.observe(blank=True)
        self.tracker.process(self.gray, 1_000_000_000)
        self.assertEqual(self.tracker.process(self.gray, 500_000_000)['lost_duration_ms'], 0)
        self.tracker.process(self.gray, 2_500_000_000)
        self.assertEqual(self.tracker.auto_resets, 1)
        self.tracker.reset()
        self.assertIsNone(self.tracker.previous_session_id)
        self.assertIsNone(self.tracker.reset_reason)

    def test_quality_eviction_preserves_reliable_old_points_and_alignment(self):
        t = self.tracker
        t.max_points = 30
        t.frame = 100
        t.point_hits = np.ones(100, dtype=int)
        t.point_seen = np.zeros(100, dtype=int)
        t.point_hits[:20] = 10
        t.point_seen[:20] = 99
        new_xyz = self.xyz[-10:] + [0, 0, 1]
        new_desc = self.desc[-10:].copy()
        t.append_points(new_xyz, new_desc)
        self.assertEqual(len(t.xyz), 30)
        np.testing.assert_allclose(t.xyz[:20], self.xyz[:20])
        np.testing.assert_array_equal(t.desc[:20], self.desc[:20])
        np.testing.assert_array_equal(t.anchor_desc, t.desc)
        self.assertEqual(len(t.point_seen), 30)
        self.assertEqual(t.points_pruned, 80)

    def test_local_search_failure_falls_back_to_full_map(self):
        t = self.tracker
        t.xyz = np.concatenate((self.xyz, self.xyz + [20, 0, 0]))
        t.desc = np.concatenate((self.desc, np.bitwise_xor(self.desc, 255)))
        t.anchor_desc = t.desc.copy()
        # Last pose sees the first region. A sudden move observes only the other.
        pixels = cv2.projectPoints(t.xyz[100:], np.zeros(3), np.array([-20., 0, 0]), self.K, None)[0].reshape(-1, 2)
        t.last_tracking_frame = t.frame
        result = t.update(pixels, t.desc[100:].copy())
        self.assertTrue(result['valid'], result)
        self.assertLess(result['local_map_points'], 200)
        self.assertEqual(result['tracking_method'], 'orb')
        self.assertAlmostEqual(result['position'][0], 20., places=4)


if __name__ == '__main__': unittest.main()
