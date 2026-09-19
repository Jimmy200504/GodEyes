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


def update(gate, gesture, points, now, confidence=.95, handedness=.95):
    return gate.update(gesture, confidence, points, handedness=handedness, now=now)


def calibrate(gate):
    gate.begin_calibration()
    for now in (0., .1, .2, .4):
        assert update(gate, 'Open', hand(), now) == STOP
    assert not gate.calibrating
    assert update(gate, 'Open', hand(), .45) == STOP
    update(gate, 'Close', hand(), .5)


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

    def test_calibration_is_required_and_finishing_it_never_moves(self):
        gate = GestureGate()
        for now in (0., .1, .2, .4, .6, .8):
            self.assertEqual(update(gate, 'Open', hand(), now), STOP)
        calibrate(gate)
        for now in (.6, .8, 1., 1.15, 1.25, 1.35):
            command = update(gate, 'Open', hand(), now)
        self.assertEqual(command, dict(STOP, forward=1))
        update(gate, 'Close', hand(), 1.4)
        for now in (1.5, 1.7, 1.9, 2.05, 2.15, 2.25):
            command = update(gate, 'Open', hand(facing=-1), now)
        self.assertEqual(command, dict(STOP, forward=-1))
        self.assertEqual(update(gate, 'Close', hand(), 2.3), STOP)
        self.assertEqual(update(gate, 'Open', hand(), 2.4, handedness=.05), STOP)
        self.assertEqual(update(gate, 'Open', hand(), 2.5, handedness=.5), STOP)

    def test_calibration_rejects_motion_and_uncertain_handedness(self):
        gate = GestureGate()
        gate.begin_calibration()
        for i in range(8):
            update(gate, 'Open', hand(cx=100 + 30 * i), i * .1)
        self.assertTrue(gate.calibrating)
        for i in range(8, 16):
            update(gate, 'Open', hand(), i * .1, handedness=.5)
        self.assertTrue(gate.calibrating)
        self.assertEqual(gate.outward, {})

    def test_swipes_use_requested_inverse_rotation_and_do_not_translate(self):
        for delta, axis, sign in [((-35, 0), 'yaw', -1), ((35, 0), 'yaw', 1), ((0, -35), 'pitch', -1), ((0, 35), 'pitch', 1)]:
            gate = GestureGate()
            calibrate(gate)
            update(gate, 'Open', hand(), 1.)
            command = update(gate, 'Open', hand(cx=320 + delta[0], cy=240 + delta[1]), 1.1)
            self.assertGreater(command[axis] * sign, 0)
            self.assertEqual(command['forward'], 0)
            self.assertEqual(command['sideways'], 0)
            self.assertEqual(command['vertical'], 0)
            # Holding still after a swipe must not turn into forward movement.
            for now in (1.2, 1.3, 1.4):
                self.assertEqual(update(gate, 'Open', hand(cx=320 + delta[0], cy=240 + delta[1]), now), STOP)
            self.assertEqual(update(gate, 'Close', hand(), 1.5), STOP)

    def test_invalid_lost_low_confidence_and_long_gaps_stop(self):
        gate = GestureGate()
        points = hand(direction=(60, 0))
        update(gate, 'Point', points, 0.)
        self.assertEqual(update(gate, 'Point', points, .1)['sideways'], 1)
        for gesture, confidence, points in [('None', 0, None), ('Unknown', .5, hand()), ('Point', math.nan, hand()), ('Point', .9, [[0, 0]] * 21)]:
            self.assertEqual(update(gate, gesture, points, .2, confidence), STOP)
        self.assertEqual(update(gate, 'Point', hand(direction=(60, 0)), 1.), dict(STOP, sideways=1))

    def test_classification_is_rotation_invariant_but_control_keeps_original_direction(self):
        import numpy as np
        points = np.array(hand(), dtype=float)
        canonical = classifier_landmarks(points)
        for angle in (math.pi / 2, math.pi, -math.pi / 2):
            rotation = np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])
            turned = (points - points[0]) @ rotation.T + points[0]
            np.testing.assert_allclose(classifier_landmarks(turned), canonical, atol=1e-10)
        gate = GestureGate()
        self.assertEqual(update(gate, 'Point', hand(), 0.), dict(STOP, vertical=1))
        self.assertEqual(update(gate, 'Point', hand(direction=(0, 60)), .1), dict(STOP, vertical=-1))

    def test_one_second_hold_survives_missing_detections_without_renewal(self):
        latest = LatestGesture()
        latest.put('Point', dict(STOP, vertical=1), 10.)
        for now in (10.2, 10.5, 10.9):
            latest.put('None', STOP, now)
            with patch('gesture_server.time.monotonic', return_value=now):
                packet = latest.get()
                self.assertEqual(packet['gesture'], 'None')
                self.assertEqual(packet['command']['vertical'], 1)
                self.assertEqual(packet['motion_hold_ms'], round((11-now)*1000))
                self.assertIn('延續', packet['control_hint'])
        latest.put('None', STOP, 11.)
        with patch('gesture_server.time.monotonic', return_value=11.):
            self.assertEqual(latest.get()['command'], STOP)
        # A fresh opposite direction replaces the old one immediately.
        latest.put('Point', dict(STOP, vertical=1), 12.)
        latest.put('Point', dict(STOP, vertical=-1), 12.1)
        with patch('gesture_server.time.monotonic', return_value=12.1):
            self.assertEqual(latest.get()['command']['vertical'], -1)
        for kwargs in ({'gesture': 'Close'}, {'cancel_motion': True}, {'status': 'error'}):
            latest.put('Point', dict(STOP, vertical=1), 13.)
            latest.put(command=STOP, captured=13.1, **dict({'gesture': 'None'}, **kwargs))
            with patch('gesture_server.time.monotonic', return_value=13.1):
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
