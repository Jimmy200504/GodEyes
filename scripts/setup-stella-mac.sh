#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'Run this in a native Apple Silicon Mac terminal (not Docker or Rosetta).' >&2
  exit 1
fi
mkdir -p .stella/logs
log=".stella/logs/setup-$(date +%Y%m%d-%H%M%S).log"
echo "Full build log: $PWD/$log"
if ! python3 -u scripts/setup-stella-mac.py 2>&1 | tee "$log"; then
  echo "Setup failed. Full log: $PWD/$log" >&2
  exit 1
fi
