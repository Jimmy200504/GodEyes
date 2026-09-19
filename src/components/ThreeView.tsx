import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { ThreeSceneManager } from '../utils/threeScene';
import { HeadPose } from '../utils/headPose';
import { CalibrationData } from '../utils/calibration';

interface ThreeViewProps {
  headPose: HeadPose | null;
}

export interface ThreeViewHandle {
  updateCalibration: (calibration: CalibrationData) => void;
  setDebugMode: (enabled: boolean) => void;
  updateModelPosition: (x: number, y: number, z: number) => void;
  updateModelScale: (scale: number) => void;
  updateModelRotation: (x: number, y: number, z: number) => void;
  getModelPosition: () => { x: number; y: number; z: number };
  getModelScale: () => number;
  getModelRotation: () => { x: number; y: number; z: number };
}

const ThreeView = forwardRef<ThreeViewHandle, ThreeViewProps>(({ headPose }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<ThreeSceneManager | null>(null);
  const [sceneStatus, setSceneStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [worldEnabled, setWorldEnabled] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;

    sceneManagerRef.current = new ThreeSceneManager({
      container: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      onSceneStatus: setSceneStatus
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
    updateModelPosition: (x: number, y: number, z: number) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.updateModelPosition(x, y, z);
      }
    },
    updateModelScale: (scale: number) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.updateModelScale(scale);
      }
    },
    getModelPosition: () => {
      if (sceneManagerRef.current) {
        return sceneManagerRef.current.getModelPosition();
      }
      return { x: 0, y: -0.09, z: -0.03 };
    },
    getModelScale: () => {
      if (sceneManagerRef.current) {
        return sceneManagerRef.current.getModelScale();
      }
      return 0.071;
    },
    updateModelRotation: (x: number, y: number, z: number) => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.updateModelRotation(x, y, z);
      }
    },
    getModelRotation: () => {
      if (sceneManagerRef.current) {
        return sceneManagerRef.current.getModelRotation();
      }
      return { x: 0, y: -0.628, z: 0 };
    },
  }));

  return (
    <div className="w-full h-full relative bg-black">
      <div
        ref={containerRef}
        tabIndex={0}
        aria-label="3D 場景，W S 前進後退，A D 左右平移"
        onPointerDown={() => containerRef.current?.focus({ preventScroll: true })}
        className="w-full h-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
        style={{ touchAction: 'none' }}
      />
      <div className="absolute top-4 left-4 z-10 rounded-lg bg-black/70 p-3 text-white backdrop-blur-sm text-sm">
        <button
          type="button"
          disabled={sceneStatus !== 'ready'}
          aria-pressed={worldEnabled && sceneStatus === 'ready'}
          className="rounded px-3 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-60"
          onClick={() => {
            const enabled = !worldEnabled;
            setWorldEnabled(enabled);
            sceneManagerRef.current?.setWorldEnabled(enabled);
          }}
        >
          {worldEnabled ? 'Marble 場景 · 切換格線' : '格線房間 · 切換 Marble'}
        </button>
        <p role="status" className="mt-2 text-xs text-gray-300">
          {sceneStatus === 'loading' ? '正在載入場景…' : sceneStatus === 'error'
            ? '場景載入失敗，已顯示格線房間。請重新整理重試。'
            : '頭部旋轉：水平 1：4 · 鉛直 1：2'}
        </p>
        <p className="mt-2 text-xs text-gray-300">點擊場景後：W／S 前進後退 · A／D 左右平移</p>
        <p className="mt-1 text-xs text-gray-300">坐高／蹲低，視角跟著升降</p>
        <button
          type="button"
          className="mt-2 rounded px-3 py-2 bg-white/10 hover:bg-white/20"
          onClick={() => {
            sceneManagerRef.current?.resetNavigation();
            containerRef.current?.focus({ preventScroll: true });
          }}
        >
          重設位置
        </button>
        <a className="mt-1 block text-xs text-gray-400 underline" href="https://sparkjs.dev/examples/#lofi" target="_blank" rel="noreferrer">
          場景來源：World Labs / Spark Lofi Worlds
        </a>
      </div>
    </div>
  );
});

ThreeView.displayName = 'ThreeView';

export default ThreeView;
