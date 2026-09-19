import { validateManifest, nearestFrame, decodeRgb565, FramePlayer } from './core.mjs';

const canvas = document.querySelector('#view');
const ctx = canvas.getContext('2d', { alpha: false });
const status = document.querySelector('#status');
const yaw = document.querySelector('#yaw'), pitch = document.querySelector('#pitch');
const reset = document.querySelector('#reset'), retry = document.querySelector('#retry');
const controller = new AbortController();
let player, manifest;

async function checkedFetch(path) {
  const response = await fetch(path, { signal: controller.signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}
function select() {
  if (player) player.request(nearestFrame(manifest.frames, +yaw.value, +pitch.value));
}
function setView(y, p) {
  if (!manifest || !Number.isFinite(y) || !Number.isFinite(p)) return;
  yaw.value = String(Math.max(+yaw.min, Math.min(+yaw.max, y)));
  pitch.value = String(Math.max(+pitch.min, Math.min(+pitch.max, p)));
  select();
}

async function start() {
  try {
    manifest = validateManifest(await (await checkedFetch('./manifest.json')).json());
    canvas.width = manifest.width; canvas.height = manifest.height;
    for (const [input, axis] of [[yaw, 'yaw'], [pitch, 'pitch']]) {
      input.min = Math.min(...manifest.frames.map(f => f[axis]));
      input.max = Math.max(...manifest.frames.map(f => f[axis]));
      input.disabled = false;
    }
    player = new FramePlayer({
      async load(index) {
        const response = await checkedFetch(manifest.frames[index].file);
        let bitmap;
        if (manifest.format === 'rgb565le') {
          const bytes = new Uint8Array(await response.arrayBuffer());
          bitmap = await createImageBitmap(new ImageData(decodeRgb565(bytes, manifest.width, manifest.height), manifest.width, manifest.height));
        } else {
          bitmap = await createImageBitmap(await response.blob());
        }
        if (bitmap.width !== manifest.width || bitmap.height !== manifest.height) {
          bitmap.close(); throw new Error('影像尺寸與 manifest 不符');
        }
        return bitmap;
      },
      draw(bitmap, index) {
        ctx.drawImage(bitmap, 0, 0);
        const frame = manifest.frames[index];
        status.textContent = `左右 ${frame.yaw.toFixed(1)}° · 上下 ${frame.pitch.toFixed(1)}°`;
        retry.hidden = true;
      },
      error(error) { status.textContent = `影像載入失敗：${error.message}`; retry.hidden = false; },
    });
    reset.disabled = false;
    setView(0, 0);
  } catch (error) {
    status.textContent = `無法載入預算場景：${error.message}。請先在 MacBook 匯出完整資料夾。`;
    retry.hidden = false;
  }
}
yaw.addEventListener('input', select); pitch.addEventListener('input', select);
reset.addEventListener('click', () => setView(0, 0));
retry.addEventListener('click', () => player ? select() : start());
let drag;
canvas.addEventListener('pointerdown', e => {
  if (!manifest) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: +yaw.value, pitch: +pitch.value };
  canvas.setPointerCapture(e.pointerId); canvas.focus();
});
canvas.addEventListener('pointermove', e => {
  if (drag && e.pointerId === drag.id) setView(drag.yaw - (e.clientX - drag.x) / canvas.clientWidth * (+yaw.max - +yaw.min),
    drag.pitch + (e.clientY - drag.y) / canvas.clientHeight * (+pitch.max - +pitch.min));
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { drag = null; });
canvas.addEventListener('keydown', e => {
  const offsets = { ArrowLeft: [5, 0], ArrowRight: [-5, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
  const delta = offsets[e.key];
  if (delta) { e.preventDefault(); setView(+yaw.value + delta[0], +pitch.value + delta[1]); }
});
// Optional future native/NPU pose source: radians must be converted to degrees by the caller.
window.precomputedView = Object.freeze({ setView });
window.addEventListener('pagehide', () => { controller.abort(); player?.dispose(); });
window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
void start();
