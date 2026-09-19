# 自製 Mac SLAM：320×240 處理解析度

本更新屬於 `vaclisinc/imx-local-slam`，不是板端的 `imx-slam` 原型。
保留 LK、局部地圖、重定位、自動重建、合成影像實驗以及前端旋轉外推。

- 板端 JPEG 串流及校正檔仍是 640×480，Mac 端直接 remap 成 320×240，內參同步縮放。
- `--backend sparse` 預設使用 320×240；`--process-width 480` 是折衷選項；640 可還原。
- 其他外部 SLAM backend 仍保持 640×480，避免與原生 worker 固定設定不符。
- `/status` 顯示 `capture_size` 與 `processing_size`。
- 此修改減少 SLAM 影像運算，不會降低板端 JPEG、USB 或網路流量。縮圖可能降低小特徵和初始化品質。

在 Mac 的舊程序終端按 Ctrl-C，然後：

```sh
scp root@100.86.170.121:/tmp/godeyes-local-slam-resolution-update.tar.gz ~/Downloads/
cd ~/GodEyes-local-slam
tar -xzf ~/Downloads/godeyes-local-slam-resolution-update.tar.gz
sh scripts/run-local-slam.sh --backend sparse --process-width 320
```

如原先有開啟合成影像，加回 `--synthetic-bridge`；原本旋轉外推仍由網頁開關控制。
網址仍為 http://localhost:5182 。此更新包只更新接收處理程式與此說明，不覆蓋前端或既有 SLAM 核心。
