"""Static gestures: open to move forward, point to translate, fist to stop."""
import math

STOP = dict(forward=0.0, sideways=0.0, vertical=0.0, yaw=0.0, pitch=0.0)


def valid_landmarks(landmarks):
    try:
        return (landmarks is not None and len(landmarks) == 21
                and all(len(p) == 2 and all(math.isfinite(v) for v in p) for p in landmarks)
                and math.dist(landmarks[0], landmarks[9]) >= 8)
    except (TypeError, ValueError, IndexError):
        return False


def pointing_command(landmarks, mirror=False):
    """Index MCP→tip controls translation, never camera rotation."""
    if not valid_landmarks(landmarks):
        return dict(STOP)
    dx = float(landmarks[8][0] - landmarks[5][0])
    dy = float(landmarks[8][1] - landmarks[5][1])
    length = math.hypot(dx, dy)
    if length < 8:
        return dict(STOP)
    if mirror:
        dx = -dx
    # An ambiguous diagonal or foreshortened finger stops instead of guessing.
    if abs(dx) / length >= .85:
        return dict(STOP, sideways=math.copysign(1.0, dx))
    if abs(dy) / length >= .85:
        return dict(STOP, vertical=-math.copysign(1.0, dy))
    return dict(STOP)


class GestureGate:
    """Each observation selects one translation; no calibration or motion history."""
    def __init__(self):
        self.hint = '張掌前進；食指指向平移；握拳停止'

    def update(self, gesture, confidence, landmarks, mirror=False):
        if (gesture not in ('Open', 'Point') or not math.isfinite(confidence)
                or not .75 <= confidence <= 1 or not valid_landmarks(landmarks)):
            self.hint = '握拳：停止' if gesture == 'Close' else '未確認手勢：停止'
            return dict(STOP)
        if gesture == 'Open':
            self.hint = '張掌：前進'
            return dict(STOP, forward=1.0)
        command = pointing_command(landmarks, mirror)
        action = ('右移' if command['sideways'] > 0 else '左移' if command['sideways'] < 0
                  else '升高' if command['vertical'] > 0 else '降低' if command['vertical'] < 0
                  else '方向不明：停止')
        self.hint = '食指：' + action
        return command
