import { Fragment, lazy, Suspense } from "react";
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
  "bright-truvia": { kind: "REAL CASE", note: "Gregory Bright 與 Earl Truvia 案。" },
  "shared-scene-v2": { kind: "FAKE CASE", note: "虛構室內案件。" },
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
  const cases = scenes.filter(
    (scene) => scene.source === "preset" && scene.id in PLATE_META,
  );
  const firstReady = cases.find((scene) => scene.status === "ready");

  return (
    <main className="page">
      {/* 01 — hero */}
      <section className="band hero">
        <SplatWordmark />

        <div className="hero-body">
          <div className="panel panel-ox hero-claim">
            <h2>
              照片只留下一個視角。
              <span>現場有無數個。</span>
            </h2>
            <p>
              GodEyes 把現場照片重建成可以走進去的空間。戴上裝置走進去，轉頭、前後左右移動，還原當時站在那裡會看見的東西。
            </p>
            <ol className="flow">
              {FLOW.map(([n, , zh], i) => (
                <Fragment key={n}>
                  {i > 0 && (
                    <span className="flow-arrow" aria-hidden="true">
                      →
                    </span>
                  )}
                  <li>
                    <b>{n}</b>
                    {zh}
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
                  直接進入現場
                </button>
              )}
              <button className="keycap keycap-lg" onClick={onCreate}>
                重建你的現場
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

          </div>
        </div>
      </section>

      {/* 02 — orbit */}
      <Suspense
        fallback={
          <div className="orbit-placeholder" role="status">
            正在載入場景預覽…
          </div>
        }
      >
        <OrbitScrub />
      </Suspense>

      {/* 03 — the demo cases */}
      <section className="band" id="library">
        <div className="band-head">
          <h2>走進現場</h2>
        </div>

        <div className="plates">
          {cases.map((scene, index) => {
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
                  <span className="plate-status">
                    {scene.id === "bright-truvia" ? "真實案件" : "虛構案件"}
                  </span>
                </span>
                <span className="plate-body">
                  <strong>{scene.name}</strong>
                  <span>
                    {scene.description || meta.note}
                  </span>
                </span>
                <span className="plate-go">
                  {isReady ? "進入現場" : "檢視進度"} <b>→</b>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <footer className="page-foot">
        <span>GODEYES · 走進現場</span>
      </footer>
    </main>
  );
}
