# ORB-SLAM3 本機試跑

這個入口使用真正的 [ORB-SLAM3 官方核心](https://github.com/UZ-SLAMLab/ORB_SLAM3)，
不是原本的 Python 稀疏 VO。i.MX93 沿用現有 `frame_stream.py`；Mac 接收 JPEG、去畸變，
透過 stdin 將灰階影像交給本機 Docker 內的 ORB-SLAM3，再將姿態交給原本網頁。
容器不使用網路、不開相機、不開 Pangolin 視窗。建圖、局部最佳化、重定位與閉環使用上游實作。

## Mac 操作

先停止上次 `run-local-slam.sh`（Ctrl-C），開啟 Docker Desktop。
需 Python 3.10+、Node.js 20.19+／22.12+，以及可運作的 `docker info`。
首次建置會下載 C++ 依賴及詞彙表，請預留數 GB Docker 磁碟空間；建置時間視 Mac 而定。
Apple Silicon 使用原生 arm64 容器，Intel Mac 使用 amd64，不強制模擬 x86。

在 **Mac** 貼上：

```sh
scp root@100.86.170.121:/tmp/godeyes-orbslam3.tar.gz ~/Downloads/
mkdir -p ~/GodEyes-orbslam3
tar -xzf ~/Downloads/godeyes-orbslam3.tar.gz -C ~/GodEyes-orbslam3
cd ~/GodEyes-orbslam3
sh scripts/run-orbslam3.sh
```

腳本會先建置 `godeyes-orbslam3:4452a3c-v1`，再安裝 Mac Python／前端依賴、
建立 SSH tunnel、啟動本機 8865／8866／8867 與網頁 5182，最後開啟瀏覽器。
容器的 stdin/stdout 用於影格與姿態，容器的 ORB-SLAM3 日誌在終端機顯示。
建置預設單一編譯工作（`BUILD_JOBS=1`），啟動時印出 Docker VM 記憶體上限及完整建置輸出。
這能降低並行編譯的記憶體峰值，但不保證單一大型 C++ 檔案或詞彙表載入一定有足夠記憶體。
若仍出現 Cannot allocate memory，需保留失敗階段與錯誤前後輸出再判斷；不要直接刪除建置快取。
低記憶體修正版另外讓 GCC 更頻繁回收編譯器內部記憶體，並只將大型 `Optimizer.cc` 改用 `-O1 -g0`；
其餘追蹤／特徵擷取檔案保留上游 Release 最佳化。這可能增加編譯時間、降低最佳化模組的執行速度，
實際 FPS 需重測，不能保證一定能在你的 Docker VM 記憶體配置下完成。
DBoW2、g2o 與主核心改為分開的 Docker layer，已完成的依賴可在後續失敗重試時沿用。
Docker Desktop 的記憶體與 swap 可在 Settings → Resources 調整，需按 Mac 實際 RAM 配置，
不能把所有實體記憶體都交給 Docker。[Docker 設定文件](https://docs.docker.com/desktop/settings-and-maintenance/settings/)
再次執行會沿用 Docker 建置快取。Ctrl-C 會停止本次啟動的程序和容器。

`http://localhost:8866/status` 的 `backend` 必須為 **`orb-slam3`**；終端機會顯示
`Local orbslam3 receiver ready`。若編譯、載入詞彙表或核心失敗，不會偷偷退回原型。
自動開啟網頁表示接收服務已就緒，不代表相機已成功建圖；仍需確認 tracking 狀態。

## 測試左右轉頭

1. 相機對準有紋理、不同深度的靜態環境，先緩慢側移初始化。
2. 出現 tracking 後按「重設位置與正前方」。
3. 測試小幅慢轉，再增加角度與速度；與原型使用相同光線、動作及前端平滑設定。
4. `relocalizing`／`lost` 時凍結顯示；回到已建圖區域，觀察能否恢復。
5. 上游若切換地圖，或回報全域地圖修正，本版會要求重新設定原點，避免沿用舊座標基準。
   這與「持續 lost」不同。局部最佳化仍可能造成姿態調整。

記錄 `fps`、`timings_ms.slam`、`inliers`、`map_points`、`orb_state`、`stale_frames`。
`slam` 包含 Python 與容器的傳遞時間；不是只計 C++ TrackMonocular。
保持原有 250 ms 影格年齡預算；核心初始化或負載太高時，過期結果仍不驅動畫面。
單眼尺度仍是 arbitrary，不是公尺。這個接法沒有 IMU，也不能保證在模糊或無紋理場景不 lost。

切回原型：在原 `~/GodEyes-local-slam` 執行 `sh scripts/run-local-slam.sh`；
同時間只啟動其中一版，避免 port 衝突與額外串流負載。

## 接口與可重現性

- ORB-SLAM3 固定於 `4452a3c4ab75b1cde34e5505a36ec3f9edcdc4c4`。
- Pangolin 固定於 `aff6883c83f3fd7e8268a9715e84266c42e2efe3`（v0.8）。
- 上游修改為 C++17 編譯、移除 `-march=native` 與 examples 建置、`Optimizer.cc` 使用 `-O1 -g0`，以及暴露地圖 ID／修正版本，未改動追蹤演算法。
- 上游 ORB-SLAM3 為 GPLv3；Docker image 保留上游原始碼及 LICENSE。
- 校正讀自現有 C270 JSON。Mac 先去畸變，因此 ORB 設定中畸變為零，避免重複校正。
- C++ 回傳 optical camera-to-world（`Tcw.inverse()`），Python 不再翻轉座標軸。
- 原始 capture timestamp 直接送入核心；串流 session 改變或「重建地圖」都會重設核心與輸出 session。
- 原生核心亦可用 `--backend orbslam3 --orb-worker /path/to/godeyes_orb_worker --orb-vocabulary /path/to/ORBvoc.txt` 接入；本次附的是 Linux Docker 建置流程，未提供經驗證的 macOS 原生建置。

## 驗證界線

Python 測試檢查二進位傳輸、時間戳、重設、座標／狀態轉接、地圖版本與失敗處理。
這些使用假的 worker 回覆，不證明 ORB-SLAM3 已在 Mac 編譯成功或追蹤更穩定。
Dockerfile 另外包含**實際原生核心**的詞彙表載入、空白影格與重設冒煙測試；
只有在 Mac `docker build` 跑完該測試後，才算原生核心啟動驗證成功。
目前開發主機是空間不足的 i.MX93，未在此編譯 image；Mac 建置與實際左右轉頭效果待驗證。
