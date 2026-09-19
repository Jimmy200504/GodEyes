import { useEffect, useRef } from "react";
import { drawRamp } from "../utils/dither";

const CELL = 4;
const COLS = 56;
const ROWS = 22;
const BANDS = 7;

/**
 * The 1-bit coverage scale: solid at the top, thinning to sparse dots. It is
 * the page's legend for the dithering used on the wordmark and the orbit render.
 */
export default function DitherRamp(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const source = document.createElement("canvas");
    source.width = COLS;
    source.height = ROWS;
    const sourceCtx = source.getContext("2d");
    if (!sourceCtx) return;
    drawRamp(sourceCtx, COLS, ROWS, BANDS);

    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, []);

  return (
    <figure className="ramp">
      <canvas ref={canvasRef} aria-hidden="true" />
      <figcaption>1-BIT COVERAGE</figcaption>
    </figure>
  );
}
