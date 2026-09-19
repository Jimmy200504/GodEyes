import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { ThreeSceneManager } from '../utils/threeScene';
import type { GestureTelemetry } from '../utils/gestureSocket';
import { HeadPose } from '../utils/headPose';
import { CalibrationData } from '../utils/calibration';

interface ThreeViewProps {
  headPose: HeadPose | null;
  onGestureTelemetry?: (data: GestureTelemetry) => void;
  onGestureStatus?: (status: string) => void;
  renderSmoothing?: boolean;
  posePrediction?: boolean;
  allowCoast?: boolean;
  poseEpoch?: number;
}

export interface ThreeViewHandle {
  calibratePalm: () => boolean;
  updateCalibration: (calibration: CalibrationData) => void;
  setDebugMode: (enabled: boolean) => void;
  updateModelPosition: (x: number, y: number, z: number) => void;
  updateModelScale: (scale: number) => void;
  updateModelRotation: (x: number, y: number, z: number) => void;
  getModelPosition: () => { x: number; y: number; z: number };
  getModelScale: () => number;
  getModelRotation: () => { x: number; y: number; z: number };
}

const ThreeView = forwardRef<ThreeViewHandle, ThreeViewProps>(({ headPose, onGestureStatus, onGestureTelemetry, renderSmoothing = true, posePrediction = false, allowCoast = false, poseEpoch = 0 }, ref) => {
  const gestureStatusRef = useRef(onGestureStatus);
  gestureStatusRef.current = onGestureStatus;
  const gestureTelemetryRef = useRef(onGestureTelemetry);
  gestureTelemetryRef.current = onGestureTelemetry;
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<ThreeSceneManager | null>(null);
  useEffect(() => {
    if (!containerRef.current) return;

    sceneManagerRef.current = new ThreeSceneManager({
      container: containerRef.current,
      onGestureStatus: status => gestureStatusRef.current?.(status),
      onGestureTelemetry: data => gestureTelemetryRef.current?.(data),
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

  useEffect(() => { sceneManagerRef.current?.resetHeadPose(); }, [poseEpoch]);
  useEffect(() => { sceneManagerRef.current?.setPosePrediction(posePrediction); }, [posePrediction]);
  useEffect(() => { sceneManagerRef.current?.setRenderSmoothing(renderSmoothing); }, [renderSmoothing]);

  useEffect(() => {
    if (headPose && sceneManagerRef.current) {
      sceneManagerRef.current.updateHeadPose(headPose);
    } else if (allowCoast) { sceneManagerRef.current?.coastHeadPose(); }
    else { sceneManagerRef.current?.holdHeadPose(); }
  }, [headPose, allowCoast, posePrediction]);

  useImperativeHandle(ref, () => ({
    calibratePalm: () => sceneManagerRef.current?.calibratePalm() ?? false,
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
        aria-label="3D 場景，SLAM 頭部追蹤與手勢移動旋轉"
        onPointerDown={() => containerRef.current?.focus({ preventScroll: true })}
        className="w-full h-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
        style={{ touchAction: 'none' }}
      />

    </div>
  );
});

ThreeView.displayName = 'ThreeView';

export default ThreeView;
