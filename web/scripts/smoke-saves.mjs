#!/usr/bin/env node
// End-to-end save/load test in real Chrome (bridge-spec §6.3, §10.4; D17): binary
// saves through the engine worker into IndexedDB, driven through the UI.
//
//   boot → tutorial → build → save (named) → IndexedDB holds a gzip Blob → play on →
//   quicksave → load the named save (HUD equals the saved one) → export a .magnate →
//   import it, a Wave-1 `magnate.save` export and a legacy engine .json → load the
//   legacy one → autosave rotation (3 slots) → reload the page → Continue → delete.
//
//   node scripts/smoke-saves.mjs            # serves ./dist via `vite preview` (run `npx vite build` first)
//   node scripts/smoke-saves.mjs --dev      # Vite dev server
//   node scripts/smoke-saves.mjs --headed
//   node scripts/smoke-saves.mjs --year10   # also: a 10-year autopilot game, timed save + load (§4.8)
//                                           #   (with --dev it also records the .NET save/load phases)
//
// Screenshots + test-results/smoke-saves-report.json. Prints SMOKE-SAVES OK on success.
import puppeteer from 'puppeteer-core';
import { createServer, preview } from 'vite';
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const outDir = join(webRoot, 'test-results');
const shotDir = join(outDir, 'saves');
const downloadDir = join(outDir, 'saves-download');
mkdirSync(shotDir, { recursive: true });
rmSync(downloadDir, { recursive: true, force: true });
mkdirSync(downloadDir, { recursive: true });

const dev = process.argv.includes('--dev');
const headed = process.argv.includes('--headed');
const year10 = process.argv.includes('--year10');
const [width, height] = [1600, 900];
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!existsSync(join(webRoot, 'public', '_framework', 'dotnet.js'))) {
  console.error('public/_framework missing — run `npm run build:engine` first');
  process.exit(2);
}

const port = (dev ? 5388 : 4388) + Math.floor(Math.random() * 200);
const server = dev
  ? await createServer({
      root: webRoot,
      logLevel: 'error',
      // A private dep-optimizer cache: node_modules/.vite may be shared with other dev servers,
      // whose re-optimisation would answer this page with 504 "Outdated Optimize Dep".
      cacheDir: join(outDir, '.vite-smoke-saves'),
      // node_modules may be a symlink to a shared install: let the dev server read through it (fonts).
      server: { port, fs: { allow: [webRoot, realpathSync(join(webRoot, 'node_modules'))] } },
    })
  : await preview({ root: webRoot, logLevel: 'error', preview: { port } });
if (dev) await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;

const report = { url, steps: [], consoleErrors: [], pageErrors: [], screenshots: [], timings: {} };
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: headed ? false : 'new',
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});

let failed = false;
const page = await browser.newPage();
page.on('console', async (msg) => {
  if (msg.type() !== 'error') return;
  // Expand Error arguments (the text alone reads "JSHandle@error").
  const parts = await Promise.all(
    msg.args().map((a) => a.evaluate((v) => (v instanceof Error ? `${v.name}: ${v.message}\n${v.stack ?? ''}` : String(v))).catch(() => a.toString())),
  ).catch(() => [msg.text()]);
  // Resource errors (404s) carry no arguments: fall back to the message text and its URL.
  const text = parts.join(' ').trim() || `${msg.text()} @ ${msg.location()?.url ?? '?'}`;
  // Web Audio scheduling errors from the audio system (not the save path) are reported, not fatal.
  if (/AudioParam|AudioSystem/.test(text)) (report.audioErrors ??= []).push(text.split('\n')[0]);
  else report.consoleErrors.push(text);
});
page.on('pageerror', (error) => report.pageErrors.push(String(error)));
page.on('dialog', (dialog) => void dialog.accept().catch(() => {}));
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

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

async function shot(name) {
  const file = join(shotDir, `${name}.png`);
  await page.screenshot({ path: file });
  report.screenshots.push(file);
}

async function click(testId, timeout = 15000) {
  await page.waitForSelector(sel(testId), { visible: true, timeout });
  await page.click(sel(testId));
}

async function gone(testId, timeout = 8000) {
  await page.waitForFunction((s) => !document.querySelector(s), { timeout }, sel(testId));
}

async function press(key, mods = []) {
  const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  const real = mods.map((m) => (m === 'Mod' ? (mac ? 'Meta' : 'Control') : m));
  for (const m of real) await page.keyboard.down(m);
  await page.keyboard.press(key);
  for (const m of real.reverse()) await page.keyboard.up(m);
}

async function rest() {
  await page.mouse.move(width / 2, height - 4);
}

/** The HUD facts a load must restore. */
function game() {
  return page.evaluate(() => {
    const s = window.__magnate.game.getState();
    return {
      phase: s.phase,
      gameId: s.gameId,
      date: s.hud?.date ?? null,
      cash: s.snapshot?.player?.cash ?? null,
      buildings: s.snapshot?.player?.buildingCount ?? s.buildings?.length ?? null,
      revision: s.revision,
    };
  });
}

/** Every slot record and the type/magic of its body, read straight from IndexedDB. */
function idbSlots() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('magnate');
        req.onerror = () => reject(req.error);
        req.onsuccess = async () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('saveMeta')) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction(['saveMeta', 'saveData'], 'readonly');
          const all = await new Promise((res) => {
            const r = tx.objectStore('saveMeta').getAll();
            r.onsuccess = () => res(r.result);
          });
          const out = [];
          for (const meta of all) {
            const body = await new Promise((res) => {
              const r = db.transaction('saveData', 'readonly').objectStore('saveData').get(meta.slotId);
              r.onsuccess = () => res(r.result);
            });
            let magic = null;
            if (body instanceof Blob) magic = [...new Uint8Array(await body.slice(0, 2).arrayBuffer())];
            out.push({
              slotId: meta.slotId,
              slotKind: meta.slotKind,
              label: meta.label ?? null,
              storage: meta.storage ?? null,
              date: meta.date,
              cash: meta.cash,
              updatedAt: meta.updatedAt,
              compressedBytes: meta.compressedBytes,
              rawBytes: meta.rawBytes,
              blob: body instanceof Blob,
              blobSize: body instanceof Blob ? body.size : null,
              magic,
            });
          }
          db.close();
          resolve(out);
        };
      }),
  );
}

async function toast(pattern, timeout = 20000) {
  const handle = await page.waitForFunction(
    (source) => {
      const re = new RegExp(source, 'i');
      const texts = [...document.querySelectorAll('[data-testid^="toast-"]')].map((t) => t.textContent ?? '');
      return texts.find((t) => re.test(t)) ?? false;
    },
    { timeout },
    pattern.source,
  );
  return handle.jsonValue();
}

/** Clears toasts so the next `toast()` cannot match an old one. */
async function clearToasts() {
  await page.evaluate(() => window.__magnate.alerts?.getState().reset?.());
}

async function stepMonth() {
  const before = (await game()).date;
  // The button stays disabled until the previous month close (tick + roll-up beat) has finished;
  // a click before that is ignored by the store (stepMonth returns while stepping), which made the
  // second of two back-to-back steps time out now and then.
  await page.waitForSelector(`${sel('step-month')}:not([disabled])`, { timeout: 20000 });
  await page.waitForFunction(() => !window.__magnate.game.getState().stepping, { timeout: 20000 });
  await click('step-month');
  await page.waitForFunction(
    (b) => {
      const d = window.__magnate.game.getState().hud?.date;
      return d && (d.year !== b.year || d.month !== b.month);
    },
    { timeout: 20000 },
    before,
  );
}

async function openSaveLoad(tab) {
  await page.evaluate((t) => window.__magnate.ui.getState().openModal('saveLoad', { tab: t }), tab);
  await page.waitForSelector(sel('saveload-modal'), { visible: true, timeout: 5000 });
  await page.waitForFunction((s) => !document.querySelector(s)?.textContent?.includes('Loading'), { timeout: 5000 }, sel('slot-list')).catch(() => {});
}

async function closeSaveLoad() {
  await press('Escape');
  await gone('saveload-modal');
}

async function slotCount() {
  return page.evaluate(() => document.querySelectorAll('[data-testid="slot-list"] > [data-testid^="slot-"]').length);
}

/** Loads a slot from the Load tab and waits until the HUD shows the slot's date. */
async function loadFromUi(slotId, expectDate) {
  await openSaveLoad('load');
  await clearToasts();
  const started = Date.now();
  await click(`slot-load-${slotId}`);
  // "Save before loading?" appears only with unsaved progress.
  const confirmShown = await page.waitForSelector(sel('confirm-dialog'), { visible: true, timeout: 1500 }).then(() => true, () => false);
  if (confirmShown) await click('confirm-alt');
  await toast(/game loaded/);
  await gone('game-loading', 90000);
  const ms = Date.now() - started;
  const now = await game();
  if (expectDate && (now.date.year !== expectDate.year || now.date.month !== expectDate.month)) {
    throw new Error(`loaded date ${JSON.stringify(now.date)} ≠ saved ${JSON.stringify(expectDate)}`);
  }
  return { now, ms };
}

let saved = null;
let manualId = null;
let exportPath = null;

try {
  console.log(`smoke-saves → ${url}`);

  await step('boot engine + title; worker save store selected', async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(sel('title-screen'), { timeout: 60000 });
    const slots = await idbSlots();
    if (slots.length !== 0) throw new Error(`fresh profile should have no saves, found ${slots.length}`);
  });

  await step('start tutorial, build, play two months', async () => {
    await click('play-tutorial');
    await page.waitForSelector(sel('hud'), { timeout: 30000 });
    await gone('game-loading', 90000);
    await click('rail-build');
    await page.waitForSelector(`${sel('build-supermarket')}:not([disabled])`, { timeout: 10000 });
    await page.click(sel('build-supermarket'));
    await sleep(500);
    await click('drawer-close').catch(() => {});
    await stepMonth();
    await stepMonth();
  });

  await step('save a named game through the Save tab', async () => {
    saved = await game();
    await openSaveLoad('save');
    await page.type(sel('save-name'), 'Smoke save');
    await clearToasts();
    const started = Date.now();
    await click('save-new');
    await toast(/game saved/);
    report.timings.saveManualMs = Date.now() - started;
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="slot-list"] > [data-testid^="slot-m-"]')].length === 1, { timeout: 5000 });
    manualId = await page.$eval('[data-testid="slot-list"] > [data-testid^="slot-m-"]', (el) => el.getAttribute('data-testid').slice('slot-'.length));
    await rest();
    await sleep(400);
    await shot('01-save-tab');
    await closeSaveLoad();
  });

  await step('IndexedDB holds the save as a gzip Blob written by the worker', async () => {
    const slots = await idbSlots();
    const slot = slots.find((s) => s.slotId === manualId);
    if (!slot) throw new Error(`slot ${manualId} not in IndexedDB: ${JSON.stringify(slots)}`);
    if (slot.storage !== 'binary' || !slot.blob) throw new Error(`expected a binary Blob record, got ${JSON.stringify(slot)}`);
    if (slot.magic?.[0] !== 0x1f || slot.magic?.[1] !== 0x8b) throw new Error(`body is not gzip: ${slot.magic}`);
    if (slot.label !== 'Smoke save') throw new Error(`label ${slot.label}`);
    if (slot.blobSize !== slot.compressedBytes) throw new Error(`blob ${slot.blobSize} ≠ compressedBytes ${slot.compressedBytes}`);
    if (slot.date.year !== saved.date.year || slot.date.month !== saved.date.month) throw new Error('slot date differs from the HUD');
    report.manualSlot = slot;
  });

  await step('play on, then quicksave (Mod+S)', async () => {
    await stepMonth();
    await clearToasts();
    await press('s', ['Mod']);
    await toast(/quicksaved/);
    const slots = await idbSlots();
    const quick = slots.find((s) => s.slotKind === 'quicksave');
    if (!quick?.blob) throw new Error('no quicksave Blob in IndexedDB');
    report.quickSlot = quick.slotId;
  });

  await step('load the named save: the HUD is the saved one', async () => {
    await openSaveLoad('load');
    await rest();
    await sleep(400);
    await shot('02-load-tab');
    await closeSaveLoad();
    const { now, ms } = await loadFromUi(manualId, saved.date);
    report.timings.loadManualMs = ms;
    if (now.cash !== saved.cash) throw new Error(`cash ${now.cash} ≠ saved ${saved.cash}`);
    if (now.gameId !== saved.gameId) throw new Error(`gameId ${now.gameId} ≠ saved ${saved.gameId}`);
    await sleep(800);
    await shot('03-after-load');
  });

  await step('export the save as a .magnate file', async () => {
    await openSaveLoad('load');
    await page.click(`[data-testid="slot-${manualId}"] [aria-label="Export to a file"]`);
    const deadline = Date.now() + 15000;
    let file = null;
    while (!file && Date.now() < deadline) {
      file = readdirSync(downloadDir).find((f) => f.endsWith('.magnate'));
      if (!file) await sleep(200);
    }
    if (!file) throw new Error('no .magnate download appeared');
    await sleep(300);
    exportPath = join(downloadDir, file);
    const bytes = readFileSync(exportPath);
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('export is not gzip');
    const envelope = JSON.parse(gunzipSync(bytes).toString('utf8'));
    if (envelope.format !== 'magnate.websave') throw new Error(`export format ${envelope.format}`);
    if (!envelope.client || envelope.client.version !== 1) throw new Error('export lacks the client document');
    report.export = { file, bytes: bytes.length, hasThumbnail: typeof envelope.client.thumbnail === 'string' };
    // Files for the legacy import paths, made from the same game.
    writeFileSync(
      join(downloadDir, 'wave1-export.magnate.json'),
      JSON.stringify({ format: 'magnate.save', formatVersion: 1, meta: { label: 'Wave-1 export', playTimeSec: 42, thumbnail: null }, data: JSON.stringify(envelope), sidecar: { version: 1 } }),
    );
    writeFileSync(join(downloadDir, 'godot-engine-save.json'), JSON.stringify(envelope.engine, null, 2));
    await closeSaveLoad();
  });

  await step('import the .magnate, a Wave-1 export and a legacy engine save', async () => {
    await openSaveLoad('load');
    const before = await slotCount();
    for (const name of [exportPath, join(downloadDir, 'wave1-export.magnate.json'), join(downloadDir, 'godot-engine-save.json')]) {
      const input = await page.$('[data-testid="saveload-modal"] input[type="file"]');
      await input.uploadFile(name);
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid="slot-list"] > [data-testid^="slot-"]').length >= n, { timeout: 15000 }, (await slotCount()) + 1);
    }
    const after = await slotCount();
    if (after !== before + 3) throw new Error(`expected ${before + 3} slots after three imports, found ${after}`);
    const slots = await idbSlots();
    const imported = slots.filter((s) => s.slotId.startsWith('m-') && s.slotId !== manualId);
    if (imported.length !== 3 || imported.some((s) => !s.blob || s.magic?.[0] !== 0x1f)) throw new Error(`imports not stored as gzip Blobs: ${JSON.stringify(imported)}`);
    const labels = imported.map((s) => s.label).sort();
    report.imports = labels;
    if (!labels.includes('Wave-1 export') || !labels.includes('godot-engine-save')) throw new Error(`import labels ${labels}`);
    await rest();
    await sleep(300);
    await shot('04-after-imports');
    await closeSaveLoad();
  });

  await step('load the imported legacy engine save', async () => {
    const legacy = (await idbSlots()).find((s) => s.label === 'godot-engine-save');
    const { now } = await loadFromUi(legacy.slotId, saved.date);
    if (now.cash !== saved.cash) throw new Error(`legacy cash ${now.cash} ≠ ${saved.cash}`);
  });

  await step('autosave rotation keeps the 3 newest (every 3 months, 12 months)', async () => {
    await page.evaluate(() => {
      window.__smokeSaved = [];
      window.__magnate.bus.on('saved', (e) => window.__smokeSaved.push(e));
      window.__magnate.settings.getState().update('gameplay', { autosaveMonths: 3 });
    });
    for (let m = 0; m < 12; m++) await stepMonth();
    await page.waitForFunction(() => window.__smokeSaved.filter((e) => e.slotKind === 'autosave').length >= 4, { timeout: 20000 });
    await sleep(500);
    const autos = (await idbSlots()).filter((s) => s.slotKind === 'autosave');
    const ids = autos.map((s) => s.slotId).sort();
    if (JSON.stringify(ids) !== JSON.stringify(['auto-1', 'auto-2', 'auto-3'])) throw new Error(`autosave slots ${ids}`);
    const events = await page.evaluate(() => window.__smokeSaved.filter((e) => e.slotKind === 'autosave').map((e) => e.slotId));
    report.autosaves = events;
    if (events[3] !== events[0]) throw new Error(`4th autosave should overwrite the oldest (${events})`);
    const newest = autos.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
    report.newestAutosave = newest;
    await openSaveLoad('load');
    await rest();
    await sleep(400);
    await shot('05-load-tab-with-autosaves');
    await closeSaveLoad();
  });

  await step('reload the page: saves persist and Continue loads the newest', async () => {
    const newest = (await idbSlots()).reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(sel('continue-game'), { visible: true, timeout: 60000 });
    await sleep(500);
    await shot('06-title-continue');
    await click('continue-game');
    await page.waitForSelector(sel('hud'), { timeout: 30000 });
    await gone('game-loading', 90000);
    await page.waitForFunction(() => window.__magnate.game.getState().phase === 'playing', { timeout: 20000 });
    const now = await game();
    if (now.date.year !== newest.date.year || now.date.month !== newest.date.month) throw new Error(`continued at ${JSON.stringify(now.date)}, newest slot ${JSON.stringify(newest.date)}`);
    if (now.cash !== newest.cash) throw new Error(`continued cash ${now.cash} ≠ slot ${newest.cash}`);
    await stepMonth();
  });

  await step('delete a slot', async () => {
    await openSaveLoad('load');
    const before = await slotCount();
    const victim = (await idbSlots()).find((s) => s.label === 'Wave-1 export');
    await page.click(sel(`slot-delete-${victim.slotId}`));
    await click('confirm-ok');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="slot-list"] > [data-testid^="slot-"]').length === n, { timeout: 8000 }, before - 1);
    if ((await idbSlots()).some((s) => s.slotId === victim.slotId)) throw new Error('slot still in IndexedDB');
    await closeSaveLoad();
  });

  if (year10) {
    await step('year 10: autopilot game, timed save + load (bridge-spec §4.8)', async () => {
      await page.evaluate(() => window.__magnate.settings.getState().update('gameplay', { autosaveMonths: 0 }));
      await page.evaluate(() => window.__magnate.game.getState().startNewGame('four_archetype_melee', 42, { autopilot: 'adaptive' }));
      await page.waitForFunction(() => window.__magnate.game.getState().phase === 'playing', { timeout: 30000 });
      const ticks = await page.evaluate(async () => {
        const out = [];
        const off = window.__magnate.bus.on('tick', (r) => out.push({ engineMs: r.engineMs, bridgeMs: r.bridgeMs }));
        for (let m = 0; m < 120; m++) await window.__magnate.game.getState().advanceMonth();
        off?.();
        return out;
      });
      const last = ticks.slice(-12);
      const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * p) - 1)];
      report.timings.year10 = {
        months: ticks.length,
        engineMsMedian: pct(last.map((t) => t.engineMs), 0.5),
        bridgeMsMedian: pct(last.map((t) => t.bridgeMs), 0.5),
        bridgeMsP95: pct(last.map((t) => t.bridgeMs), 0.95),
      };
      const save = await page.evaluate(async () => {
        const t0 = performance.now();
        const meta = await window.__magnate.game.getState().saveToSlot('m-year10', { slotKind: 'manual', label: 'Year 10', silent: true });
        return { ms: performance.now() - t0, compressed: meta?.compressedBytes, raw: meta?.rawBytes };
      });
      const load = await page.evaluate(async () => {
        const t0 = performance.now();
        const ok = await window.__magnate.game.getState().loadSlot('m-year10');
        return { ms: performance.now() - t0, ok };
      });
      await gone('game-loading', 90000);
      report.timings.year10.save = save;
      report.timings.year10.load = load;
      // Per-phase .NET time of that save and load (debugStats); the engine client is reachable
      // from the page only under the dev server (`--dev`), where modules import by URL.
      report.timings.year10.phases = await page.evaluate(async () => {
        try {
          const store = await import(/* @vite-ignore */ '/src/state/gameStore.ts');
          const stats = await store.getEngine().call('debugStats');
          return { save: stats.lastSavePhasesMs ?? null, load: stats.lastLoadPhasesMs ?? null, indexCatchUpMs: stats.indexCatchUpMs };
        } catch {
          return null;
        }
      });
      console.log(`    year 10: ${JSON.stringify(report.timings.year10)}`);
      if (!load.ok) throw new Error('year-10 load failed');
    });
  }
} catch {
  // recorded
} finally {
  report.ok = !failed && report.pageErrors.length === 0 && report.consoleErrors.length === 0;
  writeFileSync(join(outDir, 'smoke-saves-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await (dev ? server.close() : server.httpServer.close());
  if (report.consoleErrors.length) console.log('console errors:\n  ' + report.consoleErrors.join('\n  '));
  if (report.pageErrors.length) console.log('page errors:\n  ' + report.pageErrors.join('\n  '));
  if (report.audioErrors?.length) console.log('audio-system errors (not fatal here):\n  ' + report.audioErrors.join('\n  '));
  console.log(`timings: ${JSON.stringify(report.timings)}`);
  console.log(report.ok ? 'SMOKE-SAVES OK' : 'SMOKE-SAVES FAILED');
  process.exit(report.ok ? 0 : 1);
}
