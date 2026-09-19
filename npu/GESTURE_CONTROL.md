# SLAM ＋手勢移動與旋轉

已合併使用者指定的 `imx-head-pose-local-slam`（`3e3d076`）。目前預設為頭戴朝外相機、無標記 sparse SLAM，不需要 Tag。

板子執行手掌／骨架 Vela 模型（Ethos-U delegate），小型 Open／Close／Point 分類器跑 CPU。瀏覽器在每個渲染畫面套用控制，保留頭部姿態追蹤。

- 張掌：掌心移到影像上方／下方代表前進／後退，左方／右方代表左移／右移。
- 伸食指：掌心移到影像左／右代表左轉／右轉，上／下代表抬頭／低頭。
- 掌心放中央 30% 區域、握拳、手離開畫面或低信心結果都停止。
- 切換移動／旋轉需連續兩次一致結果；移動上限每秒 0.3 個場景單位（SLAM 並非公尺尺度），旋轉上限 60°/s，手勢俯仰限制 ±60°。
- 移動方向跟隨目前視角的水平朝向；頭部追蹤與手勢旋轉會疊加。
- 頁面失焦、隱藏、連線中斷或資料超過 250 ms，停止新增移動與旋轉，保留目前位置／角度。重新聚焦後新手勢可恢復控制。
- 「重設位置與正前方」清除手勢位移及角度，也重設頭部視角原點；SLAM 地圖重建仍由預覽面板的地圖重設操作負責。
- SLAM 位移倍率只作用於頭部追蹤，不放大手勢移動。SLAM lost 時保留頭部視角，但新鮮手勢仍可移動；SLAM 自動重建不清除手勢位移。

## 板子啟動

需要 BSP 的 `opencv`、`numpy`、`tflite_runtime`、`/dev/ethosu0`、`/usr/lib/libethosu_delegate.so`，以及 `websockets==15.0.1`（與 `pose/requirements.txt` 相同）。使用有這些套件的 Python。

相機只擷取一次彩色畫面，使用 `--dual-stream` 同時提供灰階 `/frames` 給 Mac SLAM，以及彩色 `/frames/color` 給板端手勢 NPU。兩路保留相同來源時間與序號。Mac 不會請求彩色路徑，因此不會增加彩色影格的跨電腦傳輸量。先停止舊相機程序，避免佔用相機或 8781 port。

```sh
# 終端 1：只在影格服務尚未啟動時執行
python3 pose/frame_stream.py --camera /dev/video2 --dual-stream

# 終端 2：先驗證板上模型可以載入、推論
python3 npu/gesture_server.py --check-models
python3 npu/gesture_server.py
```

預設使用 `npu/models/gesture/vela/*_vela.tflite`，不會默默退回 CPU。手勢服務讀取 `ws://127.0.0.1:8781/frames/color`，輸出 `ws://127.0.0.1:8782/api/gesture/ws`。頭戴相機預設不鏡像；面向使用者的相機若左右相反，加 `--mirror`。

## 電腦端

Mac 使用本 worktree 整合後的程式，執行：

```sh
sh scripts/run-local-slam.sh --backend sparse --process-width 320
```

需要測試原分支的中間影像功能時，可另外加 `--synthetic-bridge`；旋轉外推仍需在網頁勾選。腳本會建置合併後的前端、建立兩條 SSH tunnel、確認手勢服務可回應，再啟動 Mac SLAM 與網頁。預設板子為 `root@100.86.170.121`，可用 `SLAM_BOARD` 覆寫。

| 用途 | 板子 | Mac |
|---|---|---|
| SLAM 灰階影格 `/frames` | 8781 | SSH 轉到 18781 |
| 手勢彩色影格 `/frames/color` | 8781，板端使用 | 不請求此路徑 |
| 手勢 NPU 命令 | 8782 | SSH 轉到 18782 |
| SLAM API／預覽／WebSocket | 不啟動 | 8865／8866／8867 |
| 網頁 | 不啟動 | http://localhost:5182 |

Ctrl-C 會停止腳本自己啟動的 Mac 程序及 tunnel；板端相機與手勢服務需在各自終端 Ctrl-C。這次合併不會自行啟動任何服務。

手動配置時，Vite `/api/gesture/ws` 指向 Mac `127.0.0.1:18782`，姿態與預覽指向 Mac `8865/8866/8867`，不再使用 Tag 版的 `8765/8766/8767`。

開啟頁面、點一下使它取得焦點，查看左下角手勢狀態。張掌移到上方應前進；握拳停止；食指模式向右移應右轉。若一直停止，先檢查手是否在相機視野內，再檢查推論與串流延遲是否超過 250 ms。

## 本機驗證

```sh
node --test tests/*.test.mjs
.venv/bin/python -m unittest discover -s npu -p 'test_*.py'
python3 npu/gesture_server.py --cpu --check-models
```

`--cpu` 只用於明確指定的開發驗證，讀取未編譯的原始模型；不能代表 NPU 或真實手勢辨識已驗證。仍需在實體板子檢查手勢準確度、延遲與實際方向。

## 合併前手勢驗證紀錄（2026-09-20）

- 板上 `/dev/ethosu0`：兩個 Vela 模型載入及 invoke 成功，delegate 分別回報 1/4、1/6 個節點委派給 Ethos-U（Vela 子圖以單一節點呈現，不等於模型只有一個算子）。
- C270 真實 640×480 影格共 15 張：未偵測到手，手掌偵測路徑推論中位數 30.84 ms、最大 38.49 ms。骨架模型已做 warmup，但尚未量測「有手」的完整追蹤／分類延遲或真人辨識準確度。
- 完整相機 → NPU 手勢服務 → WebSocket 客戶端驗證：沿用另一 worktree 已啟動的 8781 影格服務，連續 30 個封包皆為 tracking，最大來源影格年齡 218.0 ms；沒有修改或停止既有影格服務。
- 真實 loopback WebSocket 已驗證旋轉命令、過期停止及非法路徑／請求處理。測試使用臨時 port，完成後已停止測試相機程序。
- 前端移動、旋轉疊加、俯仰限制、失焦、重連、逾時與重設皆有自動測試。Production build 成功。
- 全專案 TypeScript 檢查仍有原本的 `ModelViewer.tsx` 和 `useFaceLandmarker.ts` 錯誤；本次 App 及其相依模組的 TypeScript 檢查通過。
- 變更檔案的 ESLint 檢查通過，但本環境共用依賴的 ESLint／typescript-eslint 版本存在預設選項相容問題，驗證時明確指定 `no-unused-expressions` 的選項。

本環境沿用唯讀的共用 `node_modules`，建置時使用 `npm run build -- --configLoader runner`，避免 Vite 在共用目錄寫入暫存檔。正常 `npm ci` 安裝的工作目錄可照一般 `npm run build` 執行。

## SLAM 合併驗證

- 合併來源：`imx-head-pose-local-slam`，commit `3e3d076`。SLAM 本體保持來源版本，前端合併保留手勢與 SLAM 的平滑／恢復／旋轉外推功能。
- SLAM Python 回歸測試 93 項、手勢 Python 測試 5 項通過；既有前端測試及新增 SLAM＋手勢整合測試通過。
- 整合測試涵蓋任意尺度 SLAM、手勢前後移動與旋轉、失追停止漂移、自動地圖重建保留手勢位移，以及重設歸零。
- Mac 啟動腳本及其中的 Python 區塊已做語法檢查；實際 Mac SSH tunnel 與真人 SLAM＋手勢操作尚待啟動後驗收。本次整合維持服務暫停，沒有重新佔用相機。

## 前端即時偵測面板

右上角「手勢偵測」面板顯示手形、分類信心、四軸控制強度、推論時間、資料年齡及 Socket 連線狀態。NPU 模式標示「NPU 手部模型 · CPU 分類」，不代表每個算子都在 NPU。沒有手時信心顯示 `—`；資料過期、失焦或斷線會標為非即時有效結果，四軸顯示停止。推論時間只包含手掌／骨架／分類處理，資料年齡另包含影格等待與傳輸的保守上界。舊後端沒回報的欄位顯示 `—` 或「推論裝置未回報」。
