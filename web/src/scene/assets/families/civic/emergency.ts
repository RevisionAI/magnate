// Police and fire stations — ambient archetypes `ambient:civic:police` and `ambient:civic:fire` (art §4.3; 1×1–2×2).
// Police: a two/three-storey greige (or brick, hipped) station with a blue band, a blue-lit entrance canopy, the
// classic blue lamp, a radio mast and a vehicle yard of police cars (instanced 'car.police').
// Fire: an apparatus hall with red bay doors under a lit header, a hose / drill tower, a concrete apron with fire
// engines (instanced 'truck.fire') and, on 2×2, an office wing and a training yard.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { EM, FAC, FL_PAVED, FL_SNOW, FL_VEG } from '../common-a/constants';
import { Ctx, rectSides, type Fac } from '../common-a/ctx';
import { antenna, canopy, door, eaveFascia, hvac, propLine } from '../common-a/kit';
import { FLAT_ROOFS, HEX, P, X, shade } from '../common-a/palette';
import { cityFlag } from './classical';

const STATION: Fac = { style: FAC.APARTMENT, floor: 3.5, bay: 3.0 };
const PLINTH = 0.5;

// ------------------------------------------------------------------------------------------- police

function buildPolice(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x606);
  const brick = (p.variant >>> 0) % 2 === 1;
  const col = c.color, r = c.shape;
  const big = Math.min(c.W, c.D) >= 40;
  const hw = c.hw - 1, hd = c.hd - 1;
  const wall: RGB = brick ? col.pick([P.wall.brick, P.wall.terracotta]) : col.pick([P.wall.greige, P.wall.concrete, P.wall.stone]);
  const roof = brick ? P.roof.slate : col.pick(FLAT_ROOFS);
  const floors = big ? 3 : 2;
  const H = PLINTH + floors * STATION.floor;
  const zf = c.hd - (big ? 7 : 5);
  const [x0, x1] = big ? [-20, 10] : [-hw + 1, 6];
  const z0 = zf - (big ? 16 : 11);
  const [yx0, yx1] = big ? [-2, hw - 0.5] : [x1 + 0.6, hw + 0.7];
  const yz0 = -hd - 0.7, yz1 = big ? z0 - 1.5 : zf;
  const [gx0, gx1, gz0, gz1] = [x0, -4, -hd + 5, z0 - 2.5];

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  c.ground(yx0, yz0, yx1, yz1, P.road.asphalt, FL_PAVED | FL_SNOW);
  if (c.lod === 1) {
    c.mass(x0, z0, x1, zf, 0, H, wall, STATION, brick ? null : roof, { vBase: PLINTH });
    if (brick) c.hip(x0, z0, x1, zf, H, 3.6, roof, 0.4);
    if (big) c.mass(gx0, gz0, gx1, gz1, 0, 5, wall, null, P.roof.tar);
    return c.finish();
  }

  c.mass(x0, z0, x1, zf, 0, PLINTH, shade(wall, 0.75), null, null);
  c.mass(x0, z0, x1, zf, PLINTH, H, wall, STATION, brick ? null : roof, { vBase: PLINTH });
  if (brick) {
    c.hip(x0, z0, x1, zf, H, 3.6, roof, 0.4);
    eaveFascia(c, x0, z0, x1, zf, H, 0.4, 'hip', P.wall.warmWhite);
  } else {
    c.parapet(x0, z0, x1, zf, H, shade(wall, 0.9), 0.6, 0.25);
    hvac(c, (x0 + x1) / 2 - 3, (z0 + zf) / 2, H, 2.4, 1.8, 1.2);
  }
  const s = rectSides(x0, z0, x1, zf);
  // blue band at the first floor line round the street and side faces
  for (const side of [s.front, s.left, s.right]) c.panel(side, 0, side.len, PLINTH + 3.3, PLINTH + 3.75, 0.05, X.policeBlue);
  // entrance: canopy with a lit blue fascia, sign, the blue lamp, steps
  const front = s.front;
  const eu = big ? front.len / 2 : front.len * 0.35;
  door(c, front, eu, 2.4, 2.6, X.doors[3]);
  canopy(c, front, eu, 5, 2.2, 3.1, P.wall.concreteDark, 0.25);
  c.sideBox(front, eu - 2.5, eu + 2.5, 2.85, 3.1, 2.2, 2.32, X.policeLight, X.policeLight, c.closed ? 0 : EM.sign, 0);
  c.sign(front, eu - 2.6, eu + 2.6, PLINTH + 3.85, PLINTH + 4.75, 0.08, 'civic:police');
  const lx = front.x(eu + 3.2, 0.6), lz = front.z(eu + 3.2, 0.6);
  c.boxc(lx, lz, 0.12, 0.12, 0, 2.4, X.lampPole);
  c.boxc(lx, lz, 0.42, 0.42, 2.4, 0.5, X.policeLight, X.lampPole, c.closed ? 0 : EM.lamp);
  c.ground(front.x(eu) - 1.6, zf, front.x(eu) + 1.6, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  // radio mast on the roof
  antenna(c, x0 + 2.5, z0 + 2.5, H + (brick ? 0 : 0.6), big ? 12 : 8, false);
  c.pool(front.x(eu), zf + 2, 6);

  // vehicle yard (and a garage block on 2×2)
  const cars = big ? 6 : 2;
  for (let i = 0; i < cars; i++) {
    const cx = big ? yx0 + 3 + (i % 3) * 3.2 + (i >= 3 ? 9.6 : 0) : (yx0 + yx1) / 2;
    const cz = big ? yz1 - 4 : yz1 - 4 - i * 5.6;
    if (!c.closed && i < Math.round(cars * (0.4 + 0.6 * Math.max(0, Math.min(1, p.utilization))))) c.prop('car.police', cx, cz, big ? 0 : Math.PI);
  }
  if (big) {
    c.mass(gx0, gz0, gx1, gz1, 0, 5, shade(wall, 0.95), null, P.roof.tar);
    const gs = rectSides(gx0, gz0, gx1, gz1).right;
    for (let i = 0; i < 3; i++) c.panel(gs, 1.5 + i * 3.8, 4.5 + i * 3.8, 0, 3.6, 0.04, P.ind.dockDoors);
    if (!c.closed) c.prop('van', yx1 - 4, yz0 + 5, Math.PI / 2, 1, HEX.policeBlue);
    cityFlag(c, x1 + 3, zf + 2.5, 9);
    propLine(c, 'fence', x1 + 0.5, yz1 + 0.6, yx1, yz1 + 0.6, 2.4);
    for (let x = x0 + 2; x < x1; x += r.range(7, 9)) if (Math.abs(x - front.x(eu)) > 3.5) c.tree(x, r.range(zf + 2, c.hd - 2), 'deciduous', 0.8);
    for (let i = 0; i < 3; i++) c.tree(r.range(x1 + 4, hw - 2), r.range(yz1 + 3, zf - 1), 'deciduous', 0.9);
  } else {
    propLine(c, 'hedge', -c.hw + 1, -hd + 0.2, x1, -hd + 0.2, 2.1);
    c.tree(x0 + 1.5, c.hd - 2.2, 'deciduous', 0.7);
  }
  return c.finish();
}

// ------------------------------------------------------------------------------------------- fire

function buildFire(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x607);
  const m = (p.variant >>> 0) % 2 === 1 ? -1 : 1; // tower side
  const col = c.color, r = c.shape;
  const big = Math.min(c.W, c.D) >= 40;
  const hw = c.hw - 1, hd = c.hd - 1;
  const wall = col.pick([P.wall.brick, P.wall.greige, P.wall.concrete, P.wall.sandWall]);
  const roof = col.pick(FLAT_ROOFS);
  const bays = big ? 4 : 2, bayW = 4.6, BAY_H = 5.0, H = BAY_H + 3.6;
  const span = (a: number, b2: number): [number, number] => (m === 1 ? [a, b2] : [-b2, -a]);
  const zf = c.hd - (big ? 14 : 9.5);
  const hallW = bays * bayW + 2.4;
  const [hx0, hx1] = span(-hw + 1, -hw + 1 + hallW);
  const z0 = zf - (big ? 16 : 12.5);
  const [ox0, ox1] = span(-hw + 1 + hallW, big ? hw - 3 : hw - 1);
  const [tx0, tx1] = span(big ? hw - 9 : hw - 4.5, hw - (big ? 3 : 0.5));
  const tz1 = big ? -hd + 9 : z0 + 4.5, tz0 = tz1 - (big ? 6 : 4.5);
  const towerH = big ? 20 : 15;

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  c.ground(hx0, zf, hx1, c.hd - 0.3, P.wall.concrete, FL_PAVED | FL_SNOW);
  if (c.lod === 1) {
    c.mass(big ? Math.min(hx0, ox0) : hx0, z0, big ? Math.max(hx1, ox1) : hx1, zf, 0, H, wall, STATION, roof, { vBase: BAY_H });
    c.mass(tx0, tz0, tx1, tz1, 0, towerH, wall, null, roof);
    return c.finish();
  }

  // apparatus hall: blank bay storey, windowed upper floor, red parapet band
  c.mass(hx0, z0, hx1, zf, 0, BAY_H, wall, null, null);
  c.mass(hx0, z0, hx1, zf, BAY_H, H, wall, STATION, roof, { vBase: BAY_H - 0.6 });
  c.parapet(hx0, z0, hx1, zf, H, shade(wall, 0.9), 0.6, 0.25, X.fireRed);
  const front = rectSides(hx0, z0, hx1, zf).front;
  const bu0 = (front.len - bays * bayW) / 2;
  for (let i = 0; i < bays; i++) {
    const u0 = bu0 + i * bayW + 0.3, u1 = bu0 + (i + 1) * bayW - 0.3;
    c.panel(front, u0, u1, 0, 4.4, 0.05, X.fireRed);
    c.panel(front, u0, u1, 1.9, 2.4, 0.07, shade(X.fireRed, 0.8)); // door rail
    c.panel(front, u0 + 0.6, u1 - 0.6, 3.2, 4.0, 0.07, P.ind.glass2);
  }
  c.panel(front, bu0, front.len - bu0, 4.55, 4.9, 0.08, X.warmLight, c.closed ? 0 : EM.soft);
  c.sign(front, front.len / 2 - Math.min(5, hallW / 2 - 1), front.len / 2 + Math.min(5, hallW / 2 - 1), BAY_H + 0.3, BAY_H + 1.1, 0.06, 'civic:fire');
  // office wing (2×2) or a side door (1×1)
  if (big) {
    c.mass(ox0, z0, ox1, zf - 4, 0, H, shade(wall, 1.04), STATION, roof, { vBase: PLINTH, sides: m === 1 ? 7 : 13 });
    c.parapet(ox0, z0, ox1, zf - 4, H, shade(wall, 0.9), 0.6, 0.25);
    const of = rectSides(ox0, z0, ox1, zf - 4).front;
    door(c, of, of.len / 2, 1.8, 2.5, X.doors[0]);
    canopy(c, of, of.len / 2, 3.6, 1.6, 3.0, P.wall.concreteDark);
    cityFlag(c, (ox0 + ox1) / 2, zf - 1.5, 9);
  }
  hvac(c, (hx0 + hx1) / 2, z0 + 3, H, 2.4, 1.8, 1.2);
  // hose / drill tower with window openings
  c.mass(tx0, tz0, tx1, tz1, 0, towerH, shade(wall, 0.97), null, roof);
  c.parapet(tx0, tz0, tx1, tz1, towerH, X.fireRed, 0.5, 0.2);
  const ts = rectSides(tx0, tz0, tx1, tz1);
  for (const side of [ts.front, m === 1 ? ts.left : ts.right]) {
    for (let y = 3; y < towerH - 1.5; y += 3.2) c.panel(side, side.len / 2 - 0.6, side.len / 2 + 0.6, y, y + 1.6, 0.04, X.screenDark);
  }
  // apron with engines, a training yard behind on 2×2, lamps
  const engines = big ? 2 : 1;
  for (let i = 0; i < engines; i++) {
    const u = bu0 + (i * 2 + 0.5) * bayW + (big ? 0 : bayW * 0.5);
    if (!c.closed) c.prop('truck.fire', front.x(u, 4.6), front.z(u, 4.6), 0);
  }
  if (big) {
    c.ground(-hw + 0.5, -hd + 0.5, hw - 0.5, z0 - 1.5, P.road.asphalt, FL_PAVED | FL_SNOW);
    if (!c.closed) c.prop('ambulance', m * -10, -hd + 6, Math.PI / 2);
    for (let i = 0; i < 4; i++) c.tree(r.range(ox0 + 3, ox1 - 2), r.range(zf + 1, c.hd - 2), 'deciduous', 0.8);
  } else {
    propLine(c, 'hedge', -c.hw + 1, -hd + 0.2, c.hw - 1, -hd + 0.2, 2.1);
  }
  c.prop('lamp.street', m === 1 ? hx1 + 0.8 : hx0 - 0.8, c.hd - 1.5, m === 1 ? -Math.PI / 2 : Math.PI / 2);
  c.pool(front.x(front.len / 2, 3), zf + 3, 7);
  return c.finish();
}

export const policeFactory: AssetFactory = {
  id: 'ambient:civic:police',
  footprints: [[1, 1], [2, 2]],
  triBudget: { lod0: 400, lod1: 30 },
  build: buildPolice,
};

export const fireFactory: AssetFactory = {
  id: 'ambient:civic:fire',
  footprints: [[1, 1], [2, 2]],
  triBudget: { lod0: 400, lod1: 30 },
  build: buildFire,
};
