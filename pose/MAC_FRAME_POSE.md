# 實驗：板子傳影格，MacBook 解算姿態

原板端解算版本已保存於 `8e12db5`。新版本不改原追蹤器或前端濾波：板子只做 640×480 擷取與 JPEG 編碼（預設品質 90）；Mac 使用同一套 OpenCV ArUco、角點細化、IPPE／RANSAC，然後透過 Mac 本機 relay 驅動網頁。需要 Mac Python 3.10+ 和 Node.js 20.19+（或 22.12+）。

## 目前板端

```sh
.venv/bin/python -u pose/frame_stream.py --host 127.0.0.1 --port 8781
```

相機只能被一個程序占用；啟動串流前要停止舊 `camera_preview.py`。串流不做標記偵測、PnP、畫框或姿態傳送。伺服器僅保留最新 JPEG；接收端每处理完一張才要求下一張，網路／Mac 跟不上時跳過舊影格。這是低延遲即時模式，不保證每張曝光都送達，不是無損錄影。

## Mac：取得版本

可使用附上的 `/tmp/godeyes-mac-frames.tar.gz` 實驗套件（包含程式、既有前端 build、校正與標記配置；不含虛擬環境或原始校正照片）。在 Mac 執行：

```sh
scp root@100.86.170.121:/tmp/godeyes-mac-frames.tar.gz ~/Downloads/
mkdir -p ~/GodEyes-mac-frames
tar -xzf ~/Downloads/godeyes-mac-frames.tar.gz -C ~/GodEyes-mac-frames
cd ~/GodEyes-mac-frames
python3 -m venv .venv
.venv/bin/python -m pip install -r pose/requirements.txt
npm ci
```

若使用 Git checkout 而非套件，需先 `npm run build` 產生 `dist/`。套件內已附上 build。

## Mac：三個終端機

1. 只把板子的影格 WebSocket 轉發到 Mac，保持這個終端機開著：

```sh
ssh -N -o ExitOnForwardFailure=yes -L 8781:127.0.0.1:8781 root@100.86.170.121
```

2. Mac 執行姿態運算；同一程式會啟動本機 HTTP 8765、預覽 8766、姿態 WebSocket 8767。不要另開 `relay.py`，也不要將這三個 port 轉發回板子：

```sh
cd ~/GodEyes-mac-frames
.venv/bin/python -u pose/mac_frame_pose.py
```

預設使用此 C270 的已保存 640×480 校正及 5.3 cm 四標記配置。可用 `--calibration`、`--board`、`--marker-m` 覆寫。這個實驗模式不提供網頁重新校正；要重新校正請切回原本板端模式。

3. Mac 開本機網站：

```sh
cd ~/GodEyes-mac-frames
npm run preview -- --host 127.0.0.1 --port 5181 --strictPort
```

瀏覽器開 **http://localhost:5181**。這個網站和姿態運算都在 Mac，5181 不需要 SSH 轉發。原先轉發的 5180 是板端網站，切換實驗時不要用它。把相機對準標記板，按「重設位置與正前方」；姿態防抖和逐畫面位置 lerp／旋轉 SLERP 都沿用原版且預設開啟。

## 如何比較

Mac 接收端每約兩秒印出 JSON，也可開 `http://localhost:8766/status`：

- `fps`：成功處理並接受影格的速率，包括 lost 狀態；不是渲染 FPS。
- `timings_ms.decode / detect / pose`：Mac JPEG 解碼、標記偵測、姿態解算。
- `request_frame_ms`：Mac 要求影格到收完的時間，含板端等待影格與往返傳輸，不是單向網路延遲。
- `board_capture_ms / board_encode_ms`：板端擷取與 JPEG 編碼耗時。
- `age_upper_bound_ms`：read 完成到本機解算完成的保守上界；額外計入 request 去程及等待，未計曝光、驅動緩衝或螢幕渲染。
- `stream_mbps`：接受處理的影格訊息流量，不含 SSH/TCP 開銷與被拒收影格。
- `skipped_frames / stale_frames`：序號跳過／超过保守 250 ms 時間預算的影格。過期影格不更新姿態；前端沿用斷流凍結。

保留來源 capture 時間的相對間隔供 One Euro 濾波，串流重啟會產生新 session。跨主機不直接相減 monotonic 時鐘；relay 的資料年齡保留上述影格年齡上界，避免舊影格運算完後被當成全新量測。

請以同一光線、標記距離和動作比較兩版各 30 秒。JPEG 可能改變角點位置；Mac CPU 更快也可能被影格頻寬和 SSH 延遲抵消，不能只比 PnP 耗時。

板子 localhost 的 45 張真實影格冒煙測試約 16.2 FPS、5.58 Mbps，JPEG 編碼中位數 6.18 ms；這不是 Mac 或 SSH 路徑的效能。接收／解算／本機 relay 流程已在板子以獨立測試 port 驗證，Mac 實測待執行。

## 切回原版

停止 `frame_stream.py`（Ctrl-C），在板子工作目錄執行：

```sh
.venv/bin/python -u pose/camera_preview.py --host 127.0.0.1 --calibration camera.json --marker-m .053 --board public/markers/aruco-board-A4-55mm-ids0-3.json
```

Mac 回到原先 SSH 轉發的 `http://localhost:5180`；Mac 的 5181 與接收程式可用 Ctrl-C 關閉。
