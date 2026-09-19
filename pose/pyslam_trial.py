"""Record actual board frames and benchmark pinned upstream main_slam.py.

No synthetic frames, no pose relay, and no changes to upstream tracking logic.
"""
import argparse
import collections
import json
import math
import os
from pathlib import Path
import statistics
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'a5ff2562eb929ed9a08420f528a120a3cca65585'


def positive(value):
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError('must be finite and positive')
    return value


def record(args):
    from websockets.sync.client import connect
    from frame_stream import unpack_frame
    target = Path(args.output).resolve()
    target.mkdir(parents=True, exist_ok=False)
    calibration = json.loads(Path(args.calibration).read_text())
    if calibration['image_size'] != [640, 480]:
        raise ValueError('expected 640x480 calibration')
    (target / 'calibration.json').write_text(json.dumps(calibration, indent=2))
    print('錄製前請先平移相機建立視差，再左右轉動，最後轉回原場景。', flush=True)
    for left in range(3, 0, -1):
        print(f'{left}…', flush=True)
        time.sleep(1)
    times, session, last_seq, skipped, stale = [], None, -1, 0, 0
    with connect(args.frames, compression=None, max_size=2*1024*1024) as ws, \
            (target / 'frames.jsonl').open('w') as metadata, \
            (target / 'times.txt').open('w') as timestamps:
        started = time.monotonic()
        while time.monotonic() - started < args.seconds:
            sent = time.monotonic()
            ws.send('next')
            meta, jpeg = unpack_frame(ws.recv(timeout=10))
            if session is not None and meta['session'] != session:
                raise RuntimeError('board camera restarted; discard this recording')
            session = meta['session']
            age_bound = meta['age_ns'] / 1e9 + time.monotonic() - sent
            if age_bound > .250:
                stale += 1
                continue
            capture = meta['capture_ns'] / 1e9
            if meta['seq'] <= last_seq or (times and capture <= times[-1]):
                raise ValueError('non-monotonic board frame')
            if last_seq >= 0:
                skipped += meta['seq'] - last_seq - 1
            last_seq = meta['seq']
            (target / f'{len(times):06d}.jpg').write_bytes(jpeg)
            times.append(capture)
            timestamps.write(f'{capture - times[0]:.9f}\n')
            metadata.write(json.dumps(dict(meta, age_upper_bound_ms=age_bound*1000))+'\n')
            if len(times) % 30 == 0:
                print(f'已錄 {len(times)} 幀，{time.monotonic()-started:.1f} 秒', flush=True)
    if len(times) < 2:
        raise RuntimeError('not enough frames; recording is incomplete')
    report = {'frames': len(times), 'duration_s': times[-1]-times[0],
              'capture_fps': (len(times)-1)/(times[-1]-times[0]),
              'skipped_board_frames': skipped, 'rejected_stale_frames': stale}
    # Completion marker: interrupted recordings cannot accidentally be benchmarked.
    (target / 'recording.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    print(f'錄製完成：{target}')


def prepare_config(upstream, recording, result):
    import yaml
    info = json.loads((recording / 'recording.json').read_text())
    times = [float(t) for t in (recording / 'times.txt').read_text().splitlines()]
    images = sorted(recording.glob('*.jpg'))
    if (len(times) != len(images) or len(times) != info['frames'] or len(times) < 2
            or not all(math.isfinite(t) for t in times)
            or any(b <= a for a, b in zip(times, times[1:]))):
        raise ValueError('recording images and strictly increasing timestamps must match')
    cal = json.loads((recording / 'calibration.json').read_text())
    K, d = cal['camera_matrix'], cal['dist_coeffs']
    if cal['image_size'] != [640, 480] or len(d) != 5:
        raise ValueError('expected C270 640x480 five-coefficient calibration')
    settings = {'Camera.fx': K[0][0], 'Camera.fy': K[1][1],
                'Camera.cx': K[0][2], 'Camera.cy': K[1][2],
                'Camera.width': 640, 'Camera.height': 480,
                'Camera.fps': info['capture_fps'], 'Camera.RGB': 0,
                'FeatureTrackerConfig.name': 'ORB2',
                'FeatureTrackerConfig.nFeatures': 1200,
                'LoopDetectionConfig.name': 'DBOW3', 'Viewer.on': 1}
    settings.update(dict(zip(['Camera.k1', 'Camera.k2', 'Camera.p1', 'Camera.p2', 'Camera.k3'], d)))
    camera_path = result / 'camera.yaml'
    camera_path.write_text(yaml.safe_dump(settings))
    config = yaml.safe_load((upstream / 'config.yaml').read_text())
    config['DATASET'] = {'type': 'FOLDER_DATASET'}
    config['FOLDER_DATASET'] = {'type': 'folder', 'sensor_type': 'mono',
        'base_path': str(recording), 'name': '*.jpg', 'timestamps': 'times.txt',
        'settings': str(camera_path), 'fps': max(1, round(info['capture_fps'])),
        'environment_type': 'indoor', 'start_frame_id': 0}
    config['SYSTEM_STATE'] = {'load_state': False, 'folder_path': 'results/godeyes_trial_state'}
    config['SAVE_TRAJECTORY'] = {'save_trajectory': True, 'format_type': 'tum',
        'output_folder': str(result / 'trajectory'), 'basename': 'trajectory'}
    config['GLOBAL_PARAMETERS'] = {'kUseLoopClosing': True,
        'kDoVolumetricIntegration': False, 'kUseDepthEstimatorInFrontEnd': False,
        'kDoSparseSemanticMappingAndSegmentation': False,
        'kLogsFolder': str(result / 'upstream-logs')}
    path = result / 'config.yaml'
    path.write_text(yaml.safe_dump(config))
    return path


def instrument(source):
    """Instrument the reviewed call site, failing closed on upstream changes."""
    needle = '                        slam.track(img, img_right, depth, img_id, timestamp)  # main SLAM function'
    if source.count(needle) != 1:
        raise ValueError('upstream track call changed; review before running')
    replacement = '''                        _trial_start = time.perf_counter()
                        slam.track(img, img_right, depth, img_id, timestamp)
                        _trial_ms = (time.perf_counter() - _trial_start) * 1000
                        with open(os.environ['GODEYES_TRIAL_METRICS'], 'a') as _trial_file:
                            _trial_file.write(json.dumps({'frame': img_id, 'timestamp': timestamp,
                                'state': slam.tracking.state.name, 'track_ms': _trial_ms}) + '\\n')'''
    return source.replace(needle, replacement)


def summarize(rows):
    counts = collections.Counter(row['state'] for row in rows)
    milliseconds = sorted(row['track_ms'] for row in rows)
    lost_start, longest, recovered, trailing = None, 0., [], None
    for row in rows:
        if row['state'] == 'LOST' and lost_start is None:
            lost_start = row['timestamp']
        if row['state'] == 'OK' and lost_start is not None:
            duration = row['timestamp'] - lost_start
            recovered.append(duration)
            longest = max(longest, duration)
            lost_start = None
    if lost_start is not None:
        trailing = rows[-1]['timestamp'] - lost_start
        longest = max(longest, trailing)
    return {'processed_frames': len(rows), 'state_counts': dict(counts),
        'tracking_ok_fraction': counts['OK']/len(rows) if rows else None,
        'track_ms_median': statistics.median(milliseconds) if rows else None,
        'track_ms_p95': milliseconds[math.ceil(len(rows)*.95)-1] if rows else None,
        'longest_lost_observed_s': longest,
        'recovered_lost_durations_s': recovered, 'unrecovered_lost_observed_s': trailing,
        'note': 'Offline replay; track time excludes decoding/UI and is not end-to-end FPS. '
                'No ground truth: OK state is not proof of pose accuracy. '
                'Lost durations use observed source timestamps; trailing loss is a lower bound.'}


def run(args):
    upstream = ROOT / '.pyslam/upstream'
    revision = subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != REVISION:
        raise ValueError('upstream revision differs from reviewed version')
    recording = Path(args.recording).resolve()
    result = Path(args.output).resolve()
    result.mkdir(parents=True, exist_ok=False)
    config = prepare_config(upstream, recording, result)
    # Generated file stays beside main_slam.py so imports and multiprocessing match upstream.
    runner = upstream / 'main_godeyes_trial.py'
    runner.write_text(instrument((upstream / 'main_slam.py').read_text()))
    metrics_path = result / 'frames.jsonl'
    env = dict(os.environ, GODEYES_TRIAL_METRICS=str(metrics_path))
    command = [sys.executable, '-u', str(runner), '--config_path', str(config), '--no_output_date']
    if not args.gui:
        command.append('--headless')
    (result / 'run.json').write_text(json.dumps({'upstream_revision': revision,
        'recording': str(recording), 'command': command}, indent=2))
    print(f'執行完整 pySLAM，紀錄位置：{result}', flush=True)
    begun = time.monotonic()
    with (result / 'run.log').open('w') as log:
        proc = subprocess.Popen(command, cwd=upstream, env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
        try:
            for line in proc.stdout:
                log.write(line)
                log.flush()
                print(line, end='', flush=True)
            code = proc.wait()
        except BaseException:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            raise
    rows = [json.loads(line) for line in metrics_path.read_text().splitlines()] if metrics_path.exists() else []
    summary = summarize(rows)
    expected = json.loads((recording / 'recording.json').read_text())['frames']
    summary.update(exit_code=code, wall_seconds=time.monotonic()-begun,
                   complete=code == 0 and len(rows) == expected, expected_frames=expected)
    (result / 'summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    if not summary['complete']:
        raise SystemExit(f'測試未完整完成；請查看 {result / "run.log"}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    rec = commands.add_parser('record')
    rec.add_argument('--frames', default='ws://127.0.0.1:18782/frames')
    rec.add_argument('--seconds', type=positive, default=30)
    rec.add_argument('--output', default=str(ROOT / '.pyslam/recordings' / time.strftime('%Y%m%d-%H%M%S')))
    rec.add_argument('--calibration', default=str(ROOT / 'pose/calibrations/logitech-c270-640x480.json'))
    rec.set_defaults(action=record)
    trial = commands.add_parser('run')
    trial.add_argument('recording')
    trial.add_argument('--output', default=str(ROOT / '.pyslam/results' / time.strftime('%Y%m%d-%H%M%S')))
    trial.add_argument('--gui', action='store_true', help='show upstream GUI; close it after playback')
    trial.set_defaults(action=run)
    args = parser.parse_args()
    args.action(args)


if __name__ == '__main__':
    main()
