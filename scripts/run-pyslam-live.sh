#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")/.."
[ -f .pyslam-min/ready ] || { echo '請先執行 bash scripts/setup-pyslam-minimal-mac.sh'; exit 1; }
export SLAM_PYTHON="$PWD/.pyslam-min/venv/bin/python"
export PYSLAM_USE_CPP=false OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2
exec sh scripts/run-local-slam.sh --backend pyslam --features 1200 "$@"
