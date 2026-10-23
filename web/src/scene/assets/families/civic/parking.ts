// Parking — ambient archetype `ambient:parking` (art §5.3 kind list; 1×1 to 3×2).
// Seeded forms: a surface car park (asphalt, stall lines, lamps, trees along the edges, a pay machine and a "P"
// sign) or, on lots of 2×2 and more, a multi-storey garage (open decks with concrete edge bands and parapets, a
// stair / lift core, an entrance with a barrier, stall lines and parked cars on the roof deck). Occupancy follows
// `utilization` (art §3.16: car parks show activity). LOD1: the asphalt or the garage mass.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, FL_VEG, Y_PAINT } from '../common-a/constants';
import { Ctx, rectSides } from '../common-a/ctx';
import { parkingLot, propLine } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';
import { rgb } from '../../shapes';
import { WORLD } from '@/theme/tokens';

const DECK = 3.1;

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x60d);
  const r = c.shape;
  const hw = c.hw, hd = c.hd;
  const fill = 0.25 + 0.7 * Math.max(0, Math.min(1, Number.isFinite(p.utilization) ? p.utilization : 0.7));
  const garage = Math.min(c.W, c.D) >= 40 && (p.variant >>> 0) % 2 === 1;

  c.ground(-hw + 0.3, -hd + 0.3, hw - 0.3, hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  if (garage) return buildGarage(c, fill, r.int(3, 4));

  // --- surface car park: seeded stall module, planted margin on one or both sides, entrance side
  const planted = r.int(0, 2); // 0 none, 1 left, 2 both
  const m = r.chance(0.5) ? 1 : -1;
  const x0 = -hw + (planted >= 1 ? 3.0 : 1.2), x1 = hw - (planted === 2 ? 3.0 : 1.2), z0 = -hd + 1.2, z1 = hd - 1.0;
  if (planted >= 1 && c.lod === 0) c.ground(-hw + 0.6, z0, x0 - 0.3, z1, P.ground.park, FL_VEG | FL_SNOW, 0.05);
  if (planted === 2 && c.lod === 0) c.ground(x1 + 0.3, z0, hw - 0.6, z1, P.ground.park, FL_VEG | FL_SNOW, 0.05);
  parkingLot(c, x0, z0, x1, z1, { fill, aisle: r.pick([6.0, 6.5, 7.0]), stallW: r.pick([2.5, 2.6, 2.7]), lamps: Math.min(c.W, c.D) >= 40, maxPerRow: 24 });
  if (c.lod === 1) return c.finish();
  // entrance marked by a pay machine and a "P" sign; trees on the planted margins, a hedge at the back
  payMachine(c, m * (hw - 0.75), z1 + 0.45);
  pSign(c, -m * (hw - 0.75), z1 + 0.45);
  propLine(c, 'hedge', x0, z0 - 0.75, x1, z0 - 0.75, 2.1);
  for (let z = z0 + 3; z < z1 - 3; z += 8) {
    if (planted >= 1) c.tree((-hw + x0) / 2, z, 'deciduous', 0.8);
    if (planted === 2) c.tree((hw + x1) / 2, z, 'deciduous', 0.8);
  }
  return c.finish();
}

function buildGarage(c: Ctx, fill: number, decks: number): AssetOutput {
  const r = c.propRng;
  const x0 = -c.hw + 2, x1 = c.hw - 2, z0 = -c.hd + 2, z1 = c.hd - 3;
  const top = decks * DECK;
  const concrete = c.color.pick([P.wall.concrete, P.wall.greige, P.wall.stone]);
  const core: [number, number, number, number] = [x0 + 1, z0 + 1, x0 + 5, z0 + 6];
  if (c.lod === 1) {
    c.mass(x0, z0, x1, z1, 0, top + 1.0, concrete, null, P.road.parking);
    return c.finish();
  }
  // dark open interior behind the deck edges
  c.mass(x0 + 0.4, z0 + 0.4, x1 - 0.4, z1 - 0.4, 0, top, shade(P.ind.dockDoors, 0.75), null, null);
  for (let k = 1; k <= decks; k++) {
    const y = k * DECK;
    c.mass(x0, z0, x1, z1, y - 0.35, y, shade(concrete, 0.95), null, null); // slab edge
    if (k < decks) c.mass(x0, z0, x1, z1, y, y + 1.0, concrete, null, null); // parapet band
  }
  c.mass(x0, z0, x1, z1, 0.0, 0.9, concrete, null, null, { sides: 14 }); // ground-level kerb wall
  // roof deck: asphalt, perimeter parapet, stall lines, cars as simple bodies (props cannot sit on a deck)
  c.ground(x0 + 0.3, z0 + 0.3, x1 - 0.3, z1 - 0.3, P.road.parking, FL_PAVED | FL_SNOW, top + 0.02);
  c.parapet(x0, z0, x1, z1, top, concrete, 1.0, 0.3);
  // ≤ 12 stalls a row and ≤ 12 roof cars (10 triangles each) keep the worst case inside the budget
  const sw = 2.6, sd = 5.0, n = Math.min(12, Math.floor((x1 - x0 - 8) / sw));
  const rows = [z1 - 1.0 - sd, z0 + 1.0];
  let cars = 0;
  for (const rz of rows) {
    const sx0 = (x0 + x1) / 2 - (n * sw) / 2 + 2;
    for (let i = 0; i <= n; i++) c.line(sx0 + i * sw, rz + 0.2, sx0 + i * sw, rz + sd - 0.2, 0.12, P.road.marking, top + Y_PAINT);
    for (let i = 0; i < n; i++) {
      if (r.f() >= fill * 0.8 || c.closed || cars >= 12) continue;
      cars++;
      const cx = sx0 + (i + 0.5) * sw, cz = rz + sd / 2;
      const body: RGB = rgb(r.weighted(WORLD.vehicles.bodies));
      c.box(cx - 0.9, top + 0.2, cz - 2.2, cx + 0.9, top + 1.3, cz + 2.2, body, X.cabinGlass);
    }
  }
  // stair / lift core, entrance with a barrier, "P" sign
  c.box(core[0], 0, core[1], core[2], top + 3.2, core[3], concrete, P.roof.tar);
  c.panel(rectSides(core[0], core[1], core[2], core[3]).right, 0.8, 4.2, top + 0.2, top + 2.6, 0.04, P.ind.glass2);
  const front = rectSides(x0, z0, x1, z1).front;
  c.panel(front, front.len - 9, front.len - 3, 0, 2.6, 0.03, X.screenDark);
  c.box(x1 - 8.8, 0.9, z1 + 0.6, x1 - 4, 1.0, z1 + 0.7, X.white);
  c.ground(x1 - 9.5, z1, x1 - 2.5, c.hd - 0.3, P.road.asphalt, FL_PAVED | FL_SNOW);
  pSign(c, x0 + 1.2, c.hd - 1.2);
  c.pool(x1 - 6, z1 + 1.2, 6);
  propLine(c, 'hedge', x0, c.hd - 1.2, x1 - 11, c.hd - 1.2, 2.1);
  return c.finish();
}

/** Ticket machine on a plinth. */
function payMachine(c: Ctx, x: number, z: number): void {
  c.boxc(x, z, 0.7, 0.5, 0, 1.6, X.lampPole, X.screenDark);
}

/** Blue "P" sign on a pole (the sign layer prints the letter on 'civic:parking'). */
function pSign(c: Ctx, x: number, z: number): void {
  c.boxc(x, z, 0.12, 0.12, 0, 2.6, X.lampPole);
  c.boxc(x, z, 1.1, 0.12, 2.6, 1.1, X.cityFlag, X.cityFlag);
  c.sign(rectSides(x - 0.55, z - 0.06, x + 0.55, z + 0.06).front, 0.05, 1.05, 2.65, 3.65, 0.02, 'civic:parking');
}

export const parkingFactory: AssetFactory = {
  id: 'ambient:parking',
  footprints: [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2]],
  triBudget: { lod0: 400, lod1: 20 },
  build,
};
