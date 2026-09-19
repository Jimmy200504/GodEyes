export const LIMITS = Object.freeze({ width: 1280, height: 720, frames: 60, cache: 3 });

export function validateManifest(m) {
  if (!m || m.version !== 1 || !['jpeg', 'rgb565le'].includes(m.format)) throw new Error('不支援的場景格式');
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(m[key]) || m[key] < 1 || m[key] > LIMITS[key]) throw new Error(`超出 ${key} 上限`);
  }
  if (!Array.isArray(m.frames) || !m.frames.length || m.frames.length > LIMITS.frames) throw new Error('視角數量須為 1–60');
  const names = new Set();
  for (const f of m.frames) {
    if (!Number.isFinite(f.yaw) || !Number.isFinite(f.pitch) || Math.abs(f.yaw) > 180 || Math.abs(f.pitch) > 90 ||
      typeof f.file !== 'string' || !/^frames\/[a-zA-Z0-9_-]+\.(jpg|rgb565)$/.test(f.file) || names.has(f.file)) {
      throw new Error('無效的視角資料');
    }
    if (!f.file.endsWith(m.format === 'jpeg' ? '.jpg' : '.rgb565')) throw new Error('影像副檔名與格式不符');
    names.add(f.file);
  }
  return m;
}

export function nearestFrame(frames, yaw, pitch) {
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw new Error('無效角度');
  let best = 0, distance = Infinity;
  frames.forEach((f, i) => {
    const d = (f.yaw - yaw) ** 2 + (f.pitch - pitch) ** 2;
    if (d < distance) { best = i; distance = d; }
  });
  return best;
}

export function memoryEstimate(width, height, count) {
  return { rgb565Storage: width * height * 2 * count, rgbaCache: width * height * 4 * LIMITS.cache };
}

export function encodeRgb565(rgba) {
  const out = new Uint8Array(rgba.length / 2);
  for (let p = 0, j = 0; p < rgba.length; p += 4, j += 2) {
    const n = ((rgba[p] >> 3) << 11) | ((rgba[p + 1] >> 2) << 5) | (rgba[p + 2] >> 3);
    out[j] = n & 255; out[j + 1] = n >> 8;
  }
  return out;
}

export function decodeRgb565(bytes, width, height) {
  if (bytes.length !== width * height * 2) throw new Error('RGB565 檔案大小不符');
  const out = new Uint8ClampedArray(width * height * 4);
  for (let p = 0, j = 0; p < out.length; p += 4, j += 2) {
    const n = bytes[j] | bytes[j + 1] << 8;
    const r = n >> 11, g = n >> 5 & 63, b = n & 31;
    out[p] = (r << 3) | (r >> 2); out[p + 1] = (g << 2) | (g >> 4);
    out[p + 2] = (b << 3) | (b >> 2); out[p + 3] = 255;
  }
  return out;
}

// One decode at a time; intermediate input is coalesced, never queued.
export class FramePlayer {
  constructor({ load, draw, error, capacity = LIMITS.cache }) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > LIMITS.cache) throw new Error('無效快取大小');
    Object.assign(this, { load, draw, error, capacity });
    this.cache = new Map(); this.wanted = null; this.shown = null; this.running = false; this.closed = false;
  }
  request(index) {
    if (this.closed) return;
    this.wanted = index;
    if (!this.running) this.pending = this.pump();
    return this.pending;
  }
  async pump() {
    this.running = true;
    try {
      while (!this.closed && this.wanted !== this.shown) {
        const index = this.wanted;
        let frame = this.cache.get(index);
        if (!frame) {
          // Evict BEFORE allocating the next bitmap.
          while (this.cache.size >= this.capacity) {
            const key = this.cache.keys().next().value;
            this.cache.get(key).close(); this.cache.delete(key);
          }
          try { frame = await this.load(index); }
          catch (e) {
            if (this.closed) return;
            if (index !== this.wanted) continue;
            this.error(e); return;
          }
          if (this.closed) { frame.close(); return; }
        }
        this.cache.delete(index); this.cache.set(index, frame);
        if (index === this.wanted) { this.draw(frame, index); this.shown = index; }
      }
    } finally { this.running = false; }
  }
  dispose() {
    this.closed = true;
    for (const frame of this.cache.values()) frame.close();
    this.cache.clear();
  }
}
