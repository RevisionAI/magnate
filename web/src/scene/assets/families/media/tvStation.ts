// TV station — company building `tv_station` (art §4.2.14; 3×3): a studio/office block 44 × 28 × 14 m with
// OFFICE ribbon windows, a blind studio wing 24 × 20 × 12 m with an owner stripe, a 100 m self-supporting lattice
// broadcast tower (three tapering stages, red/white bands every 12 m, obstruction lights), three satellite dishes
// (Ø4–8 m at 35° elevation), two OB vans in owner livery (props) and a rooftop wordmark.
// Variants: tower at the back-right (0) or back-left (1).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, FL_VEG } from '../common-a/constants';
import { Ctx, FACADE, rectSides, type Fac } from '../common-a/ctx';
import { canopy, dish, door, hvac, parkingLot, weeds } from '../common-a/kit';
import { OFFICE_WALLS, P, X, shade } from '../common-a/palette';
import { latticeTower } from './masts';

const STUDIO_FAC: Fac = { style: FACADE.office.style, floor: 3.5, bay: 3.0 };

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'company', 0x701);
  const m = (p.variant >>> 0) % 2 === 1 ? -1 : 1;
  const col = c.color, r = c.shape;
  const hw = c.hw - 1, hd = c.hd - 1;
  const wall = col.pick(OFFICE_WALLS);
  const wing = col.pick([P.wall.concreteDark, P.wall.steelBlue, P.wall.greige]);
  const span = (a: number, b2: number): [number, number] => (m === 1 ? [a, b2] : [-b2, -a]);

  // studio / office block at the front, blind studio wing behind it, tower in the free back corner
  const [ox0, ox1] = span(-hw, -hw + 44);
  const oz1 = hd - 3, oz0 = oz1 - 28;
  const [wx0, wx1] = span(-hw, -hw + 24);
  const wz1 = oz0, wz0 = wz1 - 20;
  const tcx = m * (hw - 9), tcz = -hd + 10;

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  c.ground(ox0, oz1, ox1, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  if (c.lod === 1) {
    c.mass(ox0, oz0, ox1, oz1, 0, 14, wall, STUDIO_FAC, P.roof.gravel, { ownerRoof: true });
    c.mass(wx0, wz0, wx1, wz1, 0, 12, wing, null, P.roof.tar);
    latticeTower(c, tcx, tcz, 100, 4.5, 1.0);
    return c.finish();
  }

  c.mass(ox0, oz0, ox1, oz1, 0, 14, wall, STUDIO_FAC, P.roof.gravel, { ownerRoof: true });
  c.parapet(ox0, oz0, ox1, oz1, 14, shade(wall, 0.9), 0.8, 0.3, c.own, c.signEm);
  c.mass(wx0, wz0, wx1, wz1, 0, 12, wing, null, P.roof.tar, { sides: 14 });
  const ws = rectSides(wx0, wz0, wx1, wz1);
  for (const s of [ws.left, ws.right, ws.back]) c.panel(s, 0, s.len, 8.6, 10.0, 0.03, c.own, c.signEm);
  // studio doors (scenery dock) on the wing
  c.panel(m === 1 ? ws.right : ws.left, 6, 11, 0, 6, 0.04, P.ind.dockDoors);

  // entrance + rooftop wordmark
  const front = rectSides(ox0, oz0, ox1, oz1).front;
  door(c, front, front.len / 2, 4, 3.0, X.screenDark);
  canopy(c, front, front.len / 2, 10, 3, 4.2, c.own, 0.3, c.signEm);
  c.signBoard(front, front.len / 2 - 9, front.len / 2 + 9, 14.8, 18.0, -1.0, 0.35);
  for (const u of [front.len / 2 - 6, front.len / 2 + 6]) c.sideBox(front, u - 0.15, u + 0.15, 14, 17.8, -2.2, -1.0, P.wall.concreteDark);
  hvac(c, (ox0 + ox1) / 2 + m * 12, oz0 + 8, 14, 3, 2, 1.5);
  hvac(c, (ox0 + ox1) / 2 - m * 14, oz0 + 6, 14, 3, 2, 1.5);

  // broadcast tower in the back corner
  latticeTower(c, tcx, tcz, 100, 4.5, 1.0);
  // satellite farm next to the wing, dishes looking south-ish
  const fx = m * 6, fz = -hd + 6;
  c.ground(fx - 7, fz - 4.5, fx + 9, fz + 12, P.ground.gravel, FL_SNOW);
  dish(c, fx - 3, 4.6, fz, 4, (35 * Math.PI) / 180, 0.4 * m, P.ind.tankWhite);
  dish(c, fx + 5, 3.4, fz + 1, 3, (35 * Math.PI) / 180, 0.2 * m, P.ind.tankWhite);
  dish(c, fx + 1, 2.4, fz + 7.5, 2, (35 * Math.PI) / 180, -0.3 * m, P.ind.tankWhite);
  // OB vans in owner livery and a small staff car park on the free side
  const [px0, px1] = span(-hw + 46, hw);
  const pz1 = oz1 - 1, pz0 = Math.max(tcz + 8, pz1 - 24);
  parkingLot(c, px0, pz0, px1, pz1, { fill: 0.3 + 0.5 * Math.max(0, Math.min(1, p.utilization)), aisle: 6 });
  if (!c.closed) {
    c.prop('van', m * (hw - 3), pz0 - 3.5, Math.PI / 2, 1, c.ownerColor);
    c.prop('van', m * (hw - 9), pz0 - 3.5, Math.PI / 2, 1, c.ownerColor);
  }
  for (let i = 0; i < 3; i++) c.tree(m * (-hw + 4 + i * 7), r.range(wz0 - 6, wz0 - 3), 'deciduous', 0.9);
  c.pool(front.x(front.len / 2), oz1 + 2.5, 8);
  weeds(c, [[-hw + 1, -hd + 1, hw - 1, wz0 - 1]]);
  return c.finish();
}

export const tvStationFactory: AssetFactory = {
  id: 'tv_station',
  footprints: [[3, 3]],
  triBudget: { lod0: 2000, lod1: 100 },
  build,
};
