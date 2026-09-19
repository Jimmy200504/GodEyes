import { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';
import { DrawingUtils, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { HeadPose, HeadRotationTracker, HeadHeightTracker } from '../utils/headPose';

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
  onHeadPoseUpdate?: (headPose: HeadPose | null) => void;
}

export default function FaceMeshView({ onHeadPoseUpdate }: FaceMeshViewProps) {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbackRef = useRef(onHeadPoseUpdate);
  callbackRef.current = onHeadPoseUpdate;
  const rotationTracker = useRef(new HeadRotationTracker());
  const heightTracker = useRef(new HeadHeightTracker());
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
    rotationTracker.current.reset();
    heightTracker.current.reset();
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
          try {
            const video = webcamRef.current?.video;
            const canvas = canvasRef.current;
            if (video && canvas && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
              lastVideoTime = video.currentTime;
              const result = detector!.detectForVideo(video, performance.now());
              const matrix = result.facialTransformationMatrixes[0];
              const orientation = matrix && rotationTracker.current.update(matrix.data);
              const heightOffset = matrix && heightTracker.current.update(matrix.data);
              setTracking(Boolean(orientation));
              callbackRef.current?.(orientation ? {
                x: 0.5, y: 0.5, z: 1, orientation, heightOffset: heightOffset ?? 0,
              } : null);
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
    <div className="relative w-full h-full overflow-hidden bg-black">
      <Webcam ref={webcamRef} width={640} height={480} mirrored audio={false}
        onUserMedia={() => setCameraReady(true)}
        onUserMediaError={(error) => { setLastError(String(error)); setIsLoading(false); }}
        className="w-full h-full object-cover"
        videoConstraints={{ width: 640, height: 480, facingMode: 'user' }} />
      <canvas ref={canvasRef} width={640} height={480}
        className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute bottom-2 inset-x-2 rounded bg-black/70 p-2 text-xs text-white">
        <p role="status">{lastError || (isLoading ? '正在載入頭部追蹤…' : tracking
          ? '水平 1：4 · 鉛直 1：2 · 正視螢幕可重設方向' : '未偵測到臉，視角保持原位')}</p>
        <button type="button" disabled={!tracking || isLoading}
          className="mt-1 rounded bg-white/20 px-2 py-1 disabled:opacity-40"
          onClick={() => {
            rotationTracker.current.reset();
            heightTracker.current.reset();
          }}>重設正前方與高度</button>
        {lastError && <button type="button" className="ml-2 underline"
          onClick={() => { if (cameraReady) setAttempt(value => value + 1); else window.location.reload(); }}>重試</button>}
      </div>
    </div>
  );
}
