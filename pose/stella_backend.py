"""Native stella_vslam bridge. Frames are rectified before reaching this backend."""
import json
from pathlib import Path
import tempfile
import uuid

from native_worker import Worker
from relay import validate


def camera_settings(K):
    # JSON is valid YAML; use nested keys (stella does not use ORB-SLAM3 settings).
    return json.dumps(dict(
        Camera=dict(name='i.MX93 rectified stream', setup='monocular', model='perspective',
                    fx=float(K[0, 0]), fy=float(K[1, 1]), cx=float(K[0, 2]), cy=float(K[1, 2]),
                    k1=0., k2=0., p1=0., p2=0., k3=0., fps=30., cols=640, rows=480,
                    color_order='Gray'),
        Preprocessing=dict(min_size=800),
        Feature=dict(name='GodEyes ORB', scale_factor=1.2, num_levels=8,
                     ini_fast_threshold=20, min_fast_threshold=7),
        Mapping=dict(baseline_dist_thr_ratio=0.02)), indent=2)


def adapt_reply(reply, session, sequence, capture_ns):
    tracking = {'Initializing': 'initializing', 'Tracking': 'tracking', 'Lost': 'lost'}.get(
        reply['state'], 'lost')
    position, quaternion = reply['position'], reply['quaternion_xyzw']
    if tracking != 'tracking' or position is None or quaternion is None:
        if tracking == 'tracking':
            tracking = 'lost'
        position, quaternion = [0., 0., 0.], [0., 0., 0., 1.]
    packet = dict(version=1, frame='opencv-c2w', source='stella-vslam-local',
                  session_id=session, map_id=f"stella-{reply['map_id']}", seq=sequence,
                  capture_monotonic_ns=capture_ns, tracking=tracking, scale='arbitrary',
                  position=position, quaternion_xyzw=quaternion)
    # feed_monocular_frame returns Twc already. Do not invert or flip its axes.
    try:
        validate(packet)
    except ValueError as error:
        raise RuntimeError('stella_vslam produced an invalid pose') from error
    return packet, dict(stella_state=reply['state'], map_points=reply['map_points'],
                        inliers=reply['tracked_points'], reprojection_error_px=None)


class StellaSlam:
    def __init__(self, K, executable, vocabulary):
        for path in (executable, vocabulary):
            if not Path(path).is_file():
                raise ValueError(f'Missing {path}; run scripts/setup-stella-mac.sh first')
        self.directory = tempfile.TemporaryDirectory(prefix='godeyes-stella-')
        self.worker = None
        config = Path(self.directory.name)/'camera.yaml'
        config.write_text(camera_settings(K))
        try:
            self.worker = Worker([str(Path(executable).resolve()), str(Path(vocabulary).resolve()),
                                  str(config)], label='stella_vslam')
        except BaseException:
            self.close()
            raise
        self.reset()

    def reset(self):
        self.session = uuid.uuid4().hex
        self.sequence = 0
        self.pending_reset = True

    def process(self, gray, capture_ns):
        reply = self.worker.track(gray, capture_ns, self.pending_reset)
        self.pending_reset = False
        self.sequence += 1
        return adapt_reply(reply, self.session, self.sequence, capture_ns)

    def close(self):
        if self.worker is not None:
            self.worker.close()
            self.worker = None
        self.directory.cleanup()
