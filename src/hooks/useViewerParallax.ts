import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Viewer parallax for the landing board.
 *
 * The product is head-coupled perspective, so the landing page is driven by the
 * same signal: MediaPipe reports where your head is, and the board is redrawn
 * from that viewpoint. Without camera permission the pointer stands in for the
 * head, which is the same value on the same scale.
 *
 * With neither the head nor the pointer driving, the viewpoint drifts on its
 * own, so the wall is never a still image. The drift fades out when someone
 * takes over and fades back in once they stop.
 *
 * The value is written straight onto the stage element as `--vx` / `--vy` and
 * pushed to `onFrame`; it never passes through React state, because it changes
 * every frame.
 */

export type ParallaxSource = "idle" | "pointer" | "head";
export type HeadStatus = "off" | "loading" | "live" | "denied" | "unsupported";

/** Head travel, in centimetres, that maps to the full ±1 range. */
const HEAD_RANGE_CM = 9;
/** Exponential smoothing. Low enough to kill landmark jitter, high enough to
 * still feel attached to the head. */
const EMA = 0.16;
/** How long a viewer has to hold still before the drift takes back over. */
const IDLE_AFTER_MS = 3200;
/** Seconds to cross-fade between a driven viewpoint and the drift. */
const HANDOVER_S = 1.6;

/**
 * The resting drift: two slow sines per axis at unrelated periods, so the path
 * never visibly repeats and never parks in a corner.
 */
function drift(seconds: number): { x: number; y: number } {
  return {
    x:
      Math.sin(seconds * 0.23) * 0.6 +
      Math.sin(seconds * 0.081 + 2.1) * 0.24,
    y:
      Math.sin(seconds * 0.167 + 1.3) * 0.3 +
      Math.sin(seconds * 0.061) * 0.14,
  };
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

interface Options {
  /** Called once per animation frame with the smoothed viewpoint. */
  onFrame?: (x: number, y: number) => void;
}

export interface ViewerParallax {
  source: ParallaxSource;
  headStatus: HeadStatus;
  enableHead: () => void;
  disableHead: () => void;
}

export function useViewerParallax(
  stageRef: React.RefObject<HTMLElement>,
  { onFrame }: Options = {},
): ViewerParallax {
  /** Where the pointer or head last put the viewpoint. */
  const driven = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const lastInput = useRef(0);
  /** 0 = fully driven, 1 = fully drifting. */
  const mix = useRef(1);
  const frameCallback = useRef(onFrame);
  frameCallback.current = onFrame;

  const headRef = useRef<{ stop: () => void } | null>(null);
  const [source, setSource] = useState<ParallaxSource>("idle");
  const [headStatus, setHeadStatus] = useState<HeadStatus>("off");

  // Pointer stand-in. Skipped on touch and when motion is not wanted.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover)").matches) return;
    const move = (event: PointerEvent): void => {
      if (headRef.current) return; // the head outranks the pointer
      driven.current.x = clamp((event.clientX / window.innerWidth) * 2 - 1);
      driven.current.y = clamp((event.clientY / window.innerHeight) * 2 - 1);
      lastInput.current = performance.now();
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last = performance.now();
    let announced: ParallaxSource | null = null;

    const tick = (now: number): void => {
      const step = Math.min(0.1, (now - last) / 1000);
      last = now;

      // The head, once live, always drives; otherwise the pointer holds the
      // viewpoint until it has been still long enough to hand back.
      const driving =
        !!headRef.current || now - lastInput.current < IDLE_AFTER_MS;
      const wanted = driving || still.matches ? 0 : 1;
      mix.current += Math.min(1, step / HANDOVER_S) * (wanted - mix.current);

      const wander = drift(now / 1000);
      const blend = mix.current;
      const targetX = driven.current.x * (1 - blend) + wander.x * blend;
      const targetY = driven.current.y * (1 - blend) + wander.y * blend;

      const value = current.current;
      value.x += (clamp(targetX) - value.x) * EMA;
      value.y += (clamp(targetY) - value.y) * EMA;
      const stage = stageRef.current;
      if (stage) {
        stage.style.setProperty("--vx", value.x.toFixed(4));
        stage.style.setProperty("--vy", value.y.toFixed(4));
      }
      frameCallback.current?.(value.x, value.y);

      const next: ParallaxSource = headRef.current
        ? "head"
        : blend > 0.5
          ? "idle"
          : "pointer";
      if (next !== announced) {
        announced = next;
        setSource(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stageRef]);

  const disableHead = useCallback(() => {
    headRef.current?.stop();
    headRef.current = null;
    // Hands straight back to the drift rather than snapping to centre.
    lastInput.current = 0;
    setHeadStatus("off");
  }, []);

  const enableHead = useCallback(() => {
    if (headRef.current || !navigator.mediaDevices?.getUserMedia) {
      if (!navigator.mediaDevices?.getUserMedia) setHeadStatus("unsupported");
      return;
    }
    setHeadStatus("loading");
    let cancelled = false;

    void (async () => {
      let stream: MediaStream | null = null;
      try {
        const vision = await import("@mediapipe/tasks-vision");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
        });
        const files = await vision.FilesetResolver.forVisionTasks(
          "/tracking/wasm",
        );
        const landmarker = await vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: "/tracking/face_landmarker.task" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFacialTransformationMatrixes: true,
        });

        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        if (cancelled) {
          landmarker.close();
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        let raf = 0;
        let neutral: { x: number; y: number } | null = null;
        let lastTime = -1;
        const read = (): void => {
          raf = requestAnimationFrame(read);
          if (video.readyState < 2 || video.currentTime === lastTime) return;
          lastTime = video.currentTime;
          const result = landmarker.detectForVideo(video, performance.now());
          const matrix = result.facialTransformationMatrixes?.[0]?.data;
          if (!matrix || matrix.length !== 16) return;
          // MediaPipe's metric face transform is in centimetres, unmirrored.
          // Flip X into the viewer's axes; keep Y growing downward so the value
          // is on the same scale as the pointer.
          const headX = -matrix[12];
          const headY = matrix[13];
          if (!neutral) neutral = { x: headX, y: headY };
          driven.current.x = clamp((headX - neutral.x) / HEAD_RANGE_CM);
          driven.current.y = clamp((neutral.y - headY) / HEAD_RANGE_CM);
          lastInput.current = performance.now();
        };
        raf = requestAnimationFrame(read);

        const activeStream = stream;
        headRef.current = {
          stop: () => {
            cancelAnimationFrame(raf);
            landmarker.close();
            video.pause();
            video.srcObject = null;
            activeStream.getTracks().forEach((track) => track.stop());
          },
        };
        setHeadStatus("live");
        setSource("head");
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop());
        if (cancelled) return;
        const denied =
          error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "SecurityError");
        setHeadStatus(denied ? "denied" : "unsupported");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => headRef.current?.stop(), []);

  return { source, headStatus, enableHead, disableHead };
}
