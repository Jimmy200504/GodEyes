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
const { RemotePoseTracker, AdaptivePoseSmoother } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
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


const measuredPose = (x = 0, yaw = 0) => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  return { x: .5, y: .5, z: 1, position: { x, y: 0, z: 0 },
    orientation: { x: q.x, y: q.y, z: q.z, w: q.w } };
};
const rotationOf = pose => new Quaternion(pose.orientation.x, pose.orientation.y,
  pose.orientation.z, pose.orientation.w);

test('adaptive filtering reduces stationary position and angular jitter at 20 Hz', () => {
  const filter = new AdaptivePoseSmoother();
  filter.update(measuredPose(), 0);
  let positionPower = 0, anglePower = 0;
  for (let i = 1; i <= 100; i++) {
    const sign = i % 2 ? 1 : -1;
    const output = filter.update(measuredPose(.005 * sign, .02 * sign), i / 20);
    if (i > 20) {
      positionPower += output.position.x ** 2;
      anglePower += rotationOf(output).angleTo(new Quaternion()) ** 2;
    }
  }
  assert.ok(Math.sqrt(positionPower / 80) < .005 * .6);
  assert.ok(Math.sqrt(anglePower / 80) < .02 * .6);
});

test('smoothing follows sustained movement without waiting for a pause', () => {
  const filter = new AdaptivePoseSmoother();
  filter.update(measuredPose(), 0);
  let output;
  for (let i = 1; i <= 4; i++) output = filter.update(measuredPose(.2, Math.PI / 2), i / 20);
  assert.ok(output.position.x > .16 && output.position.x <= .2);
  assert.ok(rotationOf(output).angleTo(rotationOf(measuredPose(0, Math.PI / 2))) < .25);
});

test('quaternion sign changes and wrap-around use shortest arc', () => {
  const filter = new AdaptivePoseSmoother();
  const initial = measuredPose(0, 179 * Math.PI / 180);
  filter.update(initial, 0);
  const negative = structuredClone(initial);
  for (const key of ['x', 'y', 'z', 'w']) negative.orientation[key] *= -1;
  const unchanged = filter.update(negative, .05);
  close(rotationOf(initial).angleTo(rotationOf(unchanged)), 0);
  const wrapped = filter.update(measuredPose(0, -179 * Math.PI / 180), .1);
  assert.ok(rotationOf(initial).angleTo(rotationOf(wrapped)) < 2.1 * Math.PI / 180);
  close(rotationOf(wrapped).length(), 1);
});

test('capture gaps reset history and repeated/backward timestamps do not advance it', () => {
  const filter = new AdaptivePoseSmoother();
  filter.update(measuredPose(), 0);
  close(filter.update(measuredPose(1), 0).position.x, 0);
  close(filter.update(measuredPose(1), -.1).position.x, 0);
  close(filter.update(measuredPose(1), 1).position.x, 1);
  filter.reset();
  close(filter.update(measuredPose(2), 2).position.x, 2);
});

test('filter behavior remains similar across variable camera rates', () => {
  const run = frequency => {
    const filter = new AdaptivePoseSmoother();
    filter.update(measuredPose(), 0);
    let output;
    for (let i = 1; i <= frequency; i++) output = filter.update(measuredPose(.2 * i / frequency), i / frequency);
    return output.position.x;
  };
  assert.ok(Math.abs(run(17) - run(23)) < .01);
});

test('tracker toggle and tracking loss clear smoothing without changing origin', () => {
  const tracker = new RemotePoseTracker(true);
  tracker.update(packet(0), 0);
  const first = tracker.update(packet(1, { capture_monotonic_ns: 50e6, position: [.01, 0, 0] }), 0);
  assert.ok(first.position.x > 0 && first.position.x < .01);
  tracker.setSmoothing(false);
  close(tracker.update(packet(2, { capture_monotonic_ns: 100e6, position: [.1, 0, 0] }), 0).position.x, .1);
  tracker.setSmoothing(true);
  tracker.update(packet(3, { capture_monotonic_ns: 150e6, tracking: 'lost' }), 0);
  close(tracker.update(packet(4, { capture_monotonic_ns: 200e6, position: [.2, 0, 0] }), 0).position.x, .2);
  tracker.reset();
  close(tracker.update(packet(5, { capture_monotonic_ns: 250e6, position: [.2, 0, 0] }), 0).position.x, 0);
});
