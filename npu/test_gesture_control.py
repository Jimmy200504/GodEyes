import math
import unittest
from unittest.mock import patch

from gesture_control import command_for, GestureGate, STOP
from gesture_server import LatestGesture


class ControlTests(unittest.TestCase):
    def test_move_rotate_and_mirror(self):
        self.assertEqual(command_for('Open', .9, .5, 0)['forward'], 1)
        self.assertEqual(command_for('Open', .9, .5, 1)['forward'], -1)
        self.assertEqual(command_for('Open', .9, 0, .5)['sideways'], -1)
        self.assertEqual(command_for('Open', .9, 1, .5)['sideways'], 1)
        self.assertEqual(command_for('Point', .9, 1, .5)['yaw'], -1)
        self.assertEqual(command_for('Point', .9, .5, 0)['pitch'], 1)
        self.assertEqual(command_for('Point', .9, 1, .5, mirror=True)['yaw'], 1)

    def test_dead_zone_confidence_and_invalid_input_stop(self):
        for gesture in ('Open', 'Point', 'Close', 'None', 'Unknown'):
            self.assertEqual(command_for(gesture, .9, .5, .5), STOP)
        for confidence, x, y in [(.7, 0, 0), (.9, math.nan, 0), (.9, 1.1, 0), (math.inf, 0, 0)]:
            self.assertEqual(command_for('Open', confidence, x, y), STOP)

    def test_mode_changes_need_confirmation_and_stop_is_immediate(self):
        gate = GestureGate()
        self.assertEqual(gate.update('Open', .9, 1, .5), STOP)
        self.assertEqual(gate.update('Open', .9, 1, .5)['sideways'], 1)
        self.assertEqual(gate.update('Point', .9, 1, .5), STOP)
        self.assertEqual(gate.update('Point', .9, 1, .5)['yaw'], -1)
        self.assertEqual(gate.update('Close', .9, 1, .5), STOP)
        self.assertEqual(gate.update('Open', .9, 1, .5), STOP)

    def test_service_never_replays_stale_motion(self):
        latest = LatestGesture()
        self.assertEqual(latest.get()['command'], STOP)
        command = command_for('Open', .9, 1, .5)
        latest.put('Open', command, 10)
        with patch('gesture_server.time.monotonic', return_value=10.1):
            self.assertEqual(latest.get()['command'], command)
        with patch('gesture_server.time.monotonic', return_value=10.3):
            self.assertEqual(latest.get()['command'], STOP)


if __name__ == '__main__':
    unittest.main()
