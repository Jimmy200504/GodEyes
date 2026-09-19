import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { Quaternion, Vector3 } from 'three';

const source = await readFile(new URL('../src/utils/gestureNavigation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const js = outputText.replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`);
const { GestureNavigation } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const stop = { forward: 0, sideways: 0, yaw: 0, pitch: 0 };

test('all four movement directions, facing-relative motion and diagonal speed cap', () => {
  const nav = new GestureNavigation();
  for (const [command, expected] of [
    [{ forward: 1 }, [0, 0, -.015]], [{ forward: -1 }, [0, 0, .015]],
    [{ sideways: -1 }, [-.015, 0, 0]], [{ sideways: 1 }, [.015, 0, 0]],
  ]) {
    nav.reset();
    nav.accept({ ...stop, ...command }, 0, 0);
    nav.update(.05, new Quaternion(), 1);
    assert.ok(nav.offset.distanceTo(new Vector3(...expected)) < 1e-9);
  }
  nav.reset();
  nav.accept({ ...stop, forward: 1, sideways: 1 }, 0, 0);
  nav.update(10, new Quaternion(), 1);
  assert.ok(Math.abs(nav.offset.length() - .015) < 1e-9);
  nav.reset();
  nav.accept({ ...stop, forward: 1 }, 0, 0);
  nav.update(.05, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), 1);
  assert.ok(nav.offset.distanceTo(new Vector3(-.015, 0, 0)) < 1e-9);
});

test('rotation composes with head orientation, persists after stop and resets', () => {
  const nav = new GestureNavigation();
  const head = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .2);
  nav.accept({ ...stop, yaw: -1, pitch: 1 }, 0, 0);
  const rotated = head.clone();
  nav.update(.05, rotated, 1);
  const expected = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 60)
    .multiply(head).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 60));
  assert.ok(rotated.angleTo(expected) < 1e-7);
  nav.clear();
  const held = head.clone();
  nav.update(.05, held, 2);
  assert.ok(held.angleTo(rotated) < 1e-7);
  nav.reset();
  const reset = head.clone();
  nav.update(.05, reset, 3);
  assert.ok(reset.angleTo(head) < 1e-7);
});

test('expired, malformed, stop and clear commands cannot leave motion active', () => {
  for (const halt of [
    nav => nav.clear(),
    nav => nav.accept(stop, 0, 1),
    nav => nav.accept({ ...stop, forward: NaN }, 0, 1),
    nav => nav.accept({ ...stop, yaw: 2 }, 0, 1),
    nav => nav.accept(null, 0, 1),
    nav => nav.accept({ ...stop, forward: 1 }, 250, 1),
  ]) {
    const nav = new GestureNavigation();
    nav.accept({ ...stop, forward: 1, yaw: 1 }, 0, 0);
    halt(nav);
    const orientation = new Quaternion();
    nav.update(.05, orientation, 2);
    assert.equal(nav.offset.length(), 0);
    assert.equal(orientation.angleTo(new Quaternion()), 0);
  }
  const nav = new GestureNavigation();
  nav.accept({ ...stop, forward: 1 }, 200, 1000);
  nav.update(.05, new Quaternion(), 1050);
  assert.equal(nav.offset.length(), 0);
});

test('pitch clamps and movement stays horizontal after rotation', () => {
  const nav = new GestureNavigation();
  for (let index = 0; index < 100; index++) {
    nav.accept({ ...stop, pitch: 1 }, 0, index);
    nav.update(.05, new Quaternion(), index);
  }
  const orientation = new Quaternion();
  nav.clear();
  nav.update(.05, orientation, 100);
  assert.ok(Math.abs(orientation.angleTo(new Quaternion()) - Math.PI / 3) < 1e-7);
  nav.accept({ ...stop, forward: 1 }, 0, 101);
  nav.update(.05, new Quaternion(), 101);
  assert.equal(nav.offset.y, 0);
  assert.ok(nav.offset.z < 0);
});

test('finger up/down translates vertically without rotating; nonfinite vertical input is rejected', () => {
  const nav = new GestureNavigation();
  const head = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .5);
  for (const sign of [1, -1]) {
    nav.reset();
    nav.accept({ ...stop, vertical: sign }, 0, 0);
    const view = head.clone();
    nav.update(.05, view, 1);
    assert.ok(nav.offset.distanceTo(new Vector3(0, sign * .015, 0)) < 1e-9);
    assert.ok(view.angleTo(head) < 1e-7);
  }
  assert.equal(nav.accept({ ...stop, vertical: NaN }, 0, 0), false);
});
