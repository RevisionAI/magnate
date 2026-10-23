#!/usr/bin/env node
// End-to-end smoke test in real Chrome (GPU via Metal/ANGLE):
// boot the engine → title → New Game browser → tutorial → build a supermarket →
// run a month at 8× → step a month → pause menu → quicksave.
//
//   node scripts/smoke.mjs                      # serves ./dist via `vite preview` (run `npx vite build` first)
//   node scripts/smoke.mjs --dev                # serves sources via the Vite dev server
//   node scripts/smoke.mjs --headed             # watch it run
//   node scripts/smoke.mjs --tour [--size 1920x1080]
//        # after the smoke steps, walk every UI state (overlays, drawers, inspector,
//        # pause, settings, save/load, controls, UiKit, boot) and screenshot each one
//        # into web/test-results/tour-<W>x<H>/ for visual review.
//
// Selectors are the stable data-testid attributes of the UI shell (title buttons,
// scenario cards, top-bar cash/date, speed buttons, rail, build entries).
// Writes screenshots + a JSON report to web/test-results/. Exits non-zero on any
// page error, console error, or failed step.
import puppeteer from 'puppeteer-core';
import { createServer, preview } from 'vite';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const outDir = join(webRoot, 'test-results');
mkdirSync(outDir, { recursive: true });

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const dev = process.argv.includes('--dev');
const headed = process.argv.includes('--headed');
const tour = process.argv.includes('--tour');
const [width, height] = arg('size', tour ? '1920x1080' : '1600x900').split('x').map(Number);
const tourDir = join(outDir, `tour-${width}x${height}`);
if (tour) mkdirSync(tourDir, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!existsSync(join(webRoot, 'public', '_framework', 'dotnet.js'))) {
  console.error('public/_framework missing — run `npm run build:engine` first');
  process.exit(2);
}

const port = (dev ? 5188 : 4188) + Math.floor(Math.random() * 200);
const server = dev
  ? await createServer({ root: webRoot, logLevel: 'error', server: { port } })
  : await preview({ root: webRoot, logLevel: 'error', preview: { port } });
if (dev) await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;

const report = { url, size: `${width}x${height}`, steps: [], consoleErrors: [], pageErrors: [], screenshots: [] };
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: headed ? false : 'new',
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});

let failed = false;
const page = await browser.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') report.consoleErrors.push(msg.text());
});
page.on('pageerror', (error) => report.pageErrors.push(String(error)));
// Leaving a game with unsaved progress raises the browser's "Leave site?" prompt (UX §6.19); accept it.
page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sel = (testId) => `[data-testid="${testId}"]`;

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    report.steps.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    failed = true;
    report.steps.push({ name, ok: false, ms: Date.now() - started, error: String(error) });
    console.log(`  ✗ ${name}: ${error}`);
    await shot(`FAILED-${name.replace(/\W+/g, '-')}`).catch(() => {});
    throw error;
  }
}

async function shot(name, dir = outDir) {
  const file = join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
}

/** Waits for a visible element and clicks it. */
async function click(testId, timeout = 15000) {
  await page.waitForSelector(sel(testId), { visible: true, timeout });
  await page.click(sel(testId));
}

async function text(testId) {
  return page.$eval(sel(testId), (el) => el.textContent ?? '');
}

/** Waits until a test id's text differs from `before`. */
async function textChanges(testId, before, timeout) {
  await page.waitForFunction(
    (s, b) => {
      const t = document.querySelector(s)?.textContent ?? '';
      return t !== '' && t !== b;
    },
    { timeout },
    sel(testId),
    before,
  );
}

async function gone(testId, timeout = 5000) {
  await page.waitForFunction((s) => !document.querySelector(s), { timeout }, sel(testId));
}

/** Presses a key with optional modifiers ("Mod" = ⌘ on macOS, Ctrl elsewhere). */
async function press(key, mods = []) {
  const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  const real = mods.map((m) => (m === 'Mod' ? (mac ? 'Meta' : 'Control') : m));
  for (const m of real) await page.keyboard.down(m);
  await page.keyboard.press(key);
  for (const m of real.reverse()) await page.keyboard.up(m);
}

/** Pauses the game (the pause button toggles, so only click it while running). */
async function pauseGame() {
  const pressed = await page.$eval(sel('speed-pause'), (el) => el.getAttribute('aria-pressed'));
  if (pressed !== 'true') await page.click(sel('speed-pause'));
  await page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', { timeout: 5000 }, sel('speed-pause'));
}

/** Moves the pointer away so hover states do not leak into screenshots. */
async function rest() {
  await page.mouse.move(width / 2, height - 4);
}

try {
  console.log(`smoke → ${url} (${width}×${height})`);

  await step('boot engine + title', async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(sel('title-screen'), { timeout: 60000 });
    await sleep(600);
    await shot('01-title');
  });

  await step('new game browser + briefing', async () => {
    await click('new-game');
    await page.waitForSelector(sel('scenario-select'), { timeout: 10000 });
    await page.waitForSelector(sel('briefing'), { timeout: 10000 });
    const cards = await page.$$eval('[data-testid^="scenario-"]', (els) => els.filter((e) => e.getAttribute('data-testid') !== 'scenario-select').length);
    if (cards < 2) throw new Error(`expected scenario cards, found ${cards}`);
    await click('scenario-soft_drink_war').catch(() => {});
    await sleep(300);
    await shot('02-new-game');
    await click('back-to-title');
    await page.waitForSelector(sel('title-screen'), { timeout: 10000 });
  });

  await step('start tutorial', async () => {
    await click('play-tutorial');
    // The loading screen shows at once and covers the HUD until the city is built.
    await page.waitForSelector(sel('game-loading'), { timeout: 5000 });
    await page.waitForSelector(sel('hud'), { timeout: 30000 });
    await gone('game-loading', 90000);
    await page.waitForSelector(sel('cash'), { timeout: 10000 });
    await page.waitForSelector(sel('date'), { timeout: 10000 });
    await sleep(1500);
    await shot('03-city');
  });

  await step('construct supermarket', async () => {
    const before = await text('cash');
    await click('rail-build');
    await page.waitForSelector(`${sel('build-supermarket')}:not([disabled])`, { timeout: 10000 });
    await page.click(sel('build-supermarket'));
    await textChanges('cash', before, 10000);
  });

  await step('advance a month at 8×', async () => {
    const before = await text('date');
    await click('speed-8x');
    await textChanges('date', before, 20000);
    await pauseGame();
    await sleep(800);
    await shot('04-after-month');
  });

  await step('step one month while paused', async () => {
    const before = await text('date');
    await click('step-month');
    await textChanges('date', before, 15000);
  });

  await step('pause menu (Esc) + resume', async () => {
    await click('drawer-close').catch(() => {});
    await rest();
    await press('Escape');
    await page.waitForSelector(sel('pause-menu'), { visible: true, timeout: 5000 });
    await click('pause-resume');
    await gone('pause-menu');
  });

  await step('quicksave (Mod+S)', async () => {
    await press('s', ['Mod']);
    // "Quicksaved" — or, on an engine build without save methods, the explicit "Saving is unavailable" notice.
    const outcome = await page.waitForFunction(
      () => {
        const texts = [...document.querySelectorAll('[data-testid^="toast-"]')].map((t) => t.textContent ?? '');
        return texts.find((t) => /quicksaved|saving is unavailable/i.test(t)) ?? false;
      },
      { timeout: 15000 },
    );
    const message = await outcome.jsonValue();
    report.quicksave = /unavailable/i.test(message) ? 'engine build has no saveGame (notice shown)' : 'saved';
    console.log(`    quicksave: ${report.quicksave}`);
  });

  if (tour) await runTour();
} catch {
  // already recorded
} finally {
  report.ok = !failed && report.pageErrors.length === 0 && report.consoleErrors.length === 0;
  writeFileSync(join(outDir, 'smoke-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await (dev ? server.close() : server.httpServer.close());
  if (report.consoleErrors.length) console.log('console errors:\n  ' + report.consoleErrors.join('\n  '));
  if (report.pageErrors.length) console.log('page errors:\n  ' + report.pageErrors.join('\n  '));
  console.log(report.ok ? 'SMOKE OK' : 'SMOKE FAILED');
  process.exit(report.ok ? 0 : 1);
}

/** Every UI state of the shell, screenshotted for review (only with --tour). */
async function runTour() {
  const t = (name) => shot(name, tourDir);
  const closeAll = async () => {
    for (let i = 0; i < 4; i++) {
      const open = await page.evaluate(() => !!document.querySelector('[data-testid^="overlay-"], [data-testid^="drawer-"]:not([data-testid="drawer-close"]), [role="dialog"]'));
      if (!open) return;
      await press('Escape');
      await sleep(260);
    }
  };

  await step('tour: HUD', async () => {
    await closeAll();
    await rest();
    await sleep(500);
    await t('10-hud');
  });

  const panels = [
    ['r', 'overlay-reports', '11-overlay-reports'],
    ['i', 'overlay-markets', '12-overlay-markets'],
    ['f', 'overlay-finance', '13-overlay-finance'],
    ['n', 'overlay-news', '14-overlay-news'],
    ['b', 'drawer-build', '15-drawer-build'],
    ['g', 'drawer-goals', '16-drawer-goals'],
    ['h', 'drawer-advisor', '17-drawer-advisor'],
    ['j', 'drawer-alerts', '18-drawer-alerts'],
  ];
  for (const [key, testId, name] of panels) {
    await step(`tour: ${testId}`, async () => {
      await closeAll();
      await press(key);
      await page.waitForSelector(sel(testId), { visible: true, timeout: 8000 });
      await rest();
      await sleep(700);
      await t(name);
    });
  }

  await step('tour: inspector (company table → building)', async () => {
    await closeAll();
    await press('m');
    await page.waitForSelector(sel('overlay-company'), { visible: true, timeout: 8000 });
    await sleep(500);
    await t('19-overlay-company');
    const row = await page.$('[data-testid="overlay-company"] tbody tr');
    if (!row) throw new Error('no building row in the company table');
    await row.click();
    await page.waitForSelector(sel('drawer-inspector'), { visible: true, timeout: 8000 });
    await rest();
    await sleep(700);
    await t('20-drawer-inspector');
  });

  await step('tour: pause menu, settings, save/load, controls', async () => {
    await closeAll();
    await press('Escape');
    await page.waitForSelector(sel('pause-menu'), { visible: true, timeout: 5000 });
    await rest();
    await sleep(400);
    await t('21-pause');
    await click('pause-settings');
    await page.waitForSelector(sel('settings-modal'), { visible: true, timeout: 5000 });
    await rest();
    await sleep(400);
    await t('22-settings-audio');
    for (const tab of ['graphics', 'gameplay', 'accessibility', 'controls']) {
      await click(`tab-${tab}`);
      await rest();
      await sleep(300);
      await t(`23-settings-${tab}`);
    }
    await press('Escape');
    await gone('settings-modal');
    await click('pause-save');
    await page.waitForSelector(sel('saveload-modal'), { visible: true, timeout: 5000 });
    await rest();
    await sleep(600);
    await t('24-save-load');
    await press('Escape');
    await gone('saveload-modal');
    await press('Escape');
    await gone('pause-menu');
    await press('Slash', ['Shift']);
    await page.waitForSelector(sel('controls-modal'), { visible: true, timeout: 5000 });
    await rest();
    await sleep(300);
    await t('25-controls');
    await press('Escape');
    await gone('controls-modal');
  });

  await step('tour: month close moment (8×)', async () => {
    await closeAll();
    const before = await text('date');
    await click('speed-8x');
    await textChanges('date', before, 20000);
    await sleep(350);
    await t('26-month-close');
    await pauseGame();
  });

  // States that are slow to reach by play, driven through the QA handle (window.__magnate, ui/qa.ts).
  await step('tour: toast stack + context menu', async () => {
    await closeAll();
    await page.evaluate(() => {
      const a = window.__magnate.alerts.getState();
      a.notify({ kind: 'demo', severity: 'critical', title: 'Insolvency countdown', body: 'Cash is −$1.2M. Insolvent in 5 months unless cash recovers.', actions: [{ kind: 'open', label: 'Finance', panel: 'finance' }] });
      a.notify({ kind: 'demo', severity: 'warning', title: 'Stock-out', body: 'Harbor Supermarket lost 260K units of Soft Drink.', actions: [{ kind: 'open', label: 'Fix', panel: 'build' }] });
      a.notify({ kind: 'demo', severity: 'opportunity', title: 'Record month', body: 'Net income +$2.9M — your best month yet.', actions: [{ kind: 'open', label: 'Why?', panel: 'reports' }] });
      window.__magnate.ui.getState().openContextMenu({
        x: Math.round(window.innerWidth * 0.46),
        y: Math.round(window.innerHeight * 0.36),
        title: 'Supermarket',
        subtitle: 'Yours · Metropolis · Level 1',
        items: [
          { id: 'inspect', label: 'Inspect', shortcut: 'Enter' },
          { id: 'price', label: 'Set price…' },
          { id: 'ads', label: 'Advertise here' },
          { id: 'upgrade', label: 'Upgrade', shortcut: 'U', hint: '$1.4M · payback 9 mo' },
          { kind: 'separator', id: 'sep' },
          { id: 'demolish', label: 'Demolish', danger: true, shortcut: 'Delete' },
        ],
      });
    });
    await rest();
    await sleep(700);
    await t('27-toasts-context-menu');
    await press('Escape');
  });

  await step('tour: tutorial coach mark', async () => {
    await closeAll();
    await page.evaluate(() => {
      window.__magnate.tutorial.getState().start({
        id: 'tour-demo',
        title: 'Your First Company',
        steps: [
          {
            id: 'open-build',
            title: 'Open the build menu',
            body: 'Every company starts with a store. Press B or click Build to see what you can construct.',
            why: 'Stores turn cash into revenue.',
            highlight: { ui: 'rail.build' },
            allow: ['rail.build', 'speed.pause'],
            skippable: true,
          },
        ],
      });
    });
    await rest();
    await sleep(900);
    await t('28-tutorial-coach-mark');
    await page.evaluate(() => window.__magnate.tutorial.getState().stop());
  });

  for (const [status, reason] of [
    ['won', 'allGoals'],
    ['lost', 'bankruptcy'],
  ]) {
    await step(`tour: outcome debrief (${status})`, async () => {
      await closeAll();
      await page.evaluate((st, re) => window.__magnate.ui.getState().openModal('outcome', { status: st, reason: re }), status, reason);
      await page.waitForSelector(sel('outcome-modal'), { visible: true, timeout: 5000 });
      await rest();
      await sleep(700);
      await t(`29-outcome-${status}`);
      await page.evaluate(() => window.__magnate.ui.getState().closeModal('outcome'));
      await gone('outcome-modal');
    });
  }

  await step('tour: UiKit page', async () => {
    await page.goto(`${url}?dev=ui`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(sel('ui-kit'), { timeout: 20000 });
    await sleep(1200);
    await t('30-uikit');
    const sections = await page.$$eval('[data-uikit-section]', (els) => els.map((e) => e.getAttribute('data-uikit-section')));
    let i = 1;
    for (const id of sections) {
      await page.evaluate((s) => document.querySelector(`[data-uikit-section="${s}"]`)?.scrollIntoView({ block: 'start' }), id);
      await sleep(250);
      await t(`31-uikit-${String(i++).padStart(2, '0')}-${id}`);
    }
  });

  await step('tour: boot screen', async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(sel('boot-screen'), { timeout: 10000 });
    await sleep(150);
    await t('00-boot');
    await page.waitForSelector(sel('title-screen'), { timeout: 60000 });
    await sleep(900);
    await t('01-title');
    await click('new-game');
    await page.waitForSelector(sel('briefing'), { timeout: 10000 });
    await rest();
    await sleep(500);
    await t('02-new-game');
  });
}
