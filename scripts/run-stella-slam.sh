#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .stella/build/bridge/godeyes_stella_worker ] || [ ! -f .stella/orb_vocab.fbow ]; then
  echo 'Run bash scripts/setup-stella-mac.sh first.' >&2
  exit 1
fi
export OMP_NUM_THREADS=2
export OPENBLAS_NUM_THREADS=1
exec sh scripts/run-local-slam.sh --backend stella "$@"
