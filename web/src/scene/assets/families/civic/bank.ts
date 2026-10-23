// Bank — ambient archetype `ambient:civic:bank` (art §4.3; 2×2, also 1×1 as a branch).
// Heavy rusticated plinth, two storeys of tall windows, cornice and balustrade, bronze doors, and one of two
// seeded fronts: four columns in antis under a flat attic ("temple"), or a projecting two-column porch with a
// pediment ("palazzo"). Forecourt with lamps, a small staff car park behind, modest uplighting at night.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, FL_VEG } from '../common-a/constants';
import { Ctx, FACADE, rectSides } from '../common-a/ctx';
import { parkingLot } from '../common-a/kit';
import { P, mixRgb, shade } from '../common-a/palette';
import { bronzeDoors, cityFlag, classicalBlock, pilasters, portico, uplight } from './classical';

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x603);
  const temple = (p.variant >>> 0) % 2 === 0;
  const col = c.color, r = c.shape;
  const small = Math.min(c.W, c.D) < 40;
  const hw = c.hw - 1, hd = c.hd - 1;
  const stone = col.pick([P.wall.limestone, P.wall.stone, P.wall.sandWall, P.wall.greige, P.wall.warmWhite]);
  const roof = mixRgb(P.roof.slate, stone, 0.45);
  const base = small ? 1.8 : 2.4;
  const top = base + 2 * FACADE.civic.floor;
  const bw = small ? Math.min(9, hw - 0.5) : Math.min(15, hw - 4);
  const zf = c.hd - (small ? 6.5 : 9);
  const z0 = Math.max(-hd + (small ? 1 : 12), zf - (small ? 15 : 22));
  const front = rectSides(-bw, z0, bw, zf).front;
  const um = front.len / 2;
  const pw = temple ? (small ? 6 : 9) : small ? 3.2 : 4.2;
  const spec = temple
    ? { cols: 4, r: small ? 0.5 : 0.7, base, colTop: top - 1.4, depth: small ? 2.6 : 3.5, entH: 1.4, rise: 0, stone, roof }
    : { cols: 2, r: small ? 0.45 : 0.6, base, colTop: top - 2.6, depth: small ? 2.4 : 3.2, entH: 1.2, rise: small ? 1.6 : 2.2, stone, roof: shade(stone, 0.9) };

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  if (c.lod === 1) {
    c.mass(-bw, z0, bw, zf, 0, top, stone, FACADE.civic, roof, { vBase: base });
    portico(c, front, um - pw, um + pw, spec);
    return c.finish();
  }
  c.ground(-hw + 0.7, zf, hw - 0.7, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  classicalBlock(c, -bw, z0, bw, zf, top, stone, { base, fac: FACADE.civic, roof, cornice: true, balustrade: !small || temple });
  const sides = rectSides(-bw, z0, bw, zf);
  portico(c, front, um - pw, um + pw, spec);
  c.sign(front, um - Math.min(5, pw - 0.8), um + Math.min(5, pw - 0.8), spec.colTop + 0.2, spec.colTop + spec.entH - 0.2, spec.depth + 0.03, 'civic:bank');
  bronzeDoors(c, front, um, small ? 2.4 : 3.2, small ? 3.6 : 4.5, base);
  if (!temple) pilasters(c, front, 1.5, front.len - 1.5, small ? 4 : 6, base, top - 0.7, 0.9, 0.3, shade(stone, 1.05));
  for (const s of [sides.left, sides.right]) pilasters(c, s, 1.5, s.len - 1.5, Math.max(2, Math.round(s.len / 7)), base, top - 0.7, 0.9, 0.3, shade(stone, 1.05));
  uplight(c, front, 0.4, um - pw - 1.2);
  uplight(c, front, um + pw + 1.2, front.len - 0.4);
  c.pool(0, zf + spec.depth + 1.5, 6);
  // forecourt lamps, flag, staff parking and trees
  for (const m of [-1, 1]) {
    c.prop('lamp.street', m * (bw + (small ? 1.2 : 2.5)), hd - 1.4, m < 0 ? Math.PI / 2 : -Math.PI / 2);
    c.pool(m * (bw + 0.5), hd - 1.4, 6);
  }
  if (!small) {
    cityFlag(c, bw - 2, (z0 + zf) / 2, 5, top + 1.0);
    const pz1 = z0 - 2, pz0 = -hd + 0.5;
    if (pz1 - pz0 >= 10) parkingLot(c, -Math.min(hw - 3, 18), pz0, Math.min(hw - 3, 18), pz1, { fill: 0.5, aisle: 6, maxPerRow: 12 });
    for (const m of [-1, 1]) for (let z = z0 + 2; z < zf; z += 7) c.tree(m * (hw - 1.4), z + r.range(-1, 1), 'deciduous', 0.9);
  } else {
    // a 1×1 branch has no room for spreading crowns: two poplars in the back corners
    for (const m of [-1, 1]) c.tree(m * (hw - 0.4), -hd + 0.6, 'poplar', r.range(0.7, 0.85));
  }
  return c.finish();
}

export const bankFactory: AssetFactory = {
  id: 'ambient:civic:bank',
  footprints: [[2, 2], [1, 1]],
  triBudget: { lod0: 600, lod1: 30 },
  build,
};
