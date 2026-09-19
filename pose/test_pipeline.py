import json
import tempfile
import time
import unittest
from pathlib import Path
import cv2
import numpy as np
from aruco_pose import square_points
from pose_pipeline import PosePipeline
from relay import validate

class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.k = np.array([[640.,0,320],[0,640.,240],[0,0,1]])
        points,_ = cv2.projectPoints(square_points(.055),np.array([2.8,.1,.1]),
                                    np.array([.01,.02,.5]),self.k,np.zeros(5))
        self.corners = [points.reshape(1,4,2).astype(np.float32)]
        self.ids = np.array([[0]])

    def test_detection_does_not_claim_pose_without_intrinsics(self):
        pipeline = PosePipeline()
        packet,error = pipeline.update(self.corners,self.ids,(640,480),time.monotonic())
        validate(packet)
        self.assertEqual(packet['tracking'],'initializing')
        self.assertEqual(packet['tracking_reason'],'calibration_required')
        self.assertIsNone(error)

    def test_approximate_mode_publishes_but_labels_scale(self):
        pipeline = PosePipeline(approximate=True)
        packet,error = pipeline.update(self.corners,self.ids,(640,480),time.monotonic())
        validate(packet)
        self.assertEqual(packet['tracking'],'tracking')
        self.assertEqual(packet['scale'],'estimated')
        self.assertLess(error,.1)
        lost,_ = pipeline.update([],None,(640,480),time.monotonic())
        self.assertEqual(lost['tracking'],'lost')
        self.assertGreater(lost['seq'],packet['seq'])

    def test_calibrated_mode_and_resolution_mismatch(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'camera.json'
            path.write_text(json.dumps(dict(camera_matrix=self.k.tolist(),dist_coeffs=[0]*5,image_size=[640,480])))
            pipeline=PosePipeline(calibration=path)
            packet,_=pipeline.update(self.corners,self.ids,(640,480),time.monotonic())
            validate(packet)
            self.assertEqual(packet['tracking'],'tracking')
            self.assertEqual(packet['scale'],'metric')
            packet,_=pipeline.update(self.corners,self.ids,(1280,720),time.monotonic())
            self.assertEqual(packet['tracking_reason'],'resolution_mismatch')
            self.assertNotEqual(packet['tracking'],'tracking')

if __name__ == '__main__': unittest.main()
