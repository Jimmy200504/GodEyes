import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseOptions, prepareOutput, createFrameWriter, verifyFrames } from '../precompute/cli-utils.mjs';
import { CdpPipe } from '../precompute/cdp-pipe.mjs';

test('CLI parses bounded options and rejects malformed arguments', () => {
  assert.equal(parseOptions([]).columns, 15);
  assert.equal(parseOptions(['--views', '21', '--out', '/tmp/output with spaces']).columns, 7);
  assert.deepEqual(parseOptions(['--help']), { help: true });
  for (const args of [['--width', '1920'], ['--height', 'NaN'], ['--views', '90'], ['--out'], ['--unknown', 'a'], ['--format', 'yuv']]) {
    assert.throws(() => parseOptions(args));
  }
});

test('output preparation preserves existing files and rejects occupied directories', async t => {
  const out = await mkdtemp(join(tmpdir(), 'precompute-test-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await writeFile(join(out, 'keep.txt'), 'keep');
  await assert.rejects(prepareOutput(out), /不是空/);
  assert.equal(await readFile(join(out, 'keep.txt'), 'utf8'), 'keep');
  await prepareOutput(join(out, 'new'));
  await assert.rejects(prepareOutput(join(out, 'new')), /不是空/);
});

async function request(writer, name, bytes, token = 'test-token') {
  const req = Readable.from([bytes]);
  req.url = '/__precompute/frame/' + name;
  req.method = 'POST'; req.headers = { 'x-export-token': token };
  const response = { statusCode: 200, end(message) { this.message = message; } };
  await writer.middleware(req, response, () => assert.fail('Unexpected fallthrough'));
  return response;
}

test('frame writer authenticates, rejects traversal, limits bytes and verifies complete output', async t => {
  const out = await mkdtemp(join(tmpdir(), 'precompute-test-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await prepareOutput(out);
  const options = { out, width: 1, height: 1, views: 1, format: 'rgb565le' };
  const writer = createFrameWriter(options, 'test-token');
  const pixels = Buffer.from([0, 248]);
  assert.equal((await request(writer, 'view-000.rgb565', pixels, 'wrong')).statusCode, 403);
  assert.equal((await request(writer, '../escape', pixels)).statusCode, 409);
  assert.equal((await request(writer, 'view-000.rgb565', Buffer.alloc(70000))).statusCode, 400);
  assert.equal((await request(writer, 'view-000.rgb565', Buffer.alloc(1))).statusCode, 400);
  assert.equal((await request(writer, 'view-000.rgb565', pixels)).statusCode, 200);
  assert.equal((await request(writer, 'view-000.rgb565', pixels)).statusCode, 409);
  assert.deepEqual(await readFile(join(out, 'frames/view-000.rgb565')), pixels);
  const manifest = { width: 1, height: 1, format: 'rgb565le', frames: [{ file: 'frames/view-000.rgb565' }], totalBytes: 2 };
  await verifyFrames(manifest, options, writer.written);
  await assert.rejects(verifyFrames({ ...manifest, totalBytes: 3 }, options, writer.written), /byte count/);
  await assert.rejects(verifyFrames(manifest, { ...options, views: 2 }, writer.written), /Incomplete/);
});

function mockChrome() {
  const child = new EventEmitter();
  child.stdio = [null, null, null, new PassThrough(), new PassThrough()];
  return child;
}
test('CDP pipe handles fragmented responses, protocol errors and child exit', async () => {
  const child = mockChrome(), cdp = new CdpPipe(child);
  let sent = '';
  child.stdio[3].on('data', chunk => { sent += chunk; });
  const pending = cdp.send('Runtime.evaluate', { expression: '1' }, 'session');
  assert.equal(JSON.parse(sent.slice(0, -1)).sessionId, 'session');
  child.stdio[4].write('{"id":1,"res');
  child.stdio[4].write('ult":{"value":1}}\0');
  assert.deepEqual(await pending, { value: 1 });
  const failure = cdp.send('Invalid');
  child.stdio[4].write('{"id":2,"error":{"message":"unsupported"}}\0');
  await assert.rejects(failure, /unsupported/);
  const interrupted = cdp.send('Runtime.evaluate');
  child.emit('exit', 1);
  await assert.rejects(interrupted, /Chrome exited/);
  assert.equal(cdp.pending.size, 0);
});

test('CDP timeout frees pending commands', async () => {
  const cdp = new CdpPipe(mockChrome());
  await assert.rejects(cdp.send('Test', {}, undefined, 5), /timed out/);
  assert.equal(cdp.pending.size, 0); cdp.close();
});

test('non-Mac guard exits before dependency imports or browser/server startup', { skip: process.platform === 'darwin' }, () => {
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', fileURLToPath(new URL('../precompute/serve-mac.mjs', import.meta.url))], { encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /僅允許在 macOS/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
});
