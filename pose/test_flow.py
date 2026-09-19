import unittest
import cv2
import numpy as np
from slam_tracker import Tracker, track_flow


class FlowTests(unittest.TestCase):
    def setUp(self):
        cv2.setRNGSeed(17)
        self.rng = np.random.default_rng(17)
        self.K = np.array([[500., 0., 320.], [0., 500., 240.], [0., 0., 1.]])
        self.pixels = np.array([(x, y) for y in range(70, 420, 45)
                                for x in range(80, 570, 45)], dtype=np.float64)
        depth = self.rng.uniform(4., 8., len(self.pixels))
        self.xyz = np.column_stack(((self.pixels[:, 0]-320)/500*depth,
                                    (self.pixels[:, 1]-240)/500*depth, depth))
        self.patches = self.rng.integers(40, 256, (len(depth), 11, 11), dtype=np.uint8)

    def project(self, yaw):
        return cv2.projectPoints(self.xyz, np.array([0., yaw, 0.]), np.zeros(3),
                                 self.K, None)[0].reshape(-1, 2)

    def render(self, yaw):
        image = np.full((480, 640), 20, np.uint8)
        for (x, y), patch in zip(np.rint(self.project(yaw)).astype(int), self.patches):
            if 6 <= x < 634 and 6 <= y < 474:
                image[y-5:y+6, x-5:x+6] = patch
        return image

    def seeded_tracker(self, optical_flow=True):
        tracker = Tracker(self.K, optical_flow=optical_flow)
        tracker.xyz = self.xyz.copy()
        tracker.desc = self.rng.integers(0, 256, (len(self.xyz), 32), dtype=np.uint8)
        tracker.previous_xyz = self.xyz.copy()
        tracker.previous_pixels = self.pixels.copy()
        tracker.previous_gray = self.render(0.)
        tracker.previous_ns = 0
        # Deliberately simulate descriptor dropout; LK still uses real images.
        class MissingDescriptors:
            def detectAndCompute(self, *_):
                return [], None
        tracker.orb = MissingDescriptors()
        return tracker

    def test_real_lk_follows_yaw_with_descriptor_dropout(self):
        tracker = self.seeded_tracker()
        for step in range(1, 7):
            yaw = step * .008
            packet = tracker.process(self.render(yaw), step * 50_000_000)
            self.assertTrue(packet['valid'], packet)
            self.assertEqual(packet['tracking_method'], 'optical-flow')
            self.assertGreater(packet['inliers'], 40)
            self.assertAlmostEqual(packet['orientation_xyzw'][1], np.sin(yaw/2), delta=.003)
            self.assertLess(np.linalg.norm(packet['position']), .04)

    def test_blank_occlusion_is_lost_but_short_gap_can_recover(self):
        tracker = self.seeded_tracker()
        packet = tracker.process(np.zeros((480, 640), np.uint8), 50_000_000)
        self.assertFalse(packet['valid'])
        self.assertIsNotNone(tracker.previous_gray)
        self.assertEqual(tracker.previous_ns, 0)
        self.assertIsNone(packet['position'])
        recovered = tracker.process(self.render(.016), 100_000_000)
        self.assertTrue(recovered['valid'], recovered)
        self.assertEqual(recovered['tracking_method'], 'optical-flow')
        self.assertAlmostEqual(recovered['orientation_xyzw'][1], np.sin(.008), delta=.003)
        self.assertFalse(tracker.process(np.zeros((480, 640), np.uint8), 150_000_000)['valid'])
        self.assertFalse(tracker.process(self.render(.024), 301_000_000)['valid'])
        self.assertIsNone(tracker.previous_gray)

    def test_long_gap_or_reversed_clock_does_not_reuse_flow(self):
        for timestamp in [0, 201_000_000]:
            tracker = self.seeded_tracker()
            packet = tracker.process(self.render(.008), timestamp)
            self.assertFalse(packet['valid'])
            self.assertEqual(packet['flow_tracks'], 0)

    def test_disable_flow_and_reset(self):
        tracker = self.seeded_tracker(False)
        self.assertFalse(tracker.process(self.render(.008), 50_000_000)['valid'])
        tracker = self.seeded_tracker()
        session = tracker.session
        tracker.reset()
        self.assertNotEqual(tracker.session, session)
        self.assertIsNone(tracker.previous_gray)
        self.assertEqual(len(tracker.previous_xyz), 0)

    def test_flow_outliers_cannot_bypass_geometric_pose_gates(self):
        tracker = self.seeded_tracker()
        bad_pixels = self.rng.uniform([0, 0], [640, 480], self.pixels.shape)
        packet = tracker.update(np.empty((0, 2)), None, (self.xyz, bad_pixels))
        self.assertFalse(packet['valid'])

    def test_flow_rejects_disappearing_patches(self):
        before, after = self.render(0.), self.render(.008)
        after[:, :320] = 0
        points, keep = track_flow(before, after, self.pixels)
        self.assertGreater(len(points), 20)
        self.assertLess(keep[self.pixels[:, 0] < 290].sum(), 5)


if __name__ == '__main__':
    unittest.main()
