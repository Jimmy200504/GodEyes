"""Remove only this experiment's ORB-SLAM3 files/image/containers on the Mac."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

IMAGE = 'godeyes-orbslam3:4452a3c-v1'


def container_matches(row):
    return (row.get('Image') == IMAGE
            and re.fullmatch(r'godeyes-orb-[0-9a-f]{32}', row.get('Names', '')) is not None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Perform cleanup; default only lists targets')
    parser.add_argument('--prune-build-cache', action='store_true',
                        help='Also remove ALL unused build cache of the default builder (shared across projects)')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('Run on the Mac, not on the i.MX93 board')
    failures = []

    def docker(*arguments, check=True):
        return subprocess.run(['docker', *arguments], text=True, capture_output=True,
                              check=check, timeout=120)

    def remove_docker(*arguments):
        print('docker ' + ' '.join(arguments), flush=True)
        if args.apply:
            result = docker(*arguments, check=False)
            if result.returncode:
                failures.append(result.stderr.strip())

    if shutil.which('docker'):
        try:
            for line in docker('ps', '-a', '--format', '{{json .}}').stdout.splitlines():
                row = json.loads(line)
                if container_matches(row):
                    remove_docker('rm', '-f', row['Names'])
            if docker('image', 'inspect', IMAGE, check=False).returncode == 0:
                # No force: Docker refuses removal if an unrelated container uses it.
                remove_docker('image', 'rm', IMAGE)
            if args.prune_build_cache:
                remove_docker('builder', 'prune', '--all', '--force')
            else:
                print('保留共用建置快取：無法可靠判斷舊快取只屬於 ORB-SLAM3。')
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            failures.append(f'Docker 清理未完成：{error}')
    else:
        print('找不到 Docker CLI，僅處理本機檔案。')

    home = Path.home()
    folder = home / 'GodEyes-orbslam3'
    targets = []
    if folder.exists() or folder.is_symlink():
        if (folder.is_symlink() or not (folder/'ORB_SLAM3.md').is_file()
                or not (folder/'native/orbslam3/Dockerfile').is_file()):
            failures.append(f'未刪除 {folder}：不是可辨識的實驗目錄，或為符號連結。')
        else:
            targets.append(folder)
    for name in ('godeyes-orbslam3.tar.gz', 'godeyes-orb-build-fix.tar.gz'):
        archive = home/'Downloads'/name
        if archive.is_file() or archive.is_symlink():
            targets.append(archive)
    for path in targets:
        print(f'{"刪除" if args.apply else "將刪除"}：{path}', flush=True)
        if args.apply:
            try:
                if path.is_dir() and not path.is_symlink():
                    shutil.rmtree(path)
                else:
                    path.unlink()
            except OSError as error:
                failures.append(str(error))
    print('保留 GodEyes-local-slam、其他 Docker 映像／容器／volumes 與 Docker Desktop。')
    if not args.apply:
        print('以上僅列出項目；加 --apply 執行。')
    if failures:
        print('\n'.join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
