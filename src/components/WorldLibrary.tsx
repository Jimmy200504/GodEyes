import { ArrowRight, Box, Eye, Layers3, Plus } from "lucide-react";
import { isSceneActive, STATUS_LABELS } from "../utils/worldScenes";
import type { WorldScene } from "../utils/worldScenes";

interface WorldLibraryProps {
  scenes: WorldScene[];
  onCreate: () => void;
  onOpen: (scene: WorldScene) => void;
}

function getSceneCaption(id: string): string {
  switch (id) {
    case "bright-truvia":
      return "EXTERIOR / 街道空間";
    case "shared-scene-v2":
      return "INTERIOR / 室內空間";
    default:
      return "YOUR SCENE / 你的現場";
  }
}

export default function WorldLibrary({
  scenes,
  onCreate,
  onOpen,
}: WorldLibraryProps): JSX.Element {
  const activeCount = scenes.filter(
    (scene) => scene.source === "generated" && isSceneActive(scene.status),
  ).length;
  return (
    <main className="page-width library">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="small-line" />
            BEYOND THE FRAME
          </span>
          <h1>
            不只看見現場。
            <br />
            <em>走進現場。</em>
          </h1>
          <p>
            從一張照片，延伸出可以親自探索的空間。
            <br />
            換個角度，讓每一個細節重新被看見。
          </p>
          <button className="primary" onClick={onCreate}>
            <Plus size={18} />
            建立你的世界
            <ArrowRight size={17} />
          </button>
          <div className="hero-meta">
            <span>01 上傳照片</span>
            <i />
            <span>02 整理影像</span>
            <i />
            <span>03 探索世界</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbital-cross horizontal" />
          <div className="orbital-cross vertical" />
          <div className="scene-plane plane-back" />
          <div className="scene-plane plane-front">
            <img src="/scenes/previews/bright-truvia.webp" alt="" />
            <div className="plane-grid" />
            <span className="corner top-left" />
            <span className="corner bottom-right" />
          </div>
          <span className="art-label label-one">
            2D INPUT <span>→</span> 3D WORLD
          </span>
          <span className="art-label label-two">
            <Box size={13} />
            空間，從此展開。
          </span>
          <span className="coordinate">
            PHOTO REFERENCE / SPATIAL DEPTH
            <br />
            PERSPECTIVE · UNLOCKED
          </span>
        </div>
      </section>
      <section className="worlds-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">YOUR WORLD LIBRARY</span>
            <h2>
              選一個世界，開始探索{" "}
              <span>{scenes.length.toString().padStart(2, "0")}</span>
            </h2>
          </div>
          <div className="library-note">
            <span className="status-dot" />
            {activeCount
              ? `${activeCount} 個世界正在背景建立`
              : "預建世界已就緒，無須等待生成"}
          </div>
        </div>
        <div className="world-grid">
          {scenes.map((scene, index) => (
            <button
              className="world-card"
              key={scene.id}
              onClick={() => onOpen(scene)}
            >
              <div className="card-image">
                <img
                  src={scene.thumbnail}
                  alt={scene.name}
                  loading={index < 2 ? "eager" : "lazy"}
                />
                <div className="card-shade" />
                <span className="card-number">
                  WORLD / {String(index + 1).padStart(2, "0")}
                </span>
                <span
                  className={`card-status ${scene.status === "error" ? "error" : ""}`}
                >
                  <span className="status-dot" />
                  {scene.source === "preset"
                    ? "預先生成"
                    : STATUS_LABELS[scene.status]}
                </span>
                <span className="enter-circle">
                  <ArrowRight size={22} />
                </span>
                <span className="image-caption">
                  {getSceneCaption(scene.id)}
                </span>
              </div>
              <div className="card-info">
                <div>
                  <h3>{scene.name}</h3>
                  <p>
                    {scene.description ||
                      (scene.status === "ready"
                        ? "從照片重建的空間，已準備好探索。"
                        : STATUS_LABELS[scene.status])}
                  </p>
                </div>
                <span className="card-type">
                  <Layers3 size={14} />
                  {scene.status === "ready" ? "3D WORLD" : "IN PROGRESS"}
                </span>
              </div>
            </button>
          ))}
          <button className="new-world-card" onClick={onCreate}>
            <span className="new-icon">
              <Plus size={26} />
            </span>
            <h3>下一個世界，由你建立。</h3>
            <p>上傳現場照片，讓空間不再受限於畫框。</p>
            <span className="text-button">
              開始建立
              <ArrowRight size={16} />
            </span>
          </button>
        </div>
      </section>
      <footer className="page-footer">
        <span>
          <Eye size={15} />
          GODEYES <span>讓視角，超越照片。</span>
        </span>
        <span>
          IMAGE BY CODEX <i /> WORLD BY MARBLE
        </span>
      </footer>
    </main>
  );
}
