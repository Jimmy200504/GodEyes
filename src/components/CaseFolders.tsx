import type { WorldScene } from "../utils/worldScenes";
import { STATUS_LABELS } from "../utils/worldScenes";

/**
 * The archive, as a drawer of kraft folders.
 *
 * Each scene is a file: a tab with its class, a label with its name, and the
 * print sticking out of the pocket. Opening one goes straight into the scene.
 */

interface CaseFoldersProps {
  scenes: WorldScene[];
  onOpen: (scene: WorldScene) => void;
  onCreate: () => void;
}

interface CaseKind {
  tab: string;
  kicker: string;
}

const KIND: Record<string, CaseKind> = {
  "shared-scene-v2": { tab: "FAKE CASE", kicker: "虛構案件 · 視線推理" },
  "bright-truvia": { tab: "REAL CASE", kicker: "真實案件 · 著名冤獄" },
};

function caseKind(scene: WorldScene): CaseKind {
  return KIND[scene.id] ?? { tab: "SUBMITTED", kicker: "你提交的現場" };
}

export default function CaseFolders({
  scenes,
  onOpen,
  onCreate,
}: CaseFoldersProps): JSX.Element {
  return (
    <section className="band band-archive" id="library">
      <div className="band-head">
        <h2>檔案庫</h2>
        <span className="band-note">{scenes.length} FILES</span>
      </div>

      <div className="folders">
        {scenes.map((scene, index) => {
          const kind = caseKind(scene);
          return (
            <button
              className="folder"
              key={scene.id}
              style={{ "--i": index % 3 } as React.CSSProperties}
              onClick={() => onOpen(scene)}
            >
              <span className="folder-tab">{kind.tab}</span>
              <span className="folder-body">
                <span className="folder-print">
                  <img
                    src={scene.thumbnail}
                    alt={`${scene.name} 的重建預覽`}
                    loading="lazy"
                  />
                </span>
                <span className="folder-kicker">{kind.kicker}</span>
                <strong className="folder-name">{scene.name}</strong>
                <span className="folder-note">
                  {scene.description || "由你上傳的現場照片重建。"}
                </span>
                <span className="folder-foot">
                  <span className="folder-state">
                    {STATUS_LABELS[scene.status]}
                  </span>
                  <span className="folder-go">
                    {scene.status === "ready" ? "開啟檔案" : "檢視進度"} <b>→</b>
                  </span>
                </span>
              </span>
            </button>
          );
        })}

        <button className="folder folder-new" onClick={onCreate}>
          <span className="folder-tab">NEW FILE</span>
          <span className="folder-body">
            <span className="folder-plus" aria-hidden="true">
              +
            </span>
            <span className="folder-kicker">建立新的檔案</span>
            <strong className="folder-name">重建你的現場</strong>
            <span className="folder-note">
              上傳同一個現場的照片，解算成可以走進去的三維空間。
            </span>
            <span className="folder-foot">
              <span className="folder-state">需要本機生成服務</span>
              <span className="folder-go">
                開始 <b>→</b>
              </span>
            </span>
          </span>
        </button>
      </div>
    </section>
  );
}
