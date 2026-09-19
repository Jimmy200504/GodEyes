#!/usr/bin/env python3
"""Reference photographs -> imagegen photograph and World Model prompt."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[2]
REQUIRED = ['WORLD_MODEL_PROMPT.md', 'generated/imagegen-prompt.txt', 'generated/scene.png', 'manifest.json']

def validate(run):
    for name in REQUIRED:
        f = run / name
        if not f.is_file() or f.is_symlink() or not f.read_bytes().strip():
            raise ValueError(f'Missing, empty or symbolic-link output: {name}')
        if not f.resolve().is_relative_to(run.resolve()):
            raise ValueError(f'Output escapes run directory: {name}')
    m = json.loads((run / 'manifest.json').read_text())
    for key, expected in [('status', 'complete'), ('image_generated_with', 'built-in imagegen'),
                          ('image_inspected', True), ('preserve_people_and_objects', True), ('references_inspected', True), ('world_model_prompt_created', True)]:
        if m.get(key) != expected:
            raise ValueError(f'Incomplete declared stage: {key}')
    if re.search(r'[\u4e00-\u9fff]', (run / 'WORLD_MODEL_PROMPT.md').read_text()):
        raise ValueError('WORLD_MODEL_PROMPT.md must be English')
    b = (run / 'generated/scene.png').read_bytes()
    if b[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Generated image is not PNG')
    offset, ended, size = 8, False, None
    while offset + 12 <= len(b):
        n = struct.unpack('>I', b[offset:offset+4])[0]
        end = offset + 12 + n
        if end > len(b):
            raise ValueError('Truncated PNG')
        data = b[offset+4:offset+8+n]
        if zlib.crc32(data) & 0xffffffff != struct.unpack('>I', b[offset+8+n:end])[0]:
            raise ValueError('PNG checksum failure')
        if data[:4] == b'IHDR':
            size = struct.unpack('>II', data[4:12])
        offset = end
        if data[:4] == b'IEND':
            ended = True
            break
    if not ended or not size or min(size) < 512:
        raise ValueError('Incomplete or undersized generated PNG')

def prepare(args, parent):
    if not args.image:
        raise ValueError('至少提供一張 --image 現場照片')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}', args.name):
        raise ValueError('--name 只能使用英文、數字、連字號與底線')
    photos = []
    for f in args.image:
        if not f.is_file():
            raise ValueError(f'照片不存在：{f}')
        header = f.read_bytes()[:16]
        if header.startswith(b'\x89PNG\r\n\x1a\n'):
            suffix = '.png'
        elif header.startswith(b'\xff\xd8\xff'):
            suffix = '.jpg'
        elif header[:4] == b'RIFF' and header[8:12] == b'WEBP':
            suffix = '.webp'
        else:
            raise ValueError(f'請提供 PNG、JPEG 或 WebP 圖片：{f}')
        photos.append((f, suffix))
    parent.mkdir(parents=True, exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix=f'{args.name}-{datetime.now():%Y%m%d-%H%M%S}-', dir=parent))
    (run / 'inputs').mkdir()
    images = []
    for i, (f, suffix) in enumerate(photos, 1):
        dest = run / 'inputs' / f'photo_{i:02}{suffix}'
        shutil.copyfile(f, dest)
        images.append({'path': str(dest.relative_to(run)), 'source': str(f.resolve())})
    (run / 'INPUT.json').write_text(json.dumps({'images': images}, ensure_ascii=False, indent=2), encoding='utf-8')
    (run / 'TASK.md').write_text(Path(__file__).with_name('workflow.md').read_text(), encoding='utf-8')
    return run, [run / item['path'] for item in images]

def command(codex, run, images):
    cmd = [codex, '-a', 'never', 'exec', '--sandbox', 'workspace-write',
           '--skip-git-repo-check', '-C', str(run), '--json',
           '-o', str(run / 'RESULT.md')]
    for image in images:
        cmd.extend(['--image', str(image)])
    return cmd + ['-']

def main():
    ap = argparse.ArgumentParser(description='真實場景照片 → Codex imagegen 照片＋英文 World Model prompt')
    ap.add_argument('--image', '-i', action='append', type=Path, default=[], help='現場照片；可重複指定')
    ap.add_argument('--output-dir', type=Path, default=ROOT / 'case-runs', help='輸出根目錄')
    ap.add_argument('--name', default='scene', help='輸出名稱：英文、數字、連字號或底線')
    ap.add_argument('--prepare-only', action='store_true', help='只複製輸入及建立任務，不呼叫模型')
    ap.add_argument('--validate', type=Path, metavar='RUN_DIR', help='驗證照片、英文 World Model prompt 與階段宣告')
    args = ap.parse_args()
    run = None
    try:
        if args.validate:
            run = args.validate.resolve()
        else:
            codex = shutil.which('codex')
            if not args.prepare_only and not codex:
                raise ValueError('找不到 codex；可先用 --prepare-only 建立任務')
            run, images = prepare(args, args.output_dir)
            print(f'執行資料夾：{run}', flush=True)
            if args.prepare_only:
                print('輸入與 TASK.md 已建立；尚未生圖。')
                return 0
            print('正在讀取照片並生圖；日誌：events.jsonl / stderr.log', flush=True)
            with (run / 'events.jsonl').open('w') as out, (run / 'stderr.log').open('w') as err:
                result = subprocess.run(command(codex, run, images), input=(run / 'TASK.md').read_text(),
                                        text=True, stdout=out, stderr=err, timeout=1200,
                                        env={k: v for k, v in os.environ.items() if k not in ('WORLD_LABS_API_KEY', 'WLT_API_KEY')})
            if result.returncode:
                print(f'Codex 執行失敗（{result.returncode}），請查看 {run}/stderr.log', file=sys.stderr)
                return result.returncode if result.returncode > 0 else 1
        validate(run)
        print(f'生成照片：{run / "generated/scene.png"}')
        print(f'World Model prompt：{run / "WORLD_MODEL_PROMPT.md"}')
        return 0
    except (ValueError, OSError, KeyError, struct.error, subprocess.TimeoutExpired) as exc:
        print(f'未完成：{exc}', file=sys.stderr)
        if run:
            print(f'已保留 {run}；查看 BLOCKED.md 或 RESULT.md。', file=sys.stderr)
        return 2

if __name__ == '__main__':
    sys.exit(main())
