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
npm run precompute:mac -- --out ./precomputed-output
```

需要已安裝的桌面 Chrome 或 Edge，以及符合本專案 Vite 要求的 Node.js（20.19+ 或 22.12+）。這是一個 CLI：不開可操作的 Web UI、不使用瀏覽器資料夾選擇器。Node 直接建立並寫入 `--out` 指定的空資料夾。若路徑已有檔案，會拒絕覆寫；重新匯出請指定新路徑。

底層仍使用現有 Spark / Three.js 的瀏覽器 WebGL 渲染能力：CLI 在 **MacBook** 上暫時啟動 loopback Vite 資源服務與 headless Chrome，透過私有 DevTools pipe 控制，不需手動開頁面。Chrome 使用獨立的暫存 profile，不碰平常瀏覽器資料；成功、失敗或 Ctrl+C 時關閉其程序與服務。未禁用 GPU，但實際硬體加速仍取決於 Mac 的 Chrome 環境。相關機制見 [Chrome Headless 說明](https://developer.chrome.com/docs/chromium/headless)。macOS 檢查在啟動服務／瀏覽器之前，板子會直接拒絕執行。

其他選項：

```sh
npm run precompute:mac -- --out ./capture-720 --views 60 --width 1280 --height 720 --format rgb565le
npm run precompute:mac -- --help
```

Chrome 不在標準 `/Applications` 路徑時，用 `--chrome "/完整路徑/Google Chrome.app/Contents/MacOS/Google Chrome"` 指定執行檔。指令不會自動下載或安裝瀏覽器，也不需要 Playwright。這個版本取代舊版 `showDirectoryPicker` 匯出 UI，避開 Chromium 對系統／敏感資料夾的選取限制。

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

每次只處理、寫入一張，不將整批影像打包在 RAM。寫入端只接受本次隨機 token、預期影像檔名與有限大小；檔案使用 exclusive write，不覆寫既有內容。全部張數與容量核對後才寫入 `manifest.json`；沒有它代表匯出不完整。失敗後保留部分輸出供診斷，請改用空資料夾重新匯出。runtime 由 Node 直接複製原始檔，不含開發伺服器注入程式。終端會顯示每張進度、總耗時與容量；`manifest.json` 也記錄 `exportSeconds`。

完成後請回傳完整輸出資料夾 ZIP、MacBook 晶片型號，以及終端結果／錯誤。要在 MacBook 檢查互動，可另以靜態 HTTP 服務開啟輸出資料夾；不要以 file:// 雙擊 HTML。

## 裝置展示

先在 MacBook 檢查匯出畫面與資料夾大小，再將完整 `output/` 複製到裝置適合的儲存位置。只部署這個資料夾到靜態 HTTP 服務，不必帶原始專案、node_modules 或 SPZ。不要用原專案的 `npm run dev`，也不要直接雙擊 file://（ES modules / fetch 需要 HTTP）。此工作未在裝置啟動任何伺服器或瀏覽器。

輸入支援拖曳、滑桿、方向鍵和回正。最多 3 張 ImageBitmap；只有一個進行中的讀取／解碼，後續輸入合併為最新視角；淘汰時呼叫 `close()`。沒有持續動畫循環、整批預載或高 DPI 倍增。檔案以 no-store 讀取，重訪超出快取的視角需要重新讀取。失敗保留既有畫面並顯示重試。

未接攝影機／頭部追蹤，避免重新帶入 MediaPipe 成本。提供 `window.precomputedView.setView(yawDegrees, pitchDegrees)`，未來可接原生／NPU 姿態來源；正 yaw 朝左、正 pitch 朝上，超出範圍會夾住。此版本本身不使用 NPU。不支援位置平移、前進後退、roll、幾何縮放或自由漫遊。角度採最近鄰切換，沒有宣稱連續 3D 或插值效果；若上下切換太明顯，須增加俯仰取樣並重新分配最多 60 張的預算。

RGB565 規格：由左上至右下、逐列、每像素 2 bytes little-endian，R5G6B5，無 header、無 stride padding。尺寸與格式在 manifest。YUV 尚未實作，需先確認原生顯示介面與硬體解碼路徑。

## 安全驗證

```sh
npm run test:precompute
```

測試純 JS 的視角選擇、資源限制、像素格式、快速輸入競態、快取釋放、失敗重試，以及 CLI 參數、檔案保護、寫入驗證、CDP 訊息與非 Mac 啟動保護。測試不啟動 HTTP 服務、瀏覽器或 GPU。Mac 真實 GPU 匯出尚待驗證。不要在板上安裝依賴或進行 GPU 匯出。裝置實際展示、RSS 與 FPS 留待明確授權後再測。
