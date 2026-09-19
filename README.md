# GodEyes · 走進現場

將現場照片整理為 Clean Image 與英文 Marble Prompt，生成可在瀏覽器探索的 3D Gaussian Splat 世界。兩個預建世界始終可直接開啟，Demo 不必等待新的世界生成。

## 啟動（本機完整模式）

需要 Node.js 20.19+ / 22.12+、Python 3.10+、已登入的 Codex CLI，以及支援 WebGL 2 的瀏覽器。

```bash
npm ci
python3 -m venv .venv
.venv/bin/pip install -r server/requirements.txt
cp .env.example .env  # 僅首次設定；已有 .env 時不要覆蓋
# 在 .env 設定 WORLD_LABS_API_KEY
npm run dev
```

開啟 http://127.0.0.1:5173 。此指令同時啟動 Vite 與 localhost:8000 的 FastAPI 後端。Codex 使用本機登入；Marble key 只在後端讀取，不進前端 bundle 或 Codex 子程序環境。兩者都使用真實額度。

只展示預建世界可用 `npm run dev:ui`，不用 API key。追蹤 WASM、模型、縮圖與 SPZ 均由本機供應；首次安裝完成後，預建場景與頭部追蹤不依賴外部 CDN。

## Demo 操作

1. 在世界資料庫選 Bright Truvia 或 Shared Scene v2，直接探索。
2. 拖曳旋轉；點擊場景後用 WASD 移動；「重設」回到起點。
3. 按「頭部追蹤」才啟動攝影機，可收合預覽、調整角度倍率，或按住停止偵測以重新擺正身體。切回滑鼠會關閉攝影機。
4. 建立世界：命名、上傳 1–4 張同一現場的 PNG/JPEG/WebP（每張 20 MB 以下），Codex 產出一張 Clean Image 及英文 Prompt。
5. 對照照片、編輯 Prompt，按「生成 3D 世界」。期間可探索預建世界；完成後新世界出現在列表，點擊進入。

**Clean 不代表清空。** 生圖指令要求保留人物、姿勢、家具、車輛、小物件、障礙物與空間關係，只改善畫質、光線和明顯透視失真。沒有口供輸入、嫌犯推論或自動判定功能。生成影像與世界均是衍生視覺化，仍須以原圖對照；Marble 不保證精確幾何，也未實作碰撞物理。

## 資料與復原

- `data/<id>/` 保存原圖、Clean Image、Codex Prompt、實際提交的 `submitted-prompt.md`、operation ID、Marble 回應及下載 SPZ。`data/`、`.env`、`.venv/` 都排除版控。
- 刷新頁面不會中斷後端任務；後端重啟可接續已有 operation ID 的 Marble 任務。單一服務程序運作，不使用多 worker。
- Codex 生圖失敗可「接續任務」，舊輸出先封存。若缺少內建 imagegen，介面明確回報，不使用舊圖冒充新結果。
- Marble 明確拒絕可修正後手動重試；網路中斷／5xx 若沒有 operation ID，保留提交標記、禁止重送，需先在 Marble 核對記錄。終止失敗須另建任務。
- 可按接續任務重試查詢／下載，不會重新生成已提交的世界。原始日誌留在本機，不由 API 提供。

## 指令與介面

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 本機前端＋後端 |
| `npm run dev:ui` | 僅前端與预建世界 |
| `npm run typecheck` / `npm run lint` / `npm run build` | 型別、程式檢查、正式建置 |
| `npm test` | 相機與移動測試 |
| `.venv/bin/python -m unittest server.test_app -v` | 任務、重試、資產存取與復原測試 |

API：`GET /api/health`、`GET/POST /api/scenes`、`GET /api/scenes/{id}`、`POST /api/scenes/{id}/world`（JSON `{prompt}`）、`POST /api/scenes/{id}/retry`、`GET /api/scenes/{id}/assets/{path}`。建立世界使用 multipart 的 `name` 與重複 `images` 欄位。服務只綁定 localhost，限制來源與可讀資產，不作公開多人服務使用。

CLI 工作流程可獨立執行，見 [照片流程](scripts/case-workflow/README.md)。兩個預建世界來源見 [場景說明](public/scenes/README.md)，追蹤資源見 [本機追蹤](public/tracking/README.md)。

## 整合依據

- [OpenAI Codex 非互動模式](https://developers.openai.com/codex/noninteractive)：以 `codex exec --json` 追蹤工作並保存輸出。
- [World Labs 官方範例](https://github.com/worldlabsai/worldlabs-api-examples)：非同步提交、operation 輪詢與世界資產取得。
- 現有 `../Imagegen` 成功使用的 media upload 與 `marble-1.1` 設定保留為預設，可用 `WORLD_LABS_MODEL` 覆寫。

## SLAM 與 NPU 手勢探索

在世界資料庫開啟任一世界，按「進階設定」→「SLAM／NPU 手勢探索」。遠端模式使用目前選取的世界，按「返回一般探索」即可切回。

板端模型、相機串流、Mac SLAM 與服務啟動見 [手勢控制指南](npu/GESTURE_CONTROL.md)，其他 SLAM 後端與限制見 [SLAM.md](SLAM.md)。張掌前進、食指指向控制左右平移／升降，握拳或收手停止；有手時暫停 SLAM 更新。預設位移倍率為 1.5×，任意尺度不代表公尺。

Vite 同時代理世界生成 API（8000）、姿態 HTTP（8865）、姿態 WebSocket（8867）、相機（8866）與手勢 WebSocket（18782）。真機 NPU 效能與追蹤精度需另行驗證。

測試：`python3 -m unittest discover -s pose -p 'test_*.py'`、`python3 -m unittest discover -s npu -p 'test_*.py'`、`npm test`。
