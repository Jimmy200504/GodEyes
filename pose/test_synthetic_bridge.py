"""Real image warps and endpoint validation; fallback integration forces one rejection."""
import unittest
from unittest.mock import patch
import cv2
import numpy as np
from slam_tracker import midpoint_image, track_midpoint, solve_pose
import test_flow


class SyntheticBridgeTests(unittest.TestCase):
    def setUp(self):
        self.scene = test_flow.FlowTests()
        self.scene.setUp()

    def test_midpoint_is_an_image_and_endpoints_follow_real_rotation(self):
        a, b = self.scene.render(0), self.scene.render(.016)
        mid = midpoint_image(a, b)
        self.assertEqual(mid.shape, a.shape)
        self.assertEqual(mid.dtype, np.uint8)
        self.assertFalse(np.array_equal(mid, a))
        self.assertFalse(np.array_equal(mid, b))
        points, keep, _ = track_midpoint(a, b, self.scene.pixels)
        self.assertGreater(len(points), 40)
        error = np.linalg.norm(points-self.scene.project(.016)[keep], axis=1)
        self.assertLess(np.median(error), 1.)

    def test_synthesized_content_cannot_validate_a_blank_real_endpoint(self):
        points, keep, _ = track_midpoint(self.scene.render(0), np.zeros((480, 640), np.uint8), self.scene.pixels)
        self.assertLess(len(points), 12)
        self.assertIsNone(solve_pose(self.scene.K, self.scene.xyz[keep], points))

    def test_fallback_validates_real_endpoint_and_keeps_real_timestamp(self):
        tracker = self.scene.seeded_tracker()
        tracker.synthetic_bridge = True
        rejected = False
        def reject_first_valid(K, xyz, pixels):
            nonlocal rejected
            if len(xyz) >= 12 and not rejected:
                rejected = True
                return None
            return solve_pose(K, xyz, pixels)
        with patch('slam_tracker.solve_pose', side_effect=reject_first_valid):
            sample = tracker.process(self.scene.render(.016), 100_000_000)
        self.assertTrue(sample['valid'], sample)
        self.assertEqual(sample['tracking_method'], 'synthetic-bridge')
        self.assertEqual(sample['bridge_attempted'], 1)
        self.assertEqual(tracker.previous_ns, 100_000_000)
        self.assertEqual(sample['new_points'], 0)
        self.assertAlmostEqual(sample['orientation_xyzw'][1], np.sin(.008), delta=.003)

    def test_expired_reference_cannot_run_synthesis(self):
        tracker = self.scene.seeded_tracker()
        tracker.synthetic_bridge = True
        with patch('slam_tracker.track_midpoint', side_effect=AssertionError('expired image used')):
            sample = tracker.process(self.scene.render(.016), 201_000_000)
        self.assertFalse(sample['valid'])
        self.assertEqual(sample['bridge_attempted'], 0)


if __name__ == '__main__':
    unittest.main()
