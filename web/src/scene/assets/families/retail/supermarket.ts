// Supermarket — company building `supermarket` (art §4.2.2; 3×3 = 72 × 72 m; levels L1–L3): a wide low box at
// the back of a car park whose fill shows the store's sales (fill = 0.1 + 0.85 × utilization; the scene passes
// utilization = clamp01(log10(1 + unitsSold) / 6.5), art §3.16). Owner paint: parapet band across the front with
// 6 m returns, roof sign, entrance canopy fascia, pylon sign, trolley-shelter roofs.
//   L2 adds a glass-roofed garden-centre wing and 12 more bays; L3 adds rooftop solar on ~60% of the roof and a
//   click-and-collect canopy over 4 bays.
// Two shape variants: entrance canopy left / right of centre (with the service yard on the opposite side).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, FL_VEG, Y_PAINT } from '../common-a/constants';
import { Ctx, FACADE, Side, rectSides } from '../common-a/ctx';
import { boardedUp, door, hvac, parkingLot, pylon, skylight, solarRows, weeds } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

const H = 8.0;

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'company', 0x602);
  const mirror = (p.variant >>> 0) % 2 === 1 ? -1 : 1; // variant 1 mirrors the plan left ↔ right
  const level = Math.max(1, Math.min(3, p.level));
  const col = c.color, r = c.shape;
  const hw = c.hw - 1, hd = c.hd - 1;
  const cladding = col.pick([P.wall.warmWhite, P.wall.greige]);
  const roof = col.pick([P.roof.membrane, P.roof.flat]);
  const fill = 0.1 + 0.85 * Math.max(0, Math.min(1, p.utilization));
  const X0 = (x: number) => x * mirror; // mirror helper for x coordinates
  const span = (a: number, b2: number): [number, number] => (mirror === 1 ? [a, b2] : [-b2, -a]);

  // plan (unmirrored): store x ∈ [−hw, 17], z ∈ [−hd, −5]; side strip x ∈ [17, hw] (service yard at the back,
  // garden centre / landscaping in front of it); car park z ∈ [−1, hd]
  const [sx0, sx1] = span(-hw, 17);
  const sz0 = -hd, sz1 = -5;
  const [yx0, yx1] = span(17.5, hw);
  const front = rectSides(sx0, sz0, sx1, sz1).front;

  // ground: car park + drive + service yard + front planting strip
  const parkZ0 = -1, parkZ1 = hd - 1.6;
  c.ground(-c.hw + 0.3, parkZ1, c.hw - 0.3, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW);
  c.ground(-c.hw + 0.3, sz1, c.hw - 0.3, parkZ0, P.road.sidewalk, FL_PAVED | FL_SNOW);
  c.ground(yx0, sz0, yx1, sz1, P.road.parking, FL_PAVED | FL_SNOW);

  if (c.lod === 1) {
    c.ground(-c.hw + 0.3, parkZ0, c.hw - 0.3, parkZ1, P.road.parking, FL_PAVED | FL_SNOW);
    c.mass(sx0, sz0, sx1, sz1, 0, H, cladding, c.closed ? null : FACADE.shop, roof, { ownerRoof: true, facs: { back: null, left: null, right: null } });
    if (level >= 2) {
      const [gx0, gx1] = span(18.5, hw - 0.5);
      c.mass(gx0, -15, gx1, sz1, 0, 5, P.ind.glass2, c.closed ? null : FACADE.shop, P.ind.glass2);
    }
    return c.finish();
  }

  // --- the store: glazed front, blank flanks with vertical fins, rear dock wall
  c.mass(sx0, sz0, sx1, sz1, 0, H, cladding, null, roof, { ownerRoof: true, facs: { front: c.closed ? null : FACADE.shop } });
  c.parapet(sx0, sz0, sx1, sz1, H, shade(cladding, 0.93), 1.0, 0.3, c.own, c.signEm);
  // owner band returns 6 m down both flanks
  const sides = rectSides(sx0, sz0, sx1, sz1);
  c.panel(sides.left, sides.left.len - 6, sides.left.len, H, H + 1.0, 0.02, c.own, c.signEm);
  c.panel(sides.right, 0, 6, H, H + 1.0, 0.02, c.own, c.signEm);
  for (const s of [sides.left, sides.right]) {
    for (let u = 8; u < s.len - 8; u += 6) c.sideBox(s, u - 0.2, u + 0.2, 0.3, H - 0.4, 0, 0.45, shade(cladding, 0.9));
  }
  if (c.closed) boardedUp(c, front, 0.6, front.len - 0.6);

  // entrance: glass-roofed canopy with owner fascia, doors, roof sign above
  const eu = front.len / 2 + (mirror === 1 ? -4 : 4);
  door(c, front, eu, 6, 3.0, X.screenDark);
  c.sideBox(front, eu - 8, eu + 8, 4.2, 4.5, 0, 5, P.wall.concreteDark, P.ind.glass2);
  c.sideBox(front, eu - 8, eu + 8, 4.5, 5.3, 4.7, 5.0, c.signC, c.signC, c.signEm, 0);
  for (const u of [eu - 7.6, eu + 7.6]) c.boxc(front.x(u, 4.6), front.z(u, 4.6), 0.3, 0.3, 0, 4.2, P.wall.concreteDark);
  if (!c.closed) c.sign(new Side(front.x(eu - 8, 5.02), front.z(eu - 8, 5.02), front.x(eu + 8, 5.02), front.z(eu + 8, 5.02)), 0.4, 15.6, 4.55, 5.25, 0);
  const signW = 20, roofSignY = H + 1.0;
  c.signBoard(front, eu - signW / 2, eu + signW / 2, roofSignY, roofSignY + 3.5, -0.6, 0.35);
  for (const u of [eu - 6, eu + 6]) c.sideBox(front, u - 0.15, u + 0.15, H, roofSignY + 3.3, -1.6, -0.6, P.wall.concreteDark);

  // --- roof: HVAC, skylights; L3 solar over ~60% of the roof
  const roofX0 = Math.min(sx0, sx1) + 3, roofX1 = Math.max(sx0, sx1) - 3;
  if (level >= 3) solarRows(c, roofX0, sz0 + 2, roofX0 + (roofX1 - roofX0) * 0.62, sz1 - 3, H);
  else {
    skylight(c, roofX0 + 4, sz0 + 6, roofX0 + 24, sz0 + 8, H);
    skylight(c, roofX0 + 4, sz0 + 18, roofX0 + 24, sz0 + 20, H);
  }
  for (let i = 0; i < 6; i++) hvac(c, roofX1 - 4 - (i % 3) * 5.5, sz0 + 6 + Math.floor(i / 3) * 12, H, 3, 2, 1.5);

  // --- service yard: two dock doors on the store's side wall, a trailer, bins
  const dockSide = mirror === 1 ? sides.right : sides.left;
  for (const u of mirror === 1 ? [dockSide.len - 10, dockSide.len - 16] : [10, 16]) {
    c.panel(dockSide, u - 1.8, u + 1.8, 0, 4.2, 0.04, P.ind.dockDoors);
    c.sideBox(dockSide, u - 2.0, u + 2.0, 0, 1.2, 0, 1.6, P.wall.concreteDark);
  }
  if (!c.closed) {
    const tx = X0(17.5 + 6.5), tz = sz0 + 11;
    c.box(tx - 1.3, 1.1, tz - 6.8, tx + 1.3, 4.0, tz + 6.8, P.wall.warmWhite, P.wall.warmWhite);
    c.box(tx - 1.2, 0, tz - 6.0, tx + 1.2, 1.1, tz - 4.6, X.contact);
    c.box(tx - 0.2, 0, tz + 4.5, tx + 0.2, 1.1, tz + 5.0, X.contact);
  }
  for (let i = 0; i < 3; i++) c.boxc(X0(hw - 1.5), sz0 + 2 + i * 1.6, 1.2, 1.3, 0, 1.3, X.bins);

  // --- garden centre (L2+) or landscaped strip (L1) in front of the yard
  const gz0 = -15, gz1 = sz1;
  const [gx0, gx1] = span(18.5, hw - 0.5);
  if (level >= 2) {
    c.mass(gx0, gz0, gx1, gz1, 0, 5, P.ind.glass2, c.closed ? null : FACADE.shop, null);
    c.roofTop([[gx0, gz1], [gx1, gz1], [gx1, gz0], [gx0, gz0]], 5, P.ind.glass2);
    c.cornice(gx0, gz0, gx1, gz1, 4.6, c.own, 0.4, 0.1);
    // fenced outdoor plant yard in front
    c.ground(gx0, gz1, gx1, parkZ0 - 0.2, P.ground.park, FL_VEG | FL_SNOW);
    c.withFlags(FL_VEG, () => {
      for (let i = 0; i < 3; i++) c.boxc((gx0 + gx1) / 2 + (i - 1) * 5, (gz1 + parkZ0) / 2, 3.5, 1.4, 0, 0.9, P.veg.leaf2);
    });
  } else {
    c.ground(gx0, gz0, gx1, parkZ0 - 0.2, P.ground.park, FL_VEG | FL_SNOW);
    for (let i = 0; i < 3; i++) c.tree((gx0 + gx1) / 2 + r.range(-5, 5), gz0 + 2 + i * 4.5, 'deciduous');
  }

  // --- car park: 4 rows, 18 bays per row (21 at L2+), tree islands, lamps, trolley shelters
  const per = level >= 2 ? 21 : 18;
  const parkW = per * 2.6 + 1;
  const [px0, px1] = span(-hw, -hw + parkW);
  const drive = mirror === 1 ? [px1, hw] : [-hw, px0];
  c.ground(drive[0], parkZ0, drive[1], parkZ1, P.road.parking, FL_PAVED | FL_SNOW);
  const islandA = (px0 + px1) / 2 - 7.8, islandB = (px0 + px1) / 2 + 7.8;
  parkingLot(c, px0, parkZ0, px1, parkZ1, { fill, lamps: true, maxPerRow: per, skip: [[islandA - 1.4, islandA + 1.4], [islandB - 1.4, islandB + 1.4]] });
  // planted islands: one in the front row, one across the back-to-back middle rows (see parkingLot layout)
  for (const ix of [islandA, islandB]) {
    for (const [iz0, iz1] of [[parkZ1 - 5.5, parkZ1 - 0.5], [parkZ1 - 22, parkZ1 - 12]] as const) {
      c.box(ix - 1.2, 0, iz0, ix + 1.2, 0.18, iz1, P.road.curb, P.ground.yard);
      c.tree(ix, (iz0 + iz1) / 2, 'deciduous', 0.85);
    }
  }
  // trolley shelters with owner-colour roofs on the walkway either side of the entrance
  for (const tu of [eu - 13, eu + 13]) {
    const tx = front.x(tu), tz = (sz1 + parkZ0) / 2;
    c.box(tx - 3, 2.3, tz - 1, tx + 3, 2.5, tz + 1, c.own, c.own);
    c.box(tx - 3, 0, tz - 1, tx + 3, 2.3, tz - 0.94, P.ind.glass2, P.ind.glass2, false);
    for (const ex of [tx - 2.95, tx + 2.95]) c.box(ex - 0.05, 0, tz - 1, ex + 0.05, 2.3, tz + 1, P.wall.concreteDark);
  }
  // click & collect canopy over 4 bays at the drive side (L3)
  if (level >= 3) {
    const [cx0, cx1] = span(hw - 12.5, hw - 0.5);
    const cz0 = parkZ0 + 1, cz1 = cz0 + 6;
    c.box(cx0, 3.2, cz0, cx1, 3.6, cz1, P.wall.concreteDark, P.roof.membrane);
    c.sideBox(rectSides(cx0, cz0, cx1, cz1).front, 0, cx1 - cx0, 3.15, 3.75, 0, 0.08, c.own, c.own, c.signEm, 0);
    for (const [ex, ez] of [[cx0 + 0.3, cz0 + 0.3], [cx1 - 0.3, cz0 + 0.3], [cx0 + 0.3, cz1 - 0.3], [cx1 - 0.3, cz1 - 0.3]] as const) c.boxc(ex, ez, 0.25, 0.25, 0, 3.2, P.wall.concreteDark);
    for (let i = 0; i <= 4; i++) c.line(cx0 + i * 3, cz0, cx0 + i * 3, cz1, 0.12, P.road.marking, Y_PAINT);
    c.pool((cx0 + cx1) / 2, (cz0 + cz1) / 2, 7);
  }
  // pylon sign at the street entrance, trees along the front edge
  pylon(c, X0(hw - 3), hd - 3.2, 10, 3.2);
  for (let i = 0; i < 6; i++) {
    const tx = -hw + 3 + (i * (2 * hw - 14)) / 5;
    c.tree(X0(tx), parkZ1 + 1.0, 'deciduous', 0.9);
  }
  c.pool(front.x(eu, 6), front.z(eu, 6), 9);
  weeds(c, [[px0, parkZ0 + 1, px1, parkZ1 - 1]]);
  return c.finish();
}

export const supermarketFactory: AssetFactory = {
  id: 'supermarket',
  footprints: [[3, 3]],
  triBudget: { lod0: 2000, lod1: 120 },
  build,
};
