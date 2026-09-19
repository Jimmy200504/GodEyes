import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  ImagePlus,
  Loader2,
  Maximize2,
  RotateCcw,
  ScanLine,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  isSceneActive,
  sceneMessage,
  sceneStage,
  STATUS_LABELS,
  WorldScene,
} from "../utils/worldScenes";
function stepClassName(current: number, index: number): string {
  if (current === index) return "current";
  if (current > index) return "complete";
  return "";
}

function JobSymbol({ scene }: { scene: WorldScene }): JSX.Element {
  if (isSceneActive(scene.status))
    return <Loader2 className="spin" size={22} />;
  if (scene.status === "ready") return <Check size={22} />;
  return <ScanLine size={22} />;
}

interface SceneBuilderProps {
  scene?: WorldScene;
  online: boolean;
  onBack: () => void;
  onScene: (scene: WorldScene) => void;
  onExplore: (scene: WorldScene) => void;
}
export default function SceneBuilder({
  scene,
  online,
  onBack,
  onScene,
  onExplore,
}: SceneBuilderProps): JSX.Element {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(scene?.prompt || "");
  const [zoom, setZoom] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null);
  const active = !!scene && isSceneActive(scene.status);
  useEffect(() => {
    setPrompt(scene?.prompt || "");
  }, [scene?.id, scene?.prompt]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);
  useEffect(() => {
    if (!zoom) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [zoom]);
  function addFiles(incoming: File[]): void {
    if (
      incoming.some(
        (file) =>
          !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
          file.size > 20 * 1024 * 1024,
      )
    ) {
      setError("請使用 PNG、JPEG 或 WebP，每張不超過 20 MB。");
      return;
    }
    if (files.length + incoming.length > 4) {
      setError("一次最多 4 張照片，請選擇同一個現場。");
      return;
    }
    setFiles((current) => [...current, ...incoming]);
    setError("");
  }
  async function submit(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.set("name", name.trim());
      files.forEach((file) => data.append("images", file));
      onScene(
        await api<WorldScene>("/api/scenes", { method: "POST", body: data }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳失敗，請重試");
    } finally {
      setBusy(false);
    }
  }
  async function generate(retry = false): Promise<void> {
    if (!scene) return;
    setBusy(true);
    setError("");
    try {
      onScene(
        await api<WorldScene>(
          `/api/scenes/${scene.id}/${retry ? "retry" : "world"}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: retry ? undefined : JSON.stringify({ prompt }),
          },
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "送出失敗，請重試");
    } finally {
      setBusy(false);
    }
  }
  const stage = sceneStage(scene);
  const elapsed = scene?.createdAt
    ? Math.max(0, Math.floor((clock - Date.parse(scene.createdAt)) / 1000))
    : 0;
  return (
    <main className="builder page-width">
      <button className="text-button back" onClick={onBack}>
        <ArrowLeft size={16} />
        世界資料庫
      </button>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SCENE STUDIO / 場景工作台</span>
          <h1>{scene?.name || "讓照片，成為一個世界。"}</h1>
          <p>保留現場每個人物與物件，讓平面的細節成為可探索的空間。</p>
        </div>
        <span className="outline-tag">照片 → 空間</span>
      </div>
      <ol className="steps">
        {["上傳照片", "整理影像", "生成世界", "開始探索"].map((label, i) => (
          <li key={label} className={stepClassName(stage, i)}>
            <span>{stage > i ? <Check size={15} /> : `0${i + 1}`}</span>
            {label}
          </li>
        ))}
      </ol>
      {!scene ? (
        <div className="upload-layout">
          <section className="panel upload-panel">
            <div className="section-title">
              <span>01</span>
              <h2>現場的第一個視角</h2>
            </div>
            <label className="field-label" htmlFor="scene-name">
              世界名稱
            </label>
            <input
              id="scene-name"
              className="text-input"
              placeholder="例如：街角現場・午後"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="sr-only"
              onChange={(e) => {
                addFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={`drop-zone ${dragging ? "dragging" : ""}`}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <span className="upload-icon">
                <Upload size={25} />
              </span>
              <strong>將現場照片拖曳到這裡</strong>
              <span>或點擊選擇檔案</span>
              <small>PNG / JPG / WEBP · 每張 20 MB · 最多 4 張</small>
            </button>
            {files.length > 0 && (
              <div className="file-grid">
                {files.map((file, i) => (
                  <div key={`${file.name}-${i}`}>
                    <img src={previews[i]} alt={file.name} />
                    <span>{file.name}</span>
                    <button
                      aria-label={`移除 ${file.name}`}
                      onClick={() =>
                        setFiles((current) => current.filter((_, n) => n !== i))
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="form-bottom">
              <span>
                {files.length
                  ? `${files.length} 張照片已準備好`
                  : "請上傳同一個現場的照片"}
              </span>
              <button
                className="primary"
                disabled={!files.length || !name.trim() || busy || !online}
                onClick={() => void submit()}
              >
                {busy ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <ScanLine size={16} />
                )}
                整理現場影像
                <ArrowRight size={16} />
              </button>
            </div>
          </section>
          <aside className="guide-panel">
            <span className="eyebrow">FROM IMAGE TO IMMERSION</span>
            <h2>
              你提供現場，
              <br />
              我們打開空間。
            </h2>
            <div className="guide-line">
              <ImagePlus size={21} />
              <div>
                <h3>保留現場內容</h3>
                <p>人物、物件與位置保持一致，改善影像清晰度及光線。</p>
              </div>
            </div>
            <div className="guide-line">
              <ScanLine size={21} />
              <div>
                <h3>先檢視，再生成</h3>
                <p>比較原圖與 Clean Image，確認送入 Marble 的場景描述。</p>
              </div>
            </div>
            <div className="guide-foot">
              生成需要時間。你可以隨時回到世界資料庫，探索已完成的場景。
            </div>
          </aside>
        </div>
      ) : (
        <>
          <div
            className={`job-banner ${scene.status === "error" ? "failed" : ""}`}
            role="status"
          >
            <div className="job-symbol">
              <JobSymbol scene={scene} />
            </div>
            <div>
              <strong>{STATUS_LABELS[scene.status]}</strong>
              <p>{sceneMessage(scene)}</p>
            </div>
            {active && (
              <span className="elapsed">
                {Math.floor(elapsed / 60)} 分 {elapsed % 60} 秒
              </span>
            )}
            {scene.status === "ready" && (
              <button className="primary" onClick={() => onExplore(scene)}>
                進入探索
                <ArrowRight size={16} />
              </button>
            )}
            {scene.canRetry && (
              <button
                className="secondary"
                disabled={busy || !online}
                onClick={() => void generate(true)}
              >
                <RotateCcw size={16} />
                接續任務
              </button>
            )}
          </div>
          <div className="comparison">
            <section className="panel image-panel">
              <div className="image-heading">
                <h2>Real Scene</h2>
                <span>原始現場</span>
              </div>
              <div className="reference-grid">
                {scene.images?.map((url, i) => (
                  <button key={url} onClick={() => setZoom(url)}>
                    <img src={url} alt={`現場原圖 ${i + 1}`} />
                    <Maximize2 size={17} />
                  </button>
                ))}
              </div>
            </section>
            <section className="panel image-panel">
              <div className="image-heading">
                <h2>Clean Scene</h2>
                <span>Codex 整理影像</span>
              </div>
              {scene.cleanImage ? (
                <div className="reference-grid">
                  <button onClick={() => setZoom(scene.cleanImage!)}>
                    <img
                      src={scene.cleanImage}
                      alt="保留人物與物件的 Clean Image"
                    />
                    <Maximize2 size={17} />
                  </button>
                </div>
              ) : (
                <div className="image-placeholder">
                  <ScanLine size={38} />
                  <strong>
                    {scene.status === "error"
                      ? "尚未產生影像"
                      : "正在整理空間細節"}
                  </strong>
                  <span>保持人物、物件與現場格局</span>
                </div>
              )}
            </section>
          </div>
          {scene.cleanImage && (
            <div className="artifact-bar">
              <span>原圖與生成圖分開保存，隨時可對照。</span>
              <a
                className="text-button"
                href={scene.cleanImage}
                download="clean-scene.png"
              >
                <Download size={15} />
                下載影像
              </a>
            </div>
          )}
          {!!scene.prompt && (
            <details
              className="panel prompt-panel"
              open={scene.status === "review"}
            >
              <summary>
                World generation prompt <span>英文場景描述</span>
                <ChevronDown size={18} />
              </summary>
              <textarea
                aria-label="Marble 場景描述"
                value={prompt}
                readOnly={scene.status !== "review"}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <div className="prompt-footer">
                <a
                  className="text-button"
                  href={`/api/scenes/${scene.id}/assets/WORLD_MODEL_PROMPT.md`}
                  download
                >
                  <Download size={15} />
                  下載 Codex Prompt
                </a>
                {scene.status === "review" && (
                  <button
                    className="primary"
                    disabled={busy || !online || !prompt.trim()}
                    onClick={() => void generate()}
                  >
                    {busy ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <ScanLine size={16} />
                    )}
                    生成 3D 世界
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </details>
          )}
        </>
      )}
      {(!online || error) && (
        <div className="error-message" role="alert">
          {error ||
            "本機生成服務未連線；請執行 npm run dev。既有世界仍可探索。"}
        </div>
      )}
      {zoom && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="放大影像"
          onClick={() => setZoom(null)}
        >
          <button
            autoFocus
            className="icon-button"
            aria-label="關閉放大影像"
            onClick={() => setZoom(null)}
          >
            <X />
          </button>
          <img
            src={zoom}
            alt="放大的現場影像"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </main>
  );
}
