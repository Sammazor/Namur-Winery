// NAMURA Wine Studio - deterministic frame renderer.
// Serves studio/dist, drives headless Chromium (WebGL2 / SwiftShader) frame-by-frame,
// receives raw RGBA over HTTP and streams it into FFmpeg (PNG sequence or stills).
//
//   node pipeline/render/render.mjs --w 1080 --h 1920 --out build/frames_1080      (full film)
//   node pipeline/render/render.mjs --times 1.5,4.2,17 --out build/stills          (stills)
//   options: --from N --to N (frame range, resume), --step N
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(process.env.NODE_PATH || '/opt/node22/lib/node_modules', 'playwright'))); }

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]]) : a), []));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DIST = path.join(ROOT, 'studio/dist');
const W = +(args.w ?? 1080), H = +(args.h ?? 1920);
const OUT = path.resolve(ROOT, args.out ?? `build/frames_${W}x${H}`);
fs.mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
let onFrame = null;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/frame/')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { const buf = Buffer.concat(chunks); res.end('ok'); onFrame && onFrame(+req.url.split('/')[2], buf); });
    return;
  }
  const p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(DIST) || !fs.existsSync(p)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', MIME[path.extname(p)] ?? 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', '--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.type(), m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.setDefaultTimeout(0);
await page.goto(`http://127.0.0.1:${port}/index.html?w=${W}&h=${H}${args.q ? '&' + args.q : ''}`);
await page.waitForFunction(() => window.NAMURA_READY || window.NAMURA_ERROR, null, { timeout: 0 });
const err = await page.evaluate(() => window.NAMURA_ERROR);
if (err) { console.error(err); process.exit(1); }
const { frames, FPS } = await page.evaluate(() => ({ frames: window.NAMURA.frames, FPS: window.NAMURA.FPS }));

const ffArgs = (out, start) => ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-framerate', String(FPS), '-i', '-', '-vf', 'vflip', '-start_number', String(start), out];

let list;
if (args.times) list = String(args.times).split(',').map((t) => Math.round(+t * FPS));
else { const from = +(args.from ?? 0), to = +(args.to ?? frames - 1), step = +(args.step ?? 1); list = []; for (let i = from; i <= to; i += step) list.push(i); }

const t0 = Date.now();
for (const [n, i] of list.entries()) {
  const file = path.join(OUT, args.times ? `still_${(i / FPS).toFixed(2)}s.png` : `f_${String(i).padStart(4, '0')}.png`);
  const got = new Promise((res) => { onFrame = (_, buf) => res(buf); });
  const timing = await page.evaluate(([i, url]) => window.NAMURA.renderAndUpload(i, url), [i, `/frame/${i}`]);
  const buf = await got;
  await new Promise((res, rej) => {
    const ff = spawn('ffmpeg', ffArgs(file, 0).slice(0, -3).concat(['-frames:v', '1', file]));
    ff.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))); ff.stdin.end(buf);
  });
  const el = (Date.now() - t0) / 1000, per = el / (n + 1);
  console.log(`frame ${i} (${n + 1}/${list.length})  render ${timing.render.toFixed(0)}ms  upload ${timing.upload.toFixed(0)}ms  avg ${per.toFixed(2)}s  eta ${((list.length - n - 1) * per / 60).toFixed(1)}min`);
}
await browser.close(); server.close();
