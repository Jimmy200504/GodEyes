"""Single-user localhost generation service, durable jobs and bounded asset access."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import uuid
import urllib.error

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from . import world_api

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('GODEYES_DATA_DIR', ROOT / 'data'))
TASK = ROOT / 'scripts/case-workflow/workflow.md'
spec = importlib.util.spec_from_file_location('workflow', ROOT / 'scripts/case-workflow/run.py')
workflow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workflow)
TASKS = {}
LOCK = asyncio.Lock()
CODEX_LOCK = asyncio.Lock()


def now():
    return datetime.now(timezone.utc).isoformat()


def directory(scene_id):
    if not re.fullmatch(r'[0-9a-f]{32}', scene_id):
        raise HTTPException(404, '找不到世界')
    run = DATA / scene_id
    if not (run / 'scene.json').is_file():
        raise HTTPException(404, '找不到世界')
    return run


def read(run):
    return json.loads((run / 'scene.json').read_text())


def update(run, **values):
    state = {**read(run), **values, 'updatedAt': now()}
    world_api.save(run / 'scene.json', state)
    return state


def can_retry(run: Path, state: dict) -> bool:
    operation_path = run / 'operation.json'
    operation_exists = operation_path.exists()
    operation_failed = False
    if operation_exists:
        operation_failed = bool(json.loads(operation_path.read_text()).get('error'))

    submission_started = (run / 'submission-started.json').exists()
    return (
        state['status'] == 'error'
        and not operation_failed
        and (not submission_started or operation_exists)
    )


def public(run: Path) -> dict:
    state = read(run)
    base = f"/api/scenes/{state['id']}/assets/"
    state['images'] = [base + path for path in state['inputs']]
    state['cleanImage'] = None
    if (run / 'generated/scene.png').exists():
        state['cleanImage'] = base + 'generated/scene.png'

    prompt_file = run / 'submitted-prompt.md'
    if not prompt_file.exists():
        prompt_file = run / 'WORLD_MODEL_PROMPT.md'
    state['prompt'] = prompt_file.read_text() if prompt_file.exists() else ''

    state['thumbnail'] = state['cleanImage'] or state['images'][0]
    if (run / 'thumbnail.webp').exists():
        state['thumbnail'] = base + 'thumbnail.webp'
    state['spzUrl'] = base + 'world.spz' if state['status'] == 'ready' else None
    state['source'] = 'generated'
    state['canRetry'] = can_retry(run, state)
    return state


def error_text(exc):
    # Never return request headers, signed asset URLs, or subprocess logs.
    if isinstance(exc, urllib.error.HTTPError):
        return f'Marble HTTP {exc.code}；請確認額度或稍後重試。'
    if isinstance(exc, (TimeoutError, urllib.error.URLError)):
        return '網路連線中斷或逾時；可重試以接續現有任務。'
    if isinstance(exc, RuntimeError):
        return str(exc)
    return '任務未完成；請檢查本機任務紀錄後重試。'


async def clean(run):
    async with CODEX_LOCK:
        update(run, status='cleaning', error=None, stage='clean')
        images = [run / p for p in read(run)['inputs']]
        env = {k: v for k, v in os.environ.items() if k not in ('WORLD_LABS_API_KEY', 'WLT_API_KEY')}
        with (run / 'events.jsonl').open('w') as out, (run / 'stderr.log').open('w') as err:
            proc = await asyncio.create_subprocess_exec(*workflow.command(shutil.which('codex') or 'codex', run, images),
                stdin=asyncio.subprocess.PIPE, stdout=out, stderr=err, env=env)
            try:
                await asyncio.wait_for(proc.communicate(TASK.read_bytes()), 1200)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), 5)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
                raise
        if proc.returncode:
            raise RuntimeError(f'Codex 生圖未完成（exit {proc.returncode}）；請檢查本機 stderr.log，確認登入與 imagegen 工具後重試。')
        try:
            workflow.validate(run)
        except (ValueError, OSError, KeyError) as exc:
            raise RuntimeError('Codex 未產出完整圖片與 Prompt；請檢查本機 BLOCKED.md 或 RESULT.md，確認 imagegen 可用後重試。') from exc
        update(run, status='review', error=None)


async def wait_for_world(run: Path) -> dict:
    for _ in range(240):
        world = await asyncio.to_thread(world_api.poll, run)
        if world:
            return world
        await asyncio.sleep(5)
    raise RuntimeError('Marble 仍在處理；可按接續任務繼續查詢，不會重複生成。')


async def generate(run):
    state = read(run)
    update(run, status='generating', stage='world', error=None)
    world = json.loads((run / 'world.json').read_text()) if (run / 'world.json').exists() else None
    if not world:
        if not (run / 'operation.json').exists():
            await asyncio.to_thread(world_api.submit, run, state['name'], run / 'generated/scene.png',
                                    (run / 'submitted-prompt.md').read_text())
        world = await wait_for_world(run)
    update(run, status='downloading')
    await asyncio.to_thread(world_api.download, run, world)
    update(run, status='ready', error=None)


async def work(run, stage):
    try:
        if stage == 'clean':
            await clean(run)
        else:
            await generate(run)
    except asyncio.CancelledError:
        update(run, status='error', error='服務已停止；可接續任務。')
        raise
    except Exception as exc:
        update(run, status='error', error=error_text(exc))
    finally:
        TASKS.pop(run.name, None)


def launch(run, stage):
    TASKS[run.name] = asyncio.create_task(work(run, stage))


@asynccontextmanager
async def lifespan(_app):
    DATA.mkdir(parents=True, exist_ok=True)
    for path in DATA.glob('*/scene.json'):
        run = path.parent
        state = read(run)
        if state['status'] in ('generating', 'downloading'):
            if (run / 'operation.json').exists() or (run / 'world.json').exists():
                launch(run, 'world')
            else:
                update(run, status='error', error='服務中斷；若提交結果不明，請先核對 Marble 紀錄。')
        elif state['status'] in ('queued', 'cleaning'):
            update(run, status='error', error='生圖因服務重啟中斷；請重試。')
    yield
    tasks = list(TASKS.values())
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=['localhost', '127.0.0.1', 'testserver'])


@app.middleware('http')
async def local_origin(request: Request, call_next):
    origin = request.headers.get('origin')
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and origin not in (None, 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8000', 'http://127.0.0.1:8000'):
        return JSONResponse({'detail': '僅接受本機應用程式請求'}, status_code=403)
    return await call_next(request)


@app.get('/api/health')
def health():
    return {'ok': True, 'codex': bool(shutil.which('codex')), 'marble': bool(world_api.settings().get('WORLD_LABS_API_KEY'))}


@app.get('/api/scenes')
def scenes():
    return [public(p.parent) for p in sorted(DATA.glob('*/scene.json'), key=lambda p: p.stat().st_mtime, reverse=True)]


@app.get('/api/scenes/{scene_id}')
def scene(scene_id: str):
    return public(directory(scene_id))


@app.post('/api/scenes', status_code=202)
async def create(name: str = Form(...), images: list[UploadFile] = File(...)):
    name = name.strip()
    if not name or len(name) > 80:
        raise HTTPException(422, '世界名稱需為 1–80 字')
    if not 1 <= len(images) <= 4:
        raise HTTPException(422, '請提供 1–4 張現場照片')
    if not shutil.which('codex'):
        raise HTTPException(503, '找不到 Codex CLI；請安裝並登入')
    validated = []
    for photo in images:
        data = await photo.read(20 * 1024 * 1024 + 1)
        await photo.close()
        if len(data) > 20 * 1024 * 1024:
            raise HTTPException(413, '每張照片上限 20 MB')
        try:
            with Image.open(io.BytesIO(data)) as image:
                suffix = {'PNG': '.png', 'JPEG': '.jpg', 'WEBP': '.webp'}.get(image.format)
                if not suffix or image.width * image.height > 40_000_000:
                    raise ValueError()
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            raise HTTPException(422, '請使用有效的 PNG、JPEG 或 WebP，解析度不超過 4000 萬畫素') from None
        validated.append((data, suffix))
    scene_id = uuid.uuid4().hex
    run = DATA / scene_id
    (run / 'inputs').mkdir(parents=True)
    inputs = []
    for index, (data, suffix) in enumerate(validated):
        path = f'inputs/photo_{index + 1:02}{suffix}'
        (run / path).write_bytes(data)
        inputs.append(path)
    world_api.save(run / 'INPUT.json', {'images': [{'path': p} for p in inputs]})
    shutil.copyfile(TASK, run / 'TASK.md')
    world_api.save(run / 'scene.json', {'id': scene_id, 'name': name, 'status': 'queued',
        'stage': 'clean', 'inputs': inputs, 'createdAt': now(), 'updatedAt': now(), 'error': None})
    launch(run, 'clean')
    return public(run)


class WorldRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=30000)


@app.post('/api/scenes/{scene_id}/world', status_code=202)
async def create_world(scene_id: str, body: WorldRequest):
    run = directory(scene_id)
    async with LOCK:
        if read(run)['status'] != 'review' or scene_id in TASKS:
            raise HTTPException(409, '此任務已提交或尚未準備完成')
        if not body.prompt.strip():
            raise HTTPException(422, 'Prompt 不可空白')
        if not world_api.settings().get('WORLD_LABS_API_KEY'):
            raise HTTPException(503, '請先設定 WORLD_LABS_API_KEY')
        (run / 'submitted-prompt.md').write_text(body.prompt.strip())
        update(run, status='generating', stage='world', error=None)
        launch(run, 'world')
    return public(run)


CLEAN_OUTPUTS = (
    'generated', 'manifest.json', 'WORLD_MODEL_PROMPT.md',
    'BLOCKED.md', 'RESULT.md', 'events.jsonl', 'stderr.log',
)


def archive_clean_outputs(run: Path) -> None:
    # Keep prior attempts without allowing stale outputs to pass validation.
    archive = run / ('attempt-' + uuid.uuid4().hex[:8])
    archive.mkdir()
    for name in CLEAN_OUTPUTS:
        source = run / name
        if source.exists():
            shutil.move(source, archive / name)


@app.post('/api/scenes/{scene_id}/retry', status_code=202)
async def retry(scene_id: str):
    run = directory(scene_id)
    async with LOCK:
        state = read(run)
        if not can_retry(run, state) or scene_id in TASKS:
            raise HTTPException(409, '任務執行中，或提交結果不明；不能重複送出')
        stage = state['stage']
        if stage == 'clean':
            archive_clean_outputs(run)
        update(run, status='queued' if stage == 'clean' else 'generating', error=None)
        launch(run, stage)
    return public(run)


@app.get('/api/scenes/{scene_id}/assets/{asset:path}')
def asset(scene_id: str, asset: str):
    run = directory(scene_id)
    allowed = set(read(run)['inputs']) | {'generated/scene.png', 'WORLD_MODEL_PROMPT.md', 'submitted-prompt.md', 'world.spz', 'thumbnail.webp'}
    path = run / asset
    if asset not in allowed or not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(run.resolve()):
        raise HTTPException(404, '找不到資產')
    return FileResponse(path, headers={'Cache-Control': 'no-cache'})
