# 照片 → Clean Image + Marble Prompt

```bash
./case-to-scene.sh --image room.jpg --name my-world
./case-to-scene.sh --image front.jpg --image side.png --name my-world --prepare-only
./case-to-scene.sh --validate case-runs/執行資料夾
```

只接受照片，不接受口供。輸入應為同一現場，保留所有人物、物件、障礙物與格局；清理僅改善畫質、光線與明顯攝影失真，不將現場清空。

輸出 `generated/scene.png`、`generated/imagegen-prompt.txt`、`WORLD_MODEL_PROMPT.md`、`manifest.json`，以及 Codex 的日誌與差異說明。內建 imagegen 不可用或照片不能融合時明確回報未完成。每次執行建立新目錄，不覆蓋舊結果。

需要 Python 3.9+ 及已登入、可使用 imagegen 的 Codex CLI。`--prepare-only` 不產生圖片；`--validate` 僅驗證產物與階段宣告，不證明視覺或幾何準確性。
