#!/usr/bin/env node
// U2 panel tour: plays the tutorial (supermarket via the full build flow selling
// soft drinks, a soft-drink factory, an R&D centre, months of play) and
// screenshots every U2 panel state into web/test-results/u2/<W>x<H>/.
// Serves ./dist (run `npx vite build` first). From web/:
//   node src/ui/panels/_shared-a/__tour__/u2tour.mjs [--size 1920x1080]
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../../../../..');
const arg = (n, f) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : f;
};
const [width, height] = arg('size', '1920x1080').split('x').map(Number);
const outDir = join(webRoot, 'test-results', 'u2', `${width}x${height}`);
mkdirSync(outDir, { recursive: true });

const port = 4600 + Math.floor(Math.random() * 300);
const server = await preview({ root: webRoot, logLevel: 'error', preview: { port } });
const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', `--window-size=${width},${height}`],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => void d.accept().catch(() => {}));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sel = (t) => `[data-testid="${t}"]`;
const click = async (t, timeout = 15000) => {
  await page.waitForSelector(sel(t), { visible: true, timeout });
  await page.click(sel(t));
};
const shot = async (name) => {
  await page.mouse.move(width / 2, height - 3);
  await sleep(500);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('  shot', name);
};
const step = async () => {
  const before = await page.$eval(sel('date'), (e) => e.textContent);
  await click('step-month');
  await page.waitForFunction((s, b) => document.querySelector(s)?.textContent !== b, { timeout: 20000 }, sel('date'), before);
  await sleep(400);
};
const closeAll = async () => {
  for (let i = 0; i < 5; i++) {
    const open = await page.evaluate(() => !!document.querySelector('[data-testid^="overlay-"], [data-testid^="drawer-"]:not([data-testid="drawer-close"]), [role="dialog"]'));
    if (!open) return;
    await page.keyboard.press('Escape');
    await sleep(250);
  }
};
const tab = async (container, label) => {
  const handles = await page.$$(`${sel(container)} [role="tab"]`);
  for (const h of handles) {
    if ((await h.evaluate((e) => e.textContent?.trim())) === label) {
      await h.click();
      await sleep(700);
      return;
    }
  }
  throw new Error(`no tab ${label} in ${container}`);
};
const dismissToasts = async () => {
  await page.evaluate(() => window.__magnate?.alerts.getState().toasts.forEach((t) => window.__magnate.alerts.getState().dismissToast(t.id)));
};
const quickBuild = async (groupLabel, typeId, product) => {
  await closeAll();
  await page.keyboard.press('b');
  await page.waitForSelector(sel('drawer-build'), { visible: true });
  await tab('drawer-build', groupLabel);
  await click(`build-${typeId}`);
  await page.waitForSelector(sel('drawer-inspector'), { visible: true, timeout: 15000 });
  await sleep(800);
  if (product) {
    await click(`setup-add-product-${product}`);
    await click('setup-add-confirm');
    await sleep(1200);
  }
};

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(sel('title-screen'), { timeout: 60000 });
  await click('play-tutorial');
  await page.waitForSelector(sel('hud'), { timeout: 30000 });
  await sleep(1500);
  const pressed = await page.$eval(sel('speed-pause'), (el) => el.getAttribute('aria-pressed'));
  if (pressed !== 'true') await page.click(sel('speed-pause'));
  await dismissToasts();

  // ---- build flow
  await page.keyboard.press('b');
  await page.waitForSelector(sel('drawer-build'), { visible: true });
  await sleep(900);
  await shot('01-build-palette');
  await tab('drawer-build', 'Farms & mines');
  await shot('01b-build-palette-geography');
  await tab('drawer-build', 'Retail');
  await click('build-card-supermarket');
  await sleep(600);
  await shot('02-build-placing');
  await click('build-auto-site');
  await sleep(1000);
  await shot('03-build-confirm');
  await click('build-product-soft_drink').catch(() => {});
  await sleep(300);
  await shot('04-build-confirm-softdrink');
  await click('build-confirm');
  await page.waitForSelector(sel('drawer-inspector'), { visible: true, timeout: 15000 });
  await sleep(1200);
  await dismissToasts();
  await shot('05-inspector-new');

  // ---- a factory and an R&D centre, then play
  await quickBuild('Factories', 'factory_small', 'soft_drink');
  await quickBuild('R&D', 'rd_center', 'soft_drink');
  for (let i = 0; i < 3; i++) await step();
  await dismissToasts();
  await sleep(800);
  await shot('06-inspector-rd-overview');
  await tab('drawer-inspector', 'Layout');
  await shot('06b-inspector-rd-layout');
  await tab('drawer-inspector', 'Setup');
  await shot('06c-inspector-rd-setup');

  // ---- the factory
  await closeAll();
  await page.keyboard.press('m');
  await page.waitForSelector(sel('overlay-company'), { visible: true });
  await sleep(1200);
  await shot('20-company');
  const rows = await page.$$(`${sel('overlay-company')} tbody tr`);
  for (const r of rows) {
    if ((await r.evaluate((e) => e.textContent ?? '')).includes('Factory')) {
      await r.click();
      break;
    }
  }
  await page.waitForSelector(sel('drawer-inspector'), { visible: true });
  await sleep(1200);
  await shot('07-inspector-factory-overview');
  await tab('drawer-inspector', 'Layout');
  await shot('07b-inspector-factory-layout');
  await tab('drawer-inspector', 'Setup');
  await shot('07c-inspector-factory-setup');

  // ---- the supermarket, add bread, price warning
  await closeAll();
  await page.keyboard.press('m');
  await page.waitForSelector(sel('overlay-company'), { visible: true });
  await sleep(800);
  const rows2 = await page.$$(`${sel('overlay-company')} tbody tr`);
  for (const r of rows2) {
    if ((await r.evaluate((e) => e.textContent ?? '')).includes('Supermarket')) {
      await r.click();
      break;
    }
  }
  await page.waitForSelector(sel('drawer-inspector'), { visible: true });
  await sleep(1000);
  await tab('drawer-inspector', 'Setup');
  await click('setup-add-line');
  await sleep(500);
  await shot('08a-inspector-setup-add');
  await click('setup-add-product-bread');
  await click('setup-add-confirm');
  await sleep(1500);
  await step();
  await step();
  await dismissToasts();
  await tab('drawer-inspector', 'Overview');
  await shot('08-inspector-overview');
  await tab('drawer-inspector', 'Layout');
  await shot('09-inspector-layout');
  await tab('drawer-inspector', 'Setup');
  if (!(await page.$(sel('setup-price-0')))) {
    await page.click(`${sel('setup-unit-0')} button[aria-expanded]`);
    await sleep(800);
  }
  await page.waitForSelector(sel('setup-price-0'), { visible: true });
  await shot('10-inspector-setup');
  await page.focus(sel('setup-price-0'));
  await page.keyboard.press('Home');
  await sleep(500);
  await shot('10b-inspector-setup-below-cost');
  await page.keyboard.press('End');
  await sleep(500);
  await shot('10c-inspector-setup-above-ceiling');
  await tab('drawer-inspector', 'Finance');
  await shot('11-inspector-finance');
  await page.$eval(sel('inspector-disposal'), (e) => e.scrollIntoView({ block: 'end' }));
  await sleep(400);
  await shot('11b-inspector-finance-disposal');

  // ---- markets
  await closeAll();
  await page.keyboard.press('i');
  await page.waitForSelector(sel('overlay-markets'), { visible: true });
  await sleep(1500);
  await shot('12-markets-matrix');
  await click('markets-metric-share');
  await sleep(500);
  await shot('13-markets-share');
  await click('markets-cell-portbay-bread').catch(() => {});
  await sleep(1200);
  await shot('14-markets-detail-unserved');
  await tab('overlay-markets', 'Opportunities');
  await sleep(800);
  await shot('15-markets-opportunities');
  await click('opp-build-0');
  await sleep(1200);
  await shot('16-build-deeplink');

  await closeAll();
  await page.keyboard.press('m');
  await page.waitForSelector(sel('overlay-company'), { visible: true });
  await sleep(1200);
  await shot('21-company-later');
} catch (e) {
  console.error('TOUR FAILED', e);
  await page.screenshot({ path: join(outDir, 'FAILED.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.log('errors:\n  ' + errors.join('\n  '));
  await browser.close();
  server.httpServer.close();
}
