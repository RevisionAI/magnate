// Strip mall — ambient archetype `ambient:strip_mall` (art §4.3, on collector roads): five shop units in a row,
// 12 m deep × 4.5 m high, a shared canopy on posts, unit signs (local competitors), a front car park with lamps.
// Footprint 3×1 (72 m of frontage × 24 m). Two archetypes: flat canopy, or a raised false-front centrepiece.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { EM, FL_PAVED, FL_SNOW } from '../common-a/constants';
import { Ctx, FACADE, rectSides } from '../common-a/ctx';
import { boardedUp, door, hvac, parkingLot, weeds } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

const H = 4.5;
const UNITS = 5;
const ICONS = ['shoe', 'gem', 'sofa', 'toy', 'book', 'flower', 'bakery', 'coffee'] as const;

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x505);
  const centrepiece = (p.variant >>> 0) % 2 === 1;
  const r = c.shape, col = c.color;
  const x0 = -c.hw + 2, x1 = c.hw - 2;
  const z0 = -c.hd + 1, z1 = z0 + 12;
  const canopyD = 3;
  const wall = col.pick([P.wall.greige, P.wall.sandWall, P.wall.cream, P.wall.stone]);
  const roof = col.pick([P.roof.membrane, P.roof.gravel, P.roof.flat]);

  if (c.lod === 1) {
    c.ground(-c.hw + 0.3, z1, c.hw - 0.3, c.hd - 0.3, P.road.parking, FL_PAVED | FL_SNOW);
    c.mass(x0, z0, x1, z1, 0, H, wall, c.closed ? null : FACADE.shop, roof, { facs: { back: null, left: null, right: null } });
    return c.finish();
  }

  c.mass(x0, z0, x1, z1, 0, H, wall, null, roof, { facs: { front: c.closed ? null : FACADE.shop } });
  c.parapet(x0, z0, x1, z1, H, shade(wall, 0.92), 0.9, 0.25);
  const front = rectSides(x0, z0, x1, z1).front;
  // shared canopy on posts, with a fascia band carrying the unit signs
  c.sideBox(front, 0, front.len, 3.6, 3.9, 0, canopyD, P.wall.warmWhite, P.roof.membrane);
  c.sideBox(front, 0, front.len, 3.9, 4.6, canopyD - 0.3, canopyD, shade(wall, 0.85), shade(wall, 0.85));
  for (let i = 0; i <= UNITS; i++) {
    const u = Math.min(front.len - 0.3, Math.max(0.3, (i * front.len) / UNITS));
    c.boxc(front.x(u, canopyD - 0.2), front.z(u, canopyD - 0.2), 0.25, 0.25, 0, 3.6, P.wall.warmWhite);
  }
  if (centrepiece) {
    // raised false front over the middle unit
    const mu = front.len / 2, half = front.len / UNITS / 2 + 1;
    c.sideBox(front, mu - half, mu + half, H, H + 3.2, -0.3, 0.3, shade(wall, 1.05), shade(wall, 1.05));
    c.ta(front.p(mu - half, H + 3.2, 0.3), front.p(mu + half, H + 3.2, 0.3), front.p(mu, H + 5.2, 0.3), shade(wall, 1.05));
  }
  const uw = front.len / UNITS;
  for (let i = 0; i < UNITS; i++) {
    const u0 = i * uw, u1 = u0 + uw;
    if (c.closed) boardedUp(c, front, u0 + 0.4, u1 - 0.4);
    else door(c, front, (u0 + u1) / 2, 2.0, 2.4, X.screenDark);
    const aw = col.pick(X.awnings);
    const sc = c.closed ? X.signGrey : shade(aw, 0.85);
    c.sideBox(front, u0 + 2, u1 - 2, 3.95, 4.55, canopyD, canopyD + 0.12, sc, sc, c.closed ? 0 : EM.soft, 0);
    if (!c.closed) c.sign(front, u0 + 2.1, u1 - 2.1, 4.0, 4.5, canopyD + 0.14, `local:${ICONS[col.int(0, ICONS.length - 1)]}`);
    if (!c.closed) c.pool(front.x((u0 + u1) / 2, canopyD + 1), front.z((u0 + u1) / 2, canopyD + 1), 5);
  }
  for (let i = 0; i < 3; i++) hvac(c, x0 + 8 + i * 24 + r.range(-3, 3), (z0 + z1) / 2 + r.range(-2, 2), H, 2.6, 1.8, 1.3);
  // rear service doors
  const back = rectSides(x0, z0, x1, z1).back;
  for (let i = 0; i < UNITS; i++) door(c, back, ((i + 0.5) * back.len) / UNITS, 1.2, 2.3, P.ind.dockDoors);

  // walkway under the canopy, car park in front with lamps
  c.ground(x0, z1, x1, z1 + canopyD, P.road.sidewalk, FL_PAVED | FL_SNOW);
  parkingLot(c, -c.hw + 0.3, z1 + canopyD + 0.2, c.hw - 0.3, c.hd - 0.3, { fill: r.range(0.3, 0.7), lamps: true, aisle: 2.4 });
  weeds(c, [[x0, z1 + canopyD + 0.5, x1, c.hd - 1]]);
  return c.finish();
}

export const stripMallFactory: AssetFactory = {
  id: 'ambient:strip_mall',
  footprints: [[3, 1]],
  triBudget: { lod0: 700, lod1: 40 },
  build,
};
