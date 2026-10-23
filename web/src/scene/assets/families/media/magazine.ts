// Magazine publisher — company building `magazine_publisher` (art §4.2.17; 3×3): a "creative" five-storey block
// (19 m) in peach or pastel with a full-height glass atrium corner (CURTAIN box 16 × 16 m), a roof terrace with
// planters, small trees and owner-colour parasols behind a glass railing, a 30 × 20 × 8 m print wing with a glass
// wall onto a garden courtyard, a vertical owner banner and the wordmark over the entrance.
// Variants: atrium on the right (0) or left (1).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, FL_VEG } from '../common-a/constants';
import { Ctx, FACADE, rectSides, type Fac } from '../common-a/ctx';
import { banner, canopy, door, hvac, parkingLot, weeds } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

const FLOOR = 3.8;
const H = 5 * FLOOR; // 19 m
const WING_FAC: Fac = { style: FACADE.shop.style, floor: 4.0, bay: 4.5 };

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'company', 0x704);
  const m = (p.variant >>> 0) % 2 === 1 ? -1 : 1;
  const col = c.color, r = c.shape;
  const hw = c.hw - 1, hd = c.hd - 1;
  const wall = col.pick([P.wall.peach, P.wall.sage, P.wall.powderBlue, P.wall.lilacGrey, P.wall.cream]);
  const span = (a: number, b2: number): [number, number] => (m === 1 ? [a, b2] : [-b2, -a]);
  const [ox0, ox1] = span(-hw, 12);
  const oz1 = hd - 5, oz0 = oz1 - 18;
  const [ax0, ax1] = span(12, 28);
  const az1 = oz1 + 1, az0 = az1 - 16;
  const [wx0, wx1] = span(-hw, -hw + 30);
  const wz1 = oz0 - 8, wz0 = wz1 - 20;

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  c.ground(Math.min(ox0, ax0), oz1, Math.max(ox1, ax1), c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  if (c.lod === 1) {
    c.mass(ox0, oz0, ox1, oz1, 0, H, wall, FACADE.office, P.roof.green, { ownerRoof: true });
    c.mass(ax0, az0, ax1, az1, 0, H + 2, P.ind.glass2, FACADE.curtain, P.roof.tar);
    c.mass(wx0, wz0, wx1, wz1, 0, 8, P.wall.concrete, WING_FAC, P.roof.flat);
    return c.finish();
  }

  // creative block: OFFICE ribbon windows, roof terrace with glass railing
  c.mass(ox0, oz0, ox1, oz1, 0, H, wall, FACADE.office, P.roof.membrane, { ownerRoof: true });
  c.parapet(ox0, oz0, ox1, oz1, H, P.ind.glass2, 1.1, 0.08);
  c.cornice(ox0, oz0, ox1, oz1, FLOOR - 0.2, shade(wall, 0.85), 0.35, 0.2);
  // glass atrium corner rising above the block
  c.mass(ax0, az0, ax1, az1, 0, H + 2, P.ind.glass2, FACADE.curtain, P.roof.tar, { ownerRoof: true });
  c.parapet(ax0, az0, ax1, az1, H + 2, P.wall.aluminium, 0.5, 0.25);
  // roof terrace: decking, planters with small trees, owner parasols
  const tx0 = Math.min(ox0, ox1) + 2, tx1 = Math.max(ox0, ox1) - 2;
  c.ground(tx0, oz0 + 2, tx0 + (tx1 - tx0) * 0.55, oz1 - 2, X.timber, FL_SNOW, H + 0.02);
  for (let i = 0; i < 4; i++) {
    const px = tx0 + 3 + i * ((tx1 - tx0) * 0.5) / 3, pz = oz0 + 3.5;
    c.box(px - 1.2, H, pz - 1.2, px + 1.2, H + 0.7, pz + 1.2, P.wall.concreteDark, P.ground.yard);
    c.cyl(px, pz, 0.12, H + 0.7, H + 2.2, 4, P.veg.trunk, P.veg.trunk, false);
    c.withFlags(FL_VEG | FL_SNOW, () => c.blob(px, H + 3.2, pz, 1.4, 1.2, 1.4, 2, 6, col.pick([P.veg.leaf1, P.veg.leaf2, P.veg.leaf3])));
  }
  for (let i = 0; i < 3; i++) {
    const px = tx0 + 5 + i * 6, pz = oz1 - 5;
    c.cyl(px, pz, 0.06, H, H + 2.4, 4, X.lampPole, X.lampPole, false);
    c.cone(px, pz, 1.6, 0.05, H + 2.0, H + 2.7, 6, c.own);
    c.box(px - 1.4, H, pz + 1.6, px + 1.4, H + 0.75, pz + 2.4, X.timber);
  }
  hvac(c, tx1 - 4, (oz0 + oz1) / 2, H, 3, 2, 1.4);

  // print wing with a glass wall facing the courtyard garden
  c.mass(wx0, wz0, wx1, wz1, 0, 8, P.wall.concrete, null, P.roof.flat, { facs: { front: c.closed ? null : WING_FAC } });
  c.parapet(wx0, wz0, wx1, wz1, 8, shade(P.wall.concrete, 0.92), 0.6, 0.25);
  const ws = rectSides(wx0, wz0, wx1, wz1);
  c.panel(m === 1 ? ws.right : ws.left, 4, 10, 0, 4.5, 0.04, P.ind.dockDoors);
  // courtyard garden
  const gx0 = Math.min(wx0, wx1), gx1 = Math.max(wx0, wx1);
  c.ground(gx0 + 2, wz1 + 1, gx1 - 2, oz0 - 1, P.ground.park, FL_VEG | FL_SNOW, 0.05);
  for (let i = 0; i < 4; i++) c.tree(r.range(gx0 + 3, gx1 - 3), r.range(wz1 + 2.5, oz0 - 2.5), r.chance(0.3) ? 'poplar' : 'deciduous', 0.9);

  // entrance, wordmark, owner banner
  const front = rectSides(ox0, oz0, ox1, oz1).front;
  const eu = m === 1 ? front.len - 8 : 8;
  door(c, front, eu, 3.4, 3.2, X.screenDark);
  canopy(c, front, eu, 8, 2.6, 3.7, P.wall.concreteDark, 0.25);
  c.signBoard(front, eu - 7, eu + 7, FLOOR + 0.3, FLOOR + 1.6, 0, 0.25);
  banner(c, front, m === 1 ? 3 : front.len - 3, 2.2, 6, H - 1.5);

  // staff parking behind on the free side
  const [px0, px1] = span(-hw + 32, hw);
  parkingLot(c, px0, -hd, px1, Math.min(az0, oz0) - 3, { fill: 0.35 + 0.4 * Math.max(0, Math.min(1, p.utilization)), aisle: 6, lamps: true });
  c.pool(front.x(eu), oz1 + 2.5, 7);
  weeds(c, [[gx0 + 2, wz1 + 1, gx1 - 2, oz0 - 1]]);
  return c.finish();
}

export const magazineFactory: AssetFactory = {
  id: 'magazine_publisher',
  footprints: [[3, 3]],
  triBudget: { lod0: 2000, lod1: 100 },
  build,
};
