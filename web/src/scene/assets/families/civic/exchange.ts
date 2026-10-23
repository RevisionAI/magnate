// Stock exchange — ambient archetype `ambient:civic:exchange` (art §4.3, P1; 3×3).
// A limestone temple front: a three-storey block on a 2.5 m podium, a portico of eight Ø1.8 m columns under a
// pediment and, across the entablature, the 1.2 m LED ticker band (dark housing, emissive, plus a SignQuad with
// companyId 'ticker' that the sign layer scrolls through the ticker atlas row). Two seeded forms behind the
// facade: a modern curtain-wall trading tower, or a glazed barrel-vault trading hall on a deeper block.
// The paved forecourt has trees in grates, flags, lamps and a small bronze bull.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { EM, FL_PAVED, FL_SNOW } from '../common-a/constants';
import { Ctx, FACADE, rectSides } from '../common-a/ctx';
import { antenna, hvac, plantRoom } from '../common-a/kit';
import { OFFICE_WALLS, P, X, mixRgb, shade } from '../common-a/palette';
import { GRAND, bronzeDoors, cityFlag, classicalBlock, pilasters, portico, uplight } from './classical';

const BASE = 2.5;
const TOP = BASE + 3 * GRAND.floor; // 20.5 m
const COL_TOP = 16.5;
const ENT_H = TOP - COL_TOP; // the entablature carries the ticker and the inscription

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x602);
  const tower = (p.variant >>> 0) % 2 === 0;
  const col = c.color, r = c.shape;
  const hw = c.hw - 1, hd = c.hd - 1;
  const stone = col.pick([P.wall.limestone, P.wall.limestone, P.wall.stone, P.wall.warmWhite]);
  const roof = mixRgb(P.roof.slate, stone, 0.5);
  const mw = Math.min(26, hw - 4);
  const zf = c.hd - 16;
  const z0 = tower ? zf - 30 : Math.max(-hd + 2, zf - 42);

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW, 0.03);
  const front = rectSides(-mw, z0, mw, zf).front;
  const um = front.len / 2, pw = Math.min(22, mw - 3);
  const spec = { cols: 8, r: 0.9, base: BASE, colTop: COL_TOP, depth: 6, entH: ENT_H, rise: 5.5, stone, roof: shade(stone, 0.9) };

  // trading tower or barrel-vault hall behind the facade
  const ax = Math.min(16, mw - 6), az1 = z0 - 1.5, az0 = Math.max(-hd, az1 - 22);
  const towerTop = 4 + 10 * FACADE.curtain.floor;
  if (c.lod === 1) {
    c.mass(-mw, z0, mw, zf, 0, TOP, stone, GRAND, roof, { vBase: BASE });
    portico(c, front, um - pw, um + pw, spec);
    if (tower) c.mass(-ax, az0, ax, az1, 0, towerTop, col.pick(OFFICE_WALLS), FACADE.curtain, P.roof.tar);
    return c.finish();
  }

  classicalBlock(c, -mw, z0, mw, zf, TOP, stone, { base: BASE, fac: GRAND, roof, cornice: true, balustrade: true });
  const sides = rectSides(-mw, z0, mw, zf);
  for (const s of [sides.left, sides.right]) pilasters(c, s, 3, s.len - 3, Math.max(3, Math.round(s.len / 8)), BASE, TOP - 0.7, 1.2, 0.35, shade(stone, 1.05));
  portico(c, front, um - pw, um + pw, spec);
  // LED ticker: dark housing with a faint glow, wordless here — the sign layer scrolls the ticker row over it
  const tz = spec.depth + 0.03;
  c.panel(front, um - pw + 1, um + pw - 1, COL_TOP + 0.55, COL_TOP + 1.75, tz, X.screenDark, c.closed ? 0 : EM.faint);
  c.panel(front, um - pw + 1, um + pw - 1, COL_TOP + 0.5, COL_TOP + 0.56, tz + 0.01, X.signalGreen, c.closed ? 0 : EM.sign);
  c.sign(front, um - pw + 1.1, um + pw - 1.1, COL_TOP + 0.6, COL_TOP + 1.7, tz + 0.03, 'ticker');
  c.sign(front, um - 7, um + 7, COL_TOP + 2.25, COL_TOP + 3.45, spec.depth + 0.04, 'civic:exchange');
  bronzeDoors(c, front, um, 3.4, 6, BASE);
  bronzeDoors(c, front, um - 9, 2.4, 5, BASE);
  bronzeDoors(c, front, um + 9, 2.4, 5, BASE);
  uplight(c, front, 0.5, um - pw - 1.6);
  uplight(c, front, um + pw + 1.6, front.len - 0.5);

  if (tower) {
    const wall = col.pick(OFFICE_WALLS);
    c.mass(-ax, az0, ax, az1, 0, 4, shade(wall, 0.8), FACADE.office, null);
    c.mass(-ax, az0, ax, az1, 4, towerTop, wall, FACADE.curtain, P.roof.tar, { vBase: 4 });
    c.parapet(-ax, az0, ax, az1, towerTop, shade(wall, 0.9), 0.9, 0.3);
    plantRoom(c, -6, (az0 + az1) / 2 - 4, 6, (az0 + az1) / 2 + 4, towerTop, 4, shade(wall, 0.85));
    hvac(c, ax - 4, az1 - 4, towerTop);
    antenna(c, 3, (az0 + az1) / 2, towerTop + 4, 10, towerTop + 14 > 60);
  } else {
    // glazed barrel vault over the trading floor: six facets along z, gable ends glazed
    const bx = Math.min(14, mw - 8), bz0 = z0 + 6, bz1 = zf - 8, R = bx, n = 6;
    const pt = (i: number, z: number): [number, number, number] => {
      const a = Math.PI - (i / n) * Math.PI;
      return [Math.cos(a) * R, TOP + 1.0 + Math.sin(a) * R * 0.55, z];
    };
    c.box(-bx - 0.4, TOP, bz0 - 0.4, bx + 0.4, TOP + 1.0, bz1 + 0.4, shade(stone, 0.95), shade(stone, 1.04));
    c.withFlags(FL_SNOW, () => {
      for (let i = 0; i < n; i++) c.qa(pt(i, bz1), pt(i + 1, bz1), pt(i + 1, bz0), pt(i, bz0), i % 2 ? P.ind.glass2 : shade(P.ind.glass2, 0.92), c.closed ? 0 : 20);
    });
    for (let i = 0; i < n; i++) {
      c.ta([0, TOP + 1.0, bz1], pt(i + 1, bz1), pt(i, bz1), P.ind.glass, c.closed ? 0 : EM.faint);
      c.ta([0, TOP + 1.0, bz0], pt(i, bz0), pt(i + 1, bz0), P.ind.glass, c.closed ? 0 : EM.faint);
    }
    hvac(c, -mw + 5, z0 + 5, TOP);
    hvac(c, mw - 5, z0 + 5, TOP);
  }

  // trees in grates along both flanks, flags and lamps on the forecourt, the bull
  const tx = Math.min(hw - 2, mw + 5);
  for (const m of [-1, 1]) {
    for (let z = z0 + 4; z < hd - 3; z += 8) {
      c.ground(m * tx - 1.1, z - 1.1, m * tx + 1.1, z + 1.1, P.road.asphaltDark, FL_PAVED, 0.06);
      c.tree(m * tx, z, 'deciduous', 0.9);
    }
    cityFlag(c, m * 5.5, hd - 1.8, 11);
    c.prop('lamp.street', m * (pw + 3), hd - 2.5, m < 0 ? Math.PI / 2 : -Math.PI / 2);
    c.pool(m * (pw + 1), hd - 2.5, 8);
  }
  bull(c, -pw + 2, hd - 4.5, X.bronze);
  for (let i = 0; i < 4; i++) c.tree(r.range(-hw + 2, hw - 2), r.range(-hd + 1, -hd + 2.5), 'deciduous', 0.85);
  c.pool(0, zf + spec.depth + 2, 10);
  return c.finish();
}

/** A small bronze bull on a low plinth (forecourt sculpture), facing +X. */
function bull(c: Ctx, x: number, z: number, metal: typeof X.bronze): void {
  c.boxc(x, z, 4.2, 1.8, 0, 0.5, P.wall.concreteDark, P.wall.stone);
  c.blob(x - 0.2, 1.55, z, 1.45, 0.62, 0.55, 3, 6, metal);
  c.blob(x + 1.35, 1.75, z, 0.45, 0.38, 0.36, 3, 5, metal);
  for (const [dx, dz] of [[-1.0, -0.3], [-1.0, 0.3], [0.7, -0.3], [0.7, 0.3]] as const) c.boxc(x + dx, z + dz, 0.22, 0.22, 0.5, 0.75, metal);
  c.cone(x + 1.45, z - 0.4, 0.09, 0, 2.0, 2.45, 3, P.wall.limestone);
  c.cone(x + 1.45, z + 0.4, 0.09, 0, 2.0, 2.45, 3, P.wall.limestone);
}

export const exchangeFactory: AssetFactory = {
  id: 'ambient:civic:exchange',
  footprints: [[3, 3]],
  triBudget: { lod0: 1000, lod1: 50 },
  build,
};
