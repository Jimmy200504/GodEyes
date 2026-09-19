import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { Quaternion, Vector3 } from 'three';

const source = await readFile(new URL('../src/utils/keyboardNavigation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const js = outputText.replace(/from ['"]three['"]/g, `from '${import.meta.resolve('three')}'`);
const { KeyboardNavigation } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
function key(target, type, code, extra = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, ...extra });
  target.dispatchEvent(event);
}

test('WASD moves in the facing direction, cancels opposites and normalizes diagonals', () => {
  const target = new EventTarget();
  const navigation = new KeyboardNavigation(target);
  const identity = new Quaternion();
  for (const [code, expected] of [['KeyW', [0, 0, -0.015]], ['KeyS', [0, 0, 0.015]], ['KeyA', [-0.015, 0, 0]], ['KeyD', [0.015, 0, 0]]]) {
    navigation.reset();
    key(target, 'keydown', code);
    navigation.update(0.05, identity);
    assert.ok(navigation.offset.distanceTo(new Vector3(...expected)) < 1e-10);
  }
  navigation.reset();
  key(target, 'keydown', 'KeyW');
  key(target, 'keydown', 'KeyD');
  navigation.update(0.05, identity);
  assert.ok(Math.abs(navigation.offset.length() - 0.015) < 1e-10);
  navigation.reset();
  key(target, 'keydown', 'KeyW');
  key(target, 'keydown', 'KeyS');
  navigation.update(0.05, identity);
  assert.equal(navigation.offset.length(), 0);
  key(target, 'keyup', 'KeyS');
  navigation.update(0.05, new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));
  assert.ok(navigation.offset.distanceTo(new Vector3(-0.015, 0, 0)) < 1e-10);
  navigation.dispose();
});

test('release, blur, hidden page, shortcuts and disposal stop movement; frame gaps are capped', () => {
  const target = new EventTarget();
  const navigation = new KeyboardNavigation(target);
  const identity = new Quaternion();
  for (const stop of [
    () => key(target, 'keyup', 'KeyW'),
    () => target.dispatchEvent(new Event('blur')),
    () => window.dispatchEvent(new Event('blur')),
    () => document.dispatchEvent(new Event('visibilitychange')),
    () => key(target, 'keydown', 'KeyW', { ctrlKey: true }),
    () => navigation.dispose(),
  ]) {
    navigation.reset();
    key(target, 'keydown', 'KeyW');
    stop();
    navigation.update(0.05, identity);
    assert.equal(navigation.offset.length(), 0);
  }
  const fresh = new KeyboardNavigation(target);
  key(target, 'keydown', 'KeyW');
  fresh.update(10, identity);
  assert.ok(Math.abs(fresh.offset.length() - 0.015) < 1e-10);
  fresh.dispose();
});
