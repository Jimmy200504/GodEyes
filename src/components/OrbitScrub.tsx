import { useCallback, useEffect, useRef, useState } from "react";
import { blitGrid, createGrid, ditherInPlace } from "../utils/dither";

interface OrbitFrame {
  yaw: number;
  pitch: number;
  file: string;
}

interface OrbitManifest {
  width: number;
  height: number;
  frames: OrbitFrame[];
}

const BASE = "/orbit/";
/** Dot pitch in CSS pixels. Narrow screens use a finer grid so the scene stays
 * legible at a small size. */
function cellFor(width: number): number {
  return width < 700 ? 3 : 4;
}
const ROW = 15; // frames per pitch row in the manifest grid

const STEPS = [
  {
    id: "02.1",
    label: "SWEEP",
    title: "同一個現場，十五個視角",
    body: "水平掃過 yaw −35° 到 +35°。每一格都是從重建出來的 splat 場景算出的視角，不是同一張照片的平移。",
  },
  {
    id: "02.2",
    label: "PITCH",
    title: "抬頭與俯視，換一排重算",
    body: "俯仰切到另一組 pitch。視差是真的：近處的物件移動得比遠處快，遮擋關係隨視角改變。",
  },
  {
    id: "02.3",
    label: "HOLD",
    title: "這是你戴上裝置後會看見的東西",
    body: "預算視角只是把它攤平。實際進入現場時，這 45 格會變成連續的、由你的頭部姿態驅動的視角。",
  },
];

export default function OrbitScrub(): JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const readyRef = useRef<boolean[]>([]);
  const gridRef = useRef<ReturnType<typeof createGrid>>(null);
  const sizeRef = useRef({ cols: 0, rows: 0 });
  const rafRef = useRef(0);
  const drawnRef = useRef(-1);

  const [manifest, setManifest] = useState<OrbitManifest | null>(null);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(false);
  const [gridVersion, setGridVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}manifest.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("manifest"))))
      .then((data: OrbitManifest) => {
        if (!cancelled) setManifest(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Centre frame first so the panel is never blank, then fan outwards.
  useEffect(() => {
    if (!manifest) return;
    const frames = manifest.frames;
    imagesRef.current = new Array(frames.length);
    readyRef.current = new Array(frames.length).fill(false);
    let live = true;
    let done = 0;

    const middle = (frames.length - 1) / 2;
    const order = frames
      .map((_, i) => i)
      .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));

    order.forEach((i, position) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        if (!live) return;
        readyRef.current[i] = true;
        done += 1;
        drawnRef.current = -1;
        setLoaded(done);
      };
      image.onerror = () => {
        if (live && position === 0) setFailed(true);
      };
      image.src = BASE + frames[i].file;
      imagesRef.current[i] = image;
    });

    return () => {
      live = false;
    };
  }, [manifest]);

  // Scroll position inside the pinned section picks the frame.
  useEffect(() => {
    if (!manifest) return;
    const section = sectionRef.current;
    if (!section) return;
    const count = manifest.frames.length;

    const update = (): void => {
      rafRef.current = 0;
      const rect = section.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) return;
      const progress = Math.min(1, Math.max(0, -rect.top / travel));
      setIndex(Math.min(count - 1, Math.floor(progress * count)));
    };
    const onScroll = (): void => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [manifest]);

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const cell = cellFor(rect.width);
    const cols = Math.max(48, Math.floor(rect.width / cell));
    const rows = Math.max(27, Math.round((cols * 9) / 16));
    canvas.width = cols * cell;
    canvas.height = rows * cell;
    sizeRef.current = { cols, rows };
    gridRef.current = createGrid(cols, rows);
    drawnRef.current = -1;
    setGridVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    measure();
    const canvas = canvasRef.current;
    if (!canvas) return;
    let last = 0;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width);
      if (next === last) return;
      last = next;
      measure();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [measure]);

  // Dither the nearest decoded frame, so scrubbing never stalls on a cold image.
  useEffect(() => {
    const canvas = canvasRef.current;
    const grid = gridRef.current;
    if (!canvas || !grid || !manifest) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let pick = -1;
    for (let offset = 0; offset < manifest.frames.length; offset += 1) {
      if (readyRef.current[index - offset]) {
        pick = index - offset;
        break;
      }
      if (readyRef.current[index + offset]) {
        pick = index + offset;
        break;
      }
    }
    if (pick < 0 || pick === drawnRef.current) return;
    const image = imagesRef.current[pick];
    if (!image) return;

    const { cols, rows } = sizeRef.current;
    const { ctx: g, canvas: gridCanvas } = grid;
    g.drawImage(image, 0, 0, cols, rows);
    const data = g.getImageData(0, 0, cols, rows);
    ditherInPlace(data, { autoLevels: true, gain: 1.1, contrast: 1.25, lift: 0.05 });
    g.putImageData(data, 0, 0);
    blitGrid(ctx, gridCanvas, canvas.width, canvas.height);
    drawnRef.current = pick;
  }, [index, manifest, loaded, gridVersion]);

  const frame = manifest?.frames[index];
  const count = manifest?.frames.length ?? 0;
  const step = Math.min(STEPS.length - 1, Math.floor(index / ROW));
  const current = STEPS[step];

  return (
    <section className="orbit" id="orbit" ref={sectionRef}>
      <div className="orbit-pin">
        <div className="orbit-grid">
          <div className="orbit-side">
            <h2>
              <span>換個角度看現場</span>
            </h2>
            <p className="orbit-lead">
              往下捲動，從不同角度觀察建築與街道。
            </p>
          </div>

          <div className="orbit-main">
            <div className="orbit-screen">
              <canvas
                ref={canvasRef}
                className="orbit-canvas"
                role="img"
                aria-label={
                  frame
                    ? `重建現場視角，水平 ${frame.yaw} 度、俯仰 ${frame.pitch} 度`
                    : "重建現場視角"
                }
              />
              {failed && (
                <p className="orbit-fallback" role="status">
                  場景預覽無法載入，仍可從下方選擇現場。
                </p>
              )}
            </div>

            <div className="ruler">
              <span className="ruler-num">1</span>
              <span className="ruler-track">
                <span
                  className="ruler-fill"
                  style={{ width: `${count ? ((index + 1) / count) * 100 : 0}%` }}
                />
                {Array.from({ length: count }, (_, i) => (
                  <span key={i} className="ruler-tick" />
                ))}
              </span>
              <span className="ruler-num">3</span>
            </div>

            <div className="orbit-caption">
              <div>
                <h3>{current.title}</h3>
                <p>{current.body}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
