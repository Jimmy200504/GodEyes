#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "$(uname -s)" != Darwin ]; then
  echo '請在 Mac 終端機執行此腳本。' >&2
  exit 1
fi
command -v python3 >/dev/null
command -v npm >/dev/null
if [ -z "${SLAM_PYTHON:-}" ]; then
  [ -d .venv ] || python3 -m venv .venv
  .venv/bin/python -m pip install -r pose/requirements.txt
  SLAM_PYTHON="$PWD/.venv/bin/python"
fi
[ -x "$SLAM_PYTHON" ] || { echo 'SLAM_PYTHON 不是可執行的 Python 路徑。' >&2; exit 1; }
[ -d node_modules ] || npm ci
npm run build -- --configLoader runner  # Rebuild the current advanced SLAM UI; never reuse a stale dist.
"$SLAM_PYTHON" - <<'PY'
import socket
for port in (18781, 18782, 8865, 8866, 8867, 5182):
    with socket.socket() as s:
        try:
            s.bind(('127.0.0.1', port))
        except OSError:
            raise SystemExit(f'Port {port} 已使用，請先關閉先前的 SLAM 程序再重試。')
PY
tunnel_pid=''
receiver_pid=''
web_pid=''
cleanup() {
  for pid in "$web_pid" "$receiver_pid" "$tunnel_pid"; do
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo "相機連線：${SLAM_BOARD:-root@100.86.170.121} 的 127.0.0.1:8781 → Mac 127.0.0.1:18781"
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:18781:127.0.0.1:8781 \
  -L 127.0.0.1:18782:127.0.0.1:8782 "${SLAM_BOARD:-root@100.86.170.121}" &
tunnel_pid=$!
"$SLAM_PYTHON" - "$tunnel_pid" <<'PY'
import json, os, sys, time
import cv2
import numpy as np
from websockets.sync.client import connect
from websockets.exceptions import WebSocketException
sys.path.insert(0, 'pose')
from frame_stream import unpack_frame
deadline = time.monotonic() + 60
last_error = '尚未收到影像'
while time.monotonic() < deadline:
    try:
        os.kill(int(sys.argv[1]), 0)
    except ProcessLookupError:
        raise SystemExit('SSH 程序已退出，請查看上方 SSH 錯誤。')
    try:
        with connect('ws://127.0.0.1:18781/frames', open_timeout=2, close_timeout=.5) as ws:
            ws.send('next')
            meta, jpeg = unpack_frame(ws.recv(timeout=3))
            frame = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
            if frame is None or frame.shape[:2] != (480, 640):
                raise ValueError('相機 JPEG 解碼失敗或尺寸錯誤')
            print('串流格式：' + str(meta.get('pixel_format', '未標示')) + '；此路徑供 SLAM 使用，手勢由板端另讀彩色路徑。', flush=True)
            print(f"已經由 SSH 收到相機影像：640×480，seq={meta['seq']}，平均亮度={frame.mean():.1f}", flush=True)
        break
    except (OSError, WebSocketException, TimeoutError, ValueError, cv2.error) as error:
        last_error = str(error)
        time.sleep(1)
else:
    raise SystemExit('相機取幀失敗，尚未啟動 SLAM。請核對上方 SSH 目的主機及板子 8781 串流。最後錯誤：' + last_error)
# Check the second tunnel before opening a UI that appears ready but cannot move.
try:
    with connect('ws://127.0.0.1:18782/api/gesture/ws', open_timeout=3, close_timeout=.5) as ws:
        ws.send('next')
        packet = json.loads(ws.recv(timeout=3))
        if packet.get('version') != 1 or not isinstance(packet.get('command'), dict):
            raise ValueError('手勢封包格式錯誤')
        print('手勢 NPU 連線就緒：Mac 18782 → 板端 8782', flush=True)
except (OSError, WebSocketException, TimeoutError, ValueError) as error:
    raise SystemExit('手勢服務未就緒，請在板端啟動 npu/gesture_server.py：' + str(error))
PY
"$SLAM_PYTHON" -u pose/mac_frame_slam.py --frames ws://127.0.0.1:18781/frames "$@" &
receiver_pid=$!
echo '等待 SLAM 初始化及本機預覽服務 8866；完成後才啟動網頁。'
"$SLAM_PYTHON" - "$receiver_pid" "$tunnel_pid" <<'PY'
import os, sys, time, urllib.request
start = time.monotonic()
report = start + 10
while time.monotonic() - start < 210:
    for pid in sys.argv[1:]:
        try:
            os.kill(int(pid), 0)
        except ProcessLookupError:
            raise SystemExit('SLAM 或 SSH 程序已退出，請查看上方錯誤。')
    try:
        with urllib.request.urlopen('http://127.0.0.1:8866/status', timeout=1):
            break
    except OSError:
        if time.monotonic() >= report:
            print(f'SLAM 尚在初始化（{time.monotonic()-start:.0f} 秒）；相機 SSH 取幀已通過。', flush=True)
            report = time.monotonic() + 10
        time.sleep(.5)
else:
    raise SystemExit('SLAM 初始化超過 210 秒，8866 尚未就緒。請提供上方 Python 錯誤或初始化堆疊。')
PY
node node_modules/vite/bin/vite.js preview --configLoader runner --host 127.0.0.1 --port 5182 --strictPort &
web_pid=$!
"$SLAM_PYTHON" - "$receiver_pid" "$web_pid" "$tunnel_pid" <<'PY'
import os, sys, time, urllib.request
for _ in range(420):
    for pid in sys.argv[1:]:
        try:
            os.kill(int(pid), 0)
        except ProcessLookupError:
            raise SystemExit('啟動程序已結束，請查看上方錯誤。')
    try:
        with urllib.request.urlopen('http://127.0.0.1:5182/api/camera/status', timeout=1):
            break
    except OSError:
        time.sleep(.5)
else:
    raise SystemExit('本機 SLAM 服務未就緒，請查看上方錯誤。')
PY
open http://localhost:5182
echo '已開啟網頁；請保持此終端機開啟。Ctrl-C 停止本次啟動的服務。'
while kill -0 "$tunnel_pid" 2>/dev/null && kill -0 "$receiver_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 1
done
echo '其中一項服務已結束，正在關閉本次啟動的其他服務。' >&2
exit 1
