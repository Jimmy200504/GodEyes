import { useCallback, useEffect, useRef, useState } from "react";
import { blitGrid, createGrid, ditherInPlace } from "../utils/dither";

interface Splat {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  angle: number;
  spin: number;
  scale: number;
  stretch: number;
  delay: number;
}

const WORD = "GODEYES";
const CELL = 5;
const SPLATS = 2600;
const DURATION = 2800;
const HOLD = 240;

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/** Box-Muller. The cloud starts gaussian, the way a splat init does. */
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeKernel(): HTMLCanvasElement {
  const size = 24;
  const kernel = document.createElement("canvas");
  kernel.width = size;
  kernel.height = size;
  const ctx = kernel.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return kernel;
}

interface Sampled {
  splats: Splat[];
  mask: HTMLCanvasElement | null;
}

/** Rasterises the word once at grid resolution and samples its coverage. */
function sampleWord(cols: number, rows: number): Sampled {
  const grid = createGrid(cols, rows);
  if (!grid) return { splats: [], mask: null };
  const { ctx } = grid;

  const size = Math.min(rows * 1.02, (cols / WORD.length) * 1.48);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${size}px Archivo, system-ui, sans-serif`;
  ctx.fillText(WORD, cols / 2, rows / 2 + size * 0.02);

  const { data } = ctx.getImageData(0, 0, cols, rows);
  const hits: number[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (data[(y * cols + x) * 4 + 3] > 120) hits.push(y * cols + x);
    }
  }
  if (!hits.length) return { splats: [], mask: null };

  const spread = Math.min(cols, rows) * 0.9;
  const splats: Splat[] = [];
  for (let i = 0; i < SPLATS; i += 1) {
    const cell = hits[Math.floor(Math.random() * hits.length)];
    const tx = (cell % cols) + Math.random();
    const ty = Math.floor(cell / cols) + Math.random();
    splats.push({
      tx,
      ty,
      sx: tx + gaussian() * spread,
      sy: ty + gaussian() * spread * 0.45,
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 3,
      scale: 0.75 + Math.random() * 0.75,
      stretch: 2 + Math.random() * 5,
      delay: Math.random() * 0.36,
    });
  }
  return { splats, mask: grid.canvas };
}

export default function SplatWordmark(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const startRef = useRef(0);
  const splatsRef = useRef<Splat[]>([]);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [settled, setSettled] = useState(false);

  const replay = useCallback(() => {
    setSettled(false);
    setRunKey((n) => n + 1);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const kernel = makeKernel();
    let grid: ReturnType<typeof createGrid> = null;
    let cols = 0;
    let rows = 0;
    let width = 0;
    let height = 0;

    const paint = (progress: number): void => {
      if (!grid) return;
      const { ctx: g, canvas: gridCanvas } = grid;
      g.fillStyle = "#000";
      g.fillRect(0, 0, cols, rows);

      const splats = splatsRef.current;
      for (let i = 0; i < splats.length; i += 1) {
        const s = splats[i];
        const local = Math.min(
          1,
          Math.max(0, (progress - s.delay) / (1 - s.delay)),
        );
        const e = easeOutExpo(local);
        const x = s.sx + (s.tx - s.sx) * e;
        const y = s.sy + (s.ty - s.sy) * e;
        // Large and anisotropic while unoptimised, tight and round once solved.
        const bloom = 1 + (1 - e) * 5;
        const rx = s.scale * bloom * (1 + (1 - e) * s.stretch);
        const ry = s.scale * bloom;

        g.save();
        g.translate(x, y);
        g.rotate(s.angle + s.spin * (1 - e));
        g.globalAlpha = 0.3 + e * 0.7;
        g.drawImage(kernel, -rx, -ry, rx * 2, ry * 2);
        g.restore();
      }
      const mask = maskRef.current;
      if (mask) {
        const settle = Math.max(0, (progress - 0.45) / 0.55);
        g.globalAlpha = settle * settle;
        g.drawImage(mask, 0, 0);
      }
      g.globalAlpha = 1;

      const image = g.getImageData(0, 0, cols, rows);
      ditherInPlace(image, { gain: 1.25, contrast: 1.15, lift: 0.02 });
      g.putImageData(image, 0, 0);
      blitGrid(ctx, gridCanvas, width, height);
    };

    const measure = (): void => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      cols = Math.max(24, Math.floor(rect.width / CELL));
      rows = Math.max(8, Math.floor(rect.height / CELL));
      // One device pixel per grid cell edge keeps the squares crisp.
      canvas.width = cols * CELL;
      canvas.height = rows * CELL;
      width = canvas.width;
      height = canvas.height;
      grid = createGrid(cols, rows);
      const sampled = sampleWord(cols, rows);
      splatsRef.current = sampled.splats;
      maskRef.current = sampled.mask;
    };

    const run = (now: number): void => {
      if (!startRef.current) startRef.current = now;
      const progress = Math.min(
        1,
        Math.max(0, (now - startRef.current - HOLD) / DURATION),
      );
      paint(progress);
      if (progress < 1) frameRef.current = requestAnimationFrame(run);
      else setSettled(true);
    };

    const boot = (): void => {
      measure();
      cancelAnimationFrame(frameRef.current);
      startRef.current = 0;
      if (reduced.matches) {
        paint(1);
        setSettled(true);
        return;
      }
      frameRef.current = requestAnimationFrame(run);
    };

    // Wait for Archivo, or the sampled mask is a fallback face.
    if (document.fonts?.ready) void document.fonts.ready.then(boot);
    else boot();

    let last = 0;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width);
      if (next === last) return;
      last = next;
      measure();
      paint(1);
      setSettled(true);
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
    };
  }, [runKey]);

  return (
    <div className="mark">
      <canvas ref={canvasRef} className="mark-canvas" aria-hidden="true" />
      <h1 className="sr-only">GodEyes</h1>
      <div className="mark-bar">
        <span>{settled ? "CONVERGED" : "OPTIMISING"}</span>
        <span className="mark-bar-mid">
          {SPLATS.toLocaleString("en-US")} GAUSSIANS · 1-BIT
        </span>
        <button type="button" className="keycap" onClick={replay}>
          重跑收斂 <b>R</b>
        </button>
      </div>
    </div>
  );
}
