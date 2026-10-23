#!/usr/bin/env node
// City tour: one browser session over ?dev=city that screenshots every (city × view × hour) through the preview API,
// so all five cities can be inspected without a server + browser per shot. Run from web/ after `npx vite build`:
//
//   node src/dev/cityPreview/tour.mjs [--cities metropolis,portbay] [--views overview,district,street]
//        [--hours 13,22.5] [--prefix t] [--size 1920x1080] [--query "&tier=low"] [--az 330]
//        [--probe "<js expression evaluated after each shot, printed>"] [--no-shot]
//
// PNGs go to web/test-results/shots/<prefix>-<city>-<view>-<hour>.png; preview stats are printed per shot.
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outDir = join(webRoot, 'test-results', 'shots');
mkdirSync(outDir, { recursive: true });
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
};
const cities = arg('cities', 'metropolis,riverside,eastside,portbay,hilltown').split(',');
const views = arg('views', 'overview,district,street').split(',');
const hours = arg('hours', '13,22.5').split(',').map(Number);
const prefix = arg('prefix', 't');
const extra = arg('query', '');
const az = arg('az', null);
const probe = arg('probe', null);
const noShot = process.argv.includes('--no-shot');
const [width, height] = arg('size', '1920x1080').split('x').map(Number);
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const port = 4300 + Math.floor(Math.random() * 500);
const server = await preview({ root: webRoot, logLevel: 'error', preview: { port } });
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', `--window-size=${width},${height}`],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e}`));
let failed = false;
try {
  await page.goto(`${base}?dev=city&ui=0&city=${cities[0]}&view=${views[0]}&hour=${hours[0]}${extra}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__cityPreviewReady === true', { timeout: 120000 });
  for (const city of cities) {
    await page.evaluate((c) => window.__cityPreview.setCity(c), city);
    await page.waitForFunction('window.__cityPreviewReady === true', { timeout: 120000 });
    for (const view of views) {
      for (const hour of hours) {
        await page.evaluate(async (v, h, a) => {
          window.__cityPreview.setHour(h);
          await window.__cityPreview.setView(v, a === null ? undefined : a);
          await new Promise((r) => setTimeout(r, 1200));
        }, view, hour, az === null ? null : Number(az));
        const file = join(outDir, `${prefix}-${city}-${view}-${String(hour).replace('.', '_')}.png`);
        if (!noShot) await page.screenshot({ path: file });
        if (probe) console.log(JSON.stringify(await page.evaluate(probe), null, 1));
        const stats = await page.evaluate(() => window.__cityPreview.stats());
        console.log(`saved ${file}  ${stats ? `${stats.calls} calls ${Math.round(stats.drawTris / 1000)}k tris chunks ${stats.chunks}` : ''}`);
      }
    }
  }
} catch (error) {
  failed = true;
  console.error(`tour failed: ${error}`);
} finally {
  if (errors.length) console.log(errors.slice(0, 30).join('\n'));
  await browser.close();
  await server.httpServer.close();
  process.exit(failed || errors.some((e) => e.startsWith('[pageerror]')) ? 1 : 0);
}
