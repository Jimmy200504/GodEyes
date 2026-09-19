import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const { outputText } = ts.transpileModule(await readFile(new URL('../src/utils/gestureSocket.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { connectGestureSocket } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
function harness(run) {
  const names = ['performance', 'location', 'WebSocket', 'setTimeout', 'clearTimeout', 'window', 'document'];
  const saved = Object.fromEntries(names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let now = 0, id = 0, clears = 0;
  const timers = new Map(), sockets = [], accepted = [], statuses = [];
  class Socket {
    constructor(url) { this.url = url; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.onclose?.(); }
  }
  const doc = Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true });
  const globals = {
    performance: { now: () => now }, location: { href: 'https://example.test/', protocol: 'https:' },
    window: new EventTarget(), document: doc, WebSocket: Socket,
    setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    clearTimeout: key => timers.delete(key),
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const stop = connectGestureSocket((command, age) => { accepted.push({ command, age }); return age < 250; }, () => clears++, status => statuses.push(status));
  const message = (ws, age = 0) => ws.onmessage({ data: JSON.stringify({ version: 1, age_ms: age, gesture: 'Open', command: { forward: 1, sideways: 0, yaw: 0, pitch: 0 } }) });
  try {
    run({ sockets, timers, accepted, statuses, doc, stop, message, clears: () => clears, time: value => now = value,
      tick: ms => { const item = [...timers].find(([, value]) => value.ms === ms); assert.ok(item); timers.delete(item[0]); item[1].fn(); },
    });
  } finally {
    stop();
    for (const key of names) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  }
}
test('uses secure same-origin socket, pulls one packet at a time and includes round trip age', () => harness(h => {
  const ws = h.sockets[0];
  assert.equal(ws.url.href, 'wss://example.test/api/gesture/ws');
  ws.onopen();
  assert.deepEqual(ws.sent, ['next']);
  h.time(40); h.message(ws, 30);
  assert.equal(h.accepted[0].age, 70);
  assert.deepEqual(ws.sent, ['next', 'next']);
  h.time(300); h.message(ws, 10);
  assert.match(h.statuses.at(-1), /過期/);
  assert.ok(h.clears() > 0);
}));
test('blur and hidden pages stop immediately; silence reconnects and disposal clears timers', () => harness(h => {
  const ws = h.sockets[0]; ws.onopen(); h.message(ws);
  const before = h.clears(); window.dispatchEvent(new Event('blur'));
  assert.equal(h.clears(), before + 1);
  h.doc.hidden = true; h.message(ws);
  assert.equal(h.accepted.length, 1);
  h.tick(1000); h.tick(500);
  assert.equal(h.sockets.length, 2);
  h.stop(); assert.equal(h.timers.size, 0);
}));
test('malformed packets and failed opening stop and reconnect', () => harness(h => {
  h.tick(1500); h.tick(500);
  const ws = h.sockets[1]; ws.onopen(); ws.onmessage({ data: 'invalid' });
  assert.equal(h.accepted.length, 0);
  assert.ok(h.clears() > 0);
  h.tick(500); assert.equal(h.sockets.length, 3);
}));
