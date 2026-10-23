#!/usr/bin/env node
// Screenshot any page of the web client in real Chrome (GPU via Metal/ANGLE).
//
//   node scripts/shoot.mjs --query "?dev=assets" --out gallery.png [--wait 4000] [--size 1920x1080]
//                          [--dev] [--eval "window.__x = 1"] [--ready "() => window.__ready === true"]
//                          [--frames 3 --interval 1500]   # several shots over time (name-1.png, name-2.png…)
//
// Serves ./dist with `vite preview` by default (run `npx vite build` first) or the
// sources with `--dev`. Writes PNGs to web/test-results/shots/ and prints console
// errors / page errors. Exit code 1 if the page threw.
import puppeteer from 'puppeteer-core';
import { createServer, preview } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const outDir = join(webRoot, 'test-results', 'shots');
mkdirSync(outDir, { recursive: true });

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const dev = process.argv.includes('--dev');
const headed = process.argv.includes('--headed');
const query = arg('query', '');
const out = arg('out', 'shot.png');
const wait = Number(arg('wait', '3000'));
const [width, height] = arg('size', '1920x1080').split('x').map(Number);
const evalJs = arg('eval', null);
const ready = arg('ready', null);
const frames = Number(arg('frames', '1'));
const interval = Number(arg('interval', '1500'));
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const port = 4300 + Math.floor(Math.random() * 500);
const server = dev
  ? await createServer({ root: webRoot, logLevel: 'error', server: { port } })
  : await preview({ root: webRoot, logLevel: 'error', preview: { port } });
if (dev) await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: headed ? false : 'new',
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e}`));

let threw = false;
try {
  await page.goto(base + query, { waitUntil: 'domcontentloaded' });
  if (ready) await page.waitForFunction(ready, { timeout: 60000 });
  if (evalJs) await page.evaluate(evalJs);
  await new Promise((r) => setTimeout(r, wait));
  const stem = basename(out, extname(out));
  for (let i = 0; i < frames; i++) {
    const file = join(outDir, frames === 1 ? `${stem}.png` : `${stem}-${i + 1}.png`);
    await page.screenshot({ path: file });
    console.log(`saved ${file}`);
    if (i + 1 < frames) await new Promise((r) => setTimeout(r, interval));
  }
} catch (error) {
  threw = true;
  console.error(`shoot failed: ${error}`);
} finally {
  if (errors.length) console.log(errors.join('\n'));
  await browser.close();
  await (dev ? server.close() : server.httpServer.close());
  process.exit(threw || errors.some((e) => e.startsWith('[pageerror]')) ? 1 : 0);
}
