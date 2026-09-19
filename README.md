# GodEyes · 頭戴相機姿態傳輸版

此分支由 `main` 的 `2baad2b` 建立，方向是 **頭戴朝外相機 → 邊緣裝置估計 6DoF → 傳送 pose → 另一台電腦渲染 3D**。邊緣裝置不 host 網站、不渲染場景。

目前已實作 **單一固定 ArUco B → PnP → 公尺尺度 pose API → 外部電腦渲染**，包括 webcam 擷取、標記產生與相機校正工具。使用 Logitech webcam 頭戴朝外、沒有 IMU；不需要 A 或 SLAM，尚未做真機精度／效能驗證，也未使用 NPU。板子背景沿用舊 worktree 的 FRDM-i.MX93 記錄。

目前執行中的相機預覽已整合 PnP 與 API 傳送，使用 `--approximate` 的未校正示範模式；以真實 B 角點估姿態，但距離與角度尚未精確校正。API 會標為 `estimated`，前端亦明確標示。

先看 [簡短 plan](pose/PLAN.md) 和 [真實相機啟動指南](pose/README.md)。下方 mock 只用於傳輸／渲染測試。

## 啟動原型

在渲染電腦，需要 Python 3 與 Node.js（沿用 Vite 7 的 Node 要求）。各指令在獨立終端執行：

```sh
python3 pose/relay.py
npm ci
npm run dev
python3 pose/mock_sender.py
```

開啟 Vite 網址。畫面會標示「模擬資料（非相機追蹤）」並以 1:1 位移／旋轉移動既有 3D 場景。前端不要求 webcam、不載入 MediaPipe CDN。重設按鈕以接下來的有效姿態建立原點。

兩台機器時，在渲染電腦執行 `python3 pose/relay.py --host 0.0.0.0`，邊緣裝置執行 `python3 pose/mock_sender.py --url http://RENDER_PC_IP:8765/api/pose`。邊緣端只需傳送器，不需 npm 或網站資產。這個 stdlib 接收器限可信 LAN 開發驗證，沒有認證／TLS；正式網站需同源代理 `/api/pose` 並部署正式接收服務，Vite proxy 不會包含在 `dist/`。

## API 與姿態來源接點

`POST /api/pose` 送一筆最新姿態，`GET /api/pose` 回 `{ "pose": ..., "age_ms": ... }`。接收端不累積影像或歷史佇列。前端以約 30 Hz 輪詢（另加請求耗時），不是效能承諾。

```json
{
  "version": 1,
  "frame": "opencv-c2w",
  "session_id": "new-uuid-per-process-start",
  "map_id": "room-map-1",
  "source": "your-slam-backend",
  "seq": 42,
  "capture_monotonic_ns": 1400000000,
  "tracking": "tracking",
  "scale": "metric",
  "position": [0.1, 0.0, 0.2],
  "quaternion_xyzw": [0.0, 0.0, 0.0, 1.0]
}
```

- Pose 是相機到世界的剛體變換 `T_wc`：`position` 為相機中心，quaternion 為相機座標軸在地圖中的方向，順序 **x,y,z,w**。相機局部座標遵守 OpenCV：右 X、下 Y、前 Z。世界座標可任意，但同一 map 必須一致。
- 公尺尺度填 `metric`；純單目且未定尺度填 `arbitrary`，前端會凍結，不能假稱公尺。若有已知距離校正，在 adapter 將整個地圖平移量換算成公尺。
- `seq` 每個 session 嚴格遞增；`capture_monotonic_ns` 是從 session 起點算的擷取時間戳（目前 webcam 來源為 read 完成時間，非硬體曝光時間）（安全整數），不要填跨裝置不可直接比較的絕對 monotonic 值。傳送端應丟棄過期影格，只送最新結果。
- `estimated` 專供明確啟用的粗估 demo，前端允許試動但顯示未校正；`arbitrary` 仍凍結。狀態為 `initializing / tracking / lost / relocalizing`。非 tracking、接收資料超過 250 ms、任意尺度（arbitrary）時維持最後視角。接收 age 不含 SLAM 處理和發送前延遲，端到端延遲必須另外量測；本版加上 GET 往返時間作保守過期判斷。
- 重啟改 `session_id`；重建／切換世界座標改 `map_id`，前端要求重設，避免瞬移。同地圖 loop closure 也可能修正 pose；目前未平滑修正，adapter 應將不連續的大幅座標修正視為 map revision。
- 前端先算 `T_relative = inverse(T_initial) * T_current`，再用 `S = diag(1,-1,-1,1)` 算 `S * T_relative * S`，將初始視線當作 Three.js 的 -Z。保持既有場景出生點的 Z 偏移，不沿用臉部追蹤倍率。
- 本原型只支援一個姿態來源；不要同時啟動 mock 與真實 SLAM。傳的是相機中心，不是眼睛中心；之後可加入固定的相機到頭部／眼睛外參。

## 驗證

```sh
python3 -m unittest discover -s pose -p 'test_*.py'
node --test tests/*.test.mjs
npm run build
```

包含 API round trip、無效 quaternion／數值拒收、亂序拒收、座標轉換、相對方向、失聯與 map reset 測試。真機 FPS、熱穩定性、追蹤精度與 NPU 加速均未驗證。演算法路線與實測驗收見 [HEAD_MOUNTED_POSE.md](HEAD_MOUNTED_POSE.md)。
