自製 OpenCV＋LK 版新增持續 lost 自動重建、局部地圖搜尋及按觀察品質保留地圖點；更新與限制見 [SLAM.md](SLAM.md)。

> 電腦端 SLAM 實驗：i.MX93 傳影像，Mac／本機運算，啟動與限制見 [SLAM.md](SLAM.md)。下方保留原專案說明。

# GodEyes · 頭戴相機姿態傳輸版

本 worktree 已加入 **NPU 手勢移動與旋轉**：張掌控制前後左右、食指控制左右轉向／上下看、握拳停止。板子與電腦的啟動方式見 [手勢控制指南](npu/GESTURE_CONTROL.md)。

目前以 `origin/imx-head-pose-local-slam`（`3e3d076`）為 SLAM 基礎。**頭戴朝外相機 → 板端彩色影格與手勢 NPU → Mac 無標記 SLAM → 瀏覽器疊加手勢移動／旋轉**，不需要 ArUco。SLAM 是自製 sparse 實驗後端，使用任意尺度；原分支的其他後端與實驗開關保留。

整合版啟動請看 [SLAM ＋手勢控制指南](npu/GESTURE_CONTROL.md)。下方為原 Tag 原型的歷史說明，並非目前預設啟動流程。

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
