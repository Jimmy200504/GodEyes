"""Relocalization must survive eviction from the active 3D point set."""
import unittest
import cv2
import numpy as np
from slam_tracker import Tracker


class RecoveryViewTests(unittest.TestCase):
    def setUp(self):
        cv2.setRNGSeed(57)
        self.rng = np.random.default_rng(57)
        self.K = np.array([[500., 0, 320], [0, 500., 240], [0, 0, 1.]])
        self.xyz = self.rng.uniform([-1.5, -1., 4.], [1.5, 1., 8.], (120, 3))
        self.desc = self.rng.integers(0, 256, (120, 32), dtype=np.uint8)
        self.pixels = cv2.projectPoints(self.xyz, np.zeros(3), np.zeros(3), self.K, None)[0].reshape(-1, 2)
        self.tracker = Tracker(self.K)
        self.tracker.xyz = self.xyz.copy()
        self.tracker.desc = self.desc.copy()
        self.tracker.anchor_desc = self.desc.copy()
        self.tracker.remember_view(self.pixels, self.desc)
        # Simulate all old points being evicted after the active map filled up.
        self.tracker.xyz = self.xyz + [4, 0, 0]
        self.tracker.desc = self.rng.integers(0, 256, (120, 32), dtype=np.uint8)
        self.tracker.anchor_desc = self.tracker.desc.copy()

    def test_retired_points_recover_pose_without_resetting_world(self):
        session = self.tracker.session
        observed = cv2.projectPoints(self.xyz, np.array([0., .12, 0.]),
                                    np.array([-.15, 0., 0.]), self.K, None)[0].reshape(-1, 2)
        sample = self.tracker.update(observed, self.desc)
        self.assertTrue(sample['valid'], sample)
        self.assertEqual(sample['tracking_method'], 'keyframe-relocalize')
        self.assertEqual(sample['session_id'], session)
        self.assertAlmostEqual(sample['orientation_xyzw'][1], np.sin(.06), places=4)
        R = cv2.Rodrigues(np.array([0., .12, 0.]))[0]
        expected = np.diag([1., -1., -1.]) @ (-R.T @ np.array([-.15, 0., 0.]))
        np.testing.assert_allclose(sample['position'], expected, atol=1e-4)
        self.assertTrue(self.tracker.update(observed, self.desc)['valid'])

    def test_descriptor_matches_without_geometry_cannot_restore_map(self):
        before = self.tracker.xyz.copy()
        pixels = self.rng.uniform([0, 0], [640, 480], self.pixels.shape)
        sample = self.tracker.update(pixels, self.desc)
        self.assertFalse(sample['valid'])
        self.assertEqual(sample['tracking_reason'], 'pose_geometry_rejected')
        np.testing.assert_array_equal(self.tracker.xyz, before)

    def test_no_correspondences_diagnostic(self):
        sample = self.tracker.update(np.empty((0, 2)), None)
        self.assertEqual(sample['tracking_reason'], 'insufficient_correspondences')
        self.assertEqual(sample['map_matches'], 0)
        self.assertEqual(sample['feature_count'], 0)

    def test_snapshots_are_independent_bounded_and_resettable(self):
        saved = self.tracker.recovery_views[0][0].copy()
        self.tracker.xyz = self.xyz.copy()
        self.tracker.desc = self.desc.copy()
        for _ in range(9):
            self.tracker.remember_view(self.pixels, self.desc)
        self.assertEqual(len(self.tracker.recovery_views), 6)
        self.assertTrue(all(len(xyz) <= 250 for xyz, _ in self.tracker.recovery_views))
        self.tracker.xyz[:] = 0
        np.testing.assert_array_equal(self.tracker.recovery_views[0][0], saved)
        self.tracker.reset()
        self.assertEqual(self.tracker.recovery_views, [])


if __name__ == '__main__':
    unittest.main()
