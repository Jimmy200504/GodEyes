#!/usr/bin/env bash
# Resume the last setup stage without downloading, installing or compiling.
set -eo pipefail
cd "$(dirname "$0")/.."
python_bin="$PWD/.pyslam-min/venv/bin/python"
[ -x "$python_bin" ] || { echo '找不到最小版 Python 環境。' >&2; exit 1; }
revision=a5ff2562eb929ed9a08420f528a120a3cca65585
[ "$(git -C .pyslam-min/upstream rev-parse HEAD)" = "$revision" ] || {
  echo 'pySLAM 版本不符，停止檢查。' >&2; exit 1;
}
mkdir -p .pyslam-min/logs
log_path=".pyslam-min/logs/check-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee "$log_path") 2>&1
trap 'echo "檢查未完成，完整紀錄：$log_path"' ERR
rm -f .pyslam-min/ready
export PYSLAM_USE_CPP=false OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2
"$python_bin" native/pyslam-min/check_runtime.py
"$python_bin" pose/pyslam_minimal.py --smoke
printf '%s\n' "$revision" > .pyslam-min/ready
echo '啟動檢查通過。可執行 bash scripts/run-pyslam-live.sh'
