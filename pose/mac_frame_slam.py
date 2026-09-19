"""Receive i.MX93 JPEG frames and run monocular sparse mapping on this computer."""
import argparse
import threading
import time

import cv2
import numpy as np
from aruco_pose import load_calibration
from frame_stream import unpack_frame
from mac_frame_pose import ROOT, Preview, make_preview_server, receive
from relay import Store, make_server, make_websocket_server
from slam_sender import adapt_pose
from slam_tracker import Tracker


class SlamFrameProcessor:
    def __init__(self, calibration, features=800, orb_factory=None, optical_flow=True, backend_name="orb-slam3", synthetic_bridge=False, lost_reset_seconds=2., process_width=None):
        K, distortion, size = load_calibration(calibration)
        if tuple(size) != (640, 480):
            raise ValueError('Frame stream requires a 640x480 calibration')
        # External workers currently have fixed 640x480 settings. Only resize
        # the self-written sparse backend; retain the original capture protocol.
        width = process_width if process_width is not None else (640 if orb_factory else 320)
        if width not in (320, 480, 640):
            raise ValueError('process width must be 320, 480 or 640')
        if orb_factory and width != 640:
            raise ValueError('external backends require process width 640')
        self.processing_size = (width, width * 3 // 4)
        scaled_K = np.diag([width / size[0], self.processing_size[1] / size[1], 1.]) @ K
        self.maps = cv2.initUndistortRectifyMap(K, distortion, None, scaled_K,
                                              self.processing_size, cv2.CV_16SC2)
        K = scaled_K
        self.orb = orb_factory(K, features) if orb_factory else None
        self.tracker = self.orb if self.orb else Tracker(K, features, optical_flow=optical_flow, synthetic_bridge=synthetic_bridge, lost_reset_seconds=lost_reset_seconds)
        self.backend_name = backend_name
        self.session = None
        self.seq = -1
        self.reset = threading.Event()

    def close(self):
        if self.orb:
            self.orb.close()

    def process(self, message):
        meta, jpeg = unpack_frame(message)
        if meta['session'] == self.session and meta['seq'] <= self.seq:
            raise ValueError('out-of-order frame')
        begun = time.monotonic()
        frame = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_GRAYSCALE)
        if frame is None or frame.shape[:2] != (480, 640):
            raise ValueError('invalid JPEG or decoded resolution')
        decoded = time.monotonic()
        gray = cv2.remap(frame, *self.maps,
                         interpolation=cv2.INTER_LINEAR)
        rectified = time.monotonic()
        if meta['session'] != self.session or self.reset.is_set():
            self.reset.clear()
            self.tracker.reset()
        self.session, self.seq = meta['session'], meta['seq']
        if self.orb:
            packet, sample = self.orb.process(gray, meta['capture_ns'])
            sample['status'] = packet['tracking']
        else:
            sample = self.tracker.process(gray, meta['capture_ns'])
            packet = adapt_pose(sample, meta['capture_ns'])
            packet['source'] = 'cpu-sparse-vo-local'
        solved = time.monotonic()
        preview = cv2.resize(gray, (320, 240), interpolation=cv2.INTER_AREA)
        cv2.putText(preview, f"{sample['status']}  map:{sample['map_points']} inliers:{sample['inliers']}",
                    (8, 18), cv2.FONT_HERSHEY_SIMPLEX, .4, 255, 1)
        if not self.orb:
            cv2.putText(preview, f"{sample['tracking_method']}  LK:{sample['flow_tracks']}",
                        (8, 35), cv2.FONT_HERSHEY_SIMPLEX, .4, 255, 1)
        ok, encoded = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if not ok:
            raise ValueError('preview encode failed')
        return packet, encoded.tobytes(), dict(
            capture_size=[640, 480], processing_size=list(self.processing_size),
            ids=[], pose_tracking=packet['tracking'], pose_reason=sample.get('tracking_reason'),
            backend=self.backend_name if self.orb else 'sparse-vo',
            tracking_method=sample.get('tracking_method'), flow_tracks=sample.get('flow_tracks', 0),
            descriptor_updates=sample.get('descriptor_updates', 0),
            keyframes=sample.get('keyframes', 0), new_points=sample.get('new_points', 0),
            mapping_ms=sample.get('mapping_ms', 0),
            lost_duration_ms=sample.get('lost_duration_ms', 0), auto_resets=sample.get('auto_resets', 0),
            reset_reason=sample.get('reset_reason'), local_map_points=sample.get('local_map_points', 0),
            points_pruned=sample.get('points_pruned', 0),
            bridge_attempted=sample.get('bridge_attempted', 0),
            bridge_tracks=sample.get('bridge_tracks', 0), bridge_ms=sample.get('bridge_ms', 0),
            synthetic_bridge_enabled=sample.get('synthetic_bridge_enabled', False),
            bridge_attempts_total=sample.get('bridge_attempts_total', 0),
            bridge_successes_total=sample.get('bridge_successes_total', 0),
            feature_count=sample.get('feature_count'), map_matches=sample.get('map_matches'),
            recovery_views=sample.get('recovery_views', 0),
            input_gap_ms=sample.get('input_gap_ms'), flow_age_ms=sample.get('flow_age_ms'),
            orb_state=sample.get('orb_state'), stella_state=sample.get('stella_state'),
            pyslam_state=sample.get('pyslam_state'),
            map_points=sample['map_points'], inliers=sample['inliers'],
            reprojection_error_px=sample['reprojection_error_px'],
            timings_ms=dict(decode=round((decoded-begun)*1000, 2),
                            undistort=round((rectified-decoded)*1000, 2),
                            slam=round((solved-rectified)*1000, 2)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frames', default='ws://127.0.0.1:8781/frames')
    parser.add_argument('--calibration', default=str(ROOT/'pose/calibrations/logitech-c270-640x480.json'))
    parser.add_argument('--process-width', type=int, choices=(320, 480, 640), help='Sparse default: 320; external workers: 640')
    parser.add_argument('--features', type=int, default=800)
    parser.add_argument('--backend', choices=['sparse', 'orbslam3', 'stella', 'pyslam'], default='sparse')
    parser.add_argument('--lost-reset-seconds', type=float, default=2., help='Rebuild after sustained loss; 0 disables')
    parser.add_argument('--synthetic-bridge', action='store_true', help='Experimental midpoint image fallback for failed tracking')
    parser.add_argument('--no-optical-flow', action='store_true', help='Disable LK fallback for comparison')
    parser.add_argument('--orb-image', default='godeyes-orbslam3:4452a3c-v1')
    parser.add_argument('--orb-worker', help='Native worker executable instead of Docker')
    parser.add_argument('--orb-vocabulary', help='ORBvoc.txt for a native worker')
    parser.add_argument('--stella-worker', default=str(ROOT/'.stella/build/bridge/godeyes_stella_worker'))
    parser.add_argument('--stella-vocabulary', default=str(ROOT/'.stella/orb_vocab.fbow'))
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--http-port', type=int, default=8865)
    parser.add_argument('--preview-port', type=int, default=8866)
    parser.add_argument('--ws-port', type=int, default=8867)
    args = parser.parse_args()
    if args.features < 50 or args.threads < 1:
        parser.error('features must be >= 50 and threads >= 1')
    if not np.isfinite(args.lost_reset_seconds) or args.lost_reset_seconds < 0:
        parser.error('--lost-reset-seconds must be finite and >= 0')
    if args.synthetic_bridge and (args.backend != 'sparse' or args.no_optical_flow):
        parser.error('--synthetic-bridge requires sparse backend with optical flow enabled')
    if args.backend != 'sparse' and args.process_width not in (None, 640):
        parser.error('--process-width below 640 requires --backend sparse')
    cv2.setNumThreads(args.threads)
    orb_factory = None
    if args.backend == 'orbslam3':
        from orbslam3_backend import OrbSlam3
        orb_factory = lambda K, features: OrbSlam3(K, features, args.orb_image,
                                                 args.orb_worker, args.orb_vocabulary)
    if args.backend == 'stella':
        from stella_backend import StellaSlam
        orb_factory = lambda K, features: StellaSlam(K, args.stella_worker, args.stella_vocabulary)
    if args.backend == 'pyslam':
        from pyslam_backend import PyslamMinimal
        orb_factory = lambda K, features: PyslamMinimal(K, features)
    processor = SlamFrameProcessor(args.calibration, args.features, orb_factory, not args.no_optical_flow,
                                   backend_name={'stella': 'stella-vslam', 'pyslam': 'pyslam-minimal'}.get(args.backend, 'orb-slam3'),
                                   synthetic_bridge=args.synthetic_bridge, lost_reset_seconds=args.lost_reset_seconds,
                                   process_width=args.process_width)
    store, preview = Store(), Preview()
    servers = []
    try:
        for create in (lambda: make_server('127.0.0.1', args.http_port, store),
                       lambda: make_preview_server(preview, args.preview_port, processor.reset),
                       lambda: make_websocket_server(store, '127.0.0.1', args.ws_port)):
            server = create()
            servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()
        print(f'Local {args.backend} receiver ready; open the local website on port 5182.', flush=True)
        receive(args.frames, processor, store, preview)
    except KeyboardInterrupt:
        pass
    finally:
        processor.close()
        for server in servers:
            server.shutdown()
            if hasattr(server, 'server_close'):
                server.server_close()


if __name__ == '__main__':
    main()
