/**
 * 1-bit ordered dithering.
 *
 * Everything visual on the landing page goes through this: the wordmark, the
 * orbit render, the ramp block. One image model, one texture.
 */

const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

/** Pre-flattened to a plain array so the inner loop stays cheap. */
const THRESHOLD = new Float32Array(64);
for (let y = 0; y < 8; y += 1) {
  for (let x = 0; x < 8; x += 1) {
    THRESHOLD[y * 8 + x] = (BAYER_8[y][x] + 0.5) / 64;
  }
}

export interface DitherOptions {
  /** Raises or lowers the overall coverage. 1 is neutral. */
  gain?: number;
  /** Pushes midtones apart before thresholding. 1 is neutral. */
  contrast?: number;
  /** Lifts the floor so dark areas keep some dots. */
  lift?: number;
  /**
   * Stretches the frame's own luminance range to full scale before
   * thresholding. Without it a dim scene dithers to almost solid black and a
   * bright one to almost solid white, so coverage would depend on the scene
   * rather than on its structure.
   */
  autoLevels?: boolean;
}

const HISTOGRAM = new Uint32Array(256);

/** Returns the [low, high] luma cut points at the given tail fraction. */
function levels(data: Uint8ClampedArray, tail: number): [number, number] {
  HISTOGRAM.fill(0);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma =
      (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    HISTOGRAM[luma] += 1;
    count += 1;
  }
  const cut = Math.max(1, Math.floor(count * tail));

  let low = 0;
  for (let seen = 0, v = 0; v < 256; v += 1) {
    seen += HISTOGRAM[v];
    if (seen >= cut) {
      low = v;
      break;
    }
  }
  let high = 255;
  for (let seen = 0, v = 255; v >= 0; v -= 1) {
    seen += HISTOGRAM[v];
    if (seen >= cut) {
      high = v;
      break;
    }
  }
  if (high - low < 16) return [0, 255];
  return [low / 255, high / 255];
}

/**
 * Thresholds `source` in place against the Bayer matrix and writes an opaque
 * black-and-white result. `source` must be the low-resolution dot grid, not the
 * display-sized image.
 */
export function ditherInPlace(
  source: ImageData,
  options: DitherOptions = {},
): ImageData {
  const { gain = 1, contrast = 1, lift = 0, autoLevels = false } = options;
  const { data, width, height } = source;
  const [low, high] = autoLevels ? levels(data, 0.015) : [0, 1];
  const range = high - low || 1;

  for (let y = 0; y < height; y += 1) {
    const row = (y % 8) * 8;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      // Rec. 601 luma, which tracks perceived brightness closely enough here.
      let value =
        (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      if (autoLevels) value = Math.min(1, Math.max(0, (value - low) / range));
      value *= gain;
      if (contrast !== 1) value = (value - 0.5) * contrast + 0.5;
      value = lift + value * (1 - lift);
      const on = value > THRESHOLD[row + (x % 8)] ? 255 : 0;
      data[i] = on;
      data[i + 1] = on;
      data[i + 2] = on;
      data[i + 3] = 255;
    }
  }
  return source;
}

/**
 * Creates the offscreen pair every dithered surface needs: a grid-sized buffer
 * to sample into, and the context used to read it back.
 */
export function createGrid(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  return { canvas, ctx };
}

/**
 * Blits a dot grid onto a display canvas with hard edges, so each cell reads as
 * a square pixel rather than a blurred dot.
 */
export function blitGrid(
  target: CanvasRenderingContext2D,
  grid: HTMLCanvasElement,
  width: number,
  height: number,
): void {
  target.imageSmoothingEnabled = false;
  target.clearRect(0, 0, width, height);
  target.drawImage(grid, 0, 0, width, height);
}

/**
 * The stripe → checker → dot ramp: a 1-bit coverage scale, drawn as a column of
 * bands that each dither a constant grey.
 */
export function drawRamp(
  ctx: CanvasRenderingContext2D,
  cols: number,
  rows: number,
  bands: number,
): void {
  const image = ctx.createImageData(cols, rows);
  const { data } = image;
  for (let y = 0; y < rows; y += 1) {
    const band = Math.floor((y / rows) * bands);
    const level = 1 - (band + 0.5) / bands;
    for (let x = 0; x < cols; x += 1) {
      const i = (y * cols + x) * 4;
      const on = level > THRESHOLD[(y % 8) * 8 + (x % 8)] ? 255 : 0;
      data[i] = on;
      data[i + 1] = on;
      data[i + 2] = on;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
