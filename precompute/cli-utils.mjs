import { mkdir, readdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export function parseOptions(args) {
  const options = { out: 'precomputed-output', width: 960, height: 540, views: 45, format: 'jpeg' };
  const allowed = new Set(['out', 'width', 'height', 'views', 'format', 'chrome']);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') return { help: true };
    const key = args[i].slice(2), value = args[++i];
    if (!args[i - 1].startsWith('--') || !allowed.has(key) || !value || value.startsWith('--')) throw new Error('無效參數，請使用 --help');
    options[key] = ['width', 'height', 'views'].includes(key) ? Number(value) : value;
  }
  if (![21, 45, 60].includes(options.views)) throw new Error('--views 須為 21、45 或 60');
  if (!['jpeg', 'rgb565le'].includes(options.format)) throw new Error('--format 須為 jpeg 或 rgb565le');
  if (!Number.isInteger(options.width) || options.width < 1 || options.width > 1280 ||
      !Number.isInteger(options.height) || options.height < 1 || options.height > 720) throw new Error('解析度上限為 1280 × 720');
  options.columns = options.views / 3;
  options.out = resolve(options.out);
  return options;
}

export async function prepareOutput(path) {
  await mkdir(path, { recursive: true });
  if ((await readdir(path)).length) throw new Error(`輸出資料夾不是空的：${path}；請使用新的 --out 路徑`);
  await mkdir(join(path, 'frames'));
}

export function createFrameWriter(options, token, progress = () => {}) {
  const written = new Map();
  const extension = options.format === 'jpeg' ? 'jpg' : 'rgb565';
  const allowed = new Set(Array.from({ length: options.views }, (_, i) => `view-${String(i).padStart(3, '0')}.${extension}`));
  let busy = false;
  const middleware = async (req, res, next) => {
    const prefix = '/__precompute/frame/';
    if (!req.url?.startsWith(prefix)) return next();
    const supplied = Buffer.from(String(req.headers['x-export-token'] ?? ''));
    const secret = Buffer.from(token);
    if (req.method !== 'POST' || supplied.length !== secret.length || !timingSafeEqual(supplied, secret)) {
      res.statusCode = 403; res.end('Unauthorized export request'); return;
    }
    const name = req.url.slice(prefix.length);
    if (!allowed.has(name) || written.has(name) || busy) {
      res.statusCode = 409; res.end('Invalid, duplicate or concurrent frame'); return;
    }
    busy = true;
    try {
      const maxBytes = options.width * options.height * 4 + 65536;
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('Frame exceeds size limit');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (options.format === 'rgb565le' && size !== options.width * options.height * 2) throw new Error('Invalid RGB565 length');
      if (options.format === 'jpeg' && (size < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[size - 2] !== 255 || bytes[size - 1] !== 217)) throw new Error('Invalid JPEG');
      await writeFile(join(options.out, 'frames', name), bytes, { flag: 'wx' });
      written.set(name, size);
      progress(written.size, options.views);
      res.end('OK');
    } catch (error) {
      res.statusCode = 400; res.end(error.message);
    } finally { busy = false; }
  };
  return { middleware, written };
}

export async function verifyFrames(manifest, options, written) {
  if (manifest.width !== options.width || manifest.height !== options.height || manifest.format !== options.format ||
      manifest.frames.length !== options.views || written.size !== options.views) throw new Error('Incomplete or inconsistent export');
  let total = 0;
  for (const frame of manifest.frames) {
    const size = (await stat(join(options.out, frame.file))).size;
    if (written.get(frame.file.slice('frames/'.length)) !== size) throw new Error('Frame size mismatch');
    total += size;
  }
  if (total !== manifest.totalBytes) throw new Error('Export byte count mismatch');
}
