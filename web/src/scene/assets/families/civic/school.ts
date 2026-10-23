// School — ambient archetype `ambient:civic:school` (art §4.3; 3×3, also 2×2 without the running track).
// An L-plan brick school of 2–3 storeys (APARTMENT windows at 3.6 m floors), a gym hall with a clerestory band,
// an asphalt schoolyard with a basketball court, and a sports field #7FAE5A inside a running track #C6734E.
// Two seeded forms: flat roofs with parapets (field on the right) or hipped tile roofs (mirrored).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { FAC, FL_PAVED, FL_SNOW, FL_VEG, Y_GROUND, Y_PAINT } from '../common-a/constants';
import { Ctx, FACADE, rectSides } from '../common-a/ctx';
import { bandBetween, canopy, door, eaveFascia, hvac, propLine, ring, trackPts } from '../common-a/kit';
import { FLAT_ROOFS, P, X, shade } from '../common-a/palette';
import { cityFlag } from './classical';

const PLINTH = 0.6;
const GYM_H = 9;

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x604);
  const hipped = (p.variant >>> 0) % 2 === 1;
  const m = hipped ? -1 : 1; // which side the sports field is on (+1 = right)
  const col = c.color, r = c.shape;
  const big = Math.min(c.W, c.D) >= 60;
  const hw = c.hw - 1, hd = c.hd - 1;
  const wall = col.weighted<RGB>([[P.wall.brick, 5], [P.wall.terracotta, 1], [P.wall.sandWall, 2], [P.wall.greige, 1]]);
  const roof = hipped ? col.pick([P.roof.tile, P.roof.slate]) : col.pick(FLAT_ROOFS);
  const floors = big ? r.int(2, 3) : 2;
  const H = PLINTH + floors * FACADE.school.floor;
  const span = (a: number, b2: number): [number, number] => (m === 1 ? [a, b2] : [-b2, -a]);

  // L-plan: front wing along the street, side wing down the far side, gym behind it (3×3), and the field + track
  // in the free back quarter; the schoolyard sits between the field and the front wing.
  const zf = c.hd - (big ? 8 : 6);
  const fd = big ? 13 : 12, sw = 13;
  const [fx0, fx1] = span(-hw + 1, big ? 10 : hw - 10);
  const sz1 = zf - fd, sz0 = big ? -6 : -hd + 3;
  const [sx0, sx1] = span(-hw + 1, -hw + 1 + sw);
  const [gx0, gx1] = span(-hw + 1, -hw + 19);
  const gz0 = -hd + 1, gz1 = -10;
  const gym = big;
  const [tx0, tx1] = span(big ? -12 : -hw + 16, hw);
  const tz0 = -hd + 1, tz1 = big ? -2 : sz1 - 3;
  const tcx = (tx0 + tx1) / 2, tcz = (tz0 + tz1) / 2;
  const ta = (tx1 - tx0) / 2 - 1, tb = Math.min((tz1 - tz0) / 2 - 1, ta * 0.62);

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  if (c.lod === 1) {
    if (big) c.ground(tcx - ta, tcz - tb, tcx + ta, tcz + tb, X.runningTrack, FL_SNOW, Y_GROUND + 0.01);
    c.ground(tcx - ta + 4, tcz - tb + 4, tcx + ta - 4, tcz + tb - 4, X.sportsField, FL_VEG | FL_SNOW, Y_GROUND + 0.02);
    c.mass(fx0, sz1, fx1, zf, 0, H, wall, FACADE.school, roof, { vBase: PLINTH });
    c.mass(sx0, sz0, sx1, sz1, 0, H, wall, FACADE.school, roof, { vBase: PLINTH, sides: 14 });
    if (gym) c.mass(gx0, gz0, gx1, gz1, 0, GYM_H, wall, { style: FAC.INDUSTRIAL, floor: GYM_H, bay: 4 }, P.roof.flat);
    return c.finish();
  }

  if (big) {
    const outer = trackPts(tcx, tcz, ta, tb, 8), inner = trackPts(tcx, tcz, ta - 3.6, tb - 3.6, 8);
    bandBetween(c, outer, inner, Y_GROUND + 0.01, X.runningTrack, FL_SNOW);
    c.groundFan(tcx, tcz, inner, X.sportsField, FL_VEG | FL_SNOW, Y_GROUND + 0.02);
  } else {
    c.ground(tcx - ta, tcz - tb, tcx + ta, tcz + tb, X.sportsField, FL_VEG | FL_SNOW, Y_GROUND + 0.02);
  }
  pitchMarks(c, tcx, tcz, big ? ta - 8.5 : ta - 2, big ? tb - 5.5 : tb - 2);

  // buildings
  const wallH = (x0: number, z0: number, x1: number, z1: number, sides = 15) => {
    c.mass(x0, z0, x1, z1, 0, PLINTH, shade(wall, 0.78), null, null, { sides });
    c.mass(x0, z0, x1, z1, PLINTH, H, wall, FACADE.school, hipped ? null : roof, { vBase: PLINTH, sides });
    if (hipped) {
      c.hip(x0, z0, x1, z1, H, 4.2, roof, 0.5);
      eaveFascia(c, x0, z0, x1, z1, H, 0.5, 'hip', P.wall.warmWhite);
    } else c.parapet(x0, z0, x1, z1, H, shade(wall, 0.92), 0.7, 0.3);
  };
  wallH(fx0, sz1, fx1, zf);
  wallH(sx0, sz0, sx1, sz1, 14);
  if (!hipped) {
    hvac(c, (fx0 + fx1) / 2, (sz1 + zf) / 2, H, 3, 2, 1.4);
    hvac(c, (sx0 + sx1) / 2, (sz0 + sz1) / 2, H, 2.4, 2, 1.3);
  }
  if (gym) {
    c.mass(gx0, gz0, gx1, gz1, 0, GYM_H, shade(wall, 0.95), { style: FAC.INDUSTRIAL, floor: GYM_H, bay: 4 }, P.roof.flat);
    c.parapet(gx0, gz0, gx1, gz1, GYM_H, shade(wall, 0.9), 0.5, 0.3);
  }

  // entrance: canopy, doors, sign, steps, flag; bike shelter beside it
  const front = rectSides(fx0, sz1, fx1, zf).front;
  const eu = m === 1 ? front.len * 0.7 : front.len * 0.3;
  door(c, front, eu, 3.2, 2.7, X.doors[1]);
  canopy(c, front, eu, 7, 2.6, 3.4, P.wall.concreteDark, 0.3);
  c.sign(front, eu - 3, eu + 3, 3.55, 4.35, 0.12, 'civic:school');
  c.ground(front.x(eu) - 2, zf, front.x(eu) + 2, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  cityFlag(c, front.x(eu) + 4 * m, zf + 2.5, 9);
  const bx = front.x(eu) - 7 * m;
  if (Math.abs(bx) < hw - 3) bikeShelter(c, bx, zf + 2.2);
  // schoolyard with a basketball court between the field and the front wing (3×3)
  if (big) {
    const [yx0, yx1] = span(-hw + 1 + sw + 3, 20);
    const yz0 = tz1 + 1, yz1 = sz1 - 2;
    c.ground(yx0, yz0, yx1, yz1, P.road.asphalt, FL_PAVED | FL_SNOW);
    court(c, (yx0 + yx1) / 2, (yz0 + yz1) / 2, Math.min(20, yx1 - yx0 - 4), Math.min(11, yz1 - yz0 - 2));
  }
  // front garden: trees along the street, a fence with a gap at the entrance
  const gate = front.x(eu);
  propLine(c, 'fence', -hw + 0.2, c.hd - 0.6, gate - 3, c.hd - 0.6, 2.4);
  propLine(c, 'fence', gate + 3, c.hd - 0.6, hw - 0.2, c.hd - 0.6, 2.4);
  for (let x = -hw + 3; x < hw - 2; x += r.range(7, 10)) {
    if (Math.abs(x - gate) > 4.5 && Math.abs(x - bx) > 4.5) c.tree(x, r.range(zf + 2.2, c.hd - 2.2), 'deciduous', 0.85);
  }
  for (let z = tz0 + 2; z < tz1 - 1; z += 8) c.tree(m * (hw - 0.4), z, 'poplar', 0.9);
  if (gym) for (let z = gz1 + 2; z < sz0 - 1; z += 5) c.tree(m * (-hw + 4), z, 'deciduous', 0.8);
  c.pool(gate, zf + 2.5, 6);
  return c.finish();
}

/** Bike shelter: a back screen, two posts and a mono-pitch roof (6 × 2 m), open towards the street. */
function bikeShelter(c: Ctx, x: number, z: number): void {
  c.box(x - 3, 0, z - 1.0, x + 3, 2.0, z - 0.9, P.ind.glass2, P.ind.glass2);
  for (const dx of [-2.9, 2.9]) c.boxc(x + dx, z + 0.85, 0.1, 0.1, 0, 2.1, X.lampPole);
  c.withFlags(FL_SNOW, () => c.qa([x - 3.1, 2.1, z + 1.1], [x + 3.1, 2.1, z + 1.1], [x + 3.1, 2.45, z - 1.1], [x - 3.1, 2.45, z - 1.1], P.ind.industrialBlue));
  c.qa([x - 3.1, 2.45, z - 1.1], [x + 3.1, 2.45, z - 1.1], [x + 3.1, 2.1, z + 1.1], [x - 3.1, 2.1, z + 1.1], X.lampPole); // underside
}

/** Football pitch markings centred at (x, z): touchlines a × b half extents, halfway line, centre circle, goals. */
function pitchMarks(c: Ctx, x: number, z: number, a: number, b: number): void {
  if (a < 6 || b < 4) return;
  const w = 0.12, y = Y_PAINT + 0.01, col = P.road.marking;
  c.line(x - a, z - b, x + a, z - b, w, col, y);
  c.line(x - a, z + b, x + a, z + b, w, col, y);
  c.line(x - a, z - b, x - a, z + b, w, col, y);
  c.line(x + a, z - b, x + a, z + b, w, col, y);
  c.line(x, z - b, x, z + b, w, col, y);
  ring(c, x, z, Math.min(3, b * 0.4) - w, Math.min(3, b * 0.4), y, 12, col);
  for (const s of [-1, 1]) {
    const gx = x + s * a;
    c.cyl(gx, z - 2.5, 0.06, 0, 2.1, 4, X.white, X.white, false);
    c.cyl(gx, z + 2.5, 0.06, 0, 2.1, 4, X.white, X.white, false);
    c.box(gx - 0.06, 2.0, z - 2.5, gx + 0.06, 2.12, z + 2.5, X.white);
  }
}

/** Basketball court lines (w along x × d) with a hoop on a post at each end of the long (x) axis. */
function court(c: Ctx, x: number, z: number, w: number, d: number): void {
  const y = Y_PAINT, col = P.road.marking, t = 0.1;
  c.line(x - w / 2, z - d / 2, x + w / 2, z - d / 2, t, col, y);
  c.line(x - w / 2, z + d / 2, x + w / 2, z + d / 2, t, col, y);
  c.line(x - w / 2, z - d / 2, x - w / 2, z + d / 2, t, col, y);
  c.line(x + w / 2, z - d / 2, x + w / 2, z + d / 2, t, col, y);
  c.line(x, z - d / 2, x, z + d / 2, t, col, y);
  for (const s of [-1, 1]) {
    const hx = x + s * (w / 2 - 0.4);
    c.boxc(hx, z, 0.14, 0.14, 0, 3.05, X.lampPole);
    c.box(hx - s * 0.2 - 0.04, 2.9, z - 0.9, hx - s * 0.2 + 0.04, 3.95, z + 0.9, X.white);
  }
}

export const schoolFactory: AssetFactory = {
  id: 'ambient:civic:school',
  footprints: [[3, 3], [2, 2]],
  triBudget: { lod0: 800, lod1: 40 },
  build,
};
