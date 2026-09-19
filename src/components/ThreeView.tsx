import {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Loader2, RotateCcw, AlertCircle } from "lucide-react";
import { ThreeSceneManager } from "../utils/threeScene";
import { WorldScene } from "../utils/worldScenes";
import { HeadPose } from "../utils/headPose";
import { CalibrationData } from "../utils/calibration";
interface Props {
  headPose: HeadPose | null;
  scene: WorldScene;
  mode: "mouse" | "head";
}
export interface ThreeViewHandle {
  updateCalibration: (calibration: CalibrationData) => void;
  setDebugMode: (enabled: boolean) => void;
  resetView: () => void;
}
const ThreeView = forwardRef<ThreeViewHandle, Props>(
  ({ headPose, scene, mode }, ref) => {
    const container = useRef<HTMLDivElement>(null);
    const sceneRef = useRef(scene);
    sceneRef.current = scene;
    const manager = useRef<ThreeSceneManager | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">(
      "loading",
    );
    const [attempt, setAttempt] = useState(0);
    const [initError, setInitError] = useState("");
    useEffect(() => {
      if (!container.current) return;
      try {
        manager.current = new ThreeSceneManager({
          container: container.current,
        });
        manager.current.start();
        const resize = new ResizeObserver(([entry]) => {
          if (entry.contentRect.width && entry.contentRect.height)
            manager.current?.resize(
              entry.contentRect.width,
              entry.contentRect.height,
            );
        });
        resize.observe(container.current);
        return () => {
          resize.disconnect();
          manager.current?.dispose();
          manager.current = null;
        };
      } catch {
        setInitError("無法啟動 3D 渲染；請使用支援 WebGL 2 的瀏覽器。");
        setStatus("error");
      }
    }, []);
    useEffect(() => {
      void manager.current?.loadWorld(sceneRef.current, setStatus);
    }, [scene.id, scene.spzUrl, attempt]); // scene metadata changes do not reload the world
    useEffect(() => {
      manager.current?.setMode(mode);
    }, [mode]);
    useEffect(() => {
      if (headPose) manager.current?.updateHeadPose(headPose);
    }, [headPose]);
    useImperativeHandle(ref, () => ({
      updateCalibration: (value) => manager.current?.updateCalibration(value),
      setDebugMode: (enabled) => manager.current?.setDebugMode(enabled),
      resetView: () => manager.current?.resetView(),
    }));
    return (
      <div className="world-canvas">
        <div
          ref={container}
          tabIndex={0}
          onPointerDown={() =>
            container.current?.focus({ preventScroll: true })
          }
          className="canvas-surface"
          aria-label="3D 場景；滑鼠拖曳旋轉，W A S D 移動"
        />
        {status !== "ready" && (
          <div
            className="world-loading"
            style={{
              backgroundImage: `linear-gradient(#101716b0, #101716ed), url(${scene.thumbnail})`,
            }}
          >
            {status === "loading" ? (
              <Loader2 className="spin" size={32} />
            ) : (
              <AlertCircle size={32} />
            )}
            <h2>
              {status === "loading" ? "正在打開這個世界" : "場景載入失敗"}
            </h2>
            <p>
              {status === "loading"
                ? "讀取本機場景與空間細節，無須重新生成。"
                : initError || "請確認場景檔案可用，或返回選擇另一個世界。"}
            </p>
            {status === "error" && !initError && (
              <button
                className="primary"
                onClick={() => setAttempt((n) => n + 1)}
              >
                <RotateCcw size={16} />
                重新載入
              </button>
            )}
          </div>
        )}
      </div>
    );
  },
);
ThreeView.displayName = "ThreeView";
export default ThreeView;
