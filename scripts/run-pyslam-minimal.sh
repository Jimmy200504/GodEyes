#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")/.."
[ -f .pyslam-min/ready ] || { echo '請先執行 bash scripts/setup-pyslam-minimal-mac.sh'; exit 1; }
mkdir -p .pyslam-min/logs
log_path=".pyslam-min/logs/run-$(date +%Y%m%d-%H%M%S).log"
export PYSLAM_USE_CPP=false OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2
.pyslam-min/venv/bin/python -u pose/pyslam_minimal.py "$@" 2>&1 | tee "$log_path"
