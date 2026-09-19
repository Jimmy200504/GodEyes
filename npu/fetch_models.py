"""Restore source models using recorded URLs, archive members and SHA256."""
from pathlib import Path
from collections import defaultdict
import hashlib
import json
import shutil
import subprocess
import tarfile

root = Path(__file__).resolve().parent
sources = json.loads((root / 'sources.json').read_text())
groups = defaultdict(list)
for item in sources:
    dest = root / item['path']
    if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == item['sha256']:
        print('Verified', item['path'])
    else:
        groups[item['url']].append(item)

for url, items in groups.items():
    pending = {x.get('archive_member'): x for x in items}
    proc = subprocess.Popen(['curl', '-fLsS', '--connect-timeout', '30', '--max-time', '1800', url], stdout=subprocess.PIPE)
    def save(item, stream):
        dest = root / item['path']
        dest.parent.mkdir(parents=True, exist_ok=True)
        temporary = dest.with_suffix(dest.suffix + '.part')
        try:
            with temporary.open('wb') as output:
                shutil.copyfileobj(stream, output)
            if hashlib.sha256(temporary.read_bytes()).hexdigest() != item['sha256']:
                raise ValueError('Checksum mismatch: ' + item['path'])
            temporary.replace(dest)
            print('Downloaded', item['path'])
        finally:
            temporary.unlink(missing_ok=True)
    try:
        if None in pending:
            save(pending.pop(None), proc.stdout)
            if proc.wait() != 0:
                raise RuntimeError('Download failed: ' + url)
        else:
            with tarfile.open(fileobj=proc.stdout, mode='r|gz') as archive:
                for member in archive:
                    item = pending.get(member.name)
                    if item is not None and member.isfile():
                        with archive.extractfile(member) as stream:
                            save(item, stream)
                        del pending[member.name]
                        if not pending:
                            break
            if pending:
                raise RuntimeError('Missing archive members: ' + str(list(pending)))
    finally:
        proc.stdout.close()
        if proc.poll() is None:
            proc.terminate()
        proc.wait()
