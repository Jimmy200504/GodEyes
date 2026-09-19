import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Compass,
  Eye,
  Layers3,
  Maximize,
  MousePointer2,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import type { ThreeViewHandle } from "./components/ThreeView";
import CalibrationWizard from "./components/CalibrationWizard";
import SceneBuilder from "./components/SceneBuilder";
import WorldLibrary from "./components/WorldLibrary";
import { pageFromHash, pageHash } from "./utils/navigation";
import type { Page } from "./utils/navigation";
import { api, WORLD_SCENES, WorldScene } from "./utils/worldScenes";
import { HeadPose } from "./utils/headPose";
import { calibrationManager } from "./utils/calibration";

const RemoteExplorer = lazy(() => import("./components/RemoteExplorer"));
const ThreeView = lazy(() => import("./components/ThreeView"));
const FaceMeshView = lazy(() => import("./components/FaceMeshView"));

function initialPage(): Page {
  return pageFromHash(window.location.hash);
}
function App(): JSX.Element {
  const [page, setPage] = useState<Page>(initialPage);
  const [generated, setGenerated] = useState<WorldScene[]>([]);
  const [online, setOnline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [remoteMode, setRemoteMode] = useState(false);
  const [headMode, setHeadMode] = useState(false);
  const [headPose, setHeadPose] = useState<HeadPose | null>(null);
  const [cameraOpen, setCameraOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [trackingKey, setTrackingKey] = useState(0);
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const [fullscreenError, setFullscreenError] = useState("");
  const viewer = useRef<ThreeViewHandle>(null);
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
      setRemoteMode(false);
      setPage(initialPage());
      setHeadMode(false);
      setHeadPose(null);
    };
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);
  function navigate(next: Page): void {
    setRemoteMode(false);
    setPage(next);
    setHeadMode(false);
    setHeadPose(null);
    setSettingsOpen(false);
    window.history.pushState(null, "", pageHash(next));
  }
  const onPose = useCallback((pose: HeadPose | null) => setHeadPose(pose), []);
  function receive(scene: WorldScene): void {
    setGenerated((current) => [
      scene,
      ...current.filter((item) => item.id !== scene.id),
    ]);
    if (page.kind !== "builder" || page.id !== scene.id)
      navigate({ kind: "builder", id: scene.id });
  }
  function reset(): void {
    viewer.current?.resetView();
    setHeadPose(null);
    setTrackingKey((n) => n + 1);
  }
  async function fullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFullscreenError("瀏覽器未允許全螢幕；仍可在此視窗探索。");
    }
  }
  if (page.kind === "explore" && selected?.spzUrl && remoteMode)
    return <Suspense fallback={<div className="world-loading">正在準備遠端探索…</div>}>
      <RemoteExplorer key={selected.id} scene={selected} onBack={() => setRemoteMode(false)} />
    </Suspense>;
  if (page.kind === "explore" && selected?.spzUrl)
    return (
      <div className="explorer">
        <Suspense
          fallback={
            <div className="world-loading">
              <p>正在準備空間探索…</p>
            </div>
          }
        >
          <ThreeView
            scene={selected}
            headPose={headPose}
            mode={headMode ? "head" : "mouse"}
            ref={viewer}
          />
        </Suspense>
        <header className="explore-header">
          <button
            className="glass icon-button"
            aria-label="返回現場資料庫"
            onClick={() => navigate({ kind: "library" })}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="glass explore-title">
            <span className="brand-mini">
              <Eye size={18} />
              GODEYES
            </span>
            <span className="divider" />
            <label>
              <span className="sr-only">切換世界</span>
              <select
                value={selected.id}
                onChange={(e) =>
                  navigate({ kind: "explore", id: e.target.value })
                }
              >
                {scenes
                  .filter((s) => s.status === "ready")
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <span className="glass live-tag">
            <span className="status-dot" />
            空間探索
          </span>
        </header>
        <div className="explore-actions">
          {selected.source === "generated" && (
            <button
              className="glass icon-button"
              aria-label="檢視原圖、Clean Image 與 Prompt"
              title="影像與 Prompt"
              onClick={() => navigate({ kind: "builder", id: selected.id })}
            >
              <Layers3 size={18} />
            </button>
          )}
          <button
            className="glass icon-button"
            aria-label="全螢幕"
            title="全螢幕"
            onClick={() => void fullscreen()}
          >
            <Maximize size={18} />
          </button>
          <button
            className="glass icon-button"
            aria-label="進階設定"
            title="進階設定"
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <Settings2 size={18} />
          </button>
        </div>
        {settingsOpen && (
          <div className="glass settings-panel">
            <div className="image-heading">
              <h2>探索設定</h2>
              <button
                className="icon-button"
                aria-label="關閉設定"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <button
              className="secondary"
              onClick={() => setCalibrationOpen(true)}
            >
              螢幕與觀看距離校正
            </button>
            <button className="secondary" onClick={() => { setHeadMode(false); setHeadPose(null); setRemoteMode(true); }}>
              SLAM／NPU 手勢探索
            </button>
            <label className="debug-option">
              <input
                type="checkbox"
                onChange={(e) => viewer.current?.setDebugMode(e.target.checked)}
              />
              顯示除錯座標
            </label>
          </div>
        )}
        <div className="explore-bottom">
          <div className="glass navigation-hint">
            <Compass size={18} />
            <span>
              {headMode ? "轉動或移動頭部探索" : "拖曳畫面環顧四周"}
              <small>點擊場景後，以 W A S D 移動</small>
            </span>
          </div>
          <div className="glass mode-controls">
            <button
              className={!headMode ? "selected" : ""}
              onClick={() => {
                setHeadMode(false);
                setHeadPose(null);
              }}
            >
              <MousePointer2 size={16} />
              滑鼠
            </button>
            <button
              className={headMode ? "selected" : ""}
              onClick={() => {
                if (!headMode) {
                  setHeadMode(true);
                  setTrackingKey((n) => n + 1);
                  if (!calibrationManager.isCalibrated())
                    setCalibrationOpen(true);
                }
              }}
            >
              <Camera size={16} />
              頭部追蹤
            </button>
            <span className="divider" />
            <button onClick={reset} title="重設視角">
              <RotateCcw size={16} />
              <span className="reset-label">重設</span>
            </button>
          </div>
        </div>
        {headMode && (
          <aside
            className={`camera-panel glass ${cameraOpen ? "" : "collapsed"}`}
          >
            <button
              className="camera-heading"
              onClick={() => setCameraOpen(!cameraOpen)}
            >
              <span>
                <CircleDot size={13} />
                頭部追蹤
              </span>
              {cameraOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
            <div
              className={
                cameraOpen
                  ? "camera-content"
                  : "camera-content visually-collapsed"
              }
            >
              <div className="camera-video">
                <Suspense
                  fallback={<p className="p-4 text-xs">正在準備頭部追蹤…</p>}
                >
                  <FaceMeshView
                    key={trackingKey}
                    onHeadPoseUpdate={onPose}
                    controlsContainer={controls}
                  />
                </Suspense>
              </div>
              <div ref={setControls} />
            </div>
          </aside>
        )}
        {fullscreenError && (
          <div className="explore-notice" role="status">
            {fullscreenError}
          </div>
        )}
        {calibrationOpen && (
          <CalibrationWizard
            onComplete={(value) => {
              viewer.current?.updateCalibration(value);
              setCalibrationOpen(false);
            }}
            onSkip={() => setCalibrationOpen(false)}
            onClose={() => setCalibrationOpen(false)}
          />
        )}
      </div>
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
          <small>SCENE RECONSTRUCTION</small>
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
        <div className="service-status">
          <span className={`status-dot ${online ? "" : "offline"}`} />
          {online ? "LOCAL · ONLINE" : "LOCAL · PRESETS ONLY"}
        </div>
      </header>
      {renderPage()}
    </div>
  );
}
export default App;
