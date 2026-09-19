import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import cv2
import numpy as np
from calibration_web import CalibrationSession

class CalibrationWebTests(unittest.TestCase):
    def test_capture_recognizes_generated_pattern_and_rejects_repeat(self):
        with tempfile.TemporaryDirectory() as folder:
            session=CalibrationSession(folder)
            image=cv2.imread(str(Path(__file__).resolve().parents[1]/'public/markers/calibration-checkerboard.png'))
            frame=cv2.resize(image,(640,480))
            session.capture(frame)
            self.assertEqual(session.status()['count'],1)
            with self.assertRaisesRegex(ValueError,'相似'):session.capture(frame)
            with self.assertRaisesRegex(ValueError,'16'):session.solve()
            session.reset();self.assertEqual(session.status()['count'],0)

    def test_synthetic_multiview_calibration_and_holdout_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            session=CalibrationSession(folder);session.folder.mkdir(parents=True)
            k=np.array([[650.,0,320],[0,645.,240],[0,0,1.]])
            obj=np.zeros((54,3),np.float32);obj[:,:2]=np.mgrid[:9,:6].T.reshape(-1,2)
            corners_by_path={}
            for i in range(16):
                r=np.array([((i%4)-1.5)*.2,((i//4)-1.5)*.2,.04*(i%3)])
                t=np.array([-4.+((i%4)-1.5)*1.4,-2.5+((i//4)-1.5)*1.,19.+i%3])
                points,_=cv2.projectPoints(obj,r,t,k,np.zeros(5))
                path=str(session.folder/f'{i}.png');cv2.imwrite(path,np.zeros((480,640),np.uint8))
                session.samples.append((path,points.reshape(-1,2)))
                corners_by_path[path]=points
            # Exercise the real calibrateCamera/PnP/holdout gates with exact synthetic corners.
            def detected(image,shape):
                index=detected.index;detected.index+=1
                return True,detected.points[index]
            train=[v for i,v in enumerate(corners_by_path.values()) if i%4!=3]
            detected.points=train+list(corners_by_path.values());detected.index=0
            with patch('calibrate.cv2.findChessboardCornersSB',side_effect=detected):
                result_path=session.solve()
            import json
            result=json.loads(Path(result_path).read_text())
            self.assertLess(result['validation_max_px'],.01)
            np.testing.assert_allclose(result['camera_matrix'],k,atol=.02)
            self.assertTrue(session.status()['ready'])
