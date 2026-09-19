> 此實驗路線已停止；目前使用 [自製 OpenCV＋LK 版](SLAM.md)。以下僅保留建置紀錄。

# stella_vslam：Apple Silicon Mac 試跑

沿用 i.MX93 → JPEG/WebSocket → Mac 去畸變 → 本機 SLAM → 原網頁。
stella_vslam 0.7.0 原生執行，無 Docker、Pangolin 或 ROS viewer。
使用者的 Mac 是 arm64、16 GiB RAM、Homebrew `/opt/homebrew/bin/brew`。
橋接與傳輸回歸測試在板端執行；**尚未在該 Mac 完成 C++ 建置或驗證追蹤效果**。

## 在 Mac 執行

先 Ctrl-C 停掉上一版的本機 SLAM；Docker Desktop 可關閉。
更新既有 `~/GodEyes-local-slam`（不含相機校正檔，不覆蓋你的校正）：

```sh
scp root@100.86.170.121:/tmp/godeyes-stella-update.tar.gz ~/Downloads/
cd ~/GodEyes-local-slam
tar -xzf ~/Downloads/godeyes-stella-update.tar.gz
bash scripts/setup-stella-mac.sh && sh scripts/run-stella-slam.sh
```

需要 Xcode Command Line Tools、Python 3.10+、既有 Node.js 環境、至少 8 GiB 可用磁碟。
若 `xcrun` 顯示缺少開發工具，先執行 `xcode-select --install` 並完成系統安裝視窗，再重跑 setup。
套件下載與首次編譯需要時間；腳本預設 `BUILD_JOBS=1`，保留完整日誌於 `.stella/logs/setup-*.log`。
建置失敗會立即停止，日誌保留真正的編譯錯誤，不會接著啟動網頁。
可重跑相同 setup，利用既有來源與增量編譯結果。

setup 最後會以**真正編譯的 worker＋FBoW 詞彙**驗證啟動、空白影格、reset、shutdown。
這只檢查安裝及協定能否工作，空白影格不應 tracking，**不是追蹤精度驗證**。
launch 延用 SSH tunnel、localhost:5182 網頁，Ctrl-C 關閉本次程序。
板端不用更新或重新編譯，i.MX93 不跑 stella。

## 第一次追蹤

1. 先對著有紋理、有不同深度的環境，緩慢橫移相機以初始化；只站在原地旋轉通常不足以建立單目地圖。
2. 看到 `tracking` 後，在網頁重設觀看原點，先小幅左右轉，再逐步擴大範圍。
3. Lost 時先轉回先前建圖的位置，觀察是否自行恢復。重設地圖會清掉重新定位依據，別每次 lost 就按。
4. 比較 `http://localhost:8866/status` 的 `backend: stella-vslam`、`stella_state`、
   `fps`、`map_points`、`inliers`、`timings_ms.slam`，分辨追蹤失敗與計算太慢。

追蹤狀態直接取自 stella 的 Initializing／Tracking／Lost，Lost 不會重用舊 pose 假裝 tracking。
地圖重新初始化會更換 map epoch，網頁可能要求重新設定觀看原點。
Loop closure 的座標修正仍可能造成視角跳動，目前未做平滑。
超過既有 250 ms 新鮮度門檻的影格仍會被丟棄；後端逾時會報錯並結束，不會無限等待。

純單目仍是任意尺度，沒有 IMU，快速轉頭模糊、低紋理及畫面重疊不足仍可能失敗。
這次換成完整 SLAM 後端；能改善多少，要看 Mac 實測的 lost／恢復次數與延遲。
stella 的特徵密度採 upstream `Preprocessing.min_size=800`，不使用 sparse/ORB-SLAM3 的 `--features` 參數。

## 建置內容與清理

固定 stella commit `525231147319bcd31242f981078c36d9272727b4`，及其 FBoW/tinycolormap submodules；
g2o `e8df2004e07ea8f5b8e6a8b9f2dc067b45b45036`，Eigen 3.4.0。
OpenCV、yaml-cpp、SuiteSparse、libomp、SQLite、CMake、Ninja 使用 Homebrew bottles；
不使用可能缺少 CSparse solver 的 Homebrew g2o，也不讓新版 Eigen 5 替代此建置的 Eigen 3.4。
OpenMP 明確指定 Homebrew libomp，關閉 x86 SIMD 編譯選項，C++17 與 CMake 相容設定由腳本處理。
Homebrew 套件版本依本機套件庫而定，並非整套 binary lock。

所有自行下載來源、詞彙、編譯物與日誌集中於專案 `.stella/`。
停掉程序後，刪除該目錄即可移除 stella 的本機建置；共用 Homebrew 套件不會被自動移除。
舊 ORB-SLAM3 的清理仍依 [SLAM.md](SLAM.md) 的範圍限定腳本處理。

官方來源：[stella_vslam](https://github.com/stella-cv/stella_vslam)、
[安裝指南](https://stella-cv.readthedocs.io/en/stable/installation.html)。
