"""Headless upstream pySLAM: ORB, local mapping/BA, bounded relocalization.

Run using scripts/run-pyslam-minimal.sh, after the isolated minimal setup.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
MIN_ROOT = ROOT / '.pyslam-min'


def select_candidates(frame, keyframes, matcher, limit=40, top=5):
    """Bound the search cost; uniformly sample older views plus recent ones."""
    keyframes = sorted((kf for kf in keyframes if not kf.is_bad() and kf.des is not None), key=lambda kf: kf.id)
    if len(keyframes) > limit:
        recent = keyframes[-limit//2:]
        older = keyframes[:-limit//2]
        count = limit-len(recent)
        keyframes = [older[i*(len(older)-1)//max(1, count-1)] for i in range(count)] + recent
    if frame.des is None or len(frame.des) < 2:
        return []
    scores = []
    for keyframe in keyframes:
        if len(keyframe.des) < 2:
            continue
        pairs = matcher.knnMatch(frame.des, keyframe.des, k=2)
        unique = {pair[0].trainIdx for pair in pairs if len(pair) == 2 and pair[0].distance < .75*pair[1].distance}
        if len(unique) >= 20:
            scores.append((len(unique), keyframe))
    return sorted(scores, key=lambda pair: (-pair[0], pair[1].id))[:top]


class RecoveryOnly:
    """LoopClosing interface with candidate lookup + upstream geometric recovery.

    No pose-graph correction or BoW vocabulary; mapping owns the keyframes.
    """
    def __init__(self, slam):
        import cv2
        from pyslam.slam.relocalizer import Relocalizer
        self.slam = slam
        self.relocalizer = Relocalizer()
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
        self.attempts = self.successes = 0

    def relocalize(self, frame, image):
        self.attempts += 1
        scores = select_candidates(frame, self.slam.map.get_keyframes(), self.matcher)
        candidates = {kf.id: kf for _, kf in scores}
        output = SimpleNamespace(candidate_idxs=list(candidates), candidate_scores=[s for s, _ in scores])
        success = self.relocalizer.relocalize(frame, output, candidates)
        self.successes += int(bool(success))
        return success

    def add_keyframe(self, keyframe, image):
        pass  # Read directly from the map; no second keyframe store.

    def is_closing(self):
        return False

    def is_correcting(self):
        return False

    def wait_if_closing(self):
        pass

    def request_reset(self):
        pass  # The map reset itself removes the candidates.

    def quit(self):
        pass  # No background worker owned by this adapter.


def configure_paths():
    os.environ['PYSLAM_USE_CPP'] = 'false'
    sys.path[:0] = [str(MIN_ROOT/'upstream'), str(MIN_ROOT/'native'),
                   str(MIN_ROOT/'upstream/thirdparty/g2opy/lib')]


def make_slam(config_path, features=1200):
    os.environ['PYSLAM_MIN_CONFIG'] = str(config_path)
    import cv2
    from pyslam.config import Config
    from pyslam.config_parameters import Parameters
    # Config must be set before importing tracking: optimizer selection is module scope.
    config = Config(str(config_path))
    Parameters.kUseLoopClosing = False
    Parameters.kDoVolumetricIntegration = False
    Parameters.kDoSparseSemanticMappingAndSegmentation = False
    Parameters.kUseDepthEstimatorInFrontEnd = False
    Parameters.kOptimizationFrontEndUseGtsam = False
    Parameters.kOptimizationBundleAdjustUseGtsam = False
    Parameters.kOptimizationLoopClosingUseGtsam = False
    Parameters.kRelocalizationDebugAndPrintToFile = False
    print('pySLAM: 載入 Python SLAM core…', flush=True)
    from pyslam.slam import PinholeCamera
    from pyslam.slam.slam import Slam
    from pyslam.local_features.feature_tracker_configs import FeatureTrackerConfigs
    from pyslam.io.dataset_types import SensorType, DatasetEnvironmentType
    feature_config = dict(FeatureTrackerConfigs.ORB)
    feature_config['num_features'] = features
    cv2.setNumThreads(2)
    print('pySLAM: 建立相機、ORB tracker 與 mapping…', flush=True)
    slam = Slam(PinholeCamera(config), feature_config, None, None, SensorType.MONOCULAR,
                environment_type=DatasetEnvironmentType.INDOOR, config=config, headless=True)
    try:
        print('pySLAM: 建立 relocalizer…', flush=True)
        slam.loop_closing = RecoveryOnly(slam)
    except BaseException:
        slam.quit()
        raise
    return slam


def assert_minimal_imports():
    forbidden = ('torch', 'tensorflow', 'kornia', 'open3d', 'detectron2', 'gtsam', 'cpp_core')
    found = sorted({name.split('.')[0] for name in sys.modules if name.split('.')[0] in forbidden})
    if found:
        raise RuntimeError(f'Unexpected optional dependencies imported: {found}')


def check_optimizer():
    """Exercise the real binding, stop flag and a tiny well-constrained BA graph."""
    import g2o
    import numpy as np
    optimizer = g2o.SparseOptimizer()
    optimizer.set_algorithm(g2o.OptimizationAlgorithmLevenberg(
        g2o.BlockSolverSE3(g2o.LinearSolverEigenSE3())))
    stop = g2o.Flag(False)
    optimizer.set_force_stop_flag(stop)
    cameras = []
    for index, center in enumerate(([-.3, 0., 0.], [.3, 0., 0.], [0., .3, 0.])):
        center = np.asarray(center)
        camera = g2o.VertexSE3Expmap()
        camera.set_id(index)
        camera.set_fixed(index < 2)
        camera.set_estimate(g2o.SE3Quat(np.eye(3), -center))
        optimizer.add_vertex(camera)
        cameras.append((camera, center))
    points = []
    for index in range(20):
        truth = np.array([(index % 5 - 2)*.2, (index // 5 - 1.5)*.2, 3.+(index % 3)*.1])
        point = g2o.VertexSBAPointXYZ()
        point.set_id(10+index)
        point.set_estimate(truth + np.array([.1, -.1, .2]))
        point.set_marginalized(True)
        optimizer.add_vertex(point)
        points.append((point, truth))
        for camera, center in cameras:
            edge = g2o.EdgeSE3ProjectXYZ()
            edge.set_vertex(0, point)
            edge.set_vertex(1, camera)
            edge.fx, edge.fy, edge.cx, edge.cy = 500., 500., 320., 240.
            projected = truth-center
            edge.set_measurement(projected[:2]/projected[2]*500 + np.array([320.,240.]))
            edge.set_information(np.eye(2))
            optimizer.add_edge(edge)
    optimizer.initialize_optimization()
    optimizer.optimize(15)
    if not all(np.allclose(point.estimate(), truth, atol=1e-4) for point, truth in points):
        raise RuntimeError('Native g2o synthetic BA check failed')
    print('Native g2o Flag / synthetic BA check passed.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recording', nargs='?')
    parser.add_argument('--smoke', action='store_true', help='construct core and track a blank image; not an accuracy test')
    parser.add_argument('--output')
    args = parser.parse_args()
    configure_paths()
    import cv2
    import numpy as np
    import yaml
    from pyslam_trial import prepare_config, summarize
    import tempfile
    if args.smoke:
        check_optimizer()
        temporary = tempfile.TemporaryDirectory(prefix='godeyes-pyslam-smoke-')
        recording = Path(temporary.name)/'recording'
        recording.mkdir()
        (recording/'calibration.json').write_bytes((ROOT/'pose/calibrations/logitech-c270-640x480.json').read_bytes())
        (recording/'recording.json').write_text(json.dumps({'frames': 2, 'capture_fps': 15}))
        (recording/'times.txt').write_text('0\n0.066666667\n')
        for i in range(2):
            cv2.imwrite(str(recording/f'{i:06d}.jpg'), np.zeros((480,640,3), np.uint8))
        output = Path(temporary.name)/'result'
    else:
        if not args.recording:
            parser.error('provide a recording directory or --smoke')
        recording = Path(args.recording).resolve()
        output = Path(args.output).resolve() if args.output else MIN_ROOT/'results'/time.strftime('%Y%m%d-%H%M%S')
    output.mkdir(parents=True, exist_ok=False)
    path = prepare_config(MIN_ROOT/'upstream', recording, output)
    config = yaml.safe_load(path.read_text())
    config['GLOBAL_PARAMETERS'].update(kUseLoopClosing=False,
        kOptimizationFrontEndUseGtsam=False, kOptimizationBundleAdjustUseGtsam=False,
        kOptimizationLoopClosingUseGtsam=False)
    path.write_text(yaml.safe_dump(config))
    camera_path = output/'camera.yaml'
    camera = yaml.safe_load(camera_path.read_text())
    camera['FeatureTrackerConfig.name'] = 'ORB'
    camera.pop('LoopDetectionConfig.name', None)
    camera_path.write_text(yaml.safe_dump(camera))
    (output/'run.json').write_text(json.dumps({'backend': 'pyslam-minimal',
        'upstream_revision': 'a5ff2562eb929ed9a08420f528a120a3cca65585',
        'features': 'OpenCV ORB 1200', 'loop_closure': False,
        'relocalization': 'bounded candidates + upstream Relocalizer',
        'recording': str(recording)}, indent=2))
    rows, slam, complete = [], None, False
    started = time.monotonic()
    try:
        slam = make_slam(path)
        assert_minimal_imports()
        times = [float(t) for t in (recording/'times.txt').read_text().splitlines()]
        with (output/'frames.jsonl').open('w') as metrics:
            for index, (image_path, timestamp) in enumerate(zip(sorted(recording.glob('*.jpg')), times)):
                image = cv2.imread(str(image_path))
                if image is None or image.shape != (480,640,3):
                    raise ValueError(f'Invalid recorded image: {image_path}')
                tick = time.perf_counter()
                slam.track(image, None, None, index, timestamp)
                row = dict(frame=index, timestamp=timestamp, state=slam.tracking.state.name,
                           track_ms=(time.perf_counter()-tick)*1000,
                           map_points=slam.map.num_points(), keyframes=slam.map.num_keyframes())
                if row['state'] == 'OK' and slam.tracking.cur_R is not None:
                    row['Rwc'] = slam.tracking.cur_R.tolist()
                    row['position'] = slam.tracking.cur_t.tolist()
                rows.append(row)
                metrics.write(json.dumps(row)+'\n')
                metrics.flush()
                if index % 15 == 0:
                    print(f"[{index+1}/{len(times)}] {row['state']} {row['track_ms']:.1f} ms", flush=True)
        assert_minimal_imports()
        complete = True
    finally:
        if slam is not None:
            slam.quit()
        report = summarize(rows)
        report.update(complete=complete, wall_seconds=time.monotonic()-started,
                      loop_closure=False, backend='pyslam-minimal')
        (output/'summary.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2), flush=True)
    if args.smoke:
        print('Minimal core construction/blank-frame smoke passed; no tracking accuracy claim.')
        temporary.cleanup()
    else:
        print(f'Results: {output}')


if __name__ == '__main__':
    main()
