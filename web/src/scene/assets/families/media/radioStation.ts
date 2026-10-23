// Radio station — company building `radio_station` (art §4.2.15; 2×2 = 48 × 48 m): a 22 × 14 × 8 m studio at the
// front, a 70 m guyed triangular mast (1.0 m wide, red/white bands every 10 m) with three guy-wire anchors (kept
// inside the lot at ~14 m radius instead of 30 m), dipoles near the top, obstruction lights, a small dish on the
// studio roof and an owner sign board at the entrance. Variants: mast left or right of the studio axis.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, FL_VEG } from '../common-a/constants';
import { Ctx, FACADE, Side, rectSides } from '../common-a/ctx';
import { canopy, dish, door, hvac, weeds } from '../common-a/kit';
import { OFFICE_WALLS, P, X, shade } from '../common-a/palette';
import { guyedMast } from './masts';

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'company', 0x702);
  const m = (p.variant >>> 0) % 2 === 1 ? -1 : 1;
  const col = c.color, r = c.shape;
  const hw = c.hw - 1, hd = c.hd - 1;
  const wall = col.pick(OFFICE_WALLS);
  const x0 = -11, x1 = 11, z1 = hd - 3, z0 = z1 - 14;
  const mx = m * 7, mz = -9;
  const anchors: [number, number][] = [0, 1, 2].map((i) => {
    const a = -Math.PI / 2 + m * 0.35 + (i / 3) * Math.PI * 2;
    return [mx + Math.cos(a) * 13.5, mz + Math.sin(a) * 13.5];
  });

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.meadow, FL_VEG | FL_SNOW, 0.03);
  c.ground(x0 - 2, z1, x1 + 2, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  c.mass(x0, z0, x1, z1, 0, 8, wall, FACADE.office, P.roof.gravel, { ownerRoof: true });
  guyedMast(c, mx, mz, 70, 1.0, anchors);
  if (c.lod === 1) return c.finish();

  c.parapet(x0, z0, x1, z1, 8, shade(wall, 0.9), 0.7, 0.25, c.own, c.signEm);
  const front = rectSides(x0, z0, x1, z1).front;
  door(c, front, 6, 2.2, 2.6, X.screenDark);
  canopy(c, front, 6, 4, 2, 3.4, P.wall.concreteDark, 0.25);
  // free-standing owner sign board at the entrance path
  const s = new Side(x0 - 1, c.hd - 2.2, x0 + 7, c.hd - 2.2);
  c.boxc(s.x(1), s.z(1, -0.15), 0.25, 0.25, 0, 1.0, P.wall.concreteDark);
  c.boxc(s.x(7), s.z(7, -0.15), 0.25, 0.25, 0, 1.0, P.wall.concreteDark);
  c.signBoard(s, 0, 8, 1.0, 2.8, -0.3, 0.3);
  // studio roof: a small dish and a plant unit
  dish(c, x1 - 4, 9.6, (z0 + z1) / 2, 1.4, (35 * Math.PI) / 180, 0.3, P.ind.tankWhite, false);
  c.boxc(x1 - 4, (z0 + z1) / 2, 0.8, 0.8, 8, 1.0, X.lampPole);
  hvac(c, x0 + 4, (z0 + z1) / 2, 8, 2.4, 1.8, 1.3);
  // transmitter hut at the mast foot and a gravel pad
  c.ground(mx - 4, mz - 4, mx + 4, mz + 4, P.ground.gravel, FL_SNOW, 0.05);
  c.box(mx + m * 2 - 1.8, 0, mz + 2.2, mx + m * 2 + 1.8, 2.8, mz + 4.2, P.wall.concrete, P.roof.tar);
  // staff parking beside the studio
  for (let i = 0; i < 3; i++) c.car(-m * 16, z1 - 2 - i * 3, m > 0 ? -Math.PI / 2 : Math.PI / 2);
  c.ground(-m * 16 - 3, z1 - 9.5, -m * 16 + 3, z1 + 1, P.road.parking, FL_PAVED | FL_SNOW);
  for (let i = 0; i < 4; i++) c.tree(r.range(-hw + 2, hw - 2), r.range(-hd + 2, -hd + 6), 'deciduous', 0.9);
  c.pool(front.x(6), z1 + 2, 6);
  weeds(c, [[-hw + 1, -hd + 1, hw - 1, z0 - 2]]);
  return c.finish();
}

export const radioStationFactory: AssetFactory = {
  id: 'radio_station',
  footprints: [[2, 2]],
  triBudget: { lod0: 900, lod1: 50 },
  build,
};
