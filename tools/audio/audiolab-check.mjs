#!/usr/bin/env node
// Live end-to-end check of the running audio engine in headless Chrome, through the AudioLab
// (?dev=audio → window.__audioLab). Unlike recipe-levels.mjs (offline renders), this exercises the real
// AudioContext graph the game uses:
//
//   1. unlock: a real click on the page starts audio.init(); the context must reach 'running';
//   2. assets: the manifest loads and the codec probe picks a format;
//   3. SFX: cues of every class reach the sfx bus and the master (analyser meters), none clips;
//   4. music: synthetic game events on the app bus drive the director (gameStarted → an operating state,
//      cash < 0 at a month close → tension) and music reaches the music bus;
//   5. voice: gameStarted voices the welcome line; a tutorial line with a recorded take plays on the voice
//      bus, emits its subtitle, ducks the music by ≈ 10 dB (audio-plan §4.2 / UX §8) and releases it;
//   6. cash < 0 → tension + the P0 line voiced; Major news → news sting, then the anchor (broadcast chain)
//      chained into the advisor; the voice-line browser auditions a line; victory;
//   7. a screenshot of the lab for review (web/test-results/shots/audiolab-e2e.png).
//
// Usage (after `cd web && npx vite build`): node tools/audio/audiolab-check.mjs [--json out.json]
// Exit code 1 on any failed check, page error or console error.
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
const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

if (!existsSync(join(webRoot, 'dist', 'index.html'))) {
  console.error('web/dist missing — run `cd web && npx vite build` first');
  process.exit(2);
}
const shotsDir = join(webRoot, 'test-results', 'shots');
mkdirSync(shotsDir, { recursive: true });

const port = 4600 + Math.floor(Math.random() * 300);
const server = await preview({ root: webRoot, logLevel: 'error', preview: { port } });
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--window-size=1600,1500'],
  defaultViewport: { width: 1600, height: 1500, deviceScaleFactor: 1 },
  protocolTimeout: 10 * 60 * 1000,
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[pageerror] ${e}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (db) => (Number.isFinite(db) ? db.toFixed(1) : '−∞');

/** Poll the bus meters for `ms` while `action` runs; returns per-bus max peak and max RMS (dBFS). */
async function watchMeters(ms, action) {
  return page.evaluate(
    async (ms, actionSrc) => {
      const lab = window.__audioLab;
      const max = {};
      if (actionSrc) await new Function('lab', actionSrc)(lab);
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        const m = lab.readMeters();
        for (const [bus, r] of Object.entries(m ?? {})) {
          const cur = max[bus] ?? { peakDb: -Infinity, rmsDb: -Infinity };
          max[bus] = { peakDb: Math.max(cur.peakDb, r.peakDb), rmsDb: Math.max(cur.rmsDb, r.rmsDb) };
        }
        await new Promise((r) => setTimeout(r, 15));
      }
      return max;
    },
    ms,
    action ?? null,
  );
}

/** Mean RMS of one bus over `ms` (dBFS, power average of 15 ms reads). */
async function meanRms(bus, ms) {
  return page.evaluate(
    async (bus, ms) => {
      let sum = 0;
      let n = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        const r = window.__audioLab.readMeters()?.[bus];
        if (r && Number.isFinite(r.rmsDb)) sum += 10 ** (r.rmsDb / 10);
        n++;
        await new Promise((res) => setTimeout(res, 15));
      }
      return n && sum > 0 ? 10 * Math.log10(sum / n) : -Infinity;
    },
    bus,
    ms,
  );
}

const debug = () => page.evaluate(() => window.__audioLab.debug());
const snapshot = (month, cash) => ({
  date: { year: 2026, month: (month % 12) + 1 },
  monthIndex: month,
  playerId: 1,
  companies: [{ id: 1, name: 'You', isPlayer: true, cash, totalAssets: 0, equity: 0, revenueThisMonth: 0, netIncomeThisMonth: 0, buildingCount: 2, color: '#2F7DE1' }],
  revision: month,
});

let failed = false;
const report = { url: base, checks: results, levels: {} };
try {
  console.log(`audiolab-check → ${base}?dev=audio`);
  // main-thread long tasks (procedural renders must not stall frames: their DSP runs in a worker)
  await page.evaluateOnNewDocument(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push({ at: e.startTime, ms: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(base + '?dev=audio', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__audioLabReady === true && !!window.__audioLab', { timeout: 60000 });
  // 1. a real user gesture on the start overlay
  const clickAt = await page.evaluate(() => performance.now());
  const clickWall = Date.now();
  await page.mouse.click(800, 400);
  await page.waitForFunction(() => window.__audioLab.debug()?.context?.state === 'running', { timeout: 15000 }).catch(() => undefined);
  let d = await debug();
  check('context unlocked by a click', d?.context?.state === 'running', `state ${d?.context?.state}, ${d?.context?.sampleRate} Hz, base latency ${((d?.context?.baseLatency ?? 0) * 1000).toFixed(1)} ms`);
  // 2. manifest + codec probe
  await page.waitForFunction(() => (window.__audioLab.debug()?.assets ?? 0) > 0, { timeout: 15000 }).catch(() => undefined);
  d = await debug();
  check('manifest loaded, codec probed', d?.assets > 0 && (d?.format === 'ogg' || d?.format === 'm4a'), `${d?.assets} assets, format .${d?.format}`);
  // 2b. start-up stalls: let the engine decode the title cue and render the city beds with nothing else
  // driving the page (the harness's own meter polling would add main-thread work of its own)
  await sleep(Math.max(0, 7000 - (Date.now() - clickWall)));
  const startup = await page.evaluate((t0) => window.__longTasks.filter((x) => x.at >= t0 && x.at < t0 + 7000), clickAt);
  const beds = await page.evaluate(() => window.__audioLab.debug()?.ambience);
  const worst = startup.reduce((m, x) => Math.max(m, x.ms), 0);
  check(
    'no main-thread stall while the engine starts (title cue decode + procedural bed renders, 7 s): longest task < 120 ms',
    worst < 120,
    `${startup.length} long tasks (> 50 ms), longest ${worst.toFixed(0)} ms; beds playing ${Object.values(beds ?? {}).filter((g) => g > 0.001).length}`,
  );
  report.longTasks = startup;

  // 3. SFX through the graph
  await sleep(500);
  const sfxIds = ['confirm', 'month_close_up', 'cash_register', 'goal_achieved', 'notify_warning', 'alert_critical', 'stinger.triumph'];
  const sfxLevels = {};
  for (const id of sfxIds) {
    const m = await watchMeters(1400, `lab.play(${JSON.stringify(id)})`);
    sfxLevels[id] = m;
    const sfx = m.sfx?.peakDb ?? -Infinity;
    const master = m.master?.peakDb ?? -Infinity;
    check(`sfx ${id} audible on the sfx bus and master, no clipping`, sfx > -45 && master > -45 && master < -0.5, `sfx peak ${fmt(sfx)} dBFS, master peak ${fmt(master)} dBFS`);
  }
  report.levels.sfx = sfxLevels;

  // 4. music director from synthetic game events
  await page.evaluate((snap) => window.__audioLab.emit('gameStarted', snap), snapshot(0, 6e6));
  await sleep(3500);
  d = await debug();
  const opState = d?.music?.state;
  check('gameStarted → an operating music state with a cue', ['calm', 'steady', 'growth'].includes(opState) && !!d?.music?.cue, `state ${opState}, cue ${d?.music?.cue}, ${d?.music?.lastTransition}`);
  const musicRms = await meanRms('music', 2500);
  check('music reaches the music bus', musicRms > -50, `music bus RMS ${fmt(musicRms)} dBFS`);
  report.levels.musicRms = musicRms;

  // 5. voice. gameStarted itself queued the welcome line (router: bus.gameStarted → adv.onboard.welcome)
  const welcome = (await page.evaluate(() => window.__audioLab.subtitles())).find((s) => s.id === 'adv.onboard.welcome');
  check('gameStarted voiced the advisor welcome with its subtitle', welcome?.voiced === true && (welcome?.text ?? '').length > 5, `“${welcome?.text ?? '—'}” shown ${welcome?.showSec?.toFixed?.(1) ?? '—'} s`);
  // wait for the channel to be free (+ the 3 s P1 silence gap), then a 6 s tutorial line must duck the music ≈ 10 dB
  await page.waitForFunction(() => window.__audioLab.debug()?.voice?.playing === null, { timeout: 20000 }).catch(() => undefined);
  await sleep(3500);
  const before = await meanRms('music', 1500);
  const voiced = await page.evaluate(() => window.__audioLab.voice('adv.legacy.tutorial_step1'));
  await sleep(600);
  const during = await meanRms('music', 1800);
  const vMeter = await watchMeters(800);
  const sub = (await page.evaluate(() => window.__audioLab.subtitles())).find((s) => s.id === 'adv.legacy.tutorial_step1');
  check('tutorial line queued and voiced with a subtitle', voiced && sub?.voiced === true, `“${sub?.text ?? '—'}” shown ${sub?.showSec?.toFixed?.(1) ?? '—'} s`);
  check('voice reaches the voice bus', (vMeter.voice?.peakDb ?? -Infinity) > -30, `voice peak ${fmt(vMeter.voice?.peakDb)} dBFS`);
  const duck = during - before;
  check('music ducks ≈ 10 dB under the voice (−7…−14 dB measured on a moving cue)', duck < -7 && duck > -14, `music RMS ${fmt(before)} → ${fmt(during)} dBFS (${duck.toFixed(1)} dB)`);
  report.levels.duck = { before, during, duck };
  await sleep(5500);
  const after = await meanRms('music', 1500);
  check('music recovers after the line', after > during + 5, `music RMS ${fmt(after)} dBFS after the line`);

  // 6. a month close with negative cash escalates to tension (beat-quantised, with a stinger)
  await page.evaluate((snap) => {
    const ev = { kind: 'cashNegative', severity: 'danger', message: 'cash negative', amount: -2e5 };
    const close = { kind: 'monthClosed', severity: 'warning', message: 'month', amount: -3e5 };
    window.__audioLab.emit('tick', { months: 1, events: [ev, close], snapshot: snap });
    window.__audioLab.emit('gameEvent', ev);
    window.__audioLab.emit('gameEvent', close);
  }, snapshot(1, -2e5));
  await sleep(2500);
  d = await debug();
  check('cash < 0 at a month close → tension', d?.music?.state === 'tension', `state ${d?.music?.state}, ${d?.music?.lastTransition}, pressure ${d?.music?.pressure}`);
  const subs2 = await page.evaluate(() => window.__audioLab.subtitles());
  const neg = subs2.find((s) => s.id === 'adv.cash.negative');
  check('P0 advisor line voiced for cash < 0, with its subtitle', neg?.voiced === true, `“${neg?.text ?? '—'}” ${neg?.durationSec?.toFixed?.(2) ?? '—'} s`);

  // Major news: newspaper slap, then the news sting, the anchor through the broadcast chain, then the advisor
  await page.waitForFunction(() => window.__audioLab.debug()?.voice?.playing === null, { timeout: 20000 }).catch(() => undefined);
  await sleep(3500); // P1 needs 3 s of silence after the last line
  await page.evaluate(() => {
    const ev = { kind: 'news', severity: 'warning', reason: 'major', message: 'OPEC oversupply triggers oil glut — wholesale crude tanks' };
    window.__audioLab.emit('gameEvent', ev);
  });
  await page.waitForFunction(() => window.__audioLab.subtitles().some((s) => s.id === 'news.commodity_drop'), { timeout: 8000 }).catch(() => undefined);
  const subs3 = await page.evaluate(() => window.__audioLab.subtitles());
  const anchor = subs3.find((s) => s.id === 'news.commodity_drop');
  const intro = subs3.find((s) => s.id === 'news.intro');
  const bigNews = subs3.find((s) => s.id === 'vo_news_major');
  check(
    'Major news: anchor line after the news sting, chained into the advisor',
    anchor?.voiced === true && intro?.voiced === true && (intro?.delaySec ?? 0) > 1 && (bigNews?.delaySec ?? 0) > (anchor?.delaySec ?? 0),
    `intro +${intro?.delaySec?.toFixed?.(2)} s, anchor +${anchor?.delaySec?.toFixed?.(2)} s, advisor +${bigNews?.delaySec?.toFixed?.(2)} s`,
  );
  await sleep(Math.max(0, (anchor?.delaySec ?? 2.3) * 1000 - 200));
  const anchorMeter = await watchMeters(2500);
  check('anchor reaches the voice bus', (anchorMeter.voice?.peakDb ?? -Infinity) > -30, `voice peak ${fmt(anchorMeter.voice?.peakDb)} dBFS`);
  await page.waitForFunction(() => window.__audioLab.debug()?.voice?.playing === null, { timeout: 30000 }).catch(() => undefined);

  // the voice-line browser auditions any line directly
  await sleep(1000);
  const auditionSec = await page.evaluate(() => window.__audioLab.audition('adv.onboard.first_plot'));
  await sleep(300);
  const aMeter = await watchMeters(1500);
  const rows = await page.$$eval('[data-testid="voice-browser"] tbody tr', (els) => els.length);
  check('voice-line browser lists every line and auditions one', rows === 108 && auditionSec > 2 && (aMeter.voice?.peakDb ?? -Infinity) > -30, `${rows} rows, adv.onboard.first_plot ${auditionSec.toFixed(2)} s, voice peak ${fmt(aMeter.voice?.peakDb)} dBFS`);
  await sleep(Math.max(0, auditionSec * 1000 - 1500));

  // victory: fanfare + victory cue
  await page.evaluate(() => {
    const ev = { kind: 'scenarioWon', severity: 'success', message: 'won' };
    window.__audioLab.emit('gameEvent', ev);
  });
  await sleep(2500);
  d = await debug();
  check('scenarioWon → victory (fanfare, one-shot cue)', d?.music?.state === 'victory' && d?.music?.cue === 'music.victory', `state ${d?.music?.state}, cue ${d?.music?.cue}`);
  const masterAll = await watchMeters(1500);
  check('master stays under the limiter ceiling', (masterAll.master?.peakDb ?? 0) < -0.5, `master peak ${fmt(masterAll.master?.peakDb)} dBFS`);

  await page.screenshot({ path: join(shotsDir, 'audiolab-e2e.png'), fullPage: true });
  report.screenshot = join(shotsDir, 'audiolab-e2e.png');
  report.debug = await debug();
} catch (error) {
  console.error('audiolab-check failed:', error);
  failed = true;
} finally {
  if (errors.length) console.log('page errors:\n  ' + errors.join('\n  '));
  failed = failed || errors.length > 0 || results.some((r) => !r.ok);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ...report, errors }, null, 2));
  await browser.close();
  await server.httpServer.close();
}
console.log(failed ? '\nAUDIOLAB CHECK FAILED' : `\nAUDIOLAB CHECK OK (${results.length} checks)`);
process.exit(failed ? 1 : 0);
