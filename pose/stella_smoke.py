"""Exercise the real compiled worker and vocabulary; not a tracking accuracy test."""
import numpy as np
from aruco_pose import load_calibration
from mac_frame_pose import ROOT
from stella_backend import StellaSlam


def main():
    K, _, _ = load_calibration(ROOT/'pose/calibrations/logitech-c270-640x480.json')
    backend = StellaSlam(K, ROOT/'.stella/build/bridge/godeyes_stella_worker',
                        ROOT/'.stella/orb_vocab.fbow')
    try:
        gray = np.zeros((480, 640), np.uint8)
        first, _ = backend.process(gray, 100_000_000)
        second, _ = backend.process(gray, 150_000_000)
        assert first['tracking'] == second['tracking'] == 'initializing'
        assert first['session_id'] == second['session_id']
        backend.reset()
        restarted, _ = backend.process(gray, 0)
        assert restarted['session_id'] != first['session_id']
        assert restarted['tracking'] == 'initializing'
        print('PASS: native vocabulary loading, frame protocol, reset and non-tracking state')
    finally:
        backend.close()


if __name__ == '__main__':
    main()
