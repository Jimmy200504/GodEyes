import itertools
from pathlib import Path
import time
import unittest
import cv2
import numpy as np
from aruco_pose import quaternion_xyzw
from marker_board import load_board, estimate_board
from pose_pipeline import PosePipeline

BOARD = Path(__file__).resolve().parents[1]/'public/markers/aruco-board-A4-55mm-ids0-3.json'

class BoardTests(unittest.TestCase):
    def setUp(self):
        self.board = load_board(BOARD,.053)
        self.k = np.array([[640.,0,320],[0,640.,240],[0,0,1]])
        self.dist = np.zeros(5)
        self.rvec = np.array([2.8,.1,.15])
        self.tvec = np.array([.02,.01,.55])
        self.rotation = cv2.Rodrigues(self.rvec)[0]

    def observations(self, ids):
        corners = [cv2.projectPoints(self.board[i],self.rvec,self.tvec,self.k,self.dist)[0].reshape(1,4,2) for i in ids]
        return corners,np.array(ids).reshape(-1,1)

    def test_every_nonempty_subset_shares_one_world_pose(self):
        expected = -self.rotation.T @ self.tvec
        for count in range(1,5):
            for ids in itertools.combinations(range(4),count):
                with self.subTest(ids=ids):
                    corners,detected = self.observations(ids)
                    result,used,reason = estimate_board(corners,detected,self.board,self.k,self.dist)
                    self.assertIsNone(reason)
                    self.assertEqual(used,list(ids))
                    np.testing.assert_allclose(result['position'],expected,atol=1e-7)
                    self.assertAlmostEqual(abs(np.dot(result['quaternion_xyzw'],quaternion_xyzw(self.rotation.T))),1,places=8)

    def test_switching_visible_ids_keeps_map_and_does_not_need_id_zero(self):
        pipeline = PosePipeline(marker_m=.053,approximate=True,board_path=BOARD)
        poses = []
        for ids in ([0],[1],[2],[3],[3,1,0,2]):
            corners,detected = self.observations(ids)
            packet,_ = pipeline.update(corners,detected,(640,480),time.monotonic())
            self.assertEqual(packet['tracking'],'tracking')
            self.assertEqual(packet['used_ids'],sorted(ids))
            poses.append(packet)
        for packet in poses[1:]:
            self.assertEqual(packet['map_id'],poses[0]['map_id'])
            np.testing.assert_allclose(packet['position'],poses[0]['position'],atol=1e-7)
        lost,_=pipeline.update([],None,(640,480),time.monotonic())
        self.assertEqual(lost['position'],poses[-1]['position'])
        self.assertEqual(lost['used_ids'],[])

    def test_print_scale_and_duplicate_id_handling(self):
        np.testing.assert_allclose(np.linalg.norm(self.board[0]-np.roll(self.board[0],1,axis=0),axis=1),.053)
        centers = [self.board[i].mean(axis=0) for i in (0,1)]
        self.assertAlmostEqual(np.linalg.norm(centers[1]-centers[0]),.09*.053/.055)
        corners,ids = self.observations([0,0,1])
        result,used,_=estimate_board(corners,ids,self.board,self.k,self.dist)
        self.assertIsNotNone(result)
        self.assertEqual(used,[1])
        result,used,_=estimate_board([],None,self.board,self.k,self.dist)
        self.assertIsNone(result)
        self.assertEqual(used,[])

if __name__ == '__main__': unittest.main()
