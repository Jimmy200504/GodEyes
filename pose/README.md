# 單一 ArUco B：實機啟動

本版使用 CPU 偵測標記與 PnP；相機綁頭朝螢幕，B 固定在螢幕旁。不需要 A／IMU／SLAM／NPU。請先閱讀 [簡短 plan](PLAN.md)。軟體包含真實 webcam 擷取與傳送，但已通過合成資料測試與板端相機讀取測試；ArUco 實機追蹤和校正精度仍待驗證。

## 目前已確認的裝置

此執行主機是 FRDM-i.MX93，已在 sandbox 外確認 Logitech C270 HD WEBCAM 位於 `/dev/video2`（`/dev/video0` 是板上 mxc-isi 介面）。已成功讀取 20 張 640×480 真實影格；該次未辨識到 ArUco ID 0，尚未完成標記追蹤／公尺精度驗證。sandbox 內的 `/dev` 不顯示相機，代理執行相機測試時需使用允許存取主機裝置的執行模式。

本板辨識測試：`python3 pose/check_marker.py --camera /dev/video2 --headless`。追蹤器也使用 `--camera /dev/video2`；其他電腦請依實際裝置選擇。

## 先用手機螢幕測試

目前列印後 B 黑色外緣實測為 **5.3 cm**，追蹤器預設為 `--marker-m 0.053`，以實物而非 PDF 標示尺寸為準。原手機版本曾使用 5.5 cm，若換回手機需重新量測並指定尺寸。量測不含白邊。

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
python3 pose/aruco_sender.py --camera 0 --calibration camera.json --id 0 --marker-m 0.053 --url http://RENDER_PC_IP:8765/api/pose
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

粗估模式假設 fx=fy=影像寬度、主點在中心、畸變為零；這不是 C270 的實測內參。它用真實 ArUco 角點與目前 5.3 cm 實測尺寸估姿態，供驗證串接；API 的 scale 是 `estimated`，網頁明確標示未校正，不能視為精確公尺與角度。正式模式的 scale 才是 `metric`。兩種模式切換後重設原點。

未提供任何模式時，預覽仍送 `initializing` 和 `calibration_required`，網站會說明原因，不再只顯示等待裝置。辨識到 tag 但角點太小或 PnP 品質不足則送 lost 及具體原因。

## 姿態防抖

3D 網頁預設開啟「姿態防抖」，可即時取消勾選比較。原始相機預覽不做電子影像防震，API 也保留原始 PnP 姿態；防抖在 MacBook／瀏覽器端執行，不用 NPU。預覽偵測另啟用 subpixel 角點細化，減少角點量化抖動。

採 [One Euro](https://gery.casiez.net/publications/CHI2012-casiez.pdf) 的速度自適應低通概念：位置 lerp、旋轉 shortest-arc quaternion SLERP；低速較穩定，快速運動降低延遲。使用捕捉時間戳計算 dt，重複 API 封包不重複濾波；只有明確重設原點會清除視角基準；失去追蹤、網路中斷或超過 250 ms 間隔會保留最後顯示的位置與角度，恢復時清除速度估計，以最多 1/30 秒的濾波步長平滑接回，每筆有效資料都可推進視角。這是姿態平滑，不是去模糊、SLAM 或精度校正，不能消除所有步行晃動／PnP 解翻轉；快速錯誤姿態也可能通過。

16–23 FPS 的偵測更新間隔約 43–63 ms。預覽網頁原先每次下載一張 JPEG 後再等 100 ms，限制了顯示流暢度；現改成 33 ms，實際顯示率仍受傳輸、解碼和相機處理率限制；頁面上的 FPS 是相機處理率，不是瀏覽器顯示率，也不是 NPU 使用率。平滑會增加延遲，需要實際擺頭比較，不承諾更準。

失去 B 時：後端保留最後有效 pose 並標為 lost，前端不把 lost 封包中的位置套到相機；不回原點、不自動重設基準。防抖開啟時，找回 B 的第一筆就以受限濾波步長開始平滑跟上，避免有／無交替時永遠停住。關閉防抖仍會在失去追蹤時凍結，但恢復使用原始姿態。

列印版實測 5.3 cm：原 PDF 和版面 JSON 仍描述設計的 5.5 cm。單 tag 追蹤已改用 0.053 m；接多 tag board 前，需量測實際中心間距或確認整張是否等比例縮放，不能直接沿用原 90 mm 間距。

## 整張 A4 四標記模式

目前使用者確認未裁切，啟用：`python3 pose/camera_preview.py --host 0.0.0.0 --approximate --marker-m 0.053 --board public/markers/aruco-board-A4-55mm-ids0-3.json`。

ID 0～3 共用版面中央原點，任何一張清楚可見時都可定位；多張同時可見時一起解 PnP。可見標記切換不會切換世界原點。前端右下角顯示看到的 ID 和實際參與定位的 ID。

此設定假設整頁從設計的 55 mm 等比例缩為實測 53 mm，中心間距預期為 90×53/55 ≈ 86.73 mm；請量測確認。若裁切後重排、印表機非等比例縮放、紙張彎曲或實際間距不同，就要更新 layout，不能沿用。多標記提高可見率，不保證增加 FPS；目前仍是未校正內參的粗估模式。

### CPU 效能觀測

相機 `/status` 的 `timings_ms` 為各階段耗時的指數移動平均（毫秒）：`capture` 包含等待影格與解碼、`detect` 為 ArUco、`pose` 為姿態 pipeline、`overlay` 包含排入傳送佇列與畫框、`jpeg` 為預覽編碼。`outcomes` 是本次相機開啟以來，各追蹤結果／失效原因的逐幀累計。編譯網頁等同機負載也會影響耗時；HTTP 傳送不包含在這些數值中。此路徑使用 CPU，未使用 NPU。

預覽預設輸出 320×240 JPEG（`--preview-width 640` 可恢復較大預覽），網頁每次讀完後等 100 ms 再取得預覽；定位仍使用原始 640×480。姿態 HTTP 輪詢以 33 ms 為起始間隔目標，扣除本次請求耗時，不會同時發出多筆請求；網路慢時以實際請求完成速度為限。預覽刷新率和定位處理 FPS 不同。


### WebSocket 與逐畫面平滑（2026-09-19）

相機預設經 `ws://127.0.0.1:8767/api/pose/publish` 傳送，relay 以 `/api/pose/ws` 推送到瀏覽器（5173 的 Vite 代理轉至 8767）。HTTP 8765 `/api/pose` 保留供診斷及舊客戶端使用，前端不再輪詢姿態。每個瀏覽器只有一筆未確認資料；確認後再取最新姿態，不重播積壓資料。斷線 500 ms 後重連，250 ms 無新姿態時凍結。介面的 RTT 是應用程式確認往返時間，包含瀏覽器排程；不是完整相機到螢幕延遲。

安裝／執行：
```sh
python3 -m venv --system-site-packages .venv
.venv/bin/python -m pip install websockets==15.0.1
.venv/bin/python pose/relay.py
.venv/bin/python pose/camera_preview.py --host 0.0.0.0 --approximate --marker-m .053 --board public/markers/aruco-board-A4-55mm-ids0-3.json
```

前端的「姿態防抖」作用於量測；「畫面平滑」則每次 requestAnimationFrame 更新位置與 quaternion SLERP。後者使用 25 ms 時間常數，固定目標約 58 ms 到達 90%，會增加少量跟隨延遲。兩個開關可獨立比較。失去追蹤時凍結已顯示的位置，重設原點清除兩層歷史；沒有運動外推。防抖位置截止頻率改成 `2 + 6*speed`，旋轉 `2.5 + 0.7*angularSpeed`，避免兩層都過度平滑。

### 網頁相機校正

在 5173 開啟 `/api/camera/calibration`，手機顯示 `/markers/calibration-checkerboard.png`（亦有 A4 PDF）。這是 10×7 格／9×6 內角點棋盤；收集至少 16 張不同位置、距離、傾角的清晰影像。使用正在追蹤的同一個相機串流原始 640×480 影像，不另開相機。校正 intrinsics 不依賴棋盤格實際尺寸；螢幕必須保持平面、固定顯示比例，並避開反光／摩爾紋。

程式拒絕近似重複照片、覆蓋或傾角不足的資料；每四張保留一張，先用其他影像求內參，再檢查保留視角的 PnP 重投影誤差。需訓練 RMS ≤1 px、保留視角各自 RMS ≤1.5 px，以及合理焦距／主點。通過仍應用實際移動距離檢查精度，低重投影誤差不是完整精度保證。

按「套用」才產生本機 `camera.json` 並切换目前 pipeline；3D 頁需按重設原點。影像與每次結果存在 git 忽略的 `calibration/`。之後重啟相機改用 `--calibration camera.json`，不要同時指定 `--approximate`。實際校正必須由使用者收集照片完成，不能以合成測試冒充。

### 曝光與濾波實驗紀錄

在當時場景各取約 6 秒：原自動曝光 73/78 幀有效（94%）、FPS 中位數 13.9、預覽灰階均值約98；手動8.3ms且關閉動態降幀為105/105幀有效、FPS16.1、灰階均值約40。場景／動作沒有固定，不能作為因果或效能保證。因明顯變暗，已恢復 auto_exposure=3、exposure_time_absolute=156（自動模式下非即時曝光讀值）、exposure_dynamic_framerate=1、gain=8。若再測短曝光，應搭配照明並檢查實際漏偵測。

合成20Hz量測／60Hz渲染、±5mm交替雜訊、0.1m/s勻速：加畫面平滑後，原濾波參數測得靜止RMS約0.55mm／移動落後約116ms；調整後約0.69mm／93ms。此結果不含真實相機、網路或渲染耗時。


本機已在 2026-09-19 完成實際 16 視角校正並套用：RMS 0.123 px，保留視角 RMS 0.153 px／最大0.177 px。去除影像路徑的內參備份為 `pose/calibrations/logitech-c270-640x480.json`，可用 `--calibration pose/calibrations/logitech-c270-640x480.json` 重啟；此參數只適用這顆 C270、640×480、相同光學設定。實際距離仍需量尺驗證，不能從重投影誤差直接推算毫米精度。

本次驗證：Python 21 項、Node 23 項測試通過，Vite build 通過；完整 app TypeScript 檢查仍有既有 `ModelViewer.tsx`／`useFaceLandmarker.ts` 錯誤，本次變更檔未出現新型別錯誤。
