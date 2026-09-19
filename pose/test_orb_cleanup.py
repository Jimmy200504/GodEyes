"""Exercise the Mac cleanup with temporary files and a fake Docker command."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('orb_cleanup',
    Path(__file__).resolve().parents[1]/'scripts/cleanup-orbslam3.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class CleanupTests(unittest.TestCase):
    def run_cleanup(self, root, apply=False):
        calls = []
        own = 'godeyes-orb-' + 'a'*32
        rows = [dict(Names=own, Image=cleanup.IMAGE),
                dict(Names='unrelated', Image=cleanup.IMAGE),
                dict(Names='godeyes-orb-'+'b'*32, Image='other-image')]
        def fake_docker(args, **kwargs):
            calls.append(args)
            output = '\n'.join(map(json.dumps, rows)) if args[1:3] == ['ps', '-a'] else ''
            return subprocess.CompletedProcess(args, 0, output, '')
        with patch.object(cleanup.sys, 'platform', 'darwin'), \
             patch.object(cleanup.sys, 'argv', ['cleanup'] + (['--apply'] if apply else [])), \
             patch.object(cleanup.Path, 'home', return_value=root), \
             patch.object(cleanup.shutil, 'which', return_value='/fake/docker'), \
             patch.object(cleanup.subprocess, 'run', side_effect=fake_docker), \
             patch('builtins.print'):
            result = cleanup.main()
        return result, calls, own

    def test_only_own_containers_image_and_files_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root/'GodEyes-orbslam3'
            (folder/'native/orbslam3').mkdir(parents=True)
            (folder/'native/orbslam3/Dockerfile').touch()
            (folder/'ORB_SLAM3.md').touch()
            keep = root/'GodEyes-local-slam'
            keep.mkdir()
            result, calls, own = self.run_cleanup(root, apply=True)
            self.assertEqual(result, 0)
            self.assertFalse(folder.exists())
            self.assertTrue(keep.exists())
            self.assertIn(['docker', 'rm', '-f', own], calls)
            self.assertIn(['docker', 'image', 'rm', cleanup.IMAGE], calls)
            self.assertFalse(any('prune' in call or 'unrelated' in call for call in calls))
            self.assertEqual(sum(call[1] == 'rm' for call in calls), 1)

    def test_unrecognized_folder_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root/'GodEyes-orbslam3'
            folder.mkdir()
            (folder/'user-data').write_text('keep')
            result, _, _ = self.run_cleanup(root, apply=True)
            self.assertEqual(result, 1)
            self.assertTrue((folder/'user-data').exists())

    def test_default_does_not_delete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'Downloads').mkdir()
            archive = root/'Downloads/godeyes-orbslam3.tar.gz'
            archive.touch()
            result, calls, _ = self.run_cleanup(root)
            self.assertEqual(result, 0)
            self.assertTrue(archive.exists())
            self.assertFalse(any(call[1] == 'rm' or 'prune' in call for call in calls))


if __name__ == '__main__':
    unittest.main()
