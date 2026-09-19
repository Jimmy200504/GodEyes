# 單一 ArUco B：實機啟動

本版使用 CPU 偵測標記與 PnP；相機綁頭朝螢幕，B 固定在螢幕旁。不需要 A／IMU／SLAM／NPU。請先閱讀 [簡短 plan](PLAN.md)。軟體包含真實 webcam 擷取與傳送，但已通過合成資料測試與板端相機讀取測試；ArUco 實機追蹤和校正精度仍待驗證。

## 目前已確認的裝置

此執行主機是 FRDM-i.MX93，已在 sandbox 外確認 Logitech C270 HD WEBCAM 位於 `/dev/video2`（`/dev/video0` 是板上 mxc-isi 介面）。已成功讀取 20 張 640×480 真實影格；該次未辨識到 ArUco ID 0，尚未完成標記追蹤／公尺精度驗證。sandbox 內的 `/dev` 不顯示相機，代理執行相機測試時需使用允許存取主機裝置的執行模式。

本板辨識測試：`python3 pose/check_marker.py --camera /dev/video2 --headless`。追蹤器也使用 `--camera /dev/video2`；其他電腦請依實際裝置選擇。

## 先用手機螢幕測試

目前使用者已量得 B 黑色外緣邊長 **5.5 cm**，傳送器預設為 `--marker-m 0.055`。只要手機顯示大小保持不變，就可直接使用；若 5.5 cm 含白邊，需重新量黑色正方形。

下載 [ArUco B PNG](../public/markers/aruco-B-4x4-50-id0.png)（DICT_4X4_50，ID 0，已自動驗證可辨識）。手機顯示原圖，保留四周完整白邊；關閉自動旋轉與自動鎖屏，顯示大小固定後將手機固定在螢幕旁。避免反光和過曝，亮度以相機中黑白邊界清楚為準。

量手機畫面上 **黑色正方形外緣** 的實際邊長，不含白邊。若量到 4.5 cm，使用 `--marker-m 0.045`。圖檔本身沒有固定公分尺寸；縮放顯示後要重新量測，追蹤期間不可縮放或移動手機。

安裝下方 Python 依賴後，可先執行不用校正的辨識測試：

```sh
python pose/check_marker.py --camera 0
```

看到 `B detected` 和標記框即表示辨識成功；Q 離開。無桌面環境加 `--headless`，終端顯示狀態、Ctrl-C 離開。此工具只驗證偵測，**不會估深度或驅動 3D**；完整位置追蹤仍需下一節的相機校正與 `aruco_sender.py`。

## 1. 安裝與列印 B

桌機／筆電可用虛擬環境：

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r pose/requirements.txt
python pose/make_marker.py --id 0 --output marker-B.png
```

列印時保留白邊，貼在平整、不反光、固定的表面。量 **黑色正方形的外緣邊長**，不含白邊，例如 8 cm 對應 `--marker-m 0.08`。PNG 像素數不代表列印尺寸；列印後用尺確認。只放一張 ID 0，不能左右各貼同 ID。

ARM 板子優先用 BSP／系統提供且含 `cv2.aruco.ArucoDetector` 的 OpenCV，先執行 `python3 -c 'import cv2; print(cv2.__version__); print(hasattr(cv2.aruco, "ArucoDetector"))'`。上述 pip wheel 不保證適合 i.MX BSP；不要同時混裝多個 opencv-python/contrib/headless 套件。

## 2. 校正同一支 webcam

使用平整的棋盤格：預設 **9 × 6 個內角點**，也就是 10 × 7 個方格。量單格實際邊長。鎖定鏡頭焦距／停用 autofocus，校正和追蹤保持同焦距、解析度、裁切與數位縮放；工具不保證驅動支援鎖焦，須在相機控制工具確認。

有桌面視窗的電腦可執行（可以校正後再把同支相機接回板子）：

```sh
python pose/capture_calibration.py --camera 0 --width 640 --height 480 --output calibration
```

空白鍵存圖，Q 離開。拍 15–25 張：棋盤需涵蓋畫面中央、邊緣、不同距離與傾角，每張看得見全部內角點；不要只拍重複的正面。無 GUI 的板子可用既有相機擷取工具存同解析度照片後，使用下一步離線校正。

```sh
python pose/calibrate.py --images 'calibration/*.png' --columns 9 --rows 6 --square-m 0.025 --output camera.json
```

`0.025` 只是範例，改成你的方格邊長（公尺）。工具要求至少 12 張成功偵測照片，輸出內參、畸變、影像尺寸與 RMS。RMS 並非精度保證；若高於約 1 px，先檢查清晰度／棋盤平整度並重拍，低 RMS 也不代表視角覆蓋充足。

## 3. 啟動接收與渲染

渲染電腦，在不同終端執行：

```sh
python3 pose/relay.py --host 0.0.0.0
npm ci
npm run dev
```

邊緣裝置只需 `pose/`、其 Python 依賴與 `camera.json`；不需前端資產。停止 mock_sender，執行：

```sh
python3 pose/aruco_sender.py --camera 0 --calibration camera.json --id 0 --marker-m 0.055 --url http://RENDER_PC_IP:8765/api/pose
```

相機可改為 `/dev/video2`。同機驗證則用 `http://127.0.0.1:8765/api/pose`。有 GUI 可加 `--preview`，Q 離開；預設 headless，不開視窗。開啟渲染電腦的 Vite 網址，看到 `追蹤中：aruco-B` 後按「重設位置與正前方」。

相機實際解析度必須符合校正，否則工具直接停止。B 移動後用新的 `--map-id`（例如 `screen-B-v2`）並重啟；不要把移動標記當成頭部移動。程式重啟／更換校正或 tag 設定後，前端會要求重設原點。

## 4. 品質與限制

- 只接受指定 ID 且至少每邊 20 px 的標記，使用角點細化、IPPE square 的候選解、正深度與預設 2 px RMS 重投影門檻。門檻是初始設定，需按真機影像調整。
- 看不到 B、重複 ID 或解算品質不足會送 `lost`；相機讀取失敗則結束，前端依資料過期凍結。
- 網路 worker 只保留一筆最新結果，發送前超過 250 ms 的資料丟棄，請求 timeout 250 ms，故障時持續重試。這是開發版 HTTP 傳輸，不保證總延遲上限。
- 一般 OpenCV webcam 讀取無硬體曝光時間戳；`capture_monotonic_ns` 在本來源實際是 **read 完成時間**（相對 session），不含驅動緩衝與曝光等待。`CAP_PROP_BUFFERSIZE=1` 是 best effort，端到端延遲需實測。
- 平面 PnP 有姿態歧義，近正面／太小／模糊時可能翻轉或抖動，即使重投影誤差小也可能發生。本版沒有濾波或時間連續性消歧；若真機不穩定，再加入多 tag board／候選解時間一致性。
- tag 座標：中心為原點，X 朝印刷右方、Y 朝上、Z 朝標記正面外。API rotation 是 optical camera 到 tag 世界的旋轉；位置是 `-R.T @ t`，不是直接 `tvec`。前端自動以第一筆有效姿態對齊。

真機驗收：靜止 30 秒觀察抖動；前後／左右／上下各移動已知距離確認方向與尺度；擺頭確認旋轉；遮 tag 應凍結、恢復可繼續；關閉接收器後再開應恢復；記錄 FPS、延遲和溫度。這些尚未在真機執行。

```sh
python3 -m unittest discover -s pose -p 'test_*.py'
```

自動測試包含已知幾何投影、多距離與尺度、180 度 quaternion、合成標記偵測、錯誤 ID／失去標記／不良角點拒收及 API round trip。

## Python 瀏覽器相機 GUI

`python3 pose/camera_preview.py --camera /dev/video2 --host 0.0.0.0` 啟動後，用 MacBook 開 `http://BOARD_IP:8766` 看即時畫面、標記框、偵測狀態與處理 FPS；同頁可開啟 5173 的 3D 場景。影格僅在記憶體保留最新一張、不寫磁碟。預設 localhost；本次 demo 使用者已明確同意在所有網路介面開放未驗證的相機預覽。

預覽程式會占用相機，跑正式 `aruco_sender.py` 前先停預覽，避免兩程序爭用。Linux 明確使用 V4L2，避免本板 GStreamer 自動選擇失敗。網站可暫由板子提供靜態檔案，但 3D 渲染在 MacBook 瀏覽器執行。

若預覽顯示 device busy，本次已觀察到 `/root/head_tracker/src/head_tracker.py` 會占用 `/dev/video2`。先確認並停止原追蹤工作，預覽每 2 秒會自動重試，不需重啟網頁。

## 預覽與姿態傳送整合（目前使用方式）

`camera_preview.py` 現在使用同一批影格同時畫框、解 PnP 並送 API，不要再另外開 `aruco_sender.py` 爭用鏡頭。

- 正式模式：`python3 pose/camera_preview.py --host 0.0.0.0 --calibration camera.json`。
- 目前 demo：`python3 pose/camera_preview.py --host 0.0.0.0 --approximate`。

粗估模式假設 fx=fy=影像寬度、主點在中心、畸變為零；這不是 C270 的實測內參。它用真實 ArUco 角點與 5.5 cm 尺寸估姿態，供驗證串接；API 的 scale 是 `estimated`，網頁明確標示未校正，不能視為精確公尺與角度。正式模式的 scale 才是 `metric`。兩種模式切換後重設原點。

未提供任何模式時，預覽仍送 `initializing` 和 `calibration_required`，網站會說明原因，不再只顯示等待裝置。辨識到 tag 但角點太小或 PnP 品質不足則送 lost 及具體原因。

## 姿態防抖

3D 網頁預設開啟「姿態防抖」，可即時取消勾選比較。原始相機預覽不做電子影像防震，API 也保留原始 PnP 姿態；防抖在 MacBook／瀏覽器端執行，不用 NPU。預覽偵測另啟用 subpixel 角點細化，減少角點量化抖動。

採 [One Euro](https://gery.casiez.net/publications/CHI2012-casiez.pdf) 的速度自適應低通概念：位置 lerp、旋轉 shortest-arc quaternion SLERP；低速較穩定，快速運動降低延遲。使用捕捉時間戳計算 dt，重複 API 封包不重複濾波；重設原點、失去追蹤或超過 250 ms 間隔會清除歷史。這是姿態平滑，不是去模糊、SLAM 或精度校正，不能消除所有步行晃動／PnP 解翻轉；快速錯誤姿態也可能通過。

16–23 FPS 的偵測更新間隔約 43–63 ms。預覽網頁原先每次下載一張 JPEG 後再等 100 ms，限制了顯示流暢度；現改成 33 ms，實際顯示率仍受傳輸、解碼和相機處理率限制；頁面上的 FPS 是相機處理率，不是瀏覽器顯示率，也不是 NPU 使用率。平滑會增加延遲，需要實際擺頭比較，不承諾更準。
