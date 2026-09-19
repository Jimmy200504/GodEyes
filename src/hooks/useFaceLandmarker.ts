import { useRef, useState, useEffect, useCallback } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
interface Options {
  videoElement: HTMLVideoElement | null;
  canvasElement: HTMLCanvasElement | null;
  onLoadingStateChange?: (loading: boolean) => void;
  onError?: (error: Error) => void;
}
export interface FaceLandmarkerState {
  isReady: boolean;
  isRunning: boolean;
  error: string | null;
  cdnAvailable: boolean;
}
/** Compatibility hook. All resources are now local; cdnAvailable means local assets available. */
export function useFaceLandmarker({
  videoElement,
  onLoadingStateChange,
  onError,
}: Options) {
  const detector = useRef<FaceLandmarker | null>(null);
  const frame = useRef(0);
  const callbacks = useRef({ onLoadingStateChange, onError });
  callbacks.current = { onLoadingStateChange, onError };
  const [state, setState] = useState<FaceLandmarkerState>({
    isReady: false,
    isRunning: false,
    error: null,
    cdnAvailable: true,
  });
  const checkCdnAvailability = useCallback(async () => {
    try {
      const response = await fetch("/tracking/face_landmarker.task", {
        method: "HEAD",
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    callbacks.current.onLoadingStateChange?.(true);
    void FilesetResolver.forVisionTasks("/tracking/wasm")
      .then((files) =>
        FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: "/tracking/face_landmarker.task" },
          runningMode: "VIDEO",
          numFaces: 1,
        }),
      )
      .then((instance) => {
        if (disposed) {
          instance.close();
          return;
        }
        detector.current = instance;
        setState((current) => ({ ...current, isReady: true }));
      })
      .catch((error) => {
        if (!disposed) {
          setState((current) => ({
            ...current,
            error: String(error),
            cdnAvailable: false,
          }));
          callbacks.current.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      })
      .finally(() => {
        if (!disposed) callbacks.current.onLoadingStateChange?.(false);
      });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame.current);
      detector.current?.close();
      detector.current = null;
    };
  }, []);
  useEffect(() => {
    if (!state.isRunning || !videoElement || !detector.current) return;
    let last = -1;
    const process = () => {
      try {
        if (videoElement.readyState >= 2 && last !== videoElement.currentTime) {
          last = videoElement.currentTime;
          detector.current?.detectForVideo(videoElement, performance.now());
        }
        frame.current = requestAnimationFrame(process);
      } catch (error) {
        setState((current) => ({
          ...current,
          isRunning: false,
          error: String(error),
        }));
        callbacks.current.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    };
    frame.current = requestAnimationFrame(process);
    return () => cancelAnimationFrame(frame.current);
  }, [state.isRunning, videoElement]);
  const startFaceLandmarker = useCallback(
    () => setState((current) => ({ ...current, isRunning: current.isReady })),
    [],
  );
  const stopFaceLandmarker = useCallback(
    () => setState((current) => ({ ...current, isRunning: false })),
    [],
  );
  return {
    state,
    startFaceLandmarker,
    stopFaceLandmarker,
    checkCdnAvailability,
  };
}
