"""Synthetic multi-view geometry: map expansion and handoff, not real-camera FPS."""
import unittest
import cv2
import numpy as np
from slam_tracker import Tracker


class KeyframeTests(unittest.TestCase):
    def setUp(self):
        cv2.setRNGSeed(43)
        rng = np.random.default_rng(43)
        self.K = np.array([[500., 0, 320], [0, 500., 240], [0, 0, 1.]])
        pixels = np.array([(x, y) for y in range(70, 430, 40) for x in range(100, 560, 35)], float)
        depth = rng.uniform(4, 8, len(pixels))
        self.xyz = np.column_stack(((pixels[:, 0]-320)*depth/500,
                                   (pixels[:, 1]-240)*depth/500, depth))
        self.desc = rng.integers(0, 256, (len(pixels), 32), dtype=np.uint8)
        self.tracker = Tracker(self.K)
        self.tracker.xyz = self.xyz[:40].copy()
        self.tracker.desc = self.desc[:40].copy()
        self.tracker.anchor_desc = self.desc[:40].copy()
        self.tracker.reference = (pixels, self.desc.copy(), self.pose(0, 0))

    def pose(self, center, yaw):
        R = cv2.Rodrigues(np.array([0., yaw, 0.]))[0]
        return np.column_stack((R, -R @ np.array([center, 0., 0.])))

    def project(self, center, yaw):
        T = self.pose(center, yaw)
        return cv2.projectPoints(self.xyz, cv2.Rodrigues(T[:, :3])[0], T[:, 3],
                                 self.K, None)[0].reshape(-1, 2)

    def test_older_view_grows_map_then_new_points_take_over_and_return(self):
        self.tracker.keyframes = [self.tracker.reference,
            (self.project(.2, .15)[:40], self.desc[:40].copy(), self.pose(.2, .15))]
        self.tracker.frame = 4
        sample = self.tracker.update(self.project(.5, .12), self.desc)
        self.assertTrue(sample['valid'], sample)
        self.assertGreater(sample['new_points'], 40)
        # The most recent keyframe contains only known points: additions had to
        # come from the older overlapping keyframe.
        session = sample['session_id']
        new_desc = self.tracker.desc[40:]
        ids = [np.flatnonzero(np.all(self.desc == d, axis=1))[0] for d in new_desc]
        np.testing.assert_allclose(self.tracker.xyz[40:], self.xyz[ids], atol=1e-4)
        sample = self.tracker.update(self.project(.6, .16)[ids], self.desc[ids])
        self.assertTrue(sample['valid'], sample)
        self.assertAlmostEqual(sample['position'][0], .6, places=4)
        self.assertEqual(sample['session_id'], session)
        returned = self.tracker.update(self.project(0, 0)[:40], self.desc[:40])
        self.assertTrue(returned['valid'], returned)
        self.assertEqual(returned['session_id'], session)
        self.assertLess(np.linalg.norm(returned['position']), 1e-4)

    def test_pure_rotation_and_stillness_do_not_invent_new_depth(self):
        for step, yaw in enumerate([0., .2, -.2, 0.], 1):
            self.tracker.frame = step*5-1
            sample = self.tracker.update(self.project(0, yaw), self.desc)
            self.assertTrue(sample['valid'], sample)
            self.assertEqual(sample['new_points'], 0)
            self.assertEqual(sample['map_points'], 40)
        self.assertGreater(len(self.tracker.keyframes), 1)

    def test_keyframes_are_bounded_lost_does_not_record_and_reset_clears(self):
        self.tracker.xyz = self.xyz.copy()
        self.tracker.desc = self.desc.copy()
        self.tracker.anchor_desc = self.desc.copy()
        for step in range(1, 15):
            self.tracker.frame = step*5-1
            sample = self.tracker.update(self.project(step*.04, .12*(-1)**step), self.desc)
            self.assertTrue(sample['valid'], sample)
            self.assertLessEqual(sample['keyframes'], 6)
        self.assertEqual(len(self.tracker.keyframes), 6)
        np.testing.assert_allclose(self.tracker.keyframes[0][2], self.pose(0, 0))
        before = [id(frame) for frame in self.tracker.keyframes]
        self.assertFalse(self.tracker.update(np.empty((0, 2)), None)['valid'])
        self.assertEqual(before, [id(frame) for frame in self.tracker.keyframes])
        self.tracker.reset()
        self.assertEqual(self.tracker.keyframes, [])


if __name__ == '__main__':
    unittest.main()
