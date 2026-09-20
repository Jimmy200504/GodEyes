import { useCallback, useEffect, useRef, useState } from "react";
import { blitGrid, createGrid, ditherInPlace } from "../utils/dither";
import { SplatWall } from "../utils/splatWall";
import type { WorldScene } from "../utils/worldScenes";

/**
 * The wall the board is pinned to — which is the reconstruction itself,
 * rendered live from the splat.
 *
 * The same rendered frame is shown twice: thresholded to 1-bit on one side of
 * the wall, full tone on the other, with the seam drifting under the viewer.
 * That is the whole claim — this is solved data, not a photograph — made
 * without a word of copy.
 */

/** Dot grid for the 1-bit half. Coarse enough to read as structure. */
const DITHER_COLS = 384;
const DITHER_CELL = 3;

export type WallStatus = "loading" | "ready" | "error";

export interface BoardBackdropHandle {
  /** Re-aims the wall. `x` and `y` are the viewer offset, each in [-1, 1]. */
  aim: (x: number, y: number) => void;
}

interface BoardBackdropProps {
  scene?: WorldScene;
  /** Resting heading and tilt for the wall camera, in degrees. */
  heading?: number;
  tilt?: number;
  handleRef: React.MutableRefObject<BoardBackdropHandle | null>;
  onStatus: (status: WallStatus) => void;
}

export default function BoardBackdrop({
  scene,
  heading = 0,
  tilt = 0,
  handleRef,
  onStatus,
}: BoardBackdropProps): JSX.Element {
  const liveRef = useRef<HTMLCanvasElement>(null);
  const ditherRef = useRef<HTMLCanvasElement>(null);
  const gridRef = useRef<ReturnType<typeof createGrid>>(null);
  const wallRef = useRef<SplatWall | null>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const parityRef = useRef(0);

  const [status, setStatus] = useState<WallStatus>("loading");
  const url = scene?.spzUrl;

  /** Resamples the frame just rendered into the 1-bit half. */
  const resample = useCallback((source: HTMLCanvasElement) => {
    // Half rate: the dot grid carries far less detail than the render, and the
    // readback is the expensive half of this component.
    parityRef.current ^= 1;
    if (parityRef.current) return;
    const grid = gridRef.current;
    const canvas = ditherRef.current;
    const context = canvas?.getContext("2d");
    if (!grid || !canvas || !context || !source.width) return;
    const { ctx: g, canvas: gridCanvas } = grid;
    g.drawImage(source, 0, 0, gridCanvas.width, gridCanvas.height);
    const data = g.getImageData(0, 0, gridCanvas.width, gridCanvas.height);
    // A dim interior thresholds to almost nothing, so the levels are pushed:
    // the 1-bit half has to read as the same room, not as noise.
    ditherInPlace(data, {
      autoLevels: true,
      gain: 0.98,
      contrast: 1.35,
      lift: 0.03,
    });
    g.putImageData(data, 0, 0);
    blitGrid(context, gridCanvas, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    const canvas = liveRef.current;
    const ditherCanvas = ditherRef.current;
    if (!canvas || !ditherCanvas || !url) return;

    const rows = Math.round((DITHER_COLS * 9) / 16);
    gridRef.current = createGrid(DITHER_COLS, rows);
    ditherCanvas.width = DITHER_COLS * DITHER_CELL;
    ditherCanvas.height = rows * DITHER_CELL;

    const wall = new SplatWall({
      canvas,
      url,
      heading,
      tilt,
      onStatus: (next) => {
        setStatus(next);
        statusRef.current(next);
      },
      onFrame: resample,
    });
    wallRef.current = wall;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      wall.resize(Math.round(width), Math.round(height));
    });
    observer.observe(canvas);
    const rect = canvas.getBoundingClientRect();
    wall.resize(Math.round(rect.width) || 960, Math.round(rect.height) || 540);

    wall.start();
    void wall.load();

    return () => {
      observer.disconnect();
      wall.dispose();
      wallRef.current = null;
    };
  }, [url, heading, tilt, resample]);

  useEffect(() => {
    handleRef.current = {
      aim: (x: number, y: number) => wallRef.current?.setAim(x, y),
    };
    const handle = handleRef;
    return () => {
      handle.current = null;
    };
  }, [handleRef]);

  return (
    <div className={`board-backdrop board-backdrop-${status}`}>
      <canvas
        ref={liveRef}
        className="board-backdrop-canvas"
        role="img"
        aria-label="重建現場，視角隨視點改變"
      />
      <canvas
        ref={ditherRef}
        className="board-backdrop-dither"
        aria-hidden="true"
      />
      <span className="board-backdrop-mask" aria-hidden="true" />
    </div>
  );
}
