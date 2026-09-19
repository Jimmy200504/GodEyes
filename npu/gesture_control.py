"""Map NXP Open/Close/Point predictions and palm position to navigation axes."""
import math

STOP = dict(forward=0.0, sideways=0.0, yaw=0.0, pitch=0.0)


def command_for(gesture, confidence, x, y, mirror=False):
    """x/y are palm-center coordinates in the original camera frame, in [0, 1]."""
    if (gesture not in ('Open', 'Point') or not all(math.isfinite(v) for v in (confidence, x, y))
            or confidence < 0.75 or not 0 <= x <= 1 or not 0 <= y <= 1):
        return dict(STOP)
    if mirror:
        x = 1 - x

    def axis(value):
        distance = value - 0.5
        # Middle 30% is a dead zone; ramp up to full speed near the edges.
        return math.copysign(min(1, max(0, (abs(distance) - 0.15) / 0.25)), distance)

    horizontal, vertical = axis(x), axis(y)
    if gesture == 'Open':
        return dict(forward=-vertical, sideways=horizontal, yaw=0.0, pitch=0.0)
    return dict(forward=0.0, sideways=0.0, yaw=-horizontal, pitch=-vertical)


class GestureGate:
    """Require two consecutive matching active gestures; stopping is immediate."""
    def __init__(self):
        self.previous = None

    def update(self, gesture, confidence, x, y, mirror=False):
        command = command_for(gesture, confidence, x, y, mirror)
        active = gesture if any(command.values()) else None
        accepted = active is not None and active == self.previous
        self.previous = active
        return command if accepted else dict(STOP)
