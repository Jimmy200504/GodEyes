import math
import unittest
from unittest.mock import patch

from gesture_control import pointing_command, GestureGate, STOP
from gesture_server import LatestGesture, infer_frame, classifier_landmarks


def hand(cx=320, cy=240, facing=1, direction=(0, -60)):
    points = [[float(cx), float(cy + 60)] for _ in range(21)]
    points[0] = [cx, cy + 60]
    points[5] = [cx - 40 * facing, cy - 20]
    points[9] = [cx, cy - 30]
    points[13] = [cx + 20 * facing, cy - 20]
    points[17] = [cx + 40 * facing, cy - 20]
    points[8] = [points[5][0] + direction[0], points[5][1] + direction[1]]
    return points


class ControlTests(unittest.TestCase):
    def test_detected_hand_with_invalid_classification_still_holds_slam(self):
        import numpy as np
        for points, scores in [(np.zeros((21, 2)), [.9, .05, .05]), (np.array(hand()), [math.nan, 0, 0])]:
            gesture, confidence, landmarks, _ = infer_frame(None, lambda _: [(points, None, .95)], lambda _: scores)
            self.assertEqual(gesture, 'Unknown')
            self.assertIsNotNone(landmarks)
            self.assertEqual(GestureGate().update(gesture, confidence, landmarks), STOP)

    def test_pointing_translates_in_finger_direction_independent_of_location(self):
        for center in ((120, 120), (500, 340)):
            for delta, axis, expected in [((-60, 0), 'sideways', -1), ((60, 0), 'sideways', 1), ((0, -60), 'vertical', 1), ((0, 60), 'vertical', -1)]:
                command = pointing_command(hand(*center, direction=delta))
                self.assertEqual(command[axis], expected)
                self.assertEqual(command['yaw'], 0)
                self.assertEqual(command['pitch'], 0)
        self.assertEqual(pointing_command(hand(direction=(60, 0)), mirror=True)['sideways'], -1)
        self.assertEqual(pointing_command(hand(direction=(60, 60))), STOP)
        self.assertEqual(pointing_command(hand(direction=(0, 0))), STOP)

    def test_open_always_moves_forward_without_facing_or_motion_history(self):
        gate = GestureGate()
        for facing in (1, -1):
            for center in ((320, 240), (326, 240), (400, 200), (100, 100)):
                self.assertEqual(gate.update('Open', .95, hand(*center, facing=facing)),
                                 dict(STOP, forward=1))
                self.assertEqual(gate.hint, '張掌：前進')
        self.assertEqual(gate.update('Close', .95, hand()), STOP)
        self.assertEqual(gate.update('Open', .95, hand()), dict(STOP, forward=1))

    def test_switching_static_gestures_replaces_direction_immediately(self):
        gate = GestureGate()
        self.assertEqual(gate.update('Open', .95, hand()), dict(STOP, forward=1))
        self.assertEqual(gate.update('Point', .95, hand(direction=(60, 0))), dict(STOP, sideways=1))
        self.assertEqual(gate.update('Point', .95, hand(direction=(60, 60))), STOP)
        self.assertEqual(gate.update('Point', .95, hand(direction=(-60, 0))), dict(STOP, sideways=-1))
        self.assertEqual(gate.update('Close', .1, None), STOP)

    def test_invalid_lost_and_low_confidence_stop(self):
        gate = GestureGate()
        for gesture, confidence, points in [
                ('None', 0, None), ('Unknown', .5, hand()), ('Open', .74, hand()),
                ('Point', math.nan, hand()), ('Point', .9, [[0, 0]] * 21),
                ('Open', 1.1, hand()), ('Open', .9, [[math.inf, 0]] * 21)]:
            gate.update('Open', .95, hand())
            self.assertEqual(gate.update(gesture, confidence, points), STOP)

    def test_classification_is_rotation_invariant_but_control_keeps_original_direction(self):
        import numpy as np
        points = np.array(hand(), dtype=float)
        canonical = classifier_landmarks(points)
        for angle in (math.pi / 2, math.pi, -math.pi / 2):
            rotation = np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])
            turned = (points - points[0]) @ rotation.T + points[0]
            np.testing.assert_allclose(classifier_landmarks(turned), canonical, atol=1e-10)
        gate = GestureGate()
        self.assertEqual(gate.update('Point', .95, hand()), dict(STOP, vertical=1))
        self.assertEqual(gate.update('Point', .95, hand(direction=(0, 60))), dict(STOP, vertical=-1))

    def test_stop_loss_and_uncertain_results_never_continue_previous_motion(self):
        latest = LatestGesture()
        for gesture in ('Open', 'Point', 'Close', 'None', 'Unknown'):
            latest.put('Point', dict(STOP, vertical=1), 10.)
            latest.put(gesture, STOP, 10.1)
            with patch('gesture_server.time.monotonic', return_value=10.1):
                packet = latest.get()
                self.assertEqual(packet['gesture'], gesture)
                self.assertEqual(packet['command'], STOP)
                self.assertEqual(packet['motion_hold_ms'], 0)
        for kwargs in ({'gesture': 'Close'}, {'status': 'error'}):
            latest.put(command=dict(STOP, vertical=1), captured=10.1,
                       **dict({'gesture': 'Point'}, **kwargs))
            with patch('gesture_server.time.monotonic', return_value=10.1):
                self.assertEqual(latest.get()['command'], STOP)

    def test_stale_diagnostics_keep_detection_but_stop_commands(self):
        latest = LatestGesture('NPU')
        self.assertEqual(latest.get()['command'], STOP)
        latest.put('Point', dict(STOP, vertical=1), 10, confidence=.93, inference_ms=32, hand_present=True)
        with patch('gesture_server.time.monotonic', return_value=10.1):
            packet = latest.get()
            self.assertEqual(packet['backend'], 'NPU')
            self.assertEqual(packet['confidence'], .93)
            self.assertEqual(packet['command']['vertical'], 1)
            self.assertTrue(packet['hand_present'])
        with patch('gesture_server.time.monotonic', return_value=10.3):
            packet = latest.get()
            self.assertEqual(packet['status'], 'stale')
            self.assertEqual(packet['gesture'], 'Point')
            self.assertEqual(packet['command'], STOP)
            self.assertGreater(packet['age_ms'], 250)


if __name__ == '__main__':
    unittest.main()
