#!/usr/bin/env node
// Offline level test for the procedural audio (audio-plan §4.14), run in headless Chrome through the
// AudioLab page (?dev=audio → window.__audioLab):
//
//   * every procedural recipe (the 38 §6.2 recipes, the GENERATE stand-ins and the stingers) is rendered
//     in an OfflineAudioContext at 48 kHz through its live chain (calibrated trim + class peak guard)
//     and measured with the BS.1770 meter (K-weighting, 400 ms momentary max): M-max within ±2 dB of
//     its class target (transients too short to reach it under the ceiling are flagged "peak-bound" by
//     the calibration and held at the ceiling instead), sample peak under the class ceiling, no NaN,
//     and it must decay within its declared length (+25 % + 1 s of tail);
//   * every procedural bed / positional loop / music layer is rendered as a seamless loop and checked
//     for LUFS-I (±1 LU), true peak under −6 dBTP (beds, loops) and a click-free wrap.
//
// Usage (from the repo root, after `cd web && npx vite build`):
//   node tools/audio/recipe-levels.mjs              # verify the compiled calibration
//   node tools/audio/recipe-levels.mjs --calibrate  # measure raw levels, write web/src/audio/synth/calibration.json
//   node tools/audio/recipe-levels.mjs --calibrate --only newspaper,thunder   # re-calibrate a few recipes, keep the rest
//   node tools/audio/recipe-levels.mjs --json out.json
// Exit code 1 if anything fails.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const webRoot = join(root, 'web');
const require = createRequire(join(webRoot, 'package.json'));
const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer-core')).href)).default;
const viteMod = await import(pathToFileURL(require.resolve('vite')).href);
const preview = viteMod.preview ?? viteMod.default.preview;

const args = process.argv.slice(2);
const calibrateMode = args.includes('--calibrate');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',').filter(Boolean) : null;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CALIBRATION = join(webRoot, 'src', 'audio', 'synth', 'calibration.json');

if (!existsSync(join(webRoot, 'dist', 'index.html'))) {
  console.error('web/dist missing — run `cd web && npx vite build` first');
  process.exit(2);
}

const port = 4600 + Math.floor(Math.random() * 300);
const server = await preview({ root: webRoot, logLevel: 'error', preview: { port } });
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  protocolTimeout: 30 * 60 * 1000, // a full calibration renders a few thousand cues on a shared machine
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`[console] ${m.text()}`);
});

let failed = false;
const out = { mode: calibrateMode ? 'calibrate' : 'verify', recipes: [], loops: [], trims: null };
try {
  await page.goto(base + '?dev=audio', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__audioLabReady === true && !!window.__audioLab', { timeout: 60000 });
  page.setDefaultTimeout(600000);

  let trims = null;
  let limited = null;
  if (calibrateMode) {
    // Raw levels (trim 0, no peak guard). Loudness (mean M-max) is stable to ±0.5 dB over a few renders,
    // but the sample peak of noise-based transients spreads 2–5 dB from render to render, so recipes
    // whose peak is close to binding are re-measured with many more renders for a reliable maximum.
    const all = await page.evaluate(() => window.__audioLab.recipeIds());
    const unknown = (only ?? []).filter((id) => !all.includes(id));
    if (unknown.length) throw new Error(`unknown recipe ids: ${unknown.join(', ')}`);
    const ids = only ?? all;
    const raw = [];
    for (const id of ids) raw.push(...(await page.evaluate((id) => window.__audioLab.measureRecipes({ ids: [id], trims: { [id]: 0 }, repeats: 8, guard: false, peakLimited: [] }), id)));
    const close = raw.filter((r) => r.peakCeiling - (r.samplePeak + (r.target - r.rawMMax)) < 3).map((r) => r.id);
    const byId = new Map(raw.map((r) => [r.id, r]));
    for (const id of close) {
      const [r] = await page.evaluate((id) => window.__audioLab.measureRecipes({ ids: [id], trims: { [id]: 0 }, repeats: 40, guard: false, peakLimited: [] }), id);
      if (r) byId.set(id, r);
    }
    // --only: start from the current calibration and replace just the listed recipes
    const prev = existsSync(CALIBRATION) ? JSON.parse(readFileSync(CALIBRATION, 'utf8')) : {};
    trims = only ? { ...(prev.trims ?? {}) } : {};
    limited = only ? (prev.peakLimited ?? []).filter((id) => !only.includes(id)) : [];
    for (const r of byId.values()) {
      const c = await page.evaluate((lvl) => window.__audioLab.calibrate(lvl), r);
      trims[r.id] = c.trim;
      if (c.peakLimited) limited.push(r.id);
    }
    limited.sort();
    out.trims = trims;
    out.peakLimited = limited;
    console.log(`calibrated ${ids.length} recipes (${close.length} re-measured ×40 for the peak; ${limited.length} peak-bound in total: ${limited.join(', ') || 'none'})`);
  }

  const verifyOpts = { repeats: 4, ...(trims ? { trims, peakLimited: limited } : {}) };
  const recipes = await page.evaluate((o) => window.__audioLab.measureRecipes(o), verifyOpts);
  out.recipes = recipes;
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  console.log(`\n${pad('recipe', 22)}${pad('class', 10)}${lpad('target', 7)}${lpad('M-max', 8)}${lpad('peak', 7)}${lpad('ceil', 6)}${lpad('TP', 7)}${lpad('trim', 7)}${lpad('active', 8)}  ${pad('bound', 9)}result`);
  for (const r of recipes) {
    console.log(
      `${pad(r.id, 22)}${pad(r.cls, 10)}${lpad(r.target, 7)}${lpad(r.mMax.toFixed(1), 8)}${lpad(r.samplePeak.toFixed(1), 7)}${lpad(r.peakCeiling, 6)}` +
        `${lpad(r.truePeak.toFixed(1), 7)}${lpad(r.trimDb.toFixed(1), 7)}${lpad(r.activeSec.toFixed(2), 8)}  ${pad(r.bound, 9)}${r.pass ? 'ok' : 'FAIL ' + r.issues.join('; ')}`,
    );
  }
  const recipeFails = recipes.filter((r) => !r.pass);
  const peakBound = recipes.filter((r) => r.bound === 'peak').length;
  console.log(`recipes: ${recipes.length - recipeFails.length}/${recipes.length} within target (${peakBound} peak-bound transients held at their ceiling)`);

  const loops = await page.evaluate(() => window.__audioLab.measureLoops());
  out.loops = loops;
  console.log(`\n${pad('loop', 24)}${pad('kind', 8)}${lpad('target', 7)}${lpad('LUFS-I', 8)}${lpad('TP', 7)}${lpad('ceil', 6)}${lpad('wrap', 9)}${lpad('p99', 8)}${lpad('ms', 7)}  result`);
  for (const r of loops) {
    console.log(
      `${pad(r.id, 24)}${pad(r.kind, 8)}${lpad(r.target, 7)}${lpad(r.lufsI.toFixed(1), 8)}${lpad(r.truePeak.toFixed(1), 7)}${lpad(r.tpCeiling, 6)}` +
        `${lpad(r.wrapJump.toFixed(4), 9)}${lpad(r.wrapP99.toFixed(4), 8)}${lpad(r.renderMs, 7)}  ${r.pass ? 'ok' : 'FAIL ' + r.issues.join('; ')}`,
    );
  }
  const loopFails = loops.filter((r) => !r.pass);
  console.log(`loops: ${loops.length - loopFails.length}/${loops.length} within target`);

  if (calibrateMode && trims) {
    const prev = existsSync(CALIBRATION) ? JSON.parse(readFileSync(CALIBRATION, 'utf8')) : {};
    const sorted = Object.fromEntries(Object.keys(trims).sort().map((k) => [k, trims[k]]));
    const doc = {
      $comment: prev.$comment,
      measuredAt: 'tools/audio/recipe-levels.mjs --calibrate',
      peakLimited: limited,
      trims: sorted,
    };
    writeFileSync(CALIBRATION, JSON.stringify(doc, null, 2) + '\n');
    console.log(`\nwrote ${CALIBRATION} — rebuild (npx vite build) and run without --calibrate to verify`);
  }
  failed = recipeFails.length > 0 || loopFails.length > 0;
  if (pageErrors.length) {
    console.log('\npage errors:\n  ' + pageErrors.join('\n  '));
    failed = true;
  }
} catch (error) {
  console.error('recipe-levels failed:', error);
  failed = true;
} finally {
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
  await browser.close();
  await server.httpServer.close();
}
console.log(failed ? '\nLEVELS FAILED' : '\nLEVELS OK');
process.exit(failed ? 1 : 0);
