"""Pose packets from the same corners used by the live preview."""
import hashlib
from pathlib import Path
import time
import uuid
import numpy as np
from aruco_pose import load_calibration, solve_marker, square_points
from marker_board import load_board, estimate_board


class PosePipeline:
    def __init__(self, marker_m=.053, calibration=None, approximate=False, board_path=None):
        square_points(marker_m)
        if calibration and approximate:
            raise ValueError("choose calibrated or approximate mode, not both")
        self.board = load_board(board_path, marker_m) if board_path else None
        self.target_ids = sorted(self.board) if self.board else [0]
        self.marker_m = marker_m
        self.calibration = load_calibration(calibration) if calibration else None
        self.approximate = approximate
        self.session = str(uuid.uuid4())
        self.start = time.monotonic()
        self.seq = 0
        identity = hashlib.sha256(Path(calibration).read_bytes()).hexdigest()[:12] if calibration else (
            'approx-width-focal' if approximate else 'uncalibrated')
        board_identity = hashlib.sha256(Path(board_path).read_bytes()).hexdigest()[:12] if board_path else 'single-0'
        self.map_id = f'screen-B:{board_identity}:{marker_m}:{identity}'
        self.last = dict(position=[0.,0.,0.], quaternion_xyzw=[0.,0.,0.,1.])

    def update(self, corners, ids, size, captured):
        scale = 'metric' if self.calibration else ('estimated' if self.approximate else 'arbitrary')
        result = None
        used_ids = []
        reason = None
        if not self.calibration and not self.approximate:
            reason = 'calibration_required'
        elif self.calibration and self.calibration[2] != tuple(size):
            reason = 'resolution_mismatch'
        else:
            if self.calibration:
                k, dist, _ = self.calibration
            else:
                # Demo assumption, not a measured camera model.
                width,height = size
                k = np.array([[width,0,width/2],[0,width,height/2],[0,0,1]],np.float64)
                dist = np.zeros(5)
            if self.board:
                result, used_ids, reason = estimate_board(corners,ids,self.board,k,dist)
            else:
                values = [] if ids is None else [int(v) for v in ids.flatten()]
                if values.count(0) != 1:
                    reason = 'marker_missing_or_duplicate'
                else:
                    pixels = corners[values.index(0)].reshape(4,2)
                    if np.min(np.linalg.norm(pixels-np.roll(pixels,1,axis=0),axis=1)) < 20:
                        reason = 'marker_too_small'
                    else:
                        result = solve_marker(pixels,self.marker_m,k,dist)
                        if result is None:
                            reason = 'pose_quality_rejected'
                        else:
                            used_ids = [0]
        if result:
            self.last = result
        tracking = 'tracking' if result else ('initializing' if reason in (
            'calibration_required','resolution_mismatch') else 'lost')
        packet = dict(version=1,frame='opencv-c2w',source='aruco-B',session_id=self.session,
            map_id=self.map_id,seq=self.seq,capture_monotonic_ns=max(0,int((captured-self.start)*1e9)),
            tracking=tracking,tracking_reason=reason,scale=scale,
            used_ids=used_ids,target_ids=self.target_ids,
            position=self.last['position'],quaternion_xyzw=self.last['quaternion_xyzw'])
        self.seq += 1
        return packet, None if result is None else result['reprojection_error_px']
