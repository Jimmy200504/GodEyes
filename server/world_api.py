"""Resumable Marble adapter. Secrets never leave this process."""
import gzip
import json
import os
import shutil
import urllib.request
import urllib.error
import uuid
from pathlib import Path

BASE = 'https://api.worldlabs.ai/marble/v1/'
ROOT = Path(__file__).resolve().parents[1]


def settings():
    values = {}
    path = ROOT / '.env'
    if path.exists():
        for line in path.read_text().splitlines():
            name, sep, value = line.strip().partition('=')
            if sep and not name.startswith('#'):
                values[name.strip()] = value.strip().strip('\"').strip("'")
    return {**values, **os.environ}


def save(path, data):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    temp.replace(path)


def api(path, payload=None):
    key = settings().get('WORLD_LABS_API_KEY')
    if not key:
        raise RuntimeError('未設定 WORLD_LABS_API_KEY；請檢查本機 .env。')
    request = urllib.request.Request(BASE + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'WLT-Api-Key': key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)


def upload(run, image):
    record = run / 'upload.json'
    if record.exists():
        return json.loads(record.read_text())['media_asset']['media_asset_id']
    prepared = api('media-assets:prepare_upload', {'file_name': image.name, 'kind': 'image', 'extension': 'png'})
    info = prepared['upload_info']
    req = urllib.request.Request(info['upload_url'], data=image.read_bytes(),
        headers=info.get('required_headers', {}), method=info['upload_method'])
    with urllib.request.urlopen(req, timeout=120) as response:
        response.read()
    save(record, prepared)
    return prepared['media_asset']['media_asset_id']


def submit(run, name, image, prompt):
    if (run / 'operation.json').exists():
        return json.loads((run / 'operation.json').read_text())
    if (run / 'submission-started.json').exists():
        raise RuntimeError('Marble 提交結果不明；請核對服務端紀錄，不能自動重送。')
    asset_id = upload(run, image)
    payload = {'display_name': name, 'model': settings().get('WORLD_LABS_MODEL', 'marble-1.1'),
        'permission': {'public': False}, 'world_prompt': {'type': 'image',
        'image_prompt': {'source': 'media_asset', 'media_asset_id': asset_id},
        'disable_recaption': True, 'text_prompt': prompt}}
    save(run / 'generate-payload.json', payload)
    save(run / 'submission-started.json', {'submitted': True})
    try:
        result = api('worlds:generate', payload)
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 401, 402, 403, 404, 422, 429):
            # Definite rejection can be retried manually. 5xx/timeouts remain ambiguous.
            (run / 'submission-started.json').rename(run / ('submission-rejected-' + uuid.uuid4().hex[:8] + '.json'))
        raise
    save(run / 'operation.json', result)
    return result


def poll(run):
    previous = json.loads((run / 'operation.json').read_text())
    result = api('operations/' + previous['operation_id'])
    result.setdefault('operation_id', previous['operation_id'])
    save(run / 'operation.json', result)
    if not result.get('done'):
        return None
    if result.get('error'):
        raise RuntimeError('Marble 生成失敗；請查看 operation.json 中的錯誤紀錄。')
    world = result.get('response') or {}
    world = world.get('world', world)
    world_id = world.get('id') or world.get('world_id') or (result.get('metadata') or {}).get('world_id')
    if not world_id:
        raise RuntimeError('Marble 已完成但未提供 world ID。')
    result = api('worlds/' + world_id)
    world = result.get('world', result)
    save(run / 'world.json', world)
    return world


def download(run, world):
    assets = world['assets']
    splats = assets.get('splats', {}).get('spz_urls', {})
    url = splats.get('full_res') or splats.get('500k') or next(iter(splats.values()), None)
    if not url:
        raise RuntimeError('Marble 未提供可載入的 SPZ。')
    urls = {'world.spz': url, 'thumbnail.webp': assets.get('thumbnail_url')}
    for name, address in urls.items():
        if not address:
            continue
        dest = run / name
        if dest.exists():
            continue
        temp = dest.with_suffix('.part')
        try:
            with urllib.request.urlopen(address, timeout=120) as response, temp.open('wb') as out:
                shutil.copyfileobj(response, out)
            if name.endswith('.spz'):
                with gzip.open(temp, 'rb') as stream:
                    if stream.read(4) != b'NGSP':
                        raise RuntimeError('下載的 SPZ 格式不正確。')
                    while stream.read(1024 * 1024):
                        pass  # Consume the stream to verify gzip length and checksum.
            elif temp.stat().st_size == 0:
                raise RuntimeError('下載的縮圖為空。')
            temp.replace(dest)
        finally:
            temp.unlink(missing_ok=True)
