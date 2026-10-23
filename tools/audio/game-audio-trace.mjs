#!/usr/bin/env node
// In-game audio verification (A3): plays the real game in headless Chrome and captures the audio
// router's decision trace (window.__magnateAudio, web/src/audio/debug/AudioTrace.ts) to show that
// VO, SFX and music react to real engine events — not synthetic ones.
//
//   title → "Play tutorial" (the click unlocks audio) → welcome line → open Build (onboarding line)
//   → build a supermarket (first-building line) → open its inspector (set-price line) → run months at
//   8× (auto-resuming after auto-pauses) → open Reports after the first close (read-the-books line)
//   → pause. Phase 2 (economy): a new "soft_drink_war" game with the player company on autopilot runs
//   more months at 8×, so real sales, milestones, rival moves and news reach the router.
//   → dump the trace.
//
// Writes web/test-results/audio-trace/{trace.json, summary.md, game.png} and prints the summary.
// Usage (after `cd web && npx vite build`; needs web/public/_framework from build-engine.mjs):
//   node tools/audio/game-audio-trace.mjs [--months 24] [--economy-months 36] [--advisor important|all|off] [--headed]
// --advisor sets the player's advisor-frequency setting (default: the game default, "important", where
// P2/P3 lines become subtitle toasts by design; "all" voices every line).
// Exit code 1 when an expectation fails (listed at the end), or on a page error.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..', '..', 'web');
const require = createRequire(join(webRoot, 'package.json'));
const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer-core')).href)).default;
const viteMod = await import(pathToFileURL(require.resolve('vite')).href);
const preview = viteMod.preview ?? viteMod.default.preview;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const MONTHS = Number(arg('months', '24'));
const ECON_MONTHS = Number(arg('economy-months', '36'));
const ADVISOR = arg('advisor', 'important');
const headed = argv.includes('--headed');

if (!existsSync(join(webRoot, 'dist', 'index.html'))) {
  console.error('web/dist missing — run `cd web && npx vite build` first');
  process.exit(2);
}
if (!existsSync(join(webRoot, 'public', '_framework', 'dotnet.js'))) {
  console.error('web/public/_framework missing — run `cd web && node scripts/build-engine.mjs` first');
  process.exit(2);
}
const outDir = join(webRoot, 'test-results', 'audio-trace');
mkdirSync(outDir, { recursive: true });

const port = 4300 + Math.floor(Math.random() * 300);
const server = await preview({ root: webRoot, logLevel: 'error', preview: { port } });
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: headed ? false : 'new',
  // no autoplay override: audio must unlock through the real click, as for a player
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
  protocolTimeout: 10 * 60 * 1000,
});
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // resolve Error arguments to their stacks (m.text() only says "JSHandle@error")
  void Promise.all(m.args().map((a) => a.evaluate((v) => (v instanceof Error ? `${v.message}\n${v.stack}` : String(v))).catch(() => '?')))
    .then((parts) => pageErrors.push(`[console] ${parts.join(' ')}`))
    .catch(() => pageErrors.push(`[console] ${m.text()}`));
});
page.on('dialog', (d) => void d.accept().catch(() => {}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sel = (id) => `[data-testid="${id}"]`;
const log = (msg) => console.log(`  · ${msg}`);
const expectations = [];
const expect = (name, ok, detail = '') => {
  expectations.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const trace = () => page.evaluate(() => window.__magnateAudio?.trace() ?? []);
const voPlayed = async () => (await trace()).filter((r) => r.kind === 'vo' && r.action === 'play').map((r) => r.key);
/** 'play' | 'toast:<reason>' once the line was decided, null on timeout. */
async function waitLine(key, timeout) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = (await trace()).find((x) => x.kind === 'vo' && x.key.split('>').includes(key) && (x.action === 'play' || x.action === 'toast'));
    if (r) return r.action === 'play' ? 'play' : `toast:${r.detail}`;
    await sleep(250);
  }
  return null;
}
async function waitVo(key, timeout) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await voPlayed()).some((k) => k.split('>').includes(key))) return true;
    await sleep(250);
  }
  return false;
}
const game = (fn, ...args) => page.evaluate(fn, ...args);

/** Run `months` closes at 8×, resuming after auto-pauses (and opening Reports once when `reports`). */
async function runMonths(months, reports) {
  const start = await game(() => window.__magnate.game.getState().snapshot?.monthIndex ?? 0);
  await game(() => window.__magnate.game.getState().setSpeed(4));
  const t0 = Date.now();
  let reportsOpened = !reports;
  let outcome = null;
  while (Date.now() - t0 < months * 4000 + 60000) {
    await sleep(600);
    const st = await game(() => {
      const g = window.__magnate.game.getState();
      return { month: g.snapshot?.monthIndex ?? 0, speed: g.speed, auto: g.autoPause?.trigger ?? null, outcome: g.snapshot?.outcome?.status ?? 'playing' };
    });
    if (st.outcome !== 'playing') {
      outcome = st.outcome;
      break;
    }
    if (st.month - start >= months) break;
    if (!reportsOpened && st.month - start >= 1) {
      reportsOpened = true;
      await page.keyboard.press('r');
      expect('Reports opened after the first close → adv.onboard.read_books voiced (tutorial scenario)', await waitVo('adv.onboard.read_books', 20000));
      await page.keyboard.press('Escape');
      await sleep(400);
      await game(() => window.__magnate.game.getState().setSpeed(4));
      continue;
    }
    if (st.speed === 0) {
      if (st.auto) log(`auto-paused (${st.auto}) at month ${st.month - start}; resuming at 8×`);
      await game(() => {
        const g = window.__magnate.game.getState();
        g.clearAutoPause();
        g.setSpeed(4);
      });
    }
  }
  await game(() => window.__magnate.game.getState().setSpeed(0));
  await sleep(1500);
  if (await page.$(sel('outcome-continue'))) await page.click(sel('outcome-continue')).catch(() => undefined); // the debrief, if any
  const end = await game(() => window.__magnate.game.getState().snapshot?.monthIndex ?? 0);
  return { start, end, outcome };
}

let failed = false;
try {
  console.log(`game-audio-trace → ${base} (${MONTHS} months at 8×)`);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(sel('title-screen'), { timeout: 90000 });
  await sleep(800);
  await page.waitForSelector(sel('play-tutorial'), { visible: true, timeout: 15000 });
  await game((advisor) => window.__magnate.settings.getState().update('audio', { advisorVoice: advisor }), ADVISOR);
  await page.click(sel('play-tutorial')); // the gesture that unlocks audio
  await page.waitForSelector(sel('hud'), { timeout: 60000 });
  await page.waitForFunction(() => !!window.__magnateAudio, { timeout: 15000 });
  const ctx = await game(() => window.__magnateAudio.debug().context);
  expect('audio unlocked by the click on "Play tutorial"', ctx?.state === 'running', `context ${ctx?.state}, ${ctx?.sampleRate} Hz`);
  expect('gameStarted → the advisor welcome is voiced', await waitVo('adv.onboard.welcome', 12000));

  // onboarding: Build opened with no building
  await page.click(sel('rail-build'));
  await page.waitForSelector(`${sel('build-supermarket')}:not([disabled])`, { timeout: 15000 });
  await sleep(400);
  const cashBefore = await page.$eval(sel('cash'), (el) => el.textContent ?? '');
  await page.click(sel('build-supermarket'));
  await page.waitForFunction((s, b) => (document.querySelector(s)?.textContent ?? b) !== b, { timeout: 15000 }, sel('cash'), cashBefore);
  log('supermarket built');
  expect('Build drawer opened with no building → adv.onboard.first_plot voiced', await waitVo('adv.onboard.first_plot', 15000));
  // P2: voiced at advisor "all", a subtitle toast at the default "important" (UX §6.18)
  const firstStore = await waitLine('vo_building_first_retail', 20000);
  // (P2 also waits for 8 s of silence after the previous line: it may expire as a toast — a valid decision)
  expect('first store → vo_building_first_retail raised (voiced or toast)', firstStore !== null, `${firstStore}`);
  await page.click(sel('drawer-close')).catch(() => undefined);
  await sleep(500);

  // onboarding: the inspector on our first store
  await game(() => {
    const st = window.__magnate.game.getState();
    const b = st.buildings[0];
    if (b) st.selectBuilding(b.id);
  });
  expect('inspector opened on the first store → adv.onboard.set_price voiced', await waitVo('adv.onboard.set_price', 20000));
  await page.click(sel('drawer-close')).catch(() => undefined);
  await sleep(300);

  // run months at 8×; resume after auto-pauses; open Reports once after the first close
  const tutorial = await runMonths(MONTHS, true);
  log(`tutorial: ran ${tutorial.end - tutorial.start} months${tutorial.outcome ? ` (outcome: ${tutorial.outcome})` : ''}`);
  const startMonth = tutorial.start;
  const endMonth = tutorial.end;
  const outcome = tutorial.outcome;
  const tutorialSeq = await game(() => window.__magnateAudio.lastSeq());

  // phase 2: the economy, with the player company on autopilot
  let economy = null;
  if (ECON_MONTHS > 0) {
    await game(() => window.__magnate.game.getState().startNewGame('soft_drink_war', 42, { autopilot: 'adaptive', companyName: 'Audio QA' }));
    await page.waitForFunction(() => window.__magnate.game.getState().phase === 'playing', { timeout: 60000 });
    await sleep(1500);
    economy = await runMonths(ECON_MONTHS, false);
    log(`economy: ran ${economy.end - economy.start} months on autopilot${economy.outcome ? ` (outcome: ${economy.outcome})` : ''}`);
  }
  await page.screenshot({ path: join(outDir, 'game.png') });

  const records = await trace();
  const summary = await game((since) => window.__magnateAudio.summary(since), -1);
  const tutorialRecords = records.filter((r) => r.seq <= tutorialSeq);
  const econRecords = records.filter((r) => r.seq > tutorialSeq);
  const econSummary = await game((since) => window.__magnateAudio.summary(since), tutorialSeq);
  const debug = await game(() => window.__magnateAudio.debug());
  const closes = tutorialRecords.filter((r) => r.kind === 'event' && r.key === 'monthClosed' && r.action === 'rule');
  const tutorialSummary = await game((max) => {
    // summary of the tutorial part only
    const all = window.__magnateAudio.trace().filter((r) => r.seq <= max);
    const played = {};
    for (const r of all) if (r.kind === 'sfx' && r.action === 'play') played[r.key] = (played[r.key] ?? 0) + 1;
    return { sfxPlayed: played };
  }, tutorialSeq);
  const closeSfx = (tutorialSummary.sfxPlayed.month_close_up ?? 0) + (tutorialSummary.sfxPlayed.month_close_down ?? 0);
  const eventKeys = [...new Set(records.filter((r) => r.kind === 'event' && r.action === 'rule').map((r) => r.key))];
  const econKeys = [...new Set(econRecords.filter((r) => r.kind === 'event' && r.action === 'rule').map((r) => r.key))];
  expect(`${endMonth - startMonth} month closes routed`, closes.length >= Math.min(MONTHS, endMonth - startMonth) && closes.length > 0, `${closes.length} monthClosed decisions`);
  expect('month-close sounds play (≤ every other close at 8×)', closeSfx >= 1 && closeSfx <= closes.length, `${closeSfx} close sounds for ${closes.length} closes`);
  expect('the 8× close policy suppressed or silenced sounds', records.some((r) => /every other close/.test(r.detail ?? '') || r.action === 'suppressed'));
  if (ECON_MONTHS > 0) {
    const sale = econRecords.find((r) => r.kind === 'event' && r.key === 'firstSale');
    const saleVo = [...econSummary.voPlayed, ...econSummary.voToasts.map((t) => t.key)].some((k) => k.includes('adv.sales.first'));
    // at 4×/8× the close keeps one close sound + 2 alerts, so the register may be suppressed (traced)
    const register = econRecords.some((r) => r.kind === 'sfx' && r.key === 'cash_register');
    expect('economy: first sale → cash register (played or close-limited) + adv.sales.first', !!sale && register && saleVo, sale?.detail ?? 'no firstSale event');
    const firstBuild = [...econSummary.voPlayed, ...econSummary.voToasts.map((t) => t.key)].filter((k) => k.startsWith('vo_building_first_') || k.startsWith('adv.build.'));
    expect('economy: autopilot builds raise the first-building / build lines', firstBuild.length > 0, firstBuild.join(', '));
    expect('economy: ≥ 6 distinct event kinds routed', econKeys.length >= 6, econKeys.join(', '));
  }
  expect('music left the title for an operating state', summary.musicStates.some((s) => ['calm', 'steady', 'growth', 'tension', 'recession'].includes(s)), summary.musicStates.join(' → '));
  expect('speed changes sounded and set the music tone', records.some((r) => r.kind === 'event' && r.key === 'bus.speedChanged' && r.action === 'rule'));

  const md = [];
  md.push(`# In-game audio trace (${new Date().toISOString().slice(0, 16)}Z)`, '');
  md.push(
    `Advisor frequency **${ADVISOR}**. Tutorial scenario through the UI, ${endMonth - startMonth} months at 8×${outcome ? ` (outcome ${outcome})` : ''}` +
      (economy ? `; then soft_drink_war on autopilot, ${economy.end - economy.start} months at 8×${economy.outcome ? ` (outcome ${economy.outcome})` : ''}` : '') +
      `. ${records.length} trace records.`,
    '',
  );
  md.push('| What | Value |', '|---|---|');
  md.push(`| Routed event kinds | ${eventKeys.join(', ')} |`);
  md.push(`| … of which in the economy phase | ${econKeys.join(', ') || '—'} |`);
  md.push(`| VO voiced (in order) | ${summary.voPlayed.join(' → ')} |`);
  md.push(`| VO as subtitle toasts | ${summary.voToasts.map((t) => `${t.key} (${t.reason})`).join(', ') || '—'} |`);
  md.push(`| VO dropped | ${summary.voDropped.map((t) => `${t.key} (${t.reason})`).join(', ') || '—'} |`);
  md.push(`| SFX played | ${Object.entries(summary.sfxPlayed).map(([k, v]) => `${k}×${v}`).join(', ')} |`);
  md.push(`| SFX suppressed/blocked | ${summary.sfxSuppressed} |`);
  md.push(`| Music states | ${summary.musicStates.join(' → ') || '—'} |`);
  md.push(`| Stingers | ${summary.stingers.join(', ') || '—'} |`);
  md.push('', '## Expectations', '');
  for (const e of expectations) md.push(`- ${e.ok ? '✓' : '✗'} ${e.name}${e.detail ? ` — ${e.detail}` : ''}`);
  md.push('', '## First 60 decisions', '', '| t (ms) | month | kind | key | action | detail |', '|---:|---:|---|---|---|---|');
  for (const r of records.slice(0, 60)) md.push(`| ${r.t} | ${r.month} | ${r.kind} | ${r.key} | ${r.action} | ${(r.detail ?? '').replace(/\|/g, '/').slice(0, 140)} |`);
  md.push('', '## Economy phase: first 60 VO / music decisions', '', '| t (ms) | month | kind | key | action | detail |', '|---:|---:|---|---|---|---|');
  for (const r of econRecords.filter((x) => x.kind === 'vo' || x.kind === 'music' || (x.kind === 'event' && /vo:/.test(x.detail ?? ''))).slice(0, 60))
    md.push(`| ${r.t} | ${r.month} | ${r.kind} | ${r.key} | ${r.action} | ${(r.detail ?? '').replace(/\|/g, '/').slice(0, 140)} |`);
  writeFileSync(join(outDir, 'summary.md'), md.join('\n') + '\n');
  writeFileSync(join(outDir, 'trace.json'), JSON.stringify({ advisor: ADVISOR, tutorial, economy, summary, econSummary, debug, expectations, records }, null, 2));
  console.log('\n' + md.slice(0, 14).join('\n'));
  console.log(`\nwrote ${join(outDir, 'summary.md')}, trace.json, game.png`);
} catch (error) {
  console.error('game-audio-trace failed:', error);
  failed = true;
  await page.screenshot({ path: join(outDir, 'FAILED.png') }).catch(() => undefined);
} finally {
  if (pageErrors.length) console.log('page errors:\n  ' + pageErrors.join('\n  '));
  failed = failed || pageErrors.length > 0 || expectations.some((e) => !e.ok);
  await browser.close();
  await server.httpServer.close();
}
console.log(failed ? '\nGAME AUDIO TRACE FAILED' : `\nGAME AUDIO TRACE OK (${expectations.length} expectations)`);
process.exit(failed ? 1 : 0);
