# GodEyes

透過攝影機追蹤頭部旋轉，在瀏覽器中以 1：1 角度探索 3D 場景。使用 React、TypeScript、Three.js、MediaPipe Face Landmarker 與 Spark Gaussian Splatting renderer。

## 目前功能

- 追蹤頭部左右轉動、抬頭低頭與側傾，將估算角度映射到相機旋轉。
- 以第一個有效姿態作為正前方，可隨時按「重設正前方」重新設定。
- 預設載入本機 Marble / Lofi Worlds 場景，可切換橘色格線房間；場景載入失敗時保留格線。
- 提供螢幕尺寸與觀看距離校正、全螢幕及除錯顯示，校正資料儲存在瀏覽器 localStorage。
- 保留 GLB 模型載入，以及模型位置、縮放與旋轉控制介面。

目前主要追蹤路徑使用頭部**旋轉**，並固定相機位置；不會根據頭部平移產生 6DoF 位移。程式仍保留以位置計算 off-axis 投影的實作，供其他輸入路徑使用。1：1 指估算角度到相機角度的映射，實際追蹤效果仍取決於攝影機與臉部辨識。

## 本機啟動

需要 Node.js 20.19+（20.x）或 22.12+，以及可使用攝影機、WebGL 2 和 WebAssembly 的瀏覽器。

```bash
git clone https://github.com/Jimmy200504/GodEyes.git
cd GodEyes
npm ci
npm run dev
```

開啟終端機顯示的本機網址（通常為 `http://localhost:5173`），允許攝影機存取。執行目前前端不需要 `.env` 或 API key；MediaPipe 模型與 WASM 仍需連線下載。

1. 首次開啟時輸入螢幕寬、高與觀看距離，或略過校正。
2. 正視螢幕，等待追蹤成功，再按右下角「重設正前方」。
3. 轉動頭部探索場景；左上角可切換 Marble 場景與格線房間。
4. 左下角可開啟全螢幕、校正與除錯顯示。
5. 右上角控制面板可調整模型位置、大小與旋轉（需有效 GLB 模型）。

## 開發指令

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 啟動 Vite 開發伺服器 |
| `npm run build` | 產生 `dist/` 正式版檔案 |
| `npm run preview` | 預覽正式版 |
| `npm run lint` | 執行 ESLint |
| `node --test tests/*.test.mjs` | 驗證旋轉映射與重設方向 |

部署時以 `dist/` 作為靜態網站根目錄，並使用 HTTPS 以取得攝影機權限；localhost 可用 HTTP。現有模型載入使用 `/models/shoe.glb` 絕對路徑，若部署在子路徑，需先調整資源路徑與 Vite base。

目前快照已通過正式版建置與 4 個旋轉測試。`npm run lint` 目前會在載入 `@typescript-eslint/no-unused-expressions` 時因 `allowShortCircuit` 選項錯誤中止；需先修正 ESLint 與 TypeScript ESLint 的規則相容性。

## 專案結構

```text
src/
  App.tsx                         主畫面與控制狀態
  components/FaceMeshView.tsx      攝影機、臉部姿態與重設方向
  components/ThreeView.tsx         場景容器與切換介面
  components/CalibrationWizard.tsx 校正介面
  components/ShoeControlPanel.tsx  模型控制面板
  utils/headPose.ts               姿態矩陣與相對旋轉
  utils/offAxisCamera.ts          相機旋轉與 off-axis 投影
  utils/threeScene.ts             Three.js、GLB 與 Spark 場景
  utils/calibration.ts            校正儲存
public/
  scenes/                         本機 SPZ 場景與來源說明
  models/                         模型資源
  media/                          既有展示素材
tests/
  headRotation.test.mjs           角度映射與重設測試
```

## 資源與已知限制

- `public/scenes/lofi-world.spz` 是約 7.2 MB 的 500k-splat 範例，來源記錄在 [場景說明](public/scenes/README.md)。此檔案由本機提供，不需 Marble 帳號。
- 目前 `public/models/shoe.glb`、`face.glb` 是 URL 文字佔位檔，並非 GLB 二進位檔，因此鞋子模型不能正常載入。使用模型功能前，請以有效且有權使用的 GLB 替換 `shoe.glb`。
- `public/media/demo.gif` 與 `example.gif` 也是文字佔位檔；既有截圖不代表目前 Marble 介面。
- 場景與模型資產的授權須依各來源確認；Spark 的軟體授權不代表外部場景素材的授權。
- 大角度轉頭或遮住臉可能導致追蹤中斷；未偵測到臉時保留最後視角。載入失敗可按「重試」，攝影機權限被拒時需先在瀏覽器設定中允許。

## 技術背景

專案延續 head-coupled perspective 的探索，並加入頭部旋轉追蹤與 Gaussian Splatting 場景。[HEAD_COUPLED_PERSPECTIVE.md](HEAD_COUPLED_PERSPECTIVE.md) 保留早期設計筆記；目前行為以本 README 與程式碼為準。
