"""Rectified-frame adapter for the isolated minimal pySLAM environment."""
import json
from pathlib import Path
import tempfile
import time
import uuid

import cv2
import numpy as np

from aruco_pose import quaternion_xyzw
from relay import validate
from pyslam_minimal import configure_paths, make_slam, assert_minimal_imports, MIN_ROOT


def adapt_tracking(tracking, session, sequence, capture_ns):
    state = tracking.state.name
    status = 'tracking' if state == 'OK' else 'initializing' if state in ('NO_IMAGES_YET', 'NOT_INITIALIZED', 'INIT_RELOCALIZE') else 'lost'
    position, quaternion = [0., 0., 0.], [0., 0., 0., 1.]
    if status == 'tracking':
        if tracking.cur_R is None or tracking.cur_t is None:
            status = 'lost'
        else:
            # upstream update_history already converts Tcw to Rwc / camera center.
            position = np.asarray(tracking.cur_t).reshape(3).tolist()
            quaternion = quaternion_xyzw(np.asarray(tracking.cur_R)).tolist()
    packet = dict(version=1, frame='opencv-c2w', source='pyslam-minimal-local',
        session_id=session, map_id='pyslam-'+session, seq=sequence,
        capture_monotonic_ns=capture_ns, tracking=status, scale='arbitrary',
        position=position, quaternion_xyzw=quaternion)
    validate(packet)
    return packet


class PyslamMinimal:
    def __init__(self, K, features=1200):
        if not (MIN_ROOT/'ready').is_file():
            raise RuntimeError('Run bash scripts/setup-pyslam-minimal-mac.sh first')
        configure_paths()
        import yaml
        self.directory = tempfile.TemporaryDirectory(prefix='godeyes-pyslam-live-')
        directory = Path(self.directory.name)
        logs = MIN_ROOT/'logs'/('live-'+time.strftime('%Y%m%d-%H%M%S'))
        logs.mkdir(parents=True, exist_ok=True)
        camera = {'Camera.fx': float(K[0,0]), 'Camera.fy': float(K[1,1]),
            'Camera.cx': float(K[0,2]), 'Camera.cy': float(K[1,2]),
            'Camera.width': 640, 'Camera.height': 480, 'Camera.fps': 15,
            'Camera.RGB': 0, 'FeatureTrackerConfig.name': 'ORB',
            'FeatureTrackerConfig.nFeatures': features}
        camera.update({key: 0. for key in ('Camera.k1', 'Camera.k2', 'Camera.p1', 'Camera.p2', 'Camera.k3')})
        (directory/'camera.yaml').write_text(yaml.safe_dump(camera))
        config = {'DATASET': {'type': 'FOLDER_DATASET'},
            'FOLDER_DATASET': {'type': 'folder', 'sensor_type': 'mono',
                'base_path': str(directory), 'name': '*.jpg', 'settings': str(directory/'camera.yaml')},
            'SYSTEM_STATE': {'load_state': False, 'folder_path': 'results/unused-live-state'},
            'SAVE_TRAJECTORY': {'save_trajectory': False, 'format_type': 'tum',
                'output_folder': str(logs), 'basename': 'trajectory'},
            'GLOBAL_PARAMETERS': {'kUseLoopClosing': False, 'kDoVolumetricIntegration': False,
                'kDoSparseSemanticMappingAndSegmentation': False, 'kUseDepthEstimatorInFrontEnd': False,
                'kOptimizationFrontEndUseGtsam': False, 'kOptimizationBundleAdjustUseGtsam': False,
                'kOptimizationLoopClosingUseGtsam': False, 'kLogsFolder': str(logs)}}
        path = directory/'config.yaml'
        path.write_text(yaml.safe_dump(config))
        self.slam = None
        try:
            import faulthandler
            print('pySLAM: 正在初始化；若超過 60 秒將印出目前 Python 堆疊。', flush=True)
            faulthandler.dump_traceback_later(60, repeat=True)
            try:
                self.slam = make_slam(path, features=features)
            finally:
                faulthandler.cancel_dump_traceback_later()
            print('pySLAM: 初始化完成。', flush=True)
            assert_minimal_imports()
            original_reset = self.slam.reset_session
            def reset_session():
                original_reset()
                self.session = uuid.uuid4().hex
            self.slam.reset_session = reset_session
            self.reset()
        except BaseException:
            self.close()
            raise

    def reset(self):
        self.session = uuid.uuid4().hex
        self.sequence = 0
        self.frame_id = 0
        self.pending_reset = True

    def process(self, gray, capture_ns):
        if self.pending_reset:
            self.slam.reset()
            self.pending_reset = False
        # The shared receiver supplies rectified grayscale; upstream pySLAM's
        # frame preprocessing expects BGR and performs its own gray conversion.
        image = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
        self.slam.track(image, None, None, self.frame_id, capture_ns/1e9)
        self.frame_id += 1
        self.sequence += 1
        packet = adapt_tracking(self.slam.tracking, self.session, self.sequence, capture_ns)
        sample = dict(tracking_method='pyslam-orb', map_points=self.slam.map.num_points(),
            keyframes=self.slam.map.num_keyframes(),
            inliers=int(self.slam.tracking.num_matched_map_points_in_last_pose_opt or 0),
            reprojection_error_px=None, pyslam_state=self.slam.tracking.state.name)
        return packet, sample

    def close(self):
        if self.slam is not None:
            self.slam.quit()
            self.slam = None
        self.directory.cleanup()
