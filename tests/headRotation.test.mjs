import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { Matrix4, Quaternion, Vector3, PerspectiveCamera } from 'three';

async function loadSource(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const js = outputText.replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { HeadRotationTracker } = await loadSource('../src/utils/headPose.ts');
const { OffAxisCamera } = await loadSource('../src/utils/offAxisCamera.ts');
const identity = new Matrix4().toArray();
const calibration = { screenWidthCm: 34, screenHeightCm: 19, viewingDistanceCm: 60 };

for (const [axis, direction] of [['x', -1], ['y', 1], ['z', -1]]) {
  test(`${axis}: measured ±30°, ±60°, ±90° reaches camera at 1:1`, () => {
    const tracker = new HeadRotationTracker();
    tracker.update(identity);
    const camera = new PerspectiveCamera(75, 1.5, 0.1, 1000);
    const controller = new OffAxisCamera(camera, calibration);
    for (const degrees of [-90, -60, -30, 0, 30, 60, 90]) {
      const vector = new Vector3(); vector[axis] = 1;
      const angle = degrees * Math.PI / 180;
      const input = new Quaternion().setFromAxisAngle(vector, angle);
      const matrix = new Matrix4().compose(new Vector3(2, 3, -40), input, new Vector3(2, 2, 2));
      const orientation = tracker.update(matrix.toArray());
      controller.updateFromHeadPose({ x: 0.5, y: 0.5, z: 1, orientation });
      const expected = new Quaternion().setFromAxisAngle(vector, angle * direction);
      assert.ok(camera.quaternion.angleTo(expected) < 1e-6);
      assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
    }
  });
}
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
