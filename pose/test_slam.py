import unittest
import cv2
import numpy as np
from slam_tracker import bootstrap, solve_pose, Tracker
from slam_sender import adapt_pose
from relay import validate


class GeometryTests(unittest.TestCase):
    def setUp(self):
        cv2.setRNGSeed(7)
        self.rng = np.random.default_rng(7)
        self.K = np.array([[500., 0, 320], [0, 500, 240], [0, 0, 1]])
        self.xyz = self.rng.uniform([-2, -1.5, 4], [2, 1.5, 9], (200, 3))
        self.desc = self.rng.integers(0, 256, (200, 32), dtype=np.uint8)

    def project(self, center, rv=(0., 0., 0.)):
        R = cv2.Rodrigues(np.array(rv))[0]
        t = -R @ np.asarray(center)
        return cv2.projectPoints(self.xyz, np.array(rv), t, self.K, None)[0].reshape(-1, 2)

    def test_initialize_then_translation_rotation_and_scale(self):
        a = self.project([0., 0, 0])
        b = self.project([.5, 0, 0])
        tracker = Tracker(self.K)
        self.assertFalse(tracker.update(a, self.desc)['valid'])
        initialized = tracker.update(b, self.desc)
        self.assertTrue(initialized['valid'])
        first = initialized['position'][0]
        third = tracker.update(self.project([1., 0, 0], (0., .08, 0.)), self.desc)
        self.assertTrue(third['valid'])
        self.assertAlmostEqual(third['position'][0] / first, 2., places=3)
        self.assertAlmostEqual(third['orientation_xyzw'][1], np.sin(.04), places=3)
        self.assertAlmostEqual(np.linalg.norm(third['orientation_xyzw']), 1.)
        stationary = tracker.update(self.project([1., 0, 0], (0., .08, 0.)), self.desc)
        np.testing.assert_allclose(stationary['position'], third['position'], atol=1e-5)
        lost = tracker.update(np.empty((0, 2)), None)
        self.assertFalse(lost['valid'])
        self.assertIsNone(lost['position'])
        self.assertTrue(tracker.update(b, self.desc)['valid'])

    def test_no_bootstrap_from_stillness_or_pure_rotation(self):
        a = self.project([0., 0, 0])
        self.assertIsNone(bootstrap(self.K, a, a))
        self.assertIsNone(bootstrap(self.K, a, self.project([0., 0, 0], (0., .15, 0.))))

    def test_pnp_rejects_outliers_and_preserves_camera_direction(self):
        pixels = self.project([.4, -.1, .2], (.03, .08, -.02))
        pixels[:35] = self.rng.uniform([0, 0], [640, 480], (35, 2))
        T, count, error = solve_pose(self.K, self.xyz, pixels)
        np.testing.assert_allclose(-T[:, :3].T @ T[:, 3], [.4, -.1, .2], atol=1e-4)
        self.assertGreater(count, 150)

    def test_adapter_basis_and_invalid_state(self):
        tracker = Tracker(self.K)
        tracker.T[:, 3] = [-.2, .3, -.4]
        sample = tracker.packet('tracking')
        packet = validate(adapt_pose(sample, 1234))
        np.testing.assert_allclose(packet['position'], [.2, -.3, .4])
        self.assertEqual(packet['scale'], 'arbitrary')
        self.assertEqual(validate(adapt_pose(tracker.packet('lost'), 1235))['tracking'], 'lost')
        first_map = packet['map_id']
        tracker.reset()
        self.assertNotEqual(adapt_pose(tracker.packet('initializing'), 1236)['map_id'], first_map)

    def test_blank_images_are_invalid(self):
        tracker = Tracker(self.K)
        for _ in range(3):
            self.assertFalse(tracker.process(np.zeros((480, 640), np.uint8))['valid'])


if __name__ == '__main__':
    unittest.main()
