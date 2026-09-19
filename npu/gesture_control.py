"""Landmark-based translation, calibrated palm facing, and inverse swipe rotation."""
from collections import deque
import math
import time

STOP = dict(forward=0.0, sideways=0.0, vertical=0.0, yaw=0.0, pitch=0.0)


def hand_geometry(landmarks):
    try:
        if landmarks is None or len(landmarks) != 21 or not all(
                len(p) == 2 and all(math.isfinite(float(v)) for v in p) for p in landmarks):
            return None
        wrist, index, pinky = landmarks[0], landmarks[5], landmarks[17]
        ax, ay = index[0] - wrist[0], index[1] - wrist[1]
        bx, by = pinky[0] - wrist[0], pinky[1] - wrist[1]
        width = math.dist(index, pinky)
        height = math.dist(wrist, landmarks[9])
        denominator = math.hypot(ax, ay) * math.hypot(bx, by)
        if width < 8 or height < 8 or denominator < 64:
            return None
        center = tuple(sum(landmarks[i][j] for i in (0, 5, 9, 13, 17)) / 5 for j in (0, 1))
        return center, math.sqrt(width * height), (ax * by - ay * bx) / denominator
    except (TypeError, ValueError, IndexError):
        return None


def pointing_command(landmarks, mirror=False):
    """Index MCP→tip controls translation, never camera rotation."""
    if hand_geometry(landmarks) is None:
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


def hand_label(handedness):
    if handedness is None or not math.isfinite(handedness):
        return None
    return 1 if handedness >= .8 else 0 if handedness <= .2 else None


class GestureGate:
    """Exclusive motion modes. Fist/loss stops; calibration survives release.

    Palm facing is learned for the selected hand, avoiding assumptions about
    the model's mirrored handedness convention. It is not a depth estimate.
    """
    def __init__(self):
        self.outward = {}
        self.calibrating = False
        self.await_release = False
        self.hint = '食指指向平移；掌心前後請先校正'
        self.reset_motion()

    def reset_motion(self):
        self.previous = None
        self.confirmations = 0
        self.history = deque()
        self.wave_mode = False
        self.mode = None
        self.mode_since = None
        self.calibration_samples = []
        self.last_time = None
        self.last_label = None

    def begin_calibration(self):
        self.reset_motion()
        self.outward = {}
        self.calibrating = True
        self.await_release = False
        self.hint = '校正中：張掌，手背朝鏡頭，保持不動'

    def _confirm(self, command, hint, count=2):
        key = tuple((key, 1 if value > 0 else -1) for key, value in command.items() if value != 0)
        self.confirmations = self.confirmations + 1 if key and key == self.previous else 1
        self.previous = key
        if not key:
            self.hint = hint
            return dict(STOP)
        if self.confirmations < count:
            self.hint = '確認動作中'
            return dict(STOP)
        self.hint = hint
        return command

    def update(self, gesture, confidence, landmarks, mirror=False, handedness=None, now=None):
        now = time.monotonic() if now is None else now
        geometry = hand_geometry(landmarks)
        if (gesture not in ('Open', 'Point') or not math.isfinite(confidence)
                or not .75 <= confidence <= 1 or geometry is None or not math.isfinite(now)):
            self.reset_motion()
            if gesture in ('Close', 'None'):
                self.await_release = False
            self.hint = '握拳：停止' if gesture == 'Close' else '未確認手勢：停止'
            return dict(STOP)
        center, scale, facing = geometry
        label = hand_label(handedness)
        if (self.last_time is not None and (now <= self.last_time or now - self.last_time > .3)) or (
                label is not None and self.last_label is not None and label != self.last_label):
            self.reset_motion()
        if gesture != self.mode:
            self.reset_motion()
            self.mode = gesture
            self.mode_since = now
        self.last_time, self.last_label = now, label

        if self.calibrating:
            if gesture != 'Open' or label is None or abs(facing) < .25:
                self.calibration_samples = []
                self.hint = '校正中：張掌，手背朝鏡頭'
                return dict(STOP)
            sample = (now, label, 1 if facing > 0 else -1, center, scale)
            if self.calibration_samples:
                previous = self.calibration_samples[-1]
                if (sample[1:3] != previous[1:3] or math.dist(center, previous[3]) / scale > .15
                        or not .85 <= scale / previous[4] <= 1.15):
                    self.calibration_samples = []
            self.calibration_samples.append(sample)
            if len(self.calibration_samples) >= 4 and now - self.calibration_samples[0][0] >= .35:
                self.outward[label] = sample[2]
                self.calibrating = False
                self.await_release = True
                self.reset_motion()
                # Require release so completing calibration never starts movement.
                self.mode = 'calibrated'
                self.hint = '校正完成，先握拳，再開始操作'
            else:
                self.hint = '校正中：手背朝鏡頭，保持不動'
            return dict(STOP)

        if getattr(self, 'await_release', False):
            self.hint = '校正完成，先握拳再開始'
            return dict(STOP)

        if gesture == 'Point':
            command = pointing_command(landmarks, mirror)
            action = ('右移' if command['sideways'] > 0 else '左移' if command['sideways'] < 0
                      else '升高' if command['vertical'] > 0 else '降低' if command['vertical'] < 0
                      else '方向不明：停止')
            return self._confirm(command, '食指：' + action, count=1)

        # Wave detection uses palm-center velocity over up to 250 ms. Hand
        # entry and scene/hand jumps don't create a swipe; stopping motion
        # stops rotation immediately, without a timed rotation pulse.
        previous = self.history[-1] if self.history else None
        self.history.append((now, center, scale))
        while self.history and now - self.history[0][0] > .25:
            self.history.popleft()
        rotating = dict(STOP)
        moving = False
        if previous is not None:
            dt = now - previous[0]
            step = math.dist(center, previous[1]) / scale
            if step > 2 or not .65 <= scale / previous[2] <= 1.55:
                self.reset_motion()
                self.hint = '手部跳變：停止，請重新擺手'
                return dict(STOP)
            moving = dt > 0 and step / dt >= .6
            oldest = self.history[0]
            elapsed = now - oldest[0]
            dx, dy = center[0] - oldest[1][0], center[1] - oldest[1][1]
            if mirror:
                dx = -dx
            distance = math.hypot(dx, dy)
            if moving and elapsed >= .06 and distance / scale >= .25 and distance / scale / elapsed >= 1.5:
                self.wave_mode = True
                # User requested drag-like inverse rotation: left swipe turns
                # right, right swipe turns left; up looks down, down looks up.
                speed = min(1., distance / scale / elapsed / 4.)
                if abs(dx) >= abs(dy) * 1.5:
                    rotating['yaw'] = math.copysign(speed, dx)
                elif abs(dy) >= abs(dx) * 1.5:
                    rotating['pitch'] = math.copysign(speed, dy)
        if self.wave_mode:
            action = ('左轉' if rotating['yaw'] > 0 else '右轉' if rotating['yaw'] < 0
                      else '抬頭' if rotating['pitch'] > 0 else '低頭' if rotating['pitch'] < 0
                      else '停止；握拳後可回到前後移動')
            self.previous = None
            return self._confirm(rotating, '揮手：' + action, count=1)

        if moving:
            self.previous = None
            self.hint = '手正在移動，等待揮動方向'
            return dict(STOP)
        if label is None or label not in self.outward:
            self.previous = None
            self.hint = '掌心前後未校正：手背朝鏡頭，按校正'
            return dict(STOP)
        if abs(facing) < .25:
            self.previous = None
            self.hint = '手掌側向：停止，請正面張掌'
            return dict(STOP)
        # Give an entering hand time to become a wave before starting forward.
        if self.mode_since is None or now - self.mode_since < .5:
            self.previous = None
            self.hint = '張掌確認中；握拳隨時停止'
            return dict(STOP)
        forward = 1.0 if (1 if facing > 0 else -1) == self.outward[label] else -1.0
        return self._confirm(dict(STOP, forward=forward), '掌心朝外：前進' if forward > 0 else '掌心朝鏡頭：後退', count=3)


class MotionPulse:
    """Bridge missed detections for at most one second after a real command.

    Polling and empty observations never renew the deadline. Fist, calibration,
    and input errors cancel it. The transport still rejects stale frames.
    """
    def __init__(self):
        self.clear()

    def clear(self):
        self.command = dict(STOP)
        self.deadline = 0.0

    def update(self, command, captured, cancel=False):
        if cancel:
            self.clear()
        elif any(command.values()):
            self.command = dict(command)
            self.deadline = captured + 1.0

    def get(self, now):
        if now >= self.deadline:
            return dict(STOP), 0
        return dict(self.command), round((self.deadline - now) * 1000)
