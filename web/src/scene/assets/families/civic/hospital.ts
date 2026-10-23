// Hospital — ambient archetype `ambient:civic:hospital` (art §4.3; 3×3).
// A nine-storey ward tower (3.6 m floors, warm-white) rising out of a three-storey treatment base whose two
// halves form the wings, a big emissive red cross on the tower, a rooftop helipad (H in a ring, edge lights),
// an emergency department at the back with an ambulance bay and parked ambulances, a drop-off loop under the
// entrance canopy and a visitor car park. Stair cores and the lobby stay lit all night (art: "always partly lit").
// Two seeded forms: a slab tower across the lot, or a deep tower running front-to-back (mirrored site plan).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { EM, FAC, FL_PAVED, FL_SNOW, FL_VEG, Y_PAINT } from '../common-a/constants';
import { Ctx, rectSides, type Fac, type Side } from '../common-a/ctx';
import { canopy, door, hvac, parkingLot, plantRoom, ring } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

const WARD: Fac = { style: FAC.APARTMENT, floor: 3.6, bay: 3.0 };
const TREAT: Fac = { style: FAC.OFFICE, floor: 3.6, bay: 3.0 };
const PLINTH = 0.6;
const BASE_H = PLINTH + 3 * 3.6; // 11.4 m
const TOWER_H = PLINTH + 9 * 3.6; // 33.0 m

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x605);
  const deep = (p.variant >>> 0) % 2 === 1;
  const m = deep ? -1 : 1; // visitor car park side (+1 = left)
  const col = c.color, r = c.shape;
  const hw = c.hw - 1, hd = c.hd - 1;
  const wall = col.pick([P.wall.warmWhite, P.wall.warmWhite, P.wall.limestone, P.wall.greige]);
  const accent = col.pick([P.wall.powderBlue, P.wall.sage, P.wall.steelBlue]);
  const roof = col.pick([P.roof.membrane, P.roof.flat, P.roof.gravel]);

  // site plan: base block across the middle, tower out of its centre, emergency wing behind
  const zf = c.hd - 24;
  const bx = Math.min(33, hw - 1), bz0 = zf - 20;
  const [tx0, tx1, tz0, tz1] = deep ? [-9, 9, bz0 - 6, zf - 1] : [-14, 14, bz0 + 2, zf - 3];
  // emergency wing at the back on the garden side, its ambulance bay facing the lot edge
  const [ex0s, ex1s] = m === 1 ? [11, 25] : [-25, -11];
  const ez1 = bz0, ez0 = Math.max(-hd + 2, bz0 - 15);

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  const tf = rectSides(tx0, tz0, tx1, tz1).front;
  // helipad on the tower roof (towards the back for the deep tower, the left for the slab)
  const hx = deep ? 0 : tx0 + 8.5, hz = deep ? tz0 + 8.5 : (tz0 + tz1) / 2;
  if (c.lod === 1) {
    c.mass(-bx, bz0, bx, zf, 0, BASE_H, wall, TREAT, roof);
    c.mass(tx0, tz0, tx1, tz1, 0, TOWER_H, wall, WARD, roof);
    c.mass(ex0s, ez0, ex1s, ez1, 0, 5, wall, TREAT, roof, { sides: 14 });
    redCross(c, tf, tf.len / 2, TOWER_H - 5, 3.2, 0.06);
    c.ground(hx - 6.5, hz - 6.5, hx + 6.5, hz + 6.5, P.road.asphaltDark, FL_PAVED, TOWER_H + 0.05);
    return c.finish();
  }

  // treatment base (the wings), plinth band and accent parapet
  c.mass(-bx, bz0, bx, zf, 0, PLINTH, shade(accent, 0.8), null, null);
  c.mass(-bx, bz0, bx, zf, PLINTH, BASE_H, wall, TREAT, roof, { vBase: PLINTH });
  c.parapet(-bx, bz0, bx, zf, BASE_H, accent, 0.8, 0.3);
  // ward tower (the deep tower stands on the ground behind the base)
  c.mass(tx0, tz0, tx1, tz1, deep ? 0 : BASE_H, TOWER_H, wall, WARD, roof, { vBase: PLINTH });
  c.parapet(tx0, tz0, tx1, tz1, TOWER_H, shade(wall, 0.94), 1.0, 0.3);
  const ts = rectSides(tx0, tz0, tx1, tz1);
  // lit stair cores at both ends of the tower (cool white, always on at night)
  for (const s of deep ? [ts.front, ts.back] : [ts.left, ts.right]) c.panel(s, s.len / 2 - 1.2, s.len / 2 + 1.2, BASE_H + 0.6, TOWER_H - 0.4, 0.05, X.coolLight, c.closed ? 0 : EM.soft);
  redCross(c, tf, tf.len / 2, TOWER_H - 5, 3.2, 0.06);
  helipad(c, hx, hz, TOWER_H);
  const px = deep ? 0 : tx1 - 6, pz = deep ? tz1 - 6 : (tz0 + tz1) / 2;
  plantRoom(c, px - 3, pz - 2.5, px + 3, pz + 2.5, TOWER_H, 3.2, shade(wall, 0.9));
  for (const x of [-bx + 6, bx - 6, m * (bx - 14)]) hvac(c, x, bz0 + 5, BASE_H, 3, 2.2, 1.5);

  // main entrance: canopy over the drop-off, glazed lobby band, sign, doors
  const front = rectSides(-bx, bz0, bx, zf).front;
  const eu = front.len / 2;
  c.panel(front, eu - 10, eu + 10, PLINTH + 0.3, 4.0, 0.04, P.ind.glass2, c.closed ? 0 : EM.faint);
  door(c, front, eu, 4, 2.8, X.screenDark);
  canopy(c, front, eu, 16, 7, 4.6, P.wall.concreteDark, 0.35);
  c.sideBox(front, eu - 8, eu + 8, 4.25, 4.95, 6.9, 7.15, accent);
  c.sign(front, eu - 5, eu + 5, 4.3, 4.9, 7.17, 'civic:hospital');
  redCross(c, front, eu + 6.5, 4.6, 0.32, 7.18);
  for (const u of [eu - 7.5, eu + 7.5]) c.cyl(front.x(u, 6.5), front.z(u, 6.5), 0.2, 0, 4.3, 6, P.wall.concrete, P.wall.concrete, false);
  // drop-off loop and a lawn round it
  c.ground(-13, zf, 13, zf + 16, P.road.asphalt, FL_PAVED | FL_SNOW);
  c.groundFan(0, zf + 9, [[-6, zf + 12], [0, zf + 13.5], [6, zf + 12], [6, zf + 5], [-6, zf + 5]] as const, P.ground.park, FL_VEG | FL_SNOW, 0.07);
  c.ground(-2, zf + 16, 2, c.hd - 0.3, P.road.asphalt, FL_PAVED | FL_SNOW);
  for (const x of [-4, 4]) c.tree(x, zf + 9, 'deciduous', 0.75);
  c.pool(0, zf + 4, 9);
  // visitor car park on one side, garden with trees on the other
  const [vx0, vx1] = m === 1 ? [-hw + 0.5, -15] : [15, hw - 0.5];
  parkingLot(c, vx0, zf + 1.5, vx1, hd - 0.5, { fill: 0.5 + 0.4 * Math.max(0, Math.min(1, p.utilization)), aisle: 6.5, lamps: true });
  const gx = m * 25;
  c.ground(gx - 9, zf + 2, gx + 9, hd - 1, P.ground.park, FL_VEG | FL_SNOW, 0.05);
  for (let i = 0; i < 7; i++) c.tree(gx + r.range(-8, 8), r.range(zf + 3, hd - 2), r.chance(0.25) ? 'conifer' : 'deciduous');
  c.prop('bench', gx, zf + 3.2, 0);

  // emergency department behind, ambulance bay with a canopy and ambulances
  c.mass(ex0s, ez0, ex1s, ez1, 0, 5, wall, TREAT, roof, { sides: 14 });
  c.parapet(ex0s, ez0, ex1s, ez1, 5, accent, 0.6, 0.25);
  const es = rectSides(ex0s, ez0, ex1s, ez1);
  const bay = m === 1 ? es.right : es.left;
  canopy(c, bay, bay.len / 2, 12, 7, 4.4, P.wall.concreteDark, 0.3);
  c.sideBox(bay, bay.len / 2 - 6, bay.len / 2 + 6, 3.95, 4.45, 6.85, 7.05, X.cross, X.cross, c.closed ? 0 : EM.sign, 0);
  door(c, bay, bay.len / 2, 3, 2.6, X.screenDark);
  const [ax0, ax1] = m === 1 ? [ex1s, hw - 0.5] : [-hw + 0.5, ex0s];
  c.ground(ax0, ez0 - 1, ax1, ez1 + 0.5, P.road.asphalt, FL_PAVED | FL_SNOW);
  if (!c.closed) {
    c.prop('ambulance', bay.x(bay.len / 2 - 3, 3.6), bay.z(bay.len / 2 - 3, 3.6), 0);
    c.prop('ambulance', bay.x(bay.len / 2 + 3, 3.6), bay.z(bay.len / 2 + 3, 3.6), 0);
  }
  c.pool(bay.x(bay.len / 2, 4), bay.z(bay.len / 2, 4), 7);
  for (let i = 0; i < 4; i++) c.tree(-m * r.range(12, hw - 2), r.range(-hd + 1.5, bz0 - 3), 'deciduous', 0.9);
  return c.finish();
}

/** Red cross (emissive) on a white square on side `s`, centred at (u, v); arm length 3·k. */
function redCross(c: Ctx, s: Side, u: number, v: number, k: number, out: number): void {
  const a = 1.5 * k, t = 0.5 * k, em = c.closed ? 0 : EM.sign;
  if (c.lod === 0) c.panel(s, u - a - 0.35 * k, u + a + 0.35 * k, v - a - 0.35 * k, v + a + 0.35 * k, out, X.white, c.closed ? 0 : EM.faint);
  const o = c.lod === 0 ? out + 0.03 : out;
  c.panel(s, u - t, u + t, v - a, v + a, o, X.cross, em);
  c.panel(s, u - a, u - t, v - t, v + t, o, X.cross, em);
  c.panel(s, u + t, u + a, v - t, v + t, o, X.cross, em);
}

/** Rooftop helipad: dark square, white ring and "H", corner lights. */
function helipad(c: Ctx, x: number, z: number, y: number): void {
  const h = 6.5, w = 0.5;
  c.ground(x - h, z - h, x + h, z + h, P.road.asphaltDark, FL_PAVED, y + 0.05);
  ring(c, x, z, 4.6, 5.2, y + Y_PAINT, 16, X.white);
  c.ground(x - 1.6, z - 2.2, x - 1.6 + w, z + 2.2, X.white, 0, y + Y_PAINT + 0.01);
  c.ground(x + 1.6 - w, z - 2.2, x + 1.6, z + 2.2, X.white, 0, y + Y_PAINT + 0.01);
  c.ground(x - 1.6 + w, z - w / 2, x + 1.6 - w, z + w / 2, X.white, 0, y + Y_PAINT + 0.01);
  for (const [dx, dz] of [[-h, -h], [h, -h], [h, h], [-h, h]] as const) c.boxc(x + dx * 0.95, z + dz * 0.95, 0.3, 0.3, y, 0.3, X.signalGreen, X.signalGreen, c.closed ? 0 : EM.lamp);
}

export const hospitalFactory: AssetFactory = {
  id: 'ambient:civic:hospital',
  footprints: [[3, 3]],
  triBudget: { lod0: 900, lod1: 40 },
  build,
};
