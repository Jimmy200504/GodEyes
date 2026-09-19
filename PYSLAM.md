# pySLAM 最小版（Apple Silicon Mac）

這版取代先前的 `install_all.sh` 全套安裝。入口 `scripts/setup-pyslam-mac.sh`
也已轉向最小版，不會再啟動官方全套安裝器。

固定 upstream 版本：
https://github.com/luigifreda/pyslam/tree/a5ff2562eb929ed9a08420f528a120a3cca65585

## 保留與差異

- 保留 upstream Python 版初始化、追蹤、關鍵幀、局部建圖、g2o BA、幾何重定位。
- 特徵使用 OpenCV ORB 1200 點；不是 upstream 預設的 ORB2 extractor。
- 重定位先從最多 40 個關鍵幀候選（較舊視角均勻取樣＋最近視角）匹配，
  最多交 5 個候選給 upstream Relocalizer 做 PnP／姿態最佳化。
- **沒有 BoW 詞典、迴環校正或長距離全地圖搜尋。** 候選範圍有限，不能視為完整
  pySLAM 的等效實作。也沒有自動 lost 插值／生成影像。
- 不安裝 torch、TensorFlow、Kornia、Open3D、語意／深度模型、Gaussian Splatting、
  Pangolin／3D viewer、GTSAM 或整套 C++ core。
- Python 使用 `opencv-contrib-python-headless`；native 只連結 core／imgproc／features2d／calib3d，
  不連結 highgui／videoio，避免 macOS 相機與視窗 Objective-C 類別重複載入。
  注意：直接檢查官方 4.10.0.84 macOS ARM64 wheel，雖然套件名為 headless，
  其二進位仍包含 COCOA。不能要求 GUI 欄位必須為 NONE；檢查的是套件唯一性、
  實際 cv2 路徑，以及 native 不再載入第二套 highgui／videoio。
- 仍需四個 C++ 模組：pySLAM 自帶的 g2o bindings、pyslam_utils、hamming、pnpsolver。
  現成 g2opy wheel 缺少 upstream 使用的 `Flag` API，不能直接換掉。

**目前尚未在你的 Mac 編譯／實測完成。** 已驗證 Python／shell 語法、精簡 patch、
候選檢索與姿態轉換測試；這些不代表真實追蹤效果或 Mac 建置已成功。
安裝最後會先檢查所有直接依賴（包含 ordered-set）與 headless OpenCV，再跑小型合成 g2o BA 問題，再建立 Slam、處理空白影像，並檢查沒有載入上述大型依賴。
只有這個 smoke test 成功才建立 `.pyslam-min/ready`。空白影像只測核心啟動，
不測建圖成功率，也不代表 BA／重定位每條路徑已在 Mac 通過。

## 安裝與啟動

先 Ctrl-C 停止舊安裝或舊 SLAM receiver；不需要刪除之前的資料。
本版用 `.pyslam-min/` 和自己的 venv，不使用／覆寫 `.pyslam/upstream`、
既有 `.venv` 或全域 conda 環境。

```bash
cd ~/GodEyes-local-slam
bash scripts/setup-pyslam-minimal-mac.sh
```

下載只選核心原始碼目錄及 g2opy，不抓任何 Git 子模組。
Homebrew 依賴是 python@3.11、cmake、ninja、eigen@3、opencv@4；重用已安裝套件。
OpenCV 明確使用 `opencv@4` 的 CMake 設定目錄，避免未指定版本的 `opencv`
升到 5.x 後被錯誤選入；不需移除電腦上已裝的 OpenCV 5。
缺少的套件要求 bottle，pip 也要求 wheel；缺少相容二進位版本會報錯，
不會偷偷開始編譯整套 OpenCV。只對保留的四個 native 元件明確使用單工建置。
Homebrew 自身的套件依賴仍可能需要下載，不能承諾總下載大小。
完整安裝紀錄：`.pyslam-min/logs/setup-*.log`。

若已編譯完成，只想重跑最後的檢查，可執行 `bash scripts/check-pyslam-minimal.sh`。
檢查先讀取 Python cv2 的路徑與建置資訊，再載入 native 元件；載入另一套
OpenCV 後不再以 getBuildInformation 判斷 wheel 類型，避免符號解析造成誤判。
Mac 上仍檢查實際載入的函式庫，不允許 native highgui／videoio 混入。

安裝通過後，接回原有板子串流與網頁：

```bash
bash scripts/run-pyslam-live.sh
```

使用原本的 SSH tunnel、640×480 校正、pose relay、網頁 5182。
輸入在既有 receiver 去畸變後送進核心，核心設定畸變為零，避免重複校正。
`/api/camera/status` 的 backend 應為 `pyslam-minimal`，附帶 `pyslam_state`。
先緩慢橫向平移取得初始化視差，再測左右旋轉與回到原場景。
upstream 若自行重置地圖，adapter 會變更 map/session ID；網頁需重新置中，
不會把不同地圖當作同一組座標接起來。

## 固定錄影比較

也可以沿用先前的錄影測試包（需要已有的 `.venv` 和板子 frame_stream）：

```bash
bash scripts/record-pyslam.sh --seconds 30 --output .pyslam/recordings/turn-test-1
bash scripts/run-pyslam-minimal.sh .pyslam/recordings/turn-test-1
```

錄影目錄不可已存在。保存原始 JPEG、五項相機畸變係數與板端時間戳；
不補幀、不重新壓縮，過期幀拒絕並計數。相機重啟／時間倒退會報錯。

新結果在 `.pyslam-min/results/<時間>/`：`summary.json`、`frames.jsonl`、
`config.yaml`、`camera.yaml`、`run.json`；執行 log 在 `.pyslam-min/logs/run-*.log`。
逐幀記錄包含 state、追蹤耗時、點數、關鍵幀及有效姿態（Rwc、position）。
`complete: true` 代表所有錄影幀處理完；OK 是演算法自報，不是 ground-truth 精度。
`track_ms` 不含解碼／傳輸／UI，也不完整包含背景 BA 成本；不可當端到端 FPS。
回放會處理所有幀，不模擬即時丟幀，仍須觀察即時版本是否跟得上輸入。

## 可審查的修改

`native/pyslam-min/prepare.py` 延後不需要的模組載入、將 CPU 工作的
`torch.multiprocessing` 換成標準 multiprocessing、限制 BF／FLANN matcher，
並讓 Config 可讀本次實驗設定。沒有以假的套件或假的追蹤結果替代依賴。
選用未安裝功能時，仍會報正常的 import error。
原始檔留在 upstream 的 `godeyes-originals/`，修改前後 SHA256 留在
`godeyes-minimal-patches.json`。再次安裝會檢查已修改檔案，避免蓋掉人工變更。
upstream GPL 授權與原始檔授權聲明均保留。

工具測試：
```bash
.pyslam-min/venv/bin/python -m unittest discover -s pose -p 'test_pyslam*.py'
```
