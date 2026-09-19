"""Synthetic geometry and appearance tests; not measured camera accuracy."""
import unittest
import cv2
import numpy as np
from slam_tracker import Tracker, matches


class AdaptiveMapTests(unittest.TestCase):
    def setUp(self):
        cv2.setRNGSeed(21)
        rng = np.random.default_rng(21)
        self.K = np.array([[500., 0, 320], [0, 500., 240], [0, 0, 1.]])
        self.xyz = rng.uniform([-1.5, -1., 4.], [1.5, 1., 8.], (100, 3))
        self.desc = rng.integers(0, 256, (100, 32), dtype=np.uint8)
        self.tracker = Tracker(self.K)
        self.tracker.xyz = self.xyz.copy()
        self.tracker.desc = self.desc.copy()
        self.tracker.anchor_desc = self.desc.copy()
        self.tracker.reference = (self.project(0), self.desc.copy(), self.tracker.T.copy())

    def project(self, yaw):
        return cv2.projectPoints(self.xyz, np.array([0., yaw, 0.]), np.zeros(3),
                                 self.K, None)[0].reshape(-1, 2)

    def test_gradual_appearance_change_preserves_yaw_tracking(self):
        current = self.desc.copy()
        for step in range(1, 17):
            current[:, step-1] ^= 255
            sample = self.tracker.update(self.project(step*.01), current)
            self.assertTrue(sample['valid'], sample)
            self.assertGreater(sample['descriptor_updates'], 90)
            self.assertAlmostEqual(sample['orientation_xyzw'][1], np.sin(step*.005), places=4)
        # A fixed initial template no longer provides enough matches.
        self.assertLess(len(matches(self.desc, current)), 12)
        np.testing.assert_array_equal(self.tracker.anchor_desc, self.desc)
        # Turning back can recover from birth descriptors without a new map/session.
        session = sample['session_id']
        recovered = self.tracker.update(self.project(0), self.desc)
        self.assertTrue(recovered['valid'], recovered)
        self.assertEqual(recovered['tracking_method'], 'orb-relocalize')
        self.assertEqual(recovered['session_id'], session)

    def test_geometric_outliers_cannot_change_map_appearance(self):
        current = self.desc.copy()
        current[:, 0] ^= 255
        pixels = self.project(.02)
        pixels[:20] += [90, -70]
        sample = self.tracker.update(pixels, current)
        self.assertTrue(sample['valid'], sample)
        np.testing.assert_array_equal(self.tracker.desc[:20], self.desc[:20])
        np.testing.assert_array_equal(self.tracker.desc[20:], current[20:])

    def test_lost_does_not_learn_and_reset_discards_appearance(self):
        before = self.tracker.desc.copy()
        packet = self.tracker.update(np.empty((0, 2)), None)
        self.assertFalse(packet['valid'])
        self.assertEqual(packet['descriptor_updates'], 0)
        np.testing.assert_array_equal(self.tracker.desc, before)
        self.tracker.reset()
        self.assertIsNone(self.tracker.anchor_desc)

    def test_map_growth_prunes_both_descriptor_banks_together(self):
        rng = np.random.default_rng(29)
        xyz = np.concatenate((self.xyz, rng.uniform([-1, -1, 4], [1, 1, 8], (100, 3))))
        desc = np.concatenate((self.desc, rng.integers(0, 256, (100, 32), dtype=np.uint8)))
        a = cv2.projectPoints(xyz, np.zeros(3), np.zeros(3), self.K, None)[0].reshape(-1, 2)
        b = cv2.projectPoints(xyz, np.zeros(3), np.array([-.5, 0., 0.]), self.K, None)[0].reshape(-1, 2)
        self.tracker.max_points = 120
        self.tracker.reference = (a, desc.copy(), self.tracker.T.copy())
        self.tracker.frame = 9
        self.assertTrue(self.tracker.update(b, desc)['valid'])
        self.assertEqual(len(self.tracker.xyz), 120)
        # Spatial thinning intentionally changes which new points are retained.
        ids = [np.flatnonzero(np.all(desc == d, axis=1))[0] for d in self.tracker.desc]
        self.assertEqual(len(set(ids)), 120)
        np.testing.assert_allclose(self.tracker.xyz, xyz[ids], atol=1e-5)
        np.testing.assert_array_equal(self.tracker.anchor_desc, desc[ids])


if __name__ == '__main__':
    unittest.main()
