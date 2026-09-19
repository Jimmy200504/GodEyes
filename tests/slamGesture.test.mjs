import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { Quaternion, Vector3 } from 'three';

async function module(name) {
  const source = await readFile(new URL(`../src/utils/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const js = outputText.replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { RemotePoseTracker } = await module('remotePose');
const { RenderPoseSmoother } = await module('renderPose');
const { GestureNavigation } = await module('gestureNavigation');
const packet = (seq, change = {}) => ({ source: 'cpu-sparse-vo-local', session_id: 'one', map_id: 'sparse-one', seq,
  capture_monotonic_ns: seq * 50e6, tracking: 'tracking', scale: 'arbitrary', position: [0, 0, 0], quaternion_xyzw: [0, 0, 0, 1], ...change });
const orientation = pose => new Quaternion(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w);

test('arbitrary-scale SLAM accepts gesture rotation and forward/backward without feeding offsets into tracking', () => {
  const tracker = new RemotePoseTracker(false, true, true);
  const smoother = new RenderPoseSmoother();
  smoother.enabled = false;
  const nav = new GestureNavigation();
  tracker.update(packet(0), 0);
  const headYaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .4);
  const head = tracker.update(packet(1, { position: [1, 0, 2], quaternion_xyzw: headYaw.toArray() }), 0);
  smoother.setTarget(head, 0);
  const measured = smoother.step(0);
  nav.accept({ forward: 1, sideways: 0, yaw: 1, pitch: 0 }, 0, 0);
  const camera = orientation(measured);
  nav.update(.05, camera, 1);
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 60);
  assert.ok(camera.angleTo(rotation.multiply(orientation(measured))) < 1e-7);
  assert.ok(Math.abs(nav.offset.length() - .015) < 1e-9);
  assert.ok(new Vector3(measured.position.x, measured.position.y, measured.position.z).distanceTo(new Vector3(1, 0, -2)) < 1e-9);
  nav.accept({ forward: -1, sideways: 0, yaw: 0, pitch: 0 }, 0, 2);
  nav.update(.05, orientation(measured), 3);
  assert.ok(nav.offset.length() < 1e-9);
  assert.deepEqual(smoother.step(4), measured);
});

test('SLAM loss and automatic map rebuild preserve gesture displacement; reset clears both', () => {
  const tracker = new RemotePoseTracker(false, true, true);
  const nav = new GestureNavigation();
  const smoother = new RenderPoseSmoother();
  tracker.update(packet(0), 0);
  const head = tracker.update(packet(1, { position: [1, 0, 0] }), 0);
  smoother.setTarget(head, 0);
  const held = smoother.step(0);
  nav.accept({ forward: 1, sideways: 0, yaw: 0, pitch: 0 }, 0, 0);
  nav.update(.05, orientation(held), 1);
  const offset = nav.offset.clone();
  assert.equal(tracker.update(packet(2, { tracking: 'lost' }), 0), null);
  smoother.hold();
  nav.update(.05, orientation(smoother.step(300)), 300);
  assert.ok(nav.offset.equals(offset)); // Expired gesture cannot drift during SLAM loss.
  const rebuilt = tracker.update(packet(0, { session_id: 'two', map_id: 'sparse-two', previous_session_id: 'one', reset_reason: 'lost_timeout' }), 0);
  assert.deepEqual(rebuilt.position, head.position);
  assert.ok(nav.offset.equals(offset));
  tracker.reset(); smoother.reset(); nav.reset();
  assert.equal(nav.offset.length(), 0);
  const fresh = tracker.update(packet(3), 0);
  assert.ok(new Vector3(fresh.position.x, fresh.position.y, fresh.position.z).length() < 1e-9);
});
