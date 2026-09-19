# GodEyes

## Product Purpose

把現場照片重建成可以親自走進去的 3D Gaussian Splat 空間。使用者上傳 1–4 張同一現場的照片，Codex 產出 Clean Image 與英文 Marble Prompt，World Labs Marble 生成 splat 世界，瀏覽器以 Spark 即時渲染。兩個預建世界永遠可直接開啟，Demo 不必等待生成。

額外的差異點：頭部追蹤驅動的 off-axis 投影。使用者轉頭，視角跟著動，螢幕變成一扇窗而不是一張圖。

## register

brand

Landing（世界資料庫首頁）是 marketing surface，設計本身就是產品說服力的一部分。Builder 與 Explorer 是 product surface，另有規則。

## Users

**主要：Hackathon / Demo 評審。** 停留時間以秒計。他們看過幾十個「AI 生成」的 demo，預設假設是：這東西大概是假的、大概是套殼、大概跑不起來。Landing 唯一的任務是在一次捲動內推翻這個假設，然後把人送進預建世界。

他們不讀 feature list。他們找的是「這是真的跑出來的嗎」的證據。

**次要：** 技術同行與 recruiter，會往下讀 pipeline 與限制。

## Tone

儀器讀數，不是行銷文案。頁面應該像一份拍攝紀錄／測量輸出：數值外露（yaw、pitch、frame index、splat count、解析度）、等寬字承載技術事實、標線與對位記號、單一訊號色。

自信來自精確，不是形容詞。不說「革命性的空間重建」，說「45 視角 · yaw −35°→+35° · pitch ±10°」。

繁體中文為主，技術標籤與數值保持英文／等寬。

## Anti-references

- 一般 AI SaaS 暗色頁：近黑底 + 單一霓虹點綴 + 玻璃卡片 + 漸層標題。目前的 GodEyes landing 正是這個樣板，這次要離開它。
- 英雄數字模板（大數字 + 小標籤 + 三欄統計）。
- 等大卡片網格（icon + 標題 + 兩行字，重複三次）。
- 「AI-powered / 革命性 / 無縫」這類詞。
- 直接抄 dottxt.ai 的配色或版面。參考的是它的紀律（捲動即機制、數值外露、克制），不是它的外觀。

## Strategic Principles

1. **證據優先於主張。** 任何宣稱都要有畫面或數值就地佐證。旋轉區塊之所以有說服力，是因為那 45 張是真的從 splat 算出來的視角，不是示意圖。
2. **不動已驗證的渲染路徑。** Explorer（ThreeView / FaceMeshView / CalibrationWizard）與真正載入 .spz 的流程完全不改。Landing 的效果一律用預算好的影格，絕不在使用者表達意願前吃 GPU 或下載 28–66MB。
3. **誠實的限制。** Marble 不保證精確幾何、未實作碰撞、Clean Image 是衍生視覺化。這些寫在頁面上，不藏起來。對技術評審而言，寫出限制比隱藏限制更可信。
4. **一次捲動到 CTA。** 評審的路徑是：看到旋轉 → 相信 → 點進預建世界。不要在中間插入註冊、導覽或 modal。
