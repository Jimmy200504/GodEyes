import json
import tempfile
import threading
import time
from urllib.request import urlopen
import unittest
from pathlib import Path
import cv2
import numpy as np
from aruco_pose import (DICTIONARY, MarkerTracker, load_calibration,
                        quaternion_xyzw, solve_marker, square_points)
from relay import validate, make_server
from aruco_sender import LatestSender

K = np.array([[800., 0, 320], [0, 800., 240], [0, 0, 1]])
DIST = np.zeros(5)

class ArucoTests(unittest.TestCase):
    def test_metric_pose_inversion_at_multiple_distances(self):
        for depth in (0.3, 0.6, 1.2):
            with self.subTest(depth=depth):
                rvec = np.array([2.9, 0.1, -0.15])
                translation = np.array([0.03, -0.02, depth])
                pixels, _ = cv2.projectPoints(square_points(.08), rvec, translation, K, DIST)
                result = solve_marker(pixels, .08, K, DIST)
                self.assertIsNotNone(result)
                rotation = cv2.Rodrigues(rvec)[0]
                np.testing.assert_allclose(result["position"], -rotation.T @ translation, atol=1e-7)
                q = np.asarray(result["quaternion_xyzw"])
                expected = quaternion_xyzw(rotation.T)
                self.assertAlmostEqual(abs(q @ expected), 1, places=8)
                validate(dict(version=1, frame="opencv-c2w", session_id="test", map_id="B",
                    source="aruco-B", seq=0, capture_monotonic_ns=0, tracking="tracking",
                    scale="metric", position=result["position"], quaternion_xyzw=q.tolist()))

    def test_quaternion_convention(self):
        for axis in np.eye(3):
            for angle in (0, .7, np.pi):
                rotation = cv2.Rodrigues(axis * angle)[0]
                q = quaternion_xyzw(rotation)
                expected = np.r_[axis * np.sin(angle/2), np.cos(angle/2)]
                self.assertAlmostEqual(abs(q @ expected), 1, places=8)

    def test_marker_detection_and_wrong_id(self):
        marker = cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(DICTIONARY), 0, 200)
        # Synthetic tilted marker seen by the calibrated camera.
        rvec = np.array([2.8, .1, .1])
        translation = np.array([0., 0., .5])
        pixels, _ = cv2.projectPoints(square_points(.08), rvec, translation, K, DIST)
        transform = cv2.getPerspectiveTransform(np.float32([[0, 0], [199, 0], [199, 199], [0, 199]]),
                                                pixels.reshape(4, 2).astype(np.float32))
        image = cv2.warpPerspective(marker, transform, (640, 480), borderValue=255)
        result = MarkerTracker(0, .08, K, DIST).estimate(image)
        self.assertIsNotNone(result)
        expected = -cv2.Rodrigues(rvec)[0].T @ translation
        np.testing.assert_allclose(result["position"], expected, atol=.025)
        self.assertIsNone(MarkerTracker(1, .08, K, DIST).estimate(image))
        self.assertIsNone(MarkerTracker(0, .08, K, DIST).estimate(np.full_like(image, 255)))

    def test_scale_depends_on_measured_marker_size(self):
        pixels, _ = cv2.projectPoints(square_points(.08), np.array([2.8, .1, 0]),
                                      np.array([.01, .02, .6]), K, DIST)
        first = solve_marker(pixels, .08, K, DIST)
        twice = solve_marker(pixels, .16, K, DIST)
        np.testing.assert_allclose(twice["position"], np.array(first["position"]) * 2, atol=1e-8)

    def test_bad_corner_fit_is_rejected(self):
        pixels, _ = cv2.projectPoints(square_points(.08), np.array([2.8, .1, 0]),
                                      np.array([0., 0., .6]), K, DIST)
        pixels[0, 0] += [25, 10]
        self.assertIsNone(solve_marker(pixels, .08, K, DIST, max_error=.1))

    def test_real_publisher_to_receiver(self):
        server = make_server("127.0.0.1", 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/api/pose"
        sender = LatestSender(url)
        try:
            pixels, _ = cv2.projectPoints(square_points(.08), np.array([2.8, .1, 0]),
                                          np.array([0., 0., .6]), K, DIST)
            result = solve_marker(pixels, .08, K, DIST)
            packet = dict(version=1, frame="opencv-c2w", session_id="integration", map_id="B",
                source="aruco-B", seq=0, capture_monotonic_ns=0, tracking="tracking", scale="metric",
                position=result["position"], quaternion_xyzw=result["quaternion_xyzw"])
            sender.put(packet, time.monotonic())
            deadline = time.monotonic() + 3
            received = None
            while time.monotonic() < deadline:
                with urlopen(url, timeout=1) as response:
                    received = json.load(response)["pose"]
                if received:
                    break
                time.sleep(.01)
            self.assertEqual(received, packet)
        finally:
            sender.close(); server.shutdown(); server.server_close(); thread.join()

    def test_calibration_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "camera.json"
            data = dict(camera_matrix=K.tolist(), dist_coeffs=DIST.tolist(), image_size=[640, 480])
            path.write_text(json.dumps(data))
            self.assertEqual(load_calibration(path)[2], (640, 480))
            data["camera_matrix"][0][0] = -1
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                load_calibration(path)

if __name__ == "__main__":
    unittest.main()
