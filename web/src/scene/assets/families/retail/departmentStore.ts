// Department store — company building `department_store` (art §4.2.3; 4×4 = 96 × 96 m): a five-storey limestone
// emporium (ground 4.5 m + 4 × 4.2 m = 21.3 m) behind a 20 m plaza with trees, bollards, benches and a fountain.
// Display windows (SHOP) on the ground floor, regular upper windows (RETAIL-UPPER approximated with HOUSE windows
// at 4.2 m floors until style 7 exists), limestone cornices, a warm uplight strip at the first-floor line,
// a marquee canopy with an owner fascia and an emissive edge, four owner banners, an owner roof band and a
// 30 × 5 m rooftop wordmark. Variant 0: glass rotunda with a shallow dome on the street corner; variant 1: a
// glazed central atrium bay with a skylight dome.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { EM, FL_PAVED, FL_SNOW } from '../common-a/constants';
import { Ctx, FACADE, Side, ngonPts, rectSides } from '../common-a/ctx';
import { banner, boardedUp, door, hvac, skylight, weeds } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

const GROUND = 4.5;
const UPPER = 4.2;
const TOP = GROUND + 4 * UPPER; // 21.3 m

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'company', 0x603);
  const rotunda = (p.variant >>> 0) % 2 === 0;
  const col = c.color, r = c.shape;
  const stone = col.pick([P.wall.limestone, P.wall.stone, P.wall.limestone]);
  const roof = col.pick([P.roof.gravel, P.roof.membrane]);
  const x0 = -c.hw + 3, x1 = c.hw - 3, z0 = -c.hd + 1, z1 = c.hd - 23;
  const front = rectSides(x0, z0, x1, z1).front;
  const sides = rectSides(x0, z0, x1, z1);
  const rc = { x: x0 + 8, z: z1 - 8, r: 8 };

  // plaza
  c.ground(-c.hw + 0.3, z1, c.hw - 0.3, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  if (c.lod === 1) {
    c.mass(x0, z0, x1, z1, 0, TOP, stone, FACADE.retailUpper, roof, { ownerRoof: true, facs: { front: c.closed ? null : FACADE.shop } });
    if (rotunda) c.box(rc.x - rc.r, TOP, rc.z - rc.r, rc.x + rc.r, TOP + 7.7, rc.z + rc.r, P.ind.glass2, P.ind.glass2);
    return c.finish();
  }

  // --- the block: display-window ground floor, regular upper floors, cornices, uplight strip, owner roof band
  c.mass(x0, z0, x1, z1, 0, GROUND, stone, c.closed ? null : FACADE.shop, null, { facs: { back: null } });
  c.mass(x0, z0, x1, z1, GROUND, TOP, stone, FACADE.retailUpper, roof, { vBase: GROUND - UPPER, ownerRoof: true });
  c.cornice(x0, z0, x1, z1, GROUND, stone, 0.3, 0.25);
  for (const s of [sides.front, sides.left, sides.right]) c.panel(s, 0.3, s.len - 0.3, GROUND + 0.3, GROUND + 0.55, 0.26, X.warmLight, c.closed ? 0 : EM.soft);
  c.cornice(x0, z0, x1, z1, TOP - 0.9, shade(stone, 1.04), 0.9, 0.7);
  c.parapet(x0, z0, x1, z1, TOP, shade(stone, 0.96), 1.1, 0.35, c.own, c.signEm);
  // pilasters between the upper bays on the street face
  for (let u = 4; u < front.len - 2; u += 8) c.sideBox(front, u - 0.35, u + 0.35, GROUND + 0.3, TOP - 0.9, 0, 0.3, shade(stone, 1.03));
  if (c.closed) boardedUp(c, front, 1, front.len - 1, 0.3, 3.6);

  // --- main entrance: doors under a marquee canopy (owner fascia + glowing edge)
  const eu = front.len / 2;
  door(c, front, eu, 8, 3.4, X.screenDark);
  c.sideBox(front, eu - 12, eu + 12, 4.6, 5.0, 0, 4, P.wall.concreteDark, P.roof.membrane);
  c.signBoard(new Side(front.x(eu - 12, 4), front.z(eu - 12, 4), front.x(eu + 12, 4), front.z(eu + 12, 4)), 0, 24, 4.6, 5.6, 0, 0.18);
  c.panel(new Side(front.x(eu - 12, 4.2), front.z(eu - 12, 4.2), front.x(eu + 12, 4.2), front.z(eu + 12, 4.2)), 0, 24, 4.5, 4.62, 0, X.lampHead, c.closed ? 0 : EM.lamp);
  for (const u of [eu - 11.6, eu + 11.6]) c.boxc(front.x(u, 3.7), front.z(u, 3.7), 0.3, 0.3, 0, 4.6, P.wall.concreteDark);

  // --- four owner banners: street-face corners and the flanks' front corners
  banner(c, front, 2.2, 2, 6, 18);
  banner(c, front, front.len - 2.2, 2, 6, 18);
  banner(c, sides.left, sides.left.len - 2.2, 2, 6, 18);
  banner(c, sides.right, 2.2, 2, 6, 18);

  // --- corner rotunda (v0) or atrium bay + skylight dome (v1)
  if (rotunda) {
    const pts = ngonPts(rc.x, rc.z, rc.r, rc.r, 16);
    c.prism(pts, TOP, TOP + 7.7, P.ind.glass2, FACADE.curtain, null, { vBase: TOP - 3.7 });
    c.dome(rc.x, TOP + 7.7, rc.z, rc.r, 3.0, 3, 16, P.ind.glass2, c.closed ? 0 : EM.faint);
    c.cyl(rc.x, rc.z, 1.2, TOP + 10.4, TOP + 12, 8, shade(stone, 1.04), P.roof.copper);
  } else {
    const aw = 22;
    c.mass(front.x(eu - aw / 2), z1 - 0.5, front.x(eu + aw / 2), z1 + 2.5, GROUND, TOP + 3, P.ind.glass2, FACADE.curtain, roof, { vBase: GROUND - 3.7, sides: 11 });
    c.dome(0, TOP, (z0 + z1) / 2, 9, 3.5, 3, 12, P.ind.glass2, c.closed ? 0 : EM.faint);
  }

  // --- rooftop wordmark on a steel frame facing the street
  const ry = TOP + 1.1, rw = 30, ru = rotunda ? front.len / 2 + 8 : front.len / 2;
  c.signBoard(new Side(front.x(ru - rw / 2, -3), front.z(ru - rw / 2, -3), front.x(ru + rw / 2, -3), front.z(ru + rw / 2, -3)), 0, rw, ry + 1.2, ry + 6.2, 0, 0.4);
  for (const u of [ru - rw / 2 + 2, ru, ru + rw / 2 - 2]) c.sideBox(front, u - 0.2, u + 0.2, ry, ry + 6.0, -4.4, -3.0, P.wall.concreteDark);

  // --- roof plant and skylights
  const mx = (x0 + x1) / 2;
  for (let i = 0; i < 4; i++) hvac(c, mx + 10 + (i % 2) * 8, z0 + 10 + Math.floor(i / 2) * 9, TOP, 3.2, 2.2, 1.6);
  skylight(c, mx - 30, z0 + 8, mx - 14, z0 + 11, TOP);
  skylight(c, mx - 30, z0 + 18, mx - 14, z0 + 21, TOP);
  // service doors on the rear wall
  for (let i = 0; i < 3; i++) c.panel(sides.back, 10 + i * 6, 14 + i * 6, 0, 4.2, 0.04, P.ind.dockDoors);

  // --- plaza: two rows of trees, bollards at the kerb, benches, a fountain on the axis
  const pz0 = z1 + 3, pz1 = c.hd - 2.5;
  for (let i = 0; i < 4; i++) {
    const tx = x0 + 8 + i * ((x1 - x0 - 16) / 3);
    for (const tz of [pz0 + 4, pz1 - 4]) {
      c.disc(tx, tz, 1.3, 0.06, 6, P.ground.yard);
      c.tree(tx, tz, 'deciduous', 0.95);
    }
    c.prop('bench', tx + 3, (pz0 + pz1) / 2, r.chance(0.5) ? 0 : Math.PI);
  }
  for (let i = 0; i < 8; i++) {
    const bx = -c.hw + 6 + (i * (c.W - 12)) / 7;
    if (Math.abs(bx - front.x(eu)) > 6) c.boxc(bx, c.hd - 1.3, 0.3, 0.3, 0, 0.9, P.wall.concreteDark);
  }
  const fz = (pz0 + pz1) / 2;
  c.cyl(front.x(eu), fz, 4.2, 0, 0.55, 12, stone, stone, false);
  c.disc(front.x(eu), fz, 4.15, 0.45, 12, P.water.shallow, EM.faint);
  c.cyl(front.x(eu), fz, 0.6, 0.45, 1.6, 6, stone, stone);
  c.cone(front.x(eu), fz, 0.25, 0.05, 1.6, 3.2, 5, P.water.foam);
  if (!c.closed) {
    c.pool(front.x(eu), z1 + 5, 10);
    c.pool(front.x(eu), fz, 7);
  }
  weeds(c, [[x0, pz0, x1, pz1]]);
  return c.finish();
}

export const departmentStoreFactory: AssetFactory = {
  id: 'department_store',
  footprints: [[4, 4]],
  triBudget: { lod0: 2500, lod1: 150 },
  build,
};
