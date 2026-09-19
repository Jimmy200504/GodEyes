# 手勢移動與旋轉

板子執行手掌／骨架 Vela 模型（Ethos-U delegate），小型 Open／Close／Point 分類器跑 CPU。瀏覽器在每個渲染畫面套用控制，保留頭部姿態追蹤。

- 張掌：掌心移到影像上方／下方代表前進／後退，左方／右方代表左移／右移。
- 伸食指：掌心移到影像左／右代表左轉／右轉，上／下代表抬頭／低頭。
- 掌心放中央 30% 區域、握拳、手離開畫面或低信心結果都停止。
- 切換移動／旋轉需連續兩次一致結果；移動上限 0.3 m/s，旋轉上限 60°/s，手勢俯仰限制 ±60°。
- 移動方向跟隨目前視角的水平朝向；頭部追蹤與手勢旋轉會疊加。
- 頁面失焦、隱藏、連線中斷或資料超過 250 ms，停止新增移動與旋轉，保留目前位置／角度。重新聚焦後新手勢可恢復控制。
- 「重設位置與正前方」清除手勢位移及角度，也重設頭部追蹤。

## 板子啟動

需要 BSP 的 `opencv`、`numpy`、`tflite_runtime`、`/dev/ethosu0`、`/usr/lib/libethosu_delegate.so`，以及 `websockets==15.0.1`（與 `pose/requirements.txt` 相同）。使用有這些套件的 Python。

手勢服務共用 `pose/frame_stream.py` 的 JPEG 串流；若它已在執行，直接沿用，不要重複開相機。原本直接佔用相機的 ArUco sender 必須改用現有 Mac frame pose 流程，見 [MAC_FRAME_POSE.md](../pose/MAC_FRAME_POSE.md)。

```sh
# 終端 1：只在影格服務尚未啟動時執行
python3 pose/frame_stream.py --camera /dev/video2

# 終端 2：先驗證板上模型可以載入、推論
python3 npu/gesture_server.py --check-models
python3 npu/gesture_server.py
```

預設使用 `npu/models/gesture/vela/*_vela.tflite`，不會默默退回 CPU。服務讀取 `ws://127.0.0.1:8781/frames`，輸出 `ws://127.0.0.1:8782/api/gesture/ws`。頭戴相機預設不鏡像；面向使用者的相機若左右相反，加 `--mirror`。

## 電腦端

若 Vite 在 Mac／另一台電腦執行，將手勢 port 一起加入原本的 SSH tunnel：

```sh
ssh -N -L 8781:127.0.0.1:8781 -L 8782:127.0.0.1:8782 root@BOARD_IP
```

已有 8781 tunnel 時，只另外開 `ssh -N -L 8782:127.0.0.1:8782 root@BOARD_IP`。Mac 的姿態運算仍照原流程執行。Vite dev／preview 已加入 `/api/gesture/ws` 代理；使用其他網頁伺服器時須自行設定 WebSocket 代理到板子的 8782。

```sh
npm run dev -- --host 0.0.0.0
```

開啟頁面、點一下使它取得焦點，查看左下角手勢狀態。張掌移到上方應前進；握拳停止；食指模式向右移應右轉。若一直停止，先檢查手是否在相機視野內，再檢查推論與串流延遲是否超過 250 ms。

## 本機驗證

```sh
node --test tests/*.test.mjs
.venv/bin/python -m unittest discover -s npu -p 'test_*.py'
python3 npu/gesture_server.py --cpu --check-models
```

`--cpu` 只用於明確指定的開發驗證，讀取未編譯的原始模型；不能代表 NPU 或真實手勢辨識已驗證。仍需在實體板子檢查手勢準確度、延遲與實際方向。

## 本次驗證紀錄（2026-09-20）

- 板上 `/dev/ethosu0`：兩個 Vela 模型載入及 invoke 成功，delegate 分別回報 1/4、1/6 個節點委派給 Ethos-U（Vela 子圖以單一節點呈現，不等於模型只有一個算子）。
- C270 真實 640×480 影格共 15 張：未偵測到手，手掌偵測路徑推論中位數 30.84 ms、最大 38.49 ms。骨架模型已做 warmup，但尚未量測「有手」的完整追蹤／分類延遲或真人辨識準確度。
- 完整相機 → NPU 手勢服務 → WebSocket 客戶端驗證：沿用另一 worktree 已啟動的 8781 影格服務，連續 30 個封包皆為 tracking，最大來源影格年齡 218.0 ms；沒有修改或停止既有影格服務。
- 真實 loopback WebSocket 已驗證旋轉命令、過期停止及非法路徑／請求處理。測試使用臨時 port，完成後已停止測試相機程序。
- 前端移動、旋轉疊加、俯仰限制、失焦、重連、逾時與重設皆有自動測試。Production build 成功。
- 全專案 TypeScript 檢查仍有原本的 `ModelViewer.tsx` 和 `useFaceLandmarker.ts` 錯誤；本次 App 及其相依模組的 TypeScript 檢查通過。
- 變更檔案的 ESLint 檢查通過，但本環境共用依賴的 ESLint／typescript-eslint 版本存在預設選項相容問題，驗證時明確指定 `no-unused-expressions` 的選項。

本環境沿用唯讀的共用 `node_modules`，建置時使用 `npm run build -- --configLoader runner`，避免 Vite 在共用目錄寫入暫存檔。正常 `npm ci` 安裝的工作目錄可照一般 `npm run build` 執行。
