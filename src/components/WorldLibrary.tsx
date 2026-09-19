import { Fragment, lazy, Suspense } from "react";
import { isSceneActive, STATUS_LABELS } from "../utils/worldScenes";
import type { WorldScene } from "../utils/worldScenes";
import SplatWordmark from "./SplatWordmark";
import DitherRamp from "./DitherRamp";

const OrbitScrub = lazy(() => import("./OrbitScrub"));

interface WorldLibraryProps {
  scenes: WorldScene[];
  onCreate: () => void;
  onOpen: (scene: WorldScene) => void;
}

interface PlateMeta {
  kind: string;
  note: string;
}

const PLATE_META: Record<string, PlateMeta> = {
  "bright-truvia": { kind: "EXTERIOR", note: "街道、建物立面、陰天散射光。" },
  "shared-scene-v2": { kind: "INTERIOR", note: "室內、遺體位置、日光燈。" },
};

function plateMeta(id: string): PlateMeta {
  return PLATE_META[id] ?? { kind: "SUBMITTED", note: "由你上傳的現場照片重建。" };
}

const FLOW = [
  ["01", "CAPTURE", "現場照片"],
  ["02", "CLEAN", "影像整理"],
  ["03", "PROMPT", "英文描述"],
  ["04", "SOLVE", "空間重建"],
  ["05", "ENTER", "走進現場"],
];

export default function WorldLibrary({
  scenes,
  onCreate,
  onOpen,
}: WorldLibraryProps): JSX.Element {
  const ready = scenes.filter((scene) => scene.status === "ready");
  const activeCount = scenes.filter(
    (scene) => scene.source === "generated" && isSceneActive(scene.status),
  ).length;
  const firstReady = ready[0];

  return (
    <main className="page">
      {/* 01 — hero */}
      <section className="band hero">
        <div className="hero-top">
          <span className="tag">01</span>
          <span className="tag-text">現場重建 · SCENE RECONSTRUCTION</span>
        </div>

        <SplatWordmark />

        <div className="hero-body">
          <div className="panel panel-ox hero-claim">
            <h2>
              照片只留下一個視角。
              <span>現場有無數個。</span>
            </h2>
            <p>
              GodEyes 把現場照片重建成 3D Gaussian Splat
              空間。戴上裝置走進去，轉頭、前後左右移動，還原當時站在那裡會看見的東西。
            </p>
            <ol className="flow">
              {FLOW.map(([n, en, zh], i) => (
                <Fragment key={n}>
                  {i > 0 && (
                    <span className="flow-arrow" aria-hidden="true">
                      →
                    </span>
                  )}
                  <li>
                    <b>{n}</b>
                    {zh}
                    <span aria-hidden="true">{en}</span>
                  </li>
                </Fragment>
              ))}
            </ol>

            <div className="hero-actions">
              {firstReady && (
                <button
                  className="keycap keycap-lg"
                  onClick={() => onOpen(firstReady)}
                >
                  直接進入現場 <b>1</b>
                </button>
              )}
              <button className="keycap keycap-lg" onClick={onCreate}>
                重建你的現場 <b>N</b>
              </button>
            </div>
          </div>

          <div className="hero-side">
            <DitherRamp />
            <div className="chip">
              <span className="chip-head">
                <b className="chip-key">!</b> 現場不是證據
              </span>
              <span>
                重建是衍生視覺化。幾何不保證精確、沒有碰撞物理、不做任何推論。判讀一律回到原始照片。
              </span>
            </div>
            <div className="terminal">
              <span className="terminal-bar">
                <i />
                <i />
                <i />
              </span>
              <pre>
{`$ godeyes status
scenes   ${String(scenes.length).padStart(2, "0")} ready
method   3d gaussian splatting
input    codex clean image
solver   world labs marble
render   webgl2 · spark
control  head pose + translation`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* 02 — orbit */}
      <Suspense
        fallback={
          <div className="orbit-placeholder" role="status">
            正在準備預算視角…
          </div>
        }
      >
        <OrbitScrub />
      </Suspense>

      {/* 03 — the demo cases */}
      <section className="band" id="library">
        <div className="band-head">
          <span className="tag">03</span>
          <h2>走進現場</h2>
          <span className="band-note">
            {activeCount
              ? `${activeCount} 個現場正在背景重建`
              : "兩個預建現場已就緒，不需要 API key，不需要等待生成"}
          </span>
        </div>

        <div className="plates">
          {scenes.map((scene, index) => {
            const meta = plateMeta(scene.id);
            const isReady = scene.status === "ready";
            return (
              <button
                className="plate"
                key={scene.id}
                onClick={() => onOpen(scene)}
              >
                <span className="plate-img">
                  <img
                    src={scene.thumbnail}
                    alt={`${scene.name} 的重建預覽`}
                    loading={index < 2 ? "eager" : "lazy"}
                  />
                </span>
                <span className="plate-meta">
                  <span className="tag">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="plate-kind">{meta.kind}</span>
                  <span className="plate-status">
                    {scene.source === "preset"
                      ? "預建"
                      : STATUS_LABELS[scene.status]}
                  </span>
                </span>
                <span className="plate-body">
                  <strong>{scene.name}</strong>
                  <span>
                    {scene.description ||
                      (isReady ? meta.note : STATUS_LABELS[scene.status])}
                  </span>
                </span>
                <span className="plate-go">
                  {isReady ? "進入現場" : "檢視進度"} <b>→</b>
                </span>
              </button>
            );
          })}

          <button className="plate plate-add" onClick={onCreate}>
            <span className="plate-add-mark">+</span>
            <span className="plate-body">
              <strong>重建你的現場</strong>
              <span>
                上傳同一現場的 1–4 張照片。Codex 產出 Clean Image 與 Prompt，
                Marble 生成世界。
              </span>
            </span>
            <span className="plate-go">
              開始 <b>→</b>
            </span>
          </button>
        </div>
      </section>

      <footer className="page-foot">
        <span>GODEYES · 走進現場</span>
        <span>IMAGE BY CODEX · WORLD BY MARBLE · RENDER BY SPARK</span>
      </footer>
    </main>
  );
}
