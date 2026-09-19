import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { Quaternion, Vector3 } from 'three';
const source = await readFile(new URL('../src/utils/remotePose.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const js = outputText.replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`);
const { RemotePoseTracker } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const packet = (seq, changes = {}) => ({ version: 1, frame: 'opencv-c2w', session_id: 'one',
  map_id: 'map', source: 'test', seq, capture_monotonic_ns: seq * 1e6,
  tracking: 'tracking', scale: 'metric', position: [0, 0, 0], quaternion_xyzw: [0, 0, 0, 1], ...changes });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('optical forward/down map to Three.js negative Z/Y without angle gain', () => {
  const tracker = new RemotePoseTracker();
  tracker.update(packet(0), 0);
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
  const pose = tracker.update(packet(1, { position: [1, 2, 3], quaternion_xyzw: yaw.toArray() }), 0);
  assert.deepEqual(pose.position, { x: 1, y: -2, z: -3 });
  close(pose.orientation.y, -yaw.y);
  close(pose.orientation.w, yaw.w);
});

test('translation is relative to the initial orientation, not world axes', () => {
  const tracker = new RemotePoseTracker();
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  tracker.update(packet(0, { position: [5, 0, 0], quaternion_xyzw: q.toArray() }), 0);
  const pose = tracker.update(packet(1, { position: [6, 0, 0], quaternion_xyzw: q.toArray() }), 0);
  close(pose.position.x, 0); close(pose.position.z, -1); close(pose.orientation.w, 1);
});

test('stale, lost, arbitrary-scale and duplicate packets cannot move camera', () => {
  const tracker = new RemotePoseTracker();
  tracker.update(packet(0), 0);
  assert.equal(tracker.update(packet(1), 251), null);
  assert.equal(tracker.update(packet(1, { tracking: 'lost' }), 0), null);
  assert.equal(tracker.update(packet(1, { scale: 'arbitrary' }), 0), null);
  assert.equal(tracker.update(packet(0), 0), null);
  assert.ok(tracker.update(packet(1), 0));
});

test('new map/session freezes until explicit recenter', () => {
  for (const change of [{ map_id: 'new' }, { session_id: 'new' }]) {
    const tracker = new RemotePoseTracker();
    tracker.update(packet(0), 0);
    assert.equal(tracker.update(packet(1, change), 0), null);
    assert.equal(tracker.update(packet(2), 0), null);
    tracker.reset();
    const pose = tracker.update(packet(0, { ...change, position: [100, 0, 0] }), 0);
    close(pose.position.x, 0);
  }
});


test('approximate demo drives view with explicit uncalibrated status', () => {
  const tracker = new RemotePoseTracker();
  assert.ok(tracker.update(packet(0, { scale: 'estimated' }), 0));
  assert.match(tracker.status, /未校正粗估/);
  assert.equal(tracker.update(packet(1, { tracking: 'initializing', tracking_reason: 'calibration_required' }), 0), null);
  assert.match(tracker.status, /需校正/);
});
