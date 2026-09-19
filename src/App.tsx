import { lazy, Suspense, useEffect, useState } from "react";
import SceneBuilder from "./components/SceneBuilder";
import WorldLibrary from "./components/WorldLibrary";
import { pageFromHash, pageHash } from "./utils/navigation";
import type { Page } from "./utils/navigation";
import { api, WORLD_SCENES, WorldScene } from "./utils/worldScenes";

const RemoteExplorer = lazy(() => import("./components/RemoteExplorer"));

function initialPage(): Page {
  return pageFromHash(window.location.hash);
}
function App(): JSX.Element {
  const [page, setPage] = useState<Page>(initialPage);
  const [generated, setGenerated] = useState<WorldScene[]>([]);
  const [online, setOnline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scenes = [...WORLD_SCENES, ...generated];
  const selected =
    "id" in page ? scenes.find((scene) => scene.id === page.id) : undefined;
  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      try {
        const result = await api<WorldScene[]>("/api/scenes");
        if (!cancelled) {
          setGenerated(result);
          setOnline(true);
        }
      } catch {
        if (!cancelled) setOnline(false);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const handle = () => {
      setPage(initialPage());
    };
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);
  function navigate(next: Page): void {
    setPage(next);
    window.history.pushState(null, "", pageHash(next));
  }
  function receive(scene: WorldScene): void {
    setGenerated((current) => [
      scene,
      ...current.filter((item) => item.id !== scene.id),
    ]);
    if (page.kind !== "builder" || page.id !== scene.id)
      navigate({ kind: "builder", id: scene.id });
  }
  if (page.kind === "explore" && selected?.spzUrl)
    return (
      <Suspense fallback={<div className="world-loading">正在準備現場探索…</div>}>
        <RemoteExplorer
          key={selected.id}
          scene={selected}
          onBack={() => navigate({ kind: "library" })}
        />
      </Suspense>
    );
  function renderPage(): JSX.Element {
    if (page.kind === "builder" && (!page.id || selected)) {
      return (
        <SceneBuilder
          key={page.id || "new"}
          scene={selected}
          online={online}
          onBack={() => navigate({ kind: "library" })}
          onScene={receive}
          onExplore={(scene) => navigate({ kind: "explore", id: scene.id })}
        />
      );
    }
    if (page.kind !== "library") {
      return (
        <main className="page-width missing-state">
          <h1>{!loaded ? "正在讀取現場…" : "找不到這個現場"}</h1>
          <p>
            {online
              ? "返回資料庫，選擇已完成的現場。"
              : "請啟動本機服務以讀取已建立的現場。"}
          </p>
          <button
            className="primary"
            onClick={() => navigate({ kind: "library" })}
          >
            返回現場資料庫
          </button>
        </main>
      );
    }
    return (
      <WorldLibrary
        scenes={scenes}
        onCreate={() => navigate({ kind: "builder" })}
        onOpen={(scene) =>
          navigate({
            kind: scene.status === "ready" ? "explore" : "builder",
            id: scene.id,
          })
        }
      />
    );
  }
  return (
    <div className="app-shell">
      <header className="main-header">
        <button className="brand" onClick={() => navigate({ kind: "library" })}>
          <span>GODEYES</span>
        </button>
        <nav>
          <button
            className={page.kind === "library" ? "nav-active" : ""}
            onClick={() => navigate({ kind: "library" })}
          >
            現場資料庫
          </button>
          <button
            className={page.kind === "builder" ? "nav-active" : ""}
            onClick={() => navigate({ kind: "builder" })}
          >
            場景工作台
          </button>
        </nav>
      </header>
      {renderPage()}
    </div>
  );
}
export default App;
