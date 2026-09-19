import { useCallback, useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { createPortal } from 'react-dom';
import { DrawingUtils, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { HeadPose, HeadNavigationTracker, DEFAULT_ROTATION_GAINS } from '../utils/headPose';

declare global {
  interface Window {
    FaceMesh: any;
    drawConnectors: any;
    drawLandmarks: any;
    Camera: any;
    FACEMESH_TESSELATION: any;
    FACEMESH_RIGHT_EYE: any;
    FACEMESH_LEFT_EYE: any;
    FACEMESH_RIGHT_EYEBROW: any;
    FACEMESH_LEFT_EYEBROW: any;
    FACEMESH_FACE_OVAL: any;
    FACEMESH_LIPS: any;
  }
}

interface FaceMeshViewProps {
  controlsContainer: HTMLDivElement | null;
  onHeadPoseUpdate?: (headPose: HeadPose | null) => void;
}

export default function FaceMeshView({ onHeadPoseUpdate, controlsContainer }: FaceMeshViewProps) {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbackRef = useRef(onHeadPoseUpdate);
  callbackRef.current = onHeadPoseUpdate;
  const navigationTracker = useRef(new HeadNavigationTracker());
  const [rotationGains, setRotationGains] = useState({ ...DEFAULT_ROTATION_GAINS });
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const pause = () => {
    pausedRef.current = true;
    setPaused(true);
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };
  const resume = useCallback(() => {
    if (!pausedRef.current) return;
    navigationTracker.current.rebase();
    pausedRef.current = false;
    setPaused(false);
  }, []);
  useEffect(() => {
    const releaseWhenHidden = () => {
      if (document.hidden) resume();
    };
    window.addEventListener('blur', resume);
    document.addEventListener('visibilitychange', releaseWhenHidden);
    return () => {
      window.removeEventListener('blur', resume);
      document.removeEventListener('visibilitychange', releaseWhenHidden);
    };
  }, [resume]);
  const [cameraReady, setCameraReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    if (!cameraReady) return;
    let cancelled = false;
    let frame = 0;
    let detector: FaceLandmarker | undefined;
    let lastVideoTime = -1;
    navigationTracker.current.rebase();
    setIsLoading(true);
    setLastError(null);

    const start = async () => {
      try {
        const files = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
        );
        if (cancelled) return;
        detector = await FaceLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFacialTransformationMatrixes: true,
        });
        if (cancelled) { detector.close(); return; }
        setIsLoading(false);
        const process = () => {
          if (cancelled) return;
          if (pausedRef.current) {
            frame = requestAnimationFrame(process);
            return;
          }
          try {
            const video = webcamRef.current?.video;
            const canvas = canvasRef.current;
            if (video && canvas && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
              lastVideoTime = video.currentTime;
              const result = detector!.detectForVideo(video, performance.now());
              const matrix = result.facialTransformationMatrixes[0];
              const pose = matrix ? navigationTracker.current.update(matrix.data) : null;
              if (!pose) navigationTracker.current.rebase();
              setTracking(Boolean(pose));
              callbackRef.current?.(pose);
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.save();
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
                const drawing = new DrawingUtils(ctx);
                for (const landmarks of result.faceLandmarks) {
                  drawing.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION,
                    { color: 'rgba(255,255,255,0.3)', lineWidth: 0.5 });
                }
                ctx.restore();
              }
            }
            frame = requestAnimationFrame(process);
          } catch (error) {
            setLastError(error instanceof Error ? error.message : '頭部追蹤失敗');
            setTracking(false);
            callbackRef.current?.(null);
          }
        };
        frame = requestAnimationFrame(process);
      } catch (error) {
        if (!cancelled) {
          setLastError(error instanceof Error ? error.message : '頭部追蹤載入失敗');
          setIsLoading(false);
        }
      }
    };
    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      detector?.close();
    };
  }, [cameraReady, attempt]);

  return (
    <>
      {controlsContainer && createPortal(
        <div className="w-64 rounded-lg bg-black/70 p-3 text-xs text-white backdrop-blur-sm">
        <fieldset className="space-y-2" disabled={paused}>
          <legend className="sr-only">角度倍率</legend>
          {([
            ['horizontal', '水平'], ['vertical', '垂直'], ['roll', '側傾'],
          ] as const).map(([axis, label]) => (
            <label key={axis} className="flex items-center gap-2">
              <span className="w-24 shrink-0">{label} 1：{rotationGains[axis]}</span>
              <input type="range" min="0.5" max="4" step="0.1"
                aria-label={`${label}角度倍率`}
                className="min-w-0 flex-1 accent-blue-500"
                value={rotationGains[axis]}
                onChange={event => {
                  const gains = { ...rotationGains, [axis]: Number(event.target.value) };
                  setRotationGains(gains);
                  navigationTracker.current.setRotationGains(gains);
                }} />
            </label>
          ))}
        </fieldset>
        <button type="button" disabled={paused || !tracking || isLoading}
          className="mt-3 w-full rounded bg-white/20 px-2 py-1 disabled:opacity-40"
          onClick={() => navigationTracker.current.reset()}>重設位置</button>
        </div>, controlsContainer
      )}
    <div className="relative w-full h-full overflow-hidden bg-black">
      <Webcam ref={webcamRef} width={640} height={480} mirrored audio={false}
        onUserMedia={() => setCameraReady(true)}
        onUserMediaError={(error) => { setLastError(String(error)); setIsLoading(false); }}
        className="w-full h-full object-cover"
        videoConstraints={{ width: 640, height: 480, facingMode: 'user' }} />
      <canvas ref={canvasRef} width={640} height={480}
        className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute bottom-2 inset-x-2 rounded bg-black/70 p-2 text-xs text-white">
        <p role="status">{paused ? '已停止偵測，可移回頭部；放開後繼續探索' : lastError || (isLoading ? '正在載入頭部追蹤…' : tracking
          ? '頭部追蹤中 · 位移 1：1' : '未偵測到臉，視角保持原位')}</p>
        <button type="button" aria-pressed={paused}
          className="mt-2 w-full touch-none select-none rounded bg-blue-600 px-3 py-3 font-medium"
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            pause();
          }}
          onPointerUp={resume}
          onPointerCancel={resume}
          onLostPointerCapture={resume}
          onBlur={resume}
          onContextMenu={event => event.preventDefault()}
          onKeyDown={event => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              pause();
            }
          }}
          onKeyUp={event => {
            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              resume();
            }
          }}>
          {paused ? '已停止偵測 · 放開繼續' : '按住停止偵測'}
        </button>
        {lastError && <button type="button" className="ml-2 underline"
          onClick={() => { if (cameraReady) setAttempt(value => value + 1); else window.location.reload(); }}>重試</button>}
      </div>
    </div>
    </>
  );
}
