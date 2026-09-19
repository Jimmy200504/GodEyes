import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { ThreeSceneManager } from '../utils/threeScene';
import { WORLD_SCENES, WorldSceneId } from '../utils/worldScenes';
import { HeadPose } from '../utils/headPose';
import { CalibrationData } from '../utils/calibration';

interface ThreeViewProps {
  headPose: HeadPose | null;
}

export interface ThreeViewHandle {
  updateCalibration: (calibration: CalibrationData) => void;
  setDebugMode: (enabled: boolean) => void;
}

const ThreeView = forwardRef<ThreeViewHandle, ThreeViewProps>(({ headPose }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<ThreeSceneManager | null>(null);
  const [sceneId, setSceneId] = useState<WorldSceneId>(WORLD_SCENES[0].id);
  const [sceneStatus, setSceneStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    sceneManagerRef.current = new ThreeSceneManager({
      container: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight
    });

    sceneManagerRef.current.start();

    const handleResize = () => {
      if (containerRef.current && sceneManagerRef.current) {
        sceneManagerRef.current.resize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        );
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (sceneManagerRef.current) {
        sceneManagerRef.current.dispose();
      }
    };
  }, []);

  useEffect(() => {
    void sceneManagerRef.current?.loadWorld(sceneId, setSceneStatus);
  }, [sceneId, retryCount]);

  useEffect(() => {
    if (headPose && sceneManagerRef.current) {
      sceneManagerRef.current.updateHeadPose(headPose);
    }
  }, [headPose]);

  useImperativeHandle(ref, () => ({
    updateCalibration: (calibration: CalibrationData) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.updateCalibration(calibration);
      }
    },
    setDebugMode: (enabled: boolean) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.setDebugMode(enabled);
      }
    },
  }));

  return (
    <div className="w-full h-full relative bg-black">
      <div
        ref={containerRef}
        tabIndex={0}
        aria-label="3D 場景，頭部位移控制，可調整角度倍率"
        onPointerDown={() => containerRef.current?.focus({ preventScroll: true })}
        className="w-full h-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
        style={{ touchAction: 'none' }}
      />
      <div className="absolute top-4 right-4 z-20 max-w-[calc(100%-2rem)] rounded-lg bg-black/70 p-3 text-white backdrop-blur-sm">
        <label htmlFor="world-scene" className="mb-1 block text-xs text-gray-300">場景</label>
        <select
          id="world-scene"
          value={sceneId}
          onChange={event => setSceneId(event.target.value as WorldSceneId)}
          disabled={sceneStatus === 'loading'}
          className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm disabled:opacity-60"
        >
          {WORLD_SCENES.map(scene => <option key={scene.id} value={scene.id}>{scene.label}</option>)}
        </select>
        <p role="status" aria-live="polite" className="mt-2 text-xs text-gray-300">
          {sceneStatus === 'loading' ? '正在載入場景…' : sceneStatus === 'error' ? '場景載入失敗，請重試或選擇另一個場景。' : '場景已就緒'}
        </p>
        {sceneStatus === 'error' && (
          <button onClick={() => setRetryCount(count => count + 1)} className="mt-2 rounded bg-blue-600 px-3 py-1 text-sm">重新載入</button>
        )}
      </div>
    </div>
  );
});

ThreeView.displayName = 'ThreeView';

export default ThreeView;
