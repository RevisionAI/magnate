#!/usr/bin/env node
// W6 interaction screenshots in real Chrome (GPU via Metal/ANGLE): starts the tutorial, builds through the placement
// ghost, then captures hover, selection, ghost valid/invalid, every overlay, labels/badges and the minimap.
//
//   (cd web && npx vite build && node src/scene/interaction/__tests__/interaction-shots.mjs [--size 1920x1080] [--headed])
//
// Shots land in web/test-results/w6/. Exits non-zero on page errors or a failed step.
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../../../..');
const outDir = join(webRoot, 'test-results', 'w6');
mkdirSync(outDir, { recursive: true });
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const [width, height] = arg('size', '1920x1080').split('x').map(Number);
const only = arg('only', '');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const port = 4600 + Math.floor(Math.random() * 300);
const server = await preview({ root: webRoot, logLevel: 'error', preview: { port } });
const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.argv.includes('--headed') ? false : 'new',
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
const report = { steps: [], errors };
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (process.argv.includes('--verbose')) console.log(`  [console.${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e}`));
page.on('dialog', (d) => void d.accept().catch(() => {}));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sel = (id) => `[data-testid="${id}"]`;
let failed = false;

async function shot(name) {
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`    → ${file}`);
}
async function step(name, fn) {
  if (only && !only.split(',').some((o) => name.includes(o)) && !name.startsWith('setup')) return;
  const t = Date.now();
  try {
    await fn();
    report.steps.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`);
  } catch (error) {
    failed = true;
    report.steps.push({ name, ok: false, error: String(error) });
    console.log(`  ✗ ${name}: ${error}`);
    await shot(`FAILED-${name.replace(/\W+/g, '-')}`).catch(() => {});
  }
}
const qa = (fn, ...args) => page.evaluate(fn, ...args);
async function rest() { await page.mouse.move(width / 2, height - 3); await sleep(150); }
async function view(target, distance, azimuthDeg = 330) {
  await qa((t, d, a) => window.__magnateScene.rig.setView({ target: t, distance: d, azimuthDeg: a }, false), target, distance, azimuthDeg);
  await sleep(700);
}
async function setOverlay(id) {
  await qa((o) => window.__magnateInteraction.store.getState().setOverlay(o), id);
  await sleep(1300);
}
async function plotScreen(px, pz) { return qa((x, z) => window.__magnateInteraction.screenOfPlot(x, z), px, pz); }

try {
  console.log(`w6 shots → ${url} (${width}×${height})`);
  await step('setup: boot + tutorial', async () => {
    await page.goto(url + '?', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(sel('title-screen'), { timeout: 90000 });
    await page.click(sel('play-tutorial'));
    await page.waitForSelector(sel('hud'), { timeout: 60000 });
    await page.waitForFunction(() => !!window.__magnateInteraction && window.__magnateInteraction.grid().w > 0, { timeout: 30000 });
    // Hold time still and keep the scene deterministic: daytime, no weather.
    await qa(() => { const g = window.__magnate.game.getState(); g.setSpeed(0); window.__magnateScene.setDayNightMode('day'); window.__magnateScene.forceWeather('clear', true); });
    await qa(() => window.__magnate.tutorial.getState().stop?.());
    await sleep(1500);
  });

  let cityInfo = null;
  await step('setup: city info', async () => {
    cityInfo = await qa(() => ({ grid: window.__magnateInteraction.grid(), buildings: window.__magnateInteraction.buildings().map((b) => ({ id: b.id, px: b.px, pz: b.pz, w: b.w, h: b.h, mine: b.model?.isPlayer })) }));
    console.log('    grid', JSON.stringify(cityInfo.grid), 'buildings', cityInfo.buildings.length);
  });

  // ---- placement ghost --------------------------------------------------------------------------------------
  /** Hover plots spiralling out from (cx, cz) until the ghost reports one of `want`; returns { px, pz, p, g }. */
  async function findGhostSpot(cx, cz, want, rings = 14, step = 2) {
    for (let r = 0; r < rings; r++) {
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        const px = cx + dx * step, pz = cz + dz * step;
        const p = await plotScreen(px, pz);
        if (!p) continue;
        await page.mouse.move(p.x, p.y);
        await sleep(450);
        const g = await qa(() => window.__magnateInteraction.store.getState().ghost);
        if (g && want.includes(g.status)) return { px, pz, p, g };
      }
    }
    return null;
  }
  /** Centre the camera on a plot and put the cursor back on it (the ghost follows). */
  async function frameGhost(spot, distance = 520) {
    const { w, h } = cityInfo.grid;
    await view({ x: (spot.px + 0.5 - w / 2) * 24, z: (spot.pz + 0.5 - h / 2) * 24 }, distance);
    const p = await plotScreen(spot.px, spot.pz);
    await page.mouse.move(p.x + 1, p.y + 1);
    await page.mouse.move(p.x, p.y);
    await sleep(900);
    return p;
  }

  let placedId = null;
  await step('ghost valid + place supermarket', async () => {
    // The integrated flow (Wave 2 merge): U2's build panel owns placement. Its deep link puts the
    // supermarket in Placing (build mode on, W6 ghost follows the cursor); a click on a valid plot
    // emits placementConfirmed, U2 shows its confirm card, and Construct builds it exactly once.
    const { w, h } = cityInfo.grid;
    await view({ x: 0, z: 0 }, 700);
    const before = await qa(() => window.__magnate.game.getState().buildings.map((b) => b.id));
    await qa(() => window.__magnate.ui.getState().openPanel('build', { typeId: 'supermarket' }));
    await page.waitForFunction(() => window.__magnate.ui.getState().buildMode?.typeId === 'supermarket', { timeout: 10000 });
    // 'valid' only: the CBD's redevelopment buy-outs leave many sites 'warning' (cash short).
    const spot = await findGhostSpot(Math.floor(w / 2), Math.floor(h / 2), ['valid'], 16, 2);
    if (!spot) throw new Error('no valid (affordable) supermarket spot found');
    const p = await frameGhost(spot);
    const g = await qa(() => window.__magnateInteraction.store.getState().ghost);
    if (!g || g.status !== 'valid') throw new Error(`ghost ${g?.status} after framing`);
    await shot('ghost-valid');
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector(sel('build-confirm'), { timeout: 10000 });
    await sleep(900);
    await shot('build-confirm-card');
    const constructs = await qa(() => window.__magnateInteraction.engineCalls?.('construct') ?? null);
    await page.click(sel('build-confirm'));
    await page.waitForFunction(() => window.__magnate.ui.getState().buildMode === null, { timeout: 10000 });
    await sleep(1500);
    const placed = await qa((b) => window.__magnate.game.getState().buildings.filter((x) => !b.includes(x.id) && x.ownerId === window.__magnate.game.getState().snapshot.playerId).map((x) => x.id), before);
    if (placed.length !== 1) throw new Error(`expected exactly one new building, got ${placed.length}`);
    placedId = placed[0];
    void constructs;
    await shot('construction-site');
  });

  await step('stock the supermarket (soft drinks) so supply links exist', async () => {
    const price = await qa(() => window.__magnate.game.getState().catalog.products.find((p) => p.id === 'soft_drink').baseWorldMarketPrice);
    await qa((id, pr) => window.__magnateInteraction.engineCall('configureSlot', { buildingId: id, slotIndex: 0, productId: 'soft_drink', price: Math.round(pr * 1.6 * 100) / 100, restockTarget: 250000 }), placedId, price);
    await sleep(500);
  });

  await step('ghost invalid (road / occupied)', async () => {
    const { w, h } = cityInfo.grid;
    await qa(() => window.__magnate.ui.getState().setBuildMode({ typeId: 'factory_small' }));
    let found = null;
    for (let i = 0; i < 40 && !found; i++) {
      const p = await plotScreen(Math.floor(w / 2) + (i % 7) - 3, Math.floor(h / 2) + Math.floor(i / 7) - 3);
      if (!p) continue;
      await page.mouse.move(p.x, p.y);
      await sleep(400);
      const g = await qa(() => window.__magnateInteraction.store.getState().ghost);
      if (g && (g.status === 'blocked' || g.status === 'own')) found = { p, g };
    }
    if (!found) throw new Error('no blocked spot found');
    console.log('    blocked:', found.g.issue, found.g.reason);
    await sleep(300);
    await page.mouse.click(found.p.x, found.p.y);
    await sleep(120);
    await shot('ghost-invalid');
    await qa(() => window.__magnate.ui.getState().setBuildMode(null));
    await sleep(800);
  });

  await step('ghost rotate + catchment (department store)', async () => {
    await qa(() => window.__magnate.ui.getState().setBuildMode({ typeId: 'department_store' }));
    await sleep(300);
    await page.keyboard.press('KeyE');
    await sleep(300);
    const spot = await findGhostSpot(Math.floor(cityInfo.grid.w / 2) + 6, Math.floor(cityInfo.grid.h / 2) + 6, ['valid', 'warning'], 16, 3);
    if (!spot) throw new Error('no valid department store spot found');
    await frameGhost(spot, 620);
    const g = await qa(() => window.__magnateInteraction.store.getState().ghost);
    console.log('    rotated ghost:', g?.at?.rotation, g?.w + 'x' + g?.h, g?.status);
    if (!g?.at || g.at.rotation === 0) throw new Error('E did not rotate the ghost');
    await shot('ghost-rotated-catchment');
    await qa(() => window.__magnate.ui.getState().setBuildMode(null));
    await sleep(600);
  });

  // ---- hover + selection -------------------------------------------------------------------------------------
  let mineId = null;
  await step('hover card + outline', async () => {
    const list = await qa(() => window.__magnateInteraction.buildings().map((b) => ({ id: b.id, mine: b.model?.isPlayer })));
    mineId = list.find((b) => b.mine)?.id ?? list[0]?.id;
    if (mineId === undefined) throw new Error('no buildings');
    await qa((id) => window.__magnateInteraction.focus(id), mineId);
    await sleep(1500);
    const p = await qa((id) => window.__magnateInteraction.screenOf(id), mineId);
    await page.mouse.move(p.x - 30, p.y - 20);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await sleep(900);
    const hovered = await qa(() => window.__magnateInteraction.store.getState().hoveredBuildingId);
    if (hovered !== mineId) throw new Error(`hovered ${hovered}, expected ${mineId}`);
    await shot('hover');
  });

  await step('selection (click) + tag + ring', async () => {
    await qa((id) => window.__magnateInteraction.focus(id), mineId);
    await sleep(1500);
    const p = await qa((id) => window.__magnateInteraction.screenOf(id), mineId);
    await page.mouse.click(p.x, p.y);
    await sleep(300);
    const selected = await qa(() => window.__magnate.game.getState().selectedBuildingId);
    if (selected !== mineId) throw new Error(`selected ${selected}`);
    await rest();
    await sleep(700);
    await shot('selected');
  });

  await step('context menu', async () => {
    const p = await qa((id) => window.__magnateInteraction.screenOf(id), mineId);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await sleep(500);
    await shot('context-menu');
    await page.keyboard.press('Escape');
    await sleep(300);
  });

  // ---- months of activity so badges / profit / links have data ------------------------------------------------
  await step('advance 2 months', async () => {
    for (let i = 0; i < 2; i++) {
      const before = await page.$eval(sel('date'), (e) => e.textContent);
      await page.click(sel('step-month'));
      await page.waitForFunction((s, b) => document.querySelector(s)?.textContent !== b, { timeout: 30000 }, sel('date'), before);
      await sleep(600);
    }
    await qa(() => { window.__magnate.game.getState().selectBuilding(null); });
    await sleep(800);
  });

  await step('rival hover (after rivals expand)', async () => {
    const list = await qa(() => window.__magnateInteraction.buildings().map((b) => ({ id: b.id, mine: b.model?.isPlayer })));
    const rival = list.find((b) => !b.mine);
    if (!rival) { console.log('    (no rival building in this city)'); return; }
    await qa((id) => window.__magnateInteraction.focus(id), rival.id);
    await sleep(1500);
    const p = await qa((id) => window.__magnateInteraction.screenOf(id), rival.id);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await sleep(900);
    await shot('hover-rival');
  });

  await step('badges + gold rings (district zoom)', async () => {
    await rest();
    const b = await qa((id) => window.__magnateInteraction.buildings().find((x) => x.id === id), mineId);
    const cx = (b.box[0] + b.box[3]) / 2, cz = (b.box[2] + b.box[5]) / 2;
    await view({ x: cx, z: cz }, 800);
    await sleep(800);
    await shot('badges-district');
    await view({ x: 0, z: 0 }, 2200);
    await sleep(800);
    await shot('badges-city');
  });

  // ---- overlays ----------------------------------------------------------------------------------------------
  for (const o of ['landValue', 'traffic', 'zones', 'owners', 'profit', 'share', 'links']) {
    await step(`overlay ${o}`, async () => {
      await rest();
      await view({ x: 0, z: 0 }, o === 'links' || o === 'profit' ? 1200 : 1700);
      await setOverlay(o);
      await sleep(o === 'share' || o === 'links' ? 1200 : 300);
      await shot(`overlay-${o}`);
    });
  }
  await step('overlay off', async () => { await setOverlay(null); });

  await step('show supply links for one building', async () => {
    await qa((id) => { window.__magnate.game.getState().selectBuilding(id); window.__magnateInteraction.store.getState().showLinksFor(id); }, placedId);
    await view({ x: 0, z: 0 }, 1500);
    await sleep(1500);
    await shot('links-building');
    await qa(() => { window.__magnateInteraction.store.getState().showLinksFor(null); window.__magnate.game.getState().selectBuilding(null); });
    await sleep(400);
  });

  await step('world popup', async () => {
    const b = await qa((id) => window.__magnateInteraction.buildings().find((x) => x.id === id), mineId);
    await view({ x: (b.box[0] + b.box[3]) / 2, z: (b.box[2] + b.box[5]) / 2 }, 500);
    await qa((id) => window.__magnate.fx.worldPopup(id, '+$412K', 'gain', 412000), mineId);
    await sleep(700);
    await shot('world-popup');
  });

  await step('minimap close-up', async () => {
    await setOverlay(null);
    const box = await page.$eval(sel('minimap'), (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await page.screenshot({ path: join(outDir, 'minimap.png'), clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: box.width + 20, height: box.height + 20 } });
    await setOverlay('landValue');
    const box2 = await page.$eval(sel('minimap'), (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await page.screenshot({ path: join(outDir, 'minimap-landvalue.png'), clip: { x: Math.max(0, box2.x - 10), y: Math.max(0, box2.y - 10), width: box2.width + 20, height: box2.height + 20 } });
    await setOverlay(null);
  });

  await step('keys: Home, Tab, O', async () => {
    await page.keyboard.press('Home');
    await sleep(1200);
    await page.keyboard.press('Tab');
    await sleep(1200);
    const sel1 = await qa(() => window.__magnate.game.getState().selectedBuildingId);
    if (sel1 === null) throw new Error('Tab did not select');
    await page.keyboard.press('KeyO');
    await sleep(300);
    const ov = await qa(() => window.__magnateInteraction.store.getState().overlay);
    if (ov !== 'landValue') throw new Error(`O → ${ov}`);
    await page.keyboard.down('Shift');
    await page.keyboard.press('Digit4');
    await page.keyboard.up('Shift');
    await sleep(300);
    const ov2 = await qa(() => window.__magnateInteraction.store.getState().overlay);
    if (ov2 !== 'owners') throw new Error(`Shift+4 → ${ov2}`);
    await setOverlay(null);
  });
} finally {
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  if (errors.length) console.log('page errors:\n' + errors.map((e) => `  ${e}`).join('\n'));
  await browser.close();
  await server.httpServer.close();
  const pageErrors = errors.filter((e) => e.startsWith('[pageerror]'));
  console.log(failed || pageErrors.length ? 'W6 SHOTS FAILED' : 'W6 SHOTS OK');
  process.exit(failed || pageErrors.length ? 1 : 0);
}
