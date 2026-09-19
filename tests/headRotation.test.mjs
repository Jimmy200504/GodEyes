import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { Euler, Matrix4, Quaternion, Vector3, PerspectiveCamera } from 'three';

async function loadSource(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const js = outputText.replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { HeadRotationTracker, HeadHeightTracker } = await loadSource('../src/utils/headPose.ts');
const { OffAxisCamera } = await loadSource('../src/utils/offAxisCamera.ts');
const identity = new Matrix4().toArray();
const calibration = { screenWidthCm: 34, screenHeightCm: 19, viewingDistanceCm: 60 };

test('height follows rising and crouching smoothly relative to the initial pose', () => {
  const tracker = new HeadHeightTracker();
  const pose = y => new Matrix4().makeTranslation(0, y, -40).toArray();
  assert.equal(tracker.update(pose(5)), 0);
  const first = tracker.update(pose(15));
  assert.ok(first > 0 && first < 0.1);
  let height;
  for (let i = 0; i < 60; i++) height = tracker.update(pose(15));
  assert.ok(Math.abs(height - 0.1) < 1e-6);
  for (let i = 0; i < 60; i++) height = tracker.update(pose(-5));
  assert.ok(Math.abs(height + 0.1) < 1e-6);
  tracker.reset();
  assert.equal(tracker.update(pose(-5)), 0);
});

test('height ignores rotation and depth, rejects invalid data and bounds extreme movement', () => {
  const tracker = new HeadHeightTracker();
  const pose = new Matrix4().makeTranslation(0, 5, -40).toArray();
  assert.equal(tracker.update(pose), 0);
  const rotated = new Matrix4().compose(new Vector3(10, 5, -80),
    new Quaternion().setFromEuler(new Euler(0.3, 0.4, 0.2)), new Vector3(1, 1, 1)).toArray();
  assert.equal(tracker.update(rotated), 0);
  assert.equal(tracker.update([NaN]), null);
  assert.equal(tracker.update(Array(16).fill(0)), null);
  assert.equal(tracker.update(pose), 0);
  for (const y of [-10000, 10000]) {
    const height = tracker.update(new Matrix4().makeTranslation(0, y, -40).toArray());
    assert.ok(Number.isFinite(height) && Math.abs(height) <= 0.5);
  }
});

test('camera height is independent of amplified rotation and does not accumulate', () => {
  const camera = new PerspectiveCamera(75, 1.5, 0.1, 1000);
  const controller = new OffAxisCamera(camera, calibration);
  const orientation = new Quaternion().setFromEuler(new Euler(0.1, 0.2, 0, 'YXZ'));
  const expected = new Quaternion().setFromEuler(new Euler(0.2, 0.8, 0, 'YXZ'));
  for (const heightOffset of [0.1, -0.1, -0.1, 0]) {
    controller.updateFromHeadPose({ x: 0.5, y: 0.5, z: 1, orientation, heightOffset });
    assert.equal(camera.position.y, heightOffset);
    assert.equal(camera.position.z, 0.6);
    assert.ok(camera.quaternion.angleTo(expected) < 1e-6);
  }
});

for (const [axis, direction] of [['x', -1], ['y', 1], ['z', -1]]) {
  const gain = axis === 'x' ? 2 : 4;
  test(`${axis}: measured angles reach camera at 1:${gain}`, () => {
    const tracker = new HeadRotationTracker();
    tracker.update(identity);
    const camera = new PerspectiveCamera(75, 1.5, 0.1, 1000);
    const controller = new OffAxisCamera(camera, calibration);
    for (const degrees of [-90, -60, -30, -10, 0, 10, 30, 60, 90]) {
      const vector = new Vector3(); vector[axis] = 1;
      const angle = degrees * Math.PI / 180;
      const input = new Quaternion().setFromAxisAngle(vector, angle);
      const matrix = new Matrix4().compose(new Vector3(2, 3, -40), input, new Vector3(2, 2, 2));
      const orientation = tracker.update(matrix.toArray());
      controller.updateFromHeadPose({ x: 0.5, y: 0.5, z: 1, orientation });
      const expected = new Quaternion().setFromAxisAngle(vector, angle * direction * gain);
      assert.ok(camera.quaternion.angleTo(expected) < 1e-6);
      assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
    }
  });
}
test('combined yaw, pitch and roll use independent gains and remain stable across frames', () => {
  const camera = new PerspectiveCamera(75, 1.5, 0.1, 1000);
  const controller = new OffAxisCamera(camera, calibration);
  for (const sign of [-1, 1]) {
    const pitch = sign * 10 * Math.PI / 180;
    const yaw = sign * 20 * Math.PI / 180;
    const roll = sign * 5 * Math.PI / 180;
    const orientation = new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'));
    const expected = new Quaternion().setFromEuler(new Euler(pitch * 2, yaw * 4, roll * 4, 'YXZ'));
    for (let frame = 0; frame < 3; frame++) {
      controller.updateFromHeadPose({ x: 0.5, y: 0.5, z: 1, orientation });
      assert.ok(camera.quaternion.angleTo(expected) < 1e-6);
    }
  }
});
test('recenter uses next valid pose, rejects malformed matrices', () => {
  const tracker = new HeadRotationTracker();
  const pose = new Matrix4().makeRotationY(0.7).toArray();
  assert.equal(tracker.update([NaN]), null);
  assert.equal(tracker.update(Array(16).fill(0)), null);
  assert.ok(Math.abs(tracker.update(pose).w - 1) < 1e-12);
  tracker.update(identity);
  tracker.reset();
  assert.ok(Math.abs(tracker.update(pose).w - 1) < 1e-12);
});
