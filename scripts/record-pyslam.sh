#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")/.."
test -x .venv/bin/python || { echo '找不到既有 .venv/bin/python'; exit 1; }
port="${PYSLAM_FRAME_PORT:-18782}"
.venv/bin/python - "$port" <<'PY'
import socket, sys
with socket.socket() as sock:
    sock.bind(('127.0.0.1', int(sys.argv[1])))
PY
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -L "127.0.0.1:$port:127.0.0.1:8781" "${SLAM_BOARD:-root@100.86.170.121}" &
tunnel_pid=$!
trap 'kill "$tunnel_pid" 2>/dev/null || true' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
.venv/bin/python - "$port" <<'PY'
import socket, sys, time
for _ in range(120):
    try:
        with socket.create_connection(('127.0.0.1', int(sys.argv[1])), timeout=.5):
            break
    except OSError:
        time.sleep(.5)
else:
    raise SystemExit('SSH tunnel 未就緒。')
PY
.venv/bin/python pose/pyslam_trial.py record --frames "ws://127.0.0.1:$port/frames" "$@"
