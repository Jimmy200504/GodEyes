"""ORB-SLAM3 subprocess bridge; supports a native worker or a local Docker worker."""
from pathlib import Path
import subprocess
import tempfile
import uuid


IMAGE = 'godeyes-orbslam3:4452a3c-v1'


from orbslam3_settings import camera_settings


from native_worker import Worker


class OrbSlam3:
    def __init__(self, K, features=1200, image=IMAGE, executable=None, vocabulary=None):
        self.directory = tempfile.TemporaryDirectory(prefix='godeyes-orb-')
        self.container = None
        self.worker = None
        config = Path(self.directory.name) / 'camera.yaml'
        config.write_text(camera_settings(K, features))
        if executable:
            if not vocabulary:
                self.directory.cleanup()
                raise ValueError('--orb-vocabulary is required with --orb-worker')
            command = [str(Path(executable).resolve()), str(Path(vocabulary).resolve()), str(config)]
        else:
            self.container = 'godeyes-orb-' + uuid.uuid4().hex
            command = ['docker', 'run', '--rm', '-i', '--network=none', '--name', self.container,
                       '--mount', f'type=bind,source={config.parent.resolve()},target=/config,readonly',
                       image, '/opt/ORB_SLAM3/Vocabulary/ORBvoc.txt', '/config/camera.yaml']
        try:
            self.worker = Worker(command, label='ORB-SLAM3')
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
        if self.container is not None:
            try:
                subprocess.run(['docker', 'rm', '-f', self.container], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=10, check=False)
            except (OSError, subprocess.TimeoutExpired):
                pass
            self.container = None
        self.directory.cleanup()


def adapt_reply(reply, session, sequence, capture_ns):
    state = reply['state']
    tracking = {0: 'initializing', 1: 'initializing', 2: 'tracking',
                3: 'relocalizing', 4: 'lost'}.get(state, 'lost')
    position, quaternion = reply['position'], reply['quaternion_xyzw']
    if position is None or quaternion is None:
        if tracking == 'tracking':
            tracking = 'lost'
        position, quaternion = [0., 0., 0.], [0., 0., 0., 1.]
    # Worker sends Twc directly in OpenCV optical coordinates. No extra axis flip.
    packet = dict(version=1, frame='opencv-c2w', source='orb-slam3-local',
                  session_id=session, map_id=f"orb-{reply['map_id']}-{reply['map_revision']}",
                  seq=sequence, capture_monotonic_ns=capture_ns, tracking=tracking,
                  scale='arbitrary', position=position, quaternion_xyzw=quaternion)
    from relay import validate
    try:
        validate(packet)
    except ValueError as error:
        raise RuntimeError('ORB-SLAM3 produced an invalid pose') from error
    return packet, dict(orb_state=state, map_points=reply['map_points'],
                        inliers=reply['tracked_points'], reprojection_error_px=None)
