import { access, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { parseOptions, prepareOutput, createFrameWriter, verifyFrames } from './cli-utils.mjs';
import { CdpPipe } from './cdp-pipe.mjs';
import { validateManifest, memoryEstimate } from './runtime/core.mjs';

const help = `MacBook offline export (uses installed Chrome; no interactive Web UI)
npm run precompute:mac -- --out ./precomputed-output
  --views 21|45|60          default: 45
  --width 960 --height 540  maximum: 1280 × 720
  --format jpeg|rgb565le    default: jpeg
  --chrome /path/to/browser optional Chrome/Edge executable
Requires macOS, project npm dependencies, and Google Chrome or Microsoft Edge.`;

let server, child, cdp, profile, closing;
async function cleanup() {
  if (closing) return closing;
  closing = (async () => {
    cdp?.close();
    if (child && child.exitCode === null && child.signalCode === null && child.pid) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exited; clearTimeout(timer);
    }
    await server?.close();
    if (profile) await rm(profile, { recursive: true, force: true });
  })();
  return closing;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
});

try {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) { console.log(help); process.exit(0); }
  // Guard BEFORE importing Vite, starting Chrome or creating a listener.
  if (process.platform !== 'darwin') throw new Error('離線預算圖僅允許在 macOS 執行；禁止在 i.MX93 啟動渲染器');
  const candidates = options.chrome ? [options.chrome] : [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  let executable;
  for (const path of candidates) {
    try { await access(path, constants.X_OK); executable = path; break; } catch { /* try next */ }
  }
  if (!executable) throw new Error('找不到 Chrome / Edge；請安裝或用 --chrome 指定執行檔');
  const { createServer } = await import('vite');
  await prepareOutput(options.out);
  const token = randomBytes(32).toString('hex');
  const writer = createFrameWriter(options, token, (done, count) => console.log(`已寫入 ${done}/${count} 張`));
  server = await createServer({
    configFile: false, root: fileURLToPath(new URL('.', import.meta.url)),
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, open: false },
    plugins: [{ name: 'offline-frame-writer', configureServer(s) { s.middlewares.use(writer.middleware); } }],
  });
  await server.listen();
  const port = server.httpServer.address().port;
  profile = await mkdtemp(join(tmpdir(), 'godeyes-export-'));
  console.log(`開始匯出 ${options.views} 視角，${options.width}×${options.height} ${options.format}\n輸出：${options.out}`);
  const started = Date.now();
  // Separate disposable profile; GPU stays enabled. No desktop window or folder picker.
  child = spawn(executable, ['--headless', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let chromeErrors = '';
  child.stderr.on('data', chunk => { chromeErrors = (chromeErrors + chunk).slice(-4000); });
  cdp = new CdpPipe(child);
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: `http://127.0.0.1:${port}/export.html` });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const deadline = Date.now() + 120000;
    let ready = false;
    while (Date.now() < deadline) {
      const result = await cdp.send('Runtime.evaluate', { expression: 'typeof window.runPrecompute === "function"', returnByValue: true }, sessionId);
      if (result.result?.value) { ready = true; break; }
      await delay(200);
    }
    if (!ready) throw new Error('渲染模組載入逾時，請檢查上方 Vite 錯誤');
    const { width, height, columns, format } = options;
    const result = await cdp.send('Runtime.evaluate', {
      expression: `window.runPrecompute(${JSON.stringify({ width, height, columns, format, token })})`,
      awaitPromise: true, returnByValue: true,
    }, sessionId, 30 * 60 * 1000);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    const manifest = validateManifest(result.result.value);
    await verifyFrames(manifest, options, writer.written);
    for (const name of ['index.html', 'style.css', 'viewer.mjs', 'core.mjs']) {
      await copyFile(new URL(`./runtime/${name}`, import.meta.url), join(options.out, name), constants.COPYFILE_EXCL);
    }
    manifest.exportSeconds = Math.round((Date.now() - started) / 1000);
    // Commit marker written last; interrupted exports never look complete.
    await writeFile(join(options.out, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    const memory = memoryEstimate(width, height, options.views);
    console.log(`完成：${manifest.exportSeconds} 秒，影像 ${(manifest.totalBytes / 1048576).toFixed(1)} MiB，三張影像快取 ${(memory.rgbaCache / 1048576).toFixed(1)} MiB（不含瀏覽器等開銷）`);
  } catch (error) {
    if (chromeErrors) console.error('Chrome diagnostics:\n' + chromeErrors);
    throw error;
  }
} catch (error) {
  console.error(`匯出失敗：${error.message}`); process.exitCode = 1;
} finally {
  await cleanup();
}
