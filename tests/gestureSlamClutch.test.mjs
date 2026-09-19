import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { Quaternion, Vector3 } from 'three';
const { outputText } = ts.transpileModule(await readFile(new URL('../src/utils/gestureSlamClutch.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const js = outputText.replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`);
const { GestureSlamClutch } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const pose = (x, yaw = 0) => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  return { x: .5, y: .5, z: 1, position: { x, y: 0, z: 0 }, orientation: { x: q.x, y: q.y, z: q.z, w: q.w } };
};
const q = p => new Quaternion(p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w);

test('hand freezes measured SLAM, stale/missing samples never release, confirmed absence rebases without a jump', () => {
  const clutch = new GestureSlamClutch();
  const before = clutch.apply(pose(2, .3), 1);
  clutch.observeHand(true, true, 0);
  assert.deepEqual(clutch.apply(pose(8, 1), 2), before);
  clutch.observeHand(false, true, 100);
  clutch.observeHand(false, false, 500);
  assert.equal(clutch.held, true);
  clutch.observeHand(false, true, 600);
  clutch.observeHand(false, true, 951);
  assert.equal(clutch.held, false);
  assert.equal(clutch.waiting, true);
  assert.deepEqual(clutch.apply(pose(8, 1), 2), before);
  const resumed = clutch.apply(pose(10, 1), 3);
  assert.ok(Math.abs(resumed.position.x - before.position.x) < 1e-9);
  assert.ok(q(resumed).angleTo(q(before)) < 1e-7);
  assert.equal(clutch.waiting, false);
  const next = clutch.apply(pose(11, 1.1), 4);
  assert.ok(Math.abs(new Vector3(next.position.x - resumed.position.x, next.position.y - resumed.position.y, next.position.z - resumed.position.z).length() - 1) < 1e-9);
  assert.ok(Math.abs(q(next).angleTo(q(resumed)) - .1) < 1e-7);
});

test('new hand interrupts pending resume and reset clears the rebase', () => {
  const clutch = new GestureSlamClutch();
  const held = clutch.apply(pose(3), 1);
  clutch.observeHand(true, true, 0);
  clutch.observeHand(false, true, 50);
  clutch.observeHand(false, true, 450);
  clutch.observeHand(true, true, 451);
  assert.deepEqual(clutch.apply(pose(20), 2), held);
  clutch.reset();
  assert.deepEqual(clutch.apply(pose(0), 3), pose(0));
});


test('an active one-second motion keeps SLAM held even without a detected hand', () => {
  const clutch = new GestureSlamClutch();
  const before = clutch.apply(pose(2), 1);
  clutch.observeHand(true, true, 0);
  for (const now of [100, 500, 900]) {
    clutch.observeHand(false, true, now, true);
    assert.deepEqual(clutch.apply(pose(8), 2), before);
  }
  clutch.observeHand(false, true, 1000, false);
  clutch.observeHand(false, true, 1300, false);
  assert.equal(clutch.held, true);
  clutch.observeHand(false, true, 1351, false);
  assert.equal(clutch.waiting, true);
  assert.deepEqual(clutch.apply(pose(8), 2), before);
});
