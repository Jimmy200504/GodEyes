# i.MX93 NPU 模型準備

Worktree：`/root/GodEyes-worktrees/imx-npu-models`；branch：`vaclisinc/imx-npu-models`，從 `d8e7d2c` 建立。
本次將「Model Cloud」按 NXP eIQ Model Zoo / GoPoint 的公開模型來源處理，沒有使用需登入的雲端帳戶。

| 用途 | 已下載模型 | 來源與注意事項 |
|---|---|---|
| 手掌 | BlazePalm Full INT8，192×192 | NXP GoPoint；原始檔及本機 Vela 版本 |
| 手部骨架 | Hand Landmark Full INT8，224×224 | NXP GoPoint；21 個手部關鍵點、左右手及信心分數 |
| 手勢分類 | Keypoint classifier，42 維輸入 | NXP GoPoint；Open / Close / Point；小型 MLP 依官方範例跑 CPU |
| 物件辨識 | YOLOv4-Tiny，416×416，COCO 80 類 | NXP eIQ Model Zoo v1.1；FP32、INT8 及本機 Vela 版本；須另做框解碼與 NMS |
| 深度 | MiDaS v2 Small，256×256 | PINTO `081_MiDaS_v2` 的量化候選：float I/O 與 full-integer I/O；NXP 支援同系列 MiDaS，但此量化權重並非 NXP 發布、尚未驗證精度 |

## 手勢控制應用

目前使用張掌前進、食指指向平移／升降、握拳或收手停止的簡易控制，不需校正，暫不提供後退與手勢旋轉，啟動與操作見 [GESTURE_CONTROL.md](GESTURE_CONTROL.md)。已驗證板上 NPU 載入與 15 張真實相機影格推論；真人手勢準確度與操作體感仍待驗證。

## 準備結果

手掌、手部骨架及 YOLO 本機 Vela 編譯成功。MiDaS 兩個量化原始檔已下載並可由本機 TFLite 載入；full-integer 版本的 Vela 編譯遭 Linux OOM killer 終止（exit -9，程序 RSS 約 792 MiB，板上總 RAM 約 1.9 GiB），因此尚無本機 MiDaS Vela 產物。下一步可在記憶體較多的主機執行下方命令，再將產物帶回板上驗證。

## 檔案

- `models/gesture/`、`models/object-detection/`、`models/depth/`：模型實體；手勢與 YOLO 的 `vela/` 為本機 Vela 4.4.1、`ethos-u65-256` 產物。
- `sources.json`：原始下載 URL、tar member、檔案大小、SHA256；手勢另外核對了板上 GoPoint 清單的 SHA1。
- `inventory.json`：實際 TFLite 輸入輸出形狀、型別、量化參數及所有模型 SHA256。
- `reports/`：Vela 編譯輸出。算子配置是編譯結果，不代表實測效能或全模型都跑 NPU。
- `references/`：NXP 前後處理範例、手掌 anchors、模型說明及授權資訊；保留來源原文，未改造為本專案的執行管線。
- `legacy/`：NXP v1.1 預編譯 YOLO Vela 檔，本機 TFLite 2.19 載入會報 `Tensor 7 is invalidly specified in schema`，僅留作來源紀錄，請用重新編譯的 `models/object-detection/vela/`。

重新下載原始模型（會先驗證已存在檔案）：

```sh
python3 npu/fetch_models.py
python3 npu/inspect_models.py
```

重新編譯單一量化模型：

```sh
vela npu/models/depth/tflite_from_saved_model__model_full_integer_quant.tflite \
  --accelerator-config=ethos-u65-256 --output-dir npu/models/depth/vela
```

板上已找到 `/dev/ethosu0`、`/usr/lib/libethosu_delegate.so`。後續手勢整合已完成 Vela 模型載入及 15 張真實相機影格推論測試（當時無手入鏡）；尚未驗證真人手勢準確度、有手時端到端 FPS 或多用途模型並行效能，詳見手勢控制指南。

## 後續融合時需要確認

MiDaS 輸出相對深度／逆深度，不能直接當公尺距離。手部 landmark 的 z 也不等於相機座標的公尺值。先確認 PINTO 權重的 normalization 與效果，再與相機標定、既有 ArUco/PnP 座標對齊。
共享同一張相機影格時，保留 timestamp、原始解析度、resize/crop 轉換，才能將手部位置、物件框及深度圖投回同一座標系。後續再測 NPU 排程與各模型更新率。

## 公開來源

- [NXP GoPoint 手勢範例](https://github.com/nxp-imx-support/nxp-demo-experience/tree/lf-6.18.2_1.0.0/scripts/machine_learning/imx_gesture_recognition)
- [NXP YOLOv4-Tiny](https://github.com/NXP/eiq-model-zoo/tree/main/tasks/vision/object-detection/yolov4tiny)
- [NXP MiDaS](https://github.com/NXP/eiq-model-zoo/tree/main/tasks/vision/monocular-depth-estimation/midas)
- [NXP i.MX93 NPU 支援矩陣](https://github.com/nxp-imx/nxp-nnstreamer-examples/blob/main/tasks/README.md)
- [MiDaS 量化權重來源](https://github.com/PINTO0309/PINTO_model_zoo/tree/main/081_MiDaS_v2)

原始模型與參考程式遵循各自上游授權；本專案沒有替它們重新授權。大型二進位檔保留在本機並由 `.gitignore` 排除。
