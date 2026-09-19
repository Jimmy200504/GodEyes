import asyncio
import gzip
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch
from fastapi.testclient import TestClient
from PIL import Image
from server import app as service
from server import world_api


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name)
        self.patches = [patch.object(service, 'DATA', self.data), patch.object(service.shutil, 'which', return_value='/usr/bin/codex'), patch.object(service, 'launch')]
        for p in self.patches: p.start()
        self.client = TestClient(service.app)
        self.client.__enter__()
        self.image = io.BytesIO()
        Image.new('RGB', (512, 512), '#777777').save(self.image, format='PNG')

    def tearDown(self):
        self.client.__exit__(None, None, None)
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()

    def create(self):
        response = self.client.post('/api/scenes', data={'name': '測試現場'}, files={'images': ('photo.png', self.image.getvalue(), 'image/png')})
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()['id']

    def review(self, scene_id):
        run = self.data / scene_id
        (run / 'generated').mkdir()
        (run / 'generated/scene.png').write_bytes(self.image.getvalue())
        (run / 'WORLD_MODEL_PROMPT.md').write_text('Preserve the entire scene.')
        service.update(run, status='review')
        return run

    def test_photo_only_create_and_asset_boundaries(self):
        scene_id = self.create()
        run = self.data / scene_id
        self.assertNotIn('testimonies', json.loads((run / 'INPUT.json').read_text()))
        self.assertEqual(self.client.get(f'/api/scenes/{scene_id}/assets/inputs/photo_01.png').status_code, 200)
        (run / 'stderr.log').write_text('private log')
        self.assertEqual(self.client.get(f'/api/scenes/{scene_id}/assets/stderr.log').status_code, 404)
        self.assertEqual(self.client.get(f'/api/scenes/{scene_id}/assets/scene.json').status_code, 404)
        self.assertEqual(self.client.get('/api/scenes/not-an-id').status_code, 404)
        self.assertEqual(len(self.client.get('/api/scenes').json()), 1)

    def test_invalid_images_and_origins(self):
        response = self.client.post('/api/scenes', data={'name': 'bad'}, files={'images': ('fake.png', b'not an image', 'image/png')})
        self.assertEqual(response.status_code, 422)
        response = self.client.post('/api/scenes', data={'name': 'bad'}, files={'images': ('photo.png', self.image.getvalue(), 'image/png')}, headers={'Origin': 'https://evil.example'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(list(self.data.iterdir()), [])

    def test_submission_freezes_prompt_and_rejects_duplicate(self):
        scene_id = self.create()
        run = self.review(scene_id)
        with patch.object(world_api, 'settings', return_value={'WORLD_LABS_API_KEY': 'test'}):
            response = self.client.post(f'/api/scenes/{scene_id}/world', json={'prompt': 'Reviewed prompt'})
            self.assertEqual(response.status_code, 202)
            self.assertEqual(self.client.post(f'/api/scenes/{scene_id}/world', json={'prompt': 'Different prompt'}).status_code, 409)
        self.assertEqual((run / 'submitted-prompt.md').read_text(), 'Reviewed prompt')

    def test_ambiguous_submission_never_resubmits(self):
        scene_id = self.create()
        run = self.review(scene_id)
        world_api.save(run / 'submission-started.json', {'submitted': True})
        service.update(run, status='error', stage='world')
        self.assertFalse(self.client.get(f'/api/scenes/{scene_id}').json()['canRetry'])
        self.assertEqual(self.client.post(f'/api/scenes/{scene_id}/retry').status_code, 409)
        with patch.object(world_api, 'api') as api:
            with self.assertRaises(RuntimeError):
                world_api.submit(run, 'name', run / 'generated/scene.png', 'prompt')
            api.assert_not_called()

    def test_existing_operation_resumes_without_submission(self):
        scene_id = self.create()
        run = self.review(scene_id)
        world_api.save(run / 'operation.json', {'operation_id': 'existing'})
        service.update(run, status='generating', stage='world')
        with patch.object(world_api, 'submit') as submit, patch.object(world_api, 'poll', return_value={'assets': {}}), patch.object(world_api, 'download'):
            asyncio.run(service.generate(run))
            submit.assert_not_called()
        self.assertEqual(service.read(run)['status'], 'ready')

    def test_download_failure_keeps_world_for_retry(self):
        scene_id = self.create()
        run = self.review(scene_id)
        world_api.save(run / 'world.json', {'assets': {}})
        service.update(run, status='generating', stage='world')
        with patch.object(world_api, 'submit') as submit, patch.object(world_api, 'download', side_effect=RuntimeError('download failed')):
            asyncio.run(service.work(run, 'world'))
            submit.assert_not_called()
        self.assertEqual(service.read(run)['status'], 'error')
        self.assertTrue((run / 'world.json').exists())

    def test_retry_archives_incomplete_clean_output(self):
        scene_id = self.create()
        run = self.review(scene_id)
        service.update(run, status='error', stage='clean')
        self.assertEqual(self.client.post(f'/api/scenes/{scene_id}/retry').status_code, 202)
        self.assertFalse((run / 'generated/scene.png').exists())
        self.assertEqual(len(list(run.glob('attempt-*/generated/scene.png'))), 1)

    def test_restart_recovers_marble_but_not_unknown_submission(self):
        a = self.create(); b = self.create()
        for item in [a, b]: service.update(self.data / item, status='generating', stage='world')
        world_api.save(self.data / a / 'operation.json', {'operation_id': 'existing'})
        world_api.save(self.data / b / 'submission-started.json', {'submitted': True})
        async def restart():
            with patch.object(service, 'launch') as launch:
                async with service.lifespan(service.app):
                    launch.assert_called_once_with(self.data / a, 'world')
        asyncio.run(restart())
        self.assertEqual(service.read(self.data / b)['status'], 'error')

    def test_definite_rejection_can_retry_but_server_error_cannot(self):
        for code, blocked in [(402, False), (500, True)]:
            scene_id = self.create()
            run = self.review(scene_id)
            error = urllib.error.HTTPError('https://api.worldlabs.ai', code, 'rejected', {}, None)
            with patch.object(world_api, 'upload', return_value='asset'), patch.object(world_api, 'api', side_effect=error):
                with self.assertRaises(urllib.error.HTTPError):
                    world_api.submit(run, 'name', run / 'generated/scene.png', 'prompt')
            self.assertEqual((run / 'submission-started.json').exists(), blocked)
            service.update(run, status='error', stage='world')
            self.assertEqual(service.public(run)['canRetry'], not blocked)

    def test_terminal_operation_is_not_retryable(self):
        scene_id = self.create()
        run = self.review(scene_id)
        world_api.save(run / 'operation.json', {'operation_id': 'existing', 'done': True, 'error': {'message': 'failed'}})
        service.update(run, status='error', stage='world')
        self.assertFalse(service.public(run)['canRetry'])

    def test_download_validates_spz_and_does_not_cache_corruption(self):
        scene_id = self.create()
        run = self.review(scene_id)
        world = {'assets': {'splats': {'spz_urls': {'full_res': 'https://example.test/world.spz'}}}}
        with patch.object(world_api.urllib.request, 'urlopen', return_value=io.BytesIO(gzip.compress(b'BAD!'))):
            with self.assertRaises(RuntimeError): world_api.download(run, world)
        self.assertFalse((run / 'world.spz').exists())
        self.assertFalse((run / 'world.part').exists())
        with patch.object(world_api.urllib.request, 'urlopen', return_value=io.BytesIO(gzip.compress(b'NGSP' + bytes(16)))):
            world_api.download(run, world)
        self.assertTrue((run / 'world.spz').exists())

    def test_png_validation_requires_preservation_and_all_deliverables(self):
        scene_id = self.create()
        run = self.review(scene_id)
        (run / 'generated/imagegen-prompt.txt').write_text('Keep all contents.')
        manifest = {'status': 'complete', 'image_generated_with': 'built-in imagegen', 'references_inspected': True,
                    'image_inspected': True, 'world_model_prompt_created': True, 'preserve_people_and_objects': True}
        world_api.save(run / 'manifest.json', manifest)
        service.workflow.validate(run)
        manifest['preserve_people_and_objects'] = False
        world_api.save(run / 'manifest.json', manifest)
        with self.assertRaises(ValueError): service.workflow.validate(run)


if __name__ == '__main__': unittest.main()
