import assert from 'node:assert/strict';
import test from 'node:test';
import { validateManifest, nearestFrame, memoryEstimate, encodeRgb565, decodeRgb565, FramePlayer } from '../precompute/runtime/core.mjs';

const manifest = () => ({ version: 1, width: 960, height: 540, format: 'jpeg', frames: [
  { yaw: -35, pitch: 0, file: 'frames/a.jpg' },
  { yaw: 0, pitch: 0, file: 'frames/b.jpg' },
  { yaw: 35, pitch: 0, file: 'frames/c.jpg' },
  { yaw: 0, pitch: 10, file: 'frames/d.jpg' },
] });

test('view selection handles center, limits and vertical input', () => {
  const { frames } = validateManifest(manifest());
  assert.equal(nearestFrame(frames, 0, 0), 1);
  assert.equal(nearestFrame(frames, -200, 0), 0);
  assert.equal(nearestFrame(frames, 200, 0), 2);
  assert.equal(nearestFrame(frames, 0, 8), 3);
  assert.throws(() => nearestFrame(frames, NaN, 0));
});

test('reject malformed, oversized and path-escaping scene packages', () => {
  for (const patch of [{ width: 1920 }, { height: 0 }, { version: 2 }, { format: 'yuv' },
    { frames: [] }, { frames: Array(61).fill(manifest().frames[0]) },
    { frames: [{ yaw: 0, pitch: 0, file: '../scene.jpg' }] },
    { frames: [{ yaw: Infinity, pitch: 0, file: 'frames/a.jpg' }] },
    { format: 'rgb565le' }, { frames: [manifest().frames[0], manifest().frames[0]] }]) {
    assert.throws(() => validateManifest({ ...manifest(), ...patch }));
  }
});

test('memory estimates distinguish storage from three decoded frames', () => {
  assert.deepEqual(memoryEstimate(960, 540, 45), { rgb565Storage: 46656000, rgbaCache: 6220800 });
  assert.equal(memoryEstimate(1280, 720, 60).rgb565Storage, 110592000);
});

test('RGB565 uses little-endian R5G6B5 with opaque reconstruction', () => {
  const source = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const encoded = encodeRgb565(source);
  assert.deepEqual([...encoded], [0, 248, 224, 7, 31, 0, 255, 255]);
  assert.deepEqual(decodeRgb565(encoded, 4, 1), source);
  assert.throws(() => decodeRgb565(encoded, 5, 1));
  const mid = new Uint8ClampedArray([120, 130, 140, 255]);
  const decoded = decodeRgb565(encodeRgb565(mid), 1, 1);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(mid[i] - decoded[i]) <= 7);
});

function fakeFrame(id, closed) { return { id, close() { closed.push(id); } }; }
test('rapid input coalesces to latest view; never displays stale completion', async () => {
  let finish;
  const loaded = [], drawn = [], closed = [];
  const player = new FramePlayer({
    load: id => { loaded.push(id); return new Promise(resolve => { finish = () => resolve(fakeFrame(id, closed)); }); },
    draw: frame => drawn.push(frame.id), error: assert.fail,
  });
  const done = player.request(0);
  player.request(1); player.request(2);
  assert.deepEqual(loaded, [0]);
  finish(); await Promise.resolve();
  assert.deepEqual(loaded, [0, 2]);
  assert.deepEqual(drawn, []);
  finish(); await done;
  assert.deepEqual(drawn, [2]);
  player.dispose(); assert.deepEqual(closed, [0, 2]);
});

test('cache evicts before decoding and releases all bitmaps on disposal', async () => {
  const closed = [], loaded = [];
  let live = 0, peak = 0;
  const player = new FramePlayer({
    load: async id => {
      loaded.push(id); live++; peak = Math.max(peak, live);
      return { id, close() { live--; closed.push(id); } };
    }, draw() {}, error: assert.fail,
  });
  for (const id of [0, 1, 2, 0, 3]) await player.request(id);
  assert.deepEqual(loaded, [0, 1, 2, 3]);
  assert.deepEqual(closed, [1]);
  assert.equal(peak, 3); assert.equal(player.cache.size, 3);
  player.dispose(); assert.equal(live, 0);
});

test('failed frames can retry; disposal closes an in-flight decode', async () => {
  let attempts = 0, errors = 0, finish;
  const closed = [], drawn = [];
  const player = new FramePlayer({
    load: async id => { if (++attempts === 1) throw new Error('missing'); return fakeFrame(id, closed); },
    draw: frame => drawn.push(frame.id), error() { errors++; },
  });
  await player.request(0); assert.equal(errors, 1);
  await player.request(0); assert.deepEqual(drawn, [0]);
  player.load = id => new Promise(resolve => { finish = () => resolve(fakeFrame(id, closed)); });
  const done = player.request(1); player.dispose(); finish(); await done;
  assert.deepEqual(closed, [0, 1]); assert.deepEqual(drawn, [0]);
});
