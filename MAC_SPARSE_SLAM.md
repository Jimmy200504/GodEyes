# 整合版入口：SLAM ＋手勢 NPU

本 worktree 已合併此 SLAM 版本並加入手勢。**板端用 `--dual-stream` 提供 SLAM 灰階與手勢彩色串流，另啟動 `npu/gesture_server.py`；Mac 執行下方啟動腳本。** Mac SLAM 仍自行轉灰階、以 320×240 運算。完整操作見 [SLAM ＋手勢指南](npu/GESTURE_CONTROL.md)。

```sh
sh scripts/run-local-slam.sh --backend sparse --process-width 320
```

目前腳本同時轉發相機 8781 → 18781 與手勢 8782 → 18782。下方是合併前的純 SLAM 紀錄；舊壓縮包不包含整合後手勢功能，灰階相機指令仍可沿用。

---

# 正確入口：板端黑白影像 → Mac 自製 SLAM

**i.MX93 只做 USB 相機擷取、灰階 JPEG 編碼與 WebSocket 傳送。**
**Mac 執行 `--backend sparse` 自製 SLAM，以及 GodEyes 網頁服務；瀏覽器在 Mac 渲染。**
不是 `/root/GodEyes-worktrees/imx-slam` 板端原型，也不是 ORB-SLAM3 / stella / pySLAM backend。

自製核心保留 ORB＋LK、關鍵影格／備份視角恢復、局部地圖、地圖點品質管理、失追自動重建、合成中間影像實驗。網頁保留最多 100 ms 旋轉外推開關。仍沒有完整 BA／閉環校正。

板端已啟動：

```sh
python3 pose/frame_stream.py --camera /dev/video2 --host 127.0.0.1 --port 8781 --grayscale
```

串流影像維持校正解析度 640×480；Mac 去畸變與縮圖後，以 320×240 執行 SLAM。
這樣不改變相機視野和原本的串流协议；縮圖同步縮放內參。`/status` 可確認 `processing_size`。

Mac 先 Ctrl-C 關掉舊版，再更新：

```sh
scp root@100.86.170.121:/tmp/godeyes-mac-sparse-slam-320.tar.gz ~/Downloads/
mkdir -p ~/GodEyes-local-slam
cd ~/GodEyes-local-slam
tar -xzf ~/Downloads/godeyes-mac-sparse-slam-320.tar.gz
sh scripts/run-local-slam.sh --backend sparse --process-width 320 --synthetic-bridge
```

此腳本建立 SSH tunnel（Mac 18781 → 板端 8781），在 **Mac** 啟動 SLAM 接收器與 5182 網頁，並自動開啟 http://localhost:5182 。
需要 Python 3.10+、Node.js 20.19+/22.12+，首次安裝依賴需要網路。
啟動會重新建置當前前端，避免沿用其他版本的 dist。旋轉外推仍需要在頁面勾選。

欲比較影像尺寸，可用 `--process-width 480` 或 `640`。合成影像若增加負擔，可移除 `--synthetic-bridge`；光流、局部地圖與自動重建仍保留。
