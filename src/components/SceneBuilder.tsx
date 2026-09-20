import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Download, Loader2, Plus, X } from "lucide-react";
import BoardBackdrop, { type BoardBackdropHandle } from "./BoardBackdrop";
import { api, sceneStage, WORLD_SCENES, type WorldScene } from "../utils/worldScenes";
import "./SceneBuilder.css";

interface Props {
  scene?: WorldScene;
  online: boolean;
  onBack: () => void;
  onScene: (scene: WorldScene) => void;
  onExplore: (scene: WorldScene) => void;
}

export default function SceneBuilder({ scene, online, onBack, onScene, onExplore }: Props): JSX.Element {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(scene?.prompt || "");
  const [dragging, setDragging] = useState(false);
  const [wallError, setWallError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const steps = useRef<(HTMLElement | null)[]>([]);
  const wall = useRef<BoardBackdropHandle | null>(null);
  const stage = Math.min(sceneStage(scene), 2);
  const scanning = scene?.status === "queued" || scene?.status === "cleaning";
  const building = scene?.status === "generating" || scene?.status === "downloading";
  const images = scene?.images || previews;

  useEffect(() => { setPrompt(scene?.prompt || ""); }, [scene?.id, scene?.prompt]);
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);
  useEffect(() => {
    if (stage > 0) steps.current[stage]?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [stage]);

  function addFiles(incoming: File[]): void {
    if (incoming.some((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024)) {
      setError("請選 PNG、JPG 或 WebP，每張不超過 20 MB。");
    } else if (files.length + incoming.length > 4) {
      setError("最多 4 張同一現場的照片。");
    } else {
      setFiles((current) => [...current, ...incoming]); setError("");
    }
  }
  async function submit(): Promise<void> {
    setBusy(true); setError("");
    try {
      const data = new FormData();
      const name = description.trim().split("\n")[0] || files[0]?.name.replace(/\.[^.]+$/, "").trim() || "新現場";
      data.set("name", name.slice(0, 80));
      data.set("description", description.trim());
      files.forEach((file) => data.append("images", file));
      onScene(await api<WorldScene>("/api/scenes", { method: "POST", body: data }));
    } catch (err) { setError(err instanceof Error ? err.message : "上傳失敗，請重試。"); }
    finally { setBusy(false); }
  }
  async function generate(retry = false): Promise<void> {
    if (!scene) return;
    setBusy(true); setError("");
    try {
      onScene(await api<WorldScene>(`/api/scenes/${scene.id}/${retry ? "retry" : "world"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: retry ? undefined : JSON.stringify({ prompt }),
      }));
    } catch (err) { setError(err instanceof Error ? err.message : "送出失敗，請重試。"); }
    finally { setBusy(false); }
  }
  return (
    <main className="scene-flow" aria-label="場景工作台">
      <div className="flow-toolbar">
        <button onClick={onBack}><ArrowLeft size={16} />檔案庫</button>
        <nav aria-label="流程步驟">{["上傳", "影像", "空間"].map((label, index) => (
          <button key={label} aria-current={stage === index ? "step" : undefined} onClick={() => steps.current[index]?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}><span>0{index + 1}</span>{label}</button>
        ))}</nav>
      </div>
      <section className="flow-sheet flow-input" ref={(element) => { steps.current[0] = element; }} aria-label="上傳文字與現場照片">
        <div className="flow-caption"><span>01 / 現場</span><span>文字 + 照片</span></div>
        <div className="flow-input-grid">
          <label className="flow-description"><span>現場描述</span>
            <textarea placeholder="寫下現場的格局、物件與補充資訊…" maxLength={6000} value={scene?.description ?? description} readOnly={!!scene || busy} onChange={(event) => setDescription(event.target.value)} />
            <small>{scene ? scene.name : "選填"}</small>
          </label>
          <div className="flow-photos">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple tabIndex={-1} className="sr-only" onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.target.value = ""; }} />
            {images.length > 0 && <div className="flow-thumbnails">{images.map((url, index) => (
              <div key={url}><img src={url} alt={`現場照片 ${index + 1}`} />{!scene && <button disabled={busy} aria-label={`移除照片 ${index + 1}`} onClick={() => setFiles((current) => current.filter((_, n) => n !== index))}><X size={16} /></button>}</div>
            ))}</div>}
            {!scene && <button disabled={busy || files.length >= 4} className={`flow-drop ${dragging ? "is-dragging" : ""}`} onClick={() => input.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); if (!busy) addFiles(Array.from(event.dataTransfer.files)); }}>
              <Plus size={28} strokeWidth={1} /><span>{files.length ? "加入照片" : "放入現場照片"}</span><small>PNG / JPG / WEBP · 最多 4 張 · 每張 20 MB</small>
            </button>}
          </div>
        </div>
        <div className="flow-bottom"><span>2D → 3D</span>{!scene && <button className="flow-action" disabled={!files.length || busy || !online} onClick={() => void submit()}>{busy && <Loader2 size={16} className="spin" />}{busy ? "上傳中" : "開始"}<ArrowRight size={18} /></button>}</div>
      </section>
      <section className="flow-sheet flow-image" ref={(element) => { steps.current[1] = element; }} aria-label="Codex 整理影像">
        <div className="flow-caption"><span>02 / 影像</span><span role="status">{scanning ? "Codex 處理中" : scene?.cleanImage ? "影像已就緒" : "等待照片"}</span></div>
        <div className={`flow-scan ${scanning ? "is-scanning" : ""}`} aria-busy={scanning}>
          {(scene?.cleanImage || images[0]) ? <img src={scene?.cleanImage || images[0]} alt={scene?.cleanImage ? "Codex 產出的中間影像" : "等待處理的現場照片"} /> : <span className="flow-empty">上傳後，照片會在這裡處理。</span>}
          {scanning && <><span className="flow-scan-line" aria-hidden="true" /><span className="flow-loading"><Loader2 size={16} className="spin" />整理影像與 prompt…</span></>}
        </div>
        {scene?.prompt && <details className="flow-prompt"><summary>World Model prompt</summary>
          <textarea aria-label="World Model prompt" value={prompt} readOnly={scene.status !== "review" || busy} onChange={(event) => setPrompt(event.target.value)} />
          <a href={`/api/scenes/${scene.id}/assets/WORLD_MODEL_PROMPT.md`} download><Download size={14} />下載 prompt</a>
        </details>}
        <div className="flow-bottom"><span>{scene?.cleanImage ? "衍生影像，非驗證證據" : "照片 → 中間影像 + prompt"}</span>
          {scene?.status === "review" && <button className="flow-action" disabled={busy || !online || !prompt.trim()} onClick={() => void generate()}>{busy && <Loader2 className="spin" size={16} />}生成空間<ArrowRight size={18} /></button>}
          {scene?.cleanImage && <a href={scene.cleanImage} download><Download size={16} />下載影像</a>}
        </div>
      </section>
      <section className="flow-sheet flow-world" ref={(element) => { steps.current[2] = element; }} aria-label="World Model 生成空間">
        <div className="flow-caption"><span>03 / 空間</span><span role="status">{scene?.status === "ready" ? "已完成" : building ? "World Model 生成中" : "等待影像"}</span></div>
        <div className="flow-world-view" onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); wall.current?.aim((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1); }} onPointerLeave={() => wall.current?.aim(0, 0)}>
          {(building || scene?.status === "ready") && <BoardBackdrop scene={scene?.status === "ready" ? scene : WORLD_SCENES[0]} handleRef={wall} onStatus={(status) => setWallError(status === "error")} />}
          {building ? <div className="flow-world-status" role="status"><Loader2 className="spin" size={22} /><span>{scene?.status === "downloading" ? "正在儲存空間…" : "正在生成空間…"}</span><small>背景為既有場景預覽</small></div>
            : scene?.status === "ready" ? <button className="flow-action flow-explore" onClick={() => onExplore(scene)}>進入現場<ArrowRight size={18} /></button>
              : <span className="flow-empty">影像準備好後，即可生成空間。</span>}
          {wallError && <span className="flow-render-note">背景預覽未載入</span>}
        </div>
        <div className="flow-bottom"><span>{building ? "可以離開，進度會保留。" : "影像 + prompt → 空間"}</span><span>World Model</span></div>
      </section>
      {(!online || error || scene?.status === "error") && <div className="flow-error" role="alert"><span>{error || scene?.error || "生成服務未連線，請啟動 npm run dev 後重試。"}</span>{scene?.canRetry && <button className="flow-action" disabled={busy || !online} onClick={() => void generate(true)}>重試<ArrowRight size={16} /></button>}</div>}
    </main>
  );
}
