# 獨立離線視角模組

原本 React / Spark 網站保持不變。此模組產生獨立、無 npm 依賴的靜態展示資料夾；裝置端只使用 Canvas 2D，不載入 Gaussian、WebGL、MediaPipe 或 NPU。瀏覽器本身如何合成畫面由系統決定。

## 本機資源快照（2026-09-19）

FRDM-i.MX93，2 × Cortex-A55；Linux MemTotal 1,985,620 KiB（1.89 GiB），當時 MemAvailable 755,464 KiB（738 MiB），無 swap。根磁碟只剩約 201 MiB。可用記憶體會隨系統工作變動，不代表全數可以分給網站。

| 解析度 / 視角 | RGB565 檔案總量 | 全部 RGBA 解碼 | 本程式 3 張 RGBA 快取 |
| --- | ---: | ---: | ---: |
| 960 × 540 / 21 | 20.8 MiB | 41.5 MiB | 5.9 MiB |
| 960 × 540 / 45（預設） | 44.5 MiB | 89.0 MiB | 5.9 MiB |
| 1280 × 720 / 60 | 105.5 MiB | 210.9 MiB | 10.5 MiB |

這些是影像容量計算，不是整個瀏覽器 RSS 預測。還有畫布、解碼暫存、合成器與瀏覽器開銷。RGB565 在此瀏覽器版仍須轉 RGBA，沒有零複製優勢；JPEG 使用瀏覽器解碼，檔案大小以實際匯出結果為準。先用 960 × 540 JPEG，裝置可用記憶體餘裕仍須實測；目前未驗證 FPS 或峰值 RSS。不建議在剩餘 201 MiB 的磁碟上放多組原始影像。

## 在 MacBook 匯出（不要在 i.MX93 執行）

把此專案含 `public/scenes/lofi-world.spz` 複製到 MacBook，在專案根目錄執行：

```sh
npm ci
npm run precompute:mac
```

這個指令會先檢查 macOS 才載入 Vite，使用專屬入口 `http://127.0.0.1:5174/export.html`，不開原網站。以桌面 Chrome / Edge 開啟；按「選擇空資料夾並匯出」，挑選空資料夾。首次使用需允許瀏覽器寫入選定資料夾。GPU 在按下匯出後才初始化。

選 21、45 或 60 個視角，JPEG 或 RGB565。預設 15 個水平角（−35° 至 +35°）× 3 個俯仰角（−10°、0°、+10°）。這是站在房間內轉頭，不是繞物體公轉。相機使用現有程式中立姿態：位置 `(0,0,0.6)`、FOV 75°、YXZ 旋轉；世界 X 旋轉 π、縮放 0.3、Z 位置 0.6。不載入佔位鞋子模型；不包含個人校正資料。

Spark 設定 `autoUpdate: false`，每張均等待 `spark.update({ scene, camera })` 完成排序，再渲染與編碼；參考 [Spark 官方說明](https://sparkjs.dev/docs/spark-renderer/)。GPU 匯出及視覺品質尚待 MacBook 實測。

匯出結果：

```text
output/
  index.html
  style.css
  viewer.mjs
  core.mjs
  manifest.json
  frames/view-000.jpg ...（或 .rgb565）
```

每次只處理、寫入一張，不將整批影像打包在 RAM。`manifest.json` 最後才寫入，沒有它代表匯出不完整。失敗後請改用空資料夾重新匯出。runtime 原始檔以 Vite raw import 複製，不含開發伺服器注入程式。

## 裝置展示

先在 MacBook 檢查匯出畫面與資料夾大小，再將完整 `output/` 複製到裝置適合的儲存位置。只部署這個資料夾到靜態 HTTP 服務，不必帶原始專案、node_modules 或 SPZ。不要用原專案的 `npm run dev`，也不要直接雙擊 file://（ES modules / fetch 需要 HTTP）。此工作未在裝置啟動任何伺服器或瀏覽器。

輸入支援拖曳、滑桿、方向鍵和回正。最多 3 張 ImageBitmap；只有一個進行中的讀取／解碼，後續輸入合併為最新視角；淘汰時呼叫 `close()`。沒有持續動畫循環、整批預載或高 DPI 倍增。檔案以 no-store 讀取，重訪超出快取的視角需要重新讀取。失敗保留既有畫面並顯示重試。

未接攝影機／頭部追蹤，避免重新帶入 MediaPipe 成本。提供 `window.precomputedView.setView(yawDegrees, pitchDegrees)`，未來可接原生／NPU 姿態來源；正 yaw 朝左、正 pitch 朝上，超出範圍會夾住。此版本本身不使用 NPU。不支援位置平移、前進後退、roll、幾何縮放或自由漫遊。角度採最近鄰切換，沒有宣稱連續 3D 或插值效果；若上下切換太明顯，須增加俯仰取樣並重新分配最多 60 張的預算。

RGB565 規格：由左上至右下、逐列、每像素 2 bytes little-endian，R5G6B5，無 header、無 stride padding。尺寸與格式在 manifest。YUV 尚未實作，需先確認原生顯示介面與硬體解碼路徑。

## 安全驗證

```sh
node --max-old-space-size=64 --test tests/precompute.test.mjs
```

測試純 JS 的視角選擇、資源限制、像素格式、快速輸入競態、快取釋放、失敗重試。不要在板上安裝依賴或進行 GPU 匯出。裝置實際展示、RSS 與 FPS 留待明確授權後再測。
