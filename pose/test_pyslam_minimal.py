import ast
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

from pyslam_minimal import select_candidates, assert_minimal_imports

path = Path(__file__).resolve().parents[1]/'native/pyslam-min/prepare.py'
spec = importlib.util.spec_from_file_location('prepare_pyslam_minimal', path)
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class MinimalTests(unittest.TestCase):
    def test_import_changes_preserve_tracking_method(self):
        source = '''"""Upstream license."""
import torch.multiprocessing as mp
from . import optimizer_gtsam
class Tracking:
    def track(self, img):
        return optimizer_g2o.pose_optimization(img)
'''
        patched = prepare.transform(source, 'pyslam/slam/tracking.py')
        original_method = ast.parse(source).body[-1]
        patched_method = ast.parse(patched).body[-1]
        self.assertEqual(ast.dump(original_method), ast.dump(patched_method))
        self.assertIn('import multiprocessing as mp', patched)
        self.assertIn("DeferredImport('pyslam.slam.optimizer_gtsam')", patched)
        self.assertEqual(ast.get_docstring(ast.parse(patched)), 'Upstream license.')

    def test_feature_factories_do_not_eagerly_import_models(self):
        source = "Neural = import_from('pyslam.local_features.feature_superpoint', 'SuperPointFeature2D')\n"
        patched = prepare.transform(source, 'pyslam/local_features/feature_manager.py')
        self.assertIn('DeferredImport(', patched)
        self.assertNotIn('= import_from(', patched)

    def test_deferred_import_does_not_hide_runtime_errors(self):
        namespace = {}
        exec(prepare.LAZY_SOURCE, namespace)
        lazy = namespace['DeferredImport']('nonexistent_optional_model_for_test', 'Network')
        with self.assertRaises(ModuleNotFoundError):
            lazy()

    def test_native_patch_disables_unused_cholmod_and_is_repeatable(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/'pyslam').mkdir()
            native = root/'thirdparty/g2opy/python'
            (native/'core').mkdir(parents=True)
            header = native/'core/block_solver.h'
            header.write_text('#include <g2o/solvers/cholmod/linear_solver_cholmod.h>\n#define _CHOLMOD_FOUND 1\n')
            cmake = native/'CMakeLists.txt'
            cmake.write_text('pybind11_add_module(g2o g2o.cpp)\n    solver_cholmod\n    opengl_helper\n')
            prepare.prepare(root)
            self.assertIn('#define _CHOLMOD_FOUND 0', header.read_text())
            self.assertNotIn('#include <g2o/solvers/cholmod', header.read_text())
            self.assertIn('NO_EXTRAS', cmake.read_text())
            before = cmake.read_text()
            prepare.prepare(root)
            self.assertEqual(before, cmake.read_text())
            header.write_text('manual edit')
            with self.assertRaises(RuntimeError):
                prepare.prepare(root)

    def test_rank_candidates_is_bounded_and_skips_bad_frames(self):
        keyframes = [SimpleNamespace(id=i, des=[i]*30, is_bad=lambda: False) for i in range(100)]
        keyframes.append(SimpleNamespace(id=101, des=[0]*30, is_bad=lambda: True))
        calls = []
        class Matcher:
            def knnMatch(self, query, train, k):
                calls.append(train[0])
                return [(SimpleNamespace(distance=10, trainIdx=j), SimpleNamespace(distance=40, trainIdx=j)) for j in range(25)]
        candidates = select_candidates(SimpleNamespace(des=[0]*30), keyframes, Matcher())
        self.assertEqual(len(calls), 40)
        self.assertEqual(len(candidates), 5)
        self.assertIn(0, calls)
        self.assertIn(99, calls)
        self.assertNotIn(101, calls)

    def test_duplicate_matches_do_not_create_false_candidate_support(self):
        class Matcher:
            def knnMatch(self, query, train, k):
                return [(SimpleNamespace(distance=10, trainIdx=0), SimpleNamespace(distance=40, trainIdx=1)) for _ in range(100)]
        keyframe = SimpleNamespace(id=1, des=[0]*30, is_bad=lambda: False)
        self.assertEqual(select_candidates(SimpleNamespace(des=[0]*30), [keyframe], Matcher()), [])

    def test_missing_frame_descriptors_skip_matching(self):
        self.assertEqual(select_candidates(SimpleNamespace(des=None), [], None), [])

    def test_dependency_guard_detects_unexpected_neural_import(self):
        from unittest.mock import patch
        with patch.dict(sys.modules, {'torch': SimpleNamespace()}):
            with self.assertRaises(RuntimeError):
                assert_minimal_imports()

    def test_live_pose_uses_upstream_camera_to_world_without_second_inversion(self):
        import numpy as np
        from pyslam_backend import adapt_tracking
        rotation = np.array([[0., -1., 0.], [1., 0., 0.], [0., 0., 1.]])
        tracking = SimpleNamespace(state=SimpleNamespace(name='OK'), cur_R=rotation, cur_t=np.array([1.,2.,3.]))
        packet = adapt_tracking(tracking, 'test-session', 1, 123)
        self.assertEqual(packet['position'], [1.,2.,3.])
        np.testing.assert_allclose(packet['quaternion_xyzw'], [0.,0.,2**-.5,2**-.5], atol=1e-7)
        self.assertEqual(packet['tracking'], 'tracking')

    def test_live_lost_does_not_publish_stale_pose_as_valid(self):
        import numpy as np
        from pyslam_backend import adapt_tracking
        tracking = SimpleNamespace(state=SimpleNamespace(name='LOST'), cur_R=np.eye(3), cur_t=np.array([1.,2.,3.]))
        packet = adapt_tracking(tracking, 'test-session', 2, 124)
        self.assertEqual(packet['tracking'], 'lost')
        self.assertEqual(packet['position'], [0.,0.,0.])


if __name__ == '__main__':
    unittest.main()
