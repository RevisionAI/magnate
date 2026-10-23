// Mixed-use mid-rise — ambient archetype `ambient:midrise` (art §4.3; also `shop` lots with floors > 2):
// SHOP ground floor (4.5 m, neutral awnings and fascia boards per shop unit) under 2–8 APARTMENT floors.
// Four archetypes: corniced block, setback penthouse, corner turret, bay windows + balconies. 1×1–2×2.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { EM, FL_PAVED, FL_SNOW } from '../common-a/constants';
import { Ctx, FACADE, rectSides, requestedFloors } from '../common-a/ctx';
import { awning, boardedUp, door, hvac, plantRoom, waterTank, weeds } from '../common-a/kit';
import { APT_WALLS, FLAT_ROOFS, P, X, shade } from '../common-a/palette';

const SHOP_H = 4.5;
const FLOOR = 3.0;
const ICONS = ['shoe', 'gem', 'sofa', 'toy', 'book', 'flower', 'bakery', 'coffee'] as const;

type Kind = 'cornice' | 'penthouse' | 'turret' | 'bays';
const KINDS: readonly Kind[] = ['cornice', 'penthouse', 'turret', 'bays'];

/** Builds a mixed-use block on the lot; `storeys` counts the shop floor. Shared with `ambient:shop` (floors > 2). */
export function buildMidrise(c: Ctx, storeys: number, kind: Kind): void {
  const r = c.shape, col = c.color;
  const upper = Math.max(2, storeys - 1);
  const x0 = -c.hw + 1, x1 = c.hw - 1;
  const z1 = c.hd - 2.5, z0 = Math.max(-c.hd + 1, z1 - Math.min(18, c.D - 7));
  const top = SHOP_H + upper * FLOOR;
  const wall = col.pick(APT_WALLS);
  const roof = col.chance(0.15) ? P.roof.green : col.pick(FLAT_ROOFS);
  const vUp = SHOP_H - 2 * FLOOR; // aligns apartment rows with the floors above the shop band

  c.ground(-c.hw + 0.3, z1, c.hw - 0.3, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, z0, P.road.parking, FL_PAVED | FL_SNOW);
  if (c.lod === 1) {
    c.mass(x0, z0, x1, z1, 0, top, wall, FACADE.apartment, roof, { facs: { front: c.closed ? null : FACADE.shop } });
    return;
  }

  // shop floor: glazed front, blank flanks/rear; flats above
  c.mass(x0, z0, x1, z1, 0, SHOP_H, shade(wall, 0.9), null, null, { facs: { front: c.closed ? null : FACADE.shop } });
  const pent = kind === 'penthouse';
  const mainTop = pent ? top - FLOOR : top;
  c.mass(x0, z0, x1, z1, SHOP_H, mainTop, wall, FACADE.apartment, roof, { vBase: vUp });
  c.cornice(x0, z0, x1, z1, SHOP_H - 0.2, shade(wall, 0.8), 0.4, 0.2);
  if (pent) {
    const inset = 2.5;
    c.parapet(x0, z0, x1, z1, mainTop, P.ind.glass2, 1.0, 0.1);
    c.mass(x0 + inset, z0 + inset, x1 - inset, z1 - inset - 1.5, mainTop, top, P.wall.warmWhite, FACADE.house, P.roof.membrane, { vBase: vUp });
  } else {
    c.cornice(x0, z0, x1, z1, top - 0.5, shade(wall, 1.06), 0.5, 0.45);
    c.parapet(x0, z0, x1, z1, top, shade(wall, 0.95), 0.6, 0.25);
  }
  if (kind === 'turret') {
    // corner turret: a taller square bay at the front corner with a pyramid cap
    const t = 5.2, tx0 = r.chance(0.5) ? x0 : x1 - t, tz1 = z1 + 0.6;
    c.mass(tx0, tz1 - t, tx0 + t, tz1, SHOP_H, top + 3, wall, FACADE.apartment, null, { vBase: vUp });
    c.spire(tx0 + t / 2, tz1 - t / 2, t * 0.72, top + 3, top + 7, 4, P.roof.slate);
  }
  if (kind === 'bays' && c.W >= 24) {
    const front = rectSides(x0, z0, x1, z1).front;
    const n = Math.max(1, Math.floor(front.len / 10));
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.5) * front.len) / n;
      c.sideBox(front, u - 1.6, u + 1.6, SHOP_H + 0.4, top - 0.8, 0, 0.9, wall, roof);
      for (let f = 0; f < upper; f++) {
        const y = SHOP_H + f * FLOOR;
        c.panel(front, u - 1.2, u + 1.2, y + 1.0, y + 2.4, 0.92, P.ind.glass);
      }
    }
  }

  // shop units: neutral awnings, fascia boards with local signs, doors
  const front = rectSides(x0, z0, x1, z1).front;
  const units = Math.max(1, Math.round(front.len / 9));
  const uw = front.len / units;
  for (let i = 0; i < units; i++) {
    const u0 = i * uw, u1 = u0 + uw;
    const aw = col.pick(X.awnings);
    if (c.closed) boardedUp(c, front, u0 + 0.3, u1 - 0.3);
    else door(c, front, (u0 + u1) / 2, 1.8, 2.4, X.screenDark);
    if (r.chance(0.7)) awning(c, front, u0 + 0.4, u1 - 0.4, 2.9, 3.25, 1.5, r.chance(0.5) ? [aw, P.wall.warmWhite] : [aw], r.chance(0.5) ? 6 : 1);
    const sc = c.closed ? X.signGrey : shade(aw, 0.8);
    c.sideBox(front, u0 + 0.8, u1 - 0.8, 3.45, 4.25, 0, 0.2, sc, sc, c.closed ? 0 : EM.soft, 0);
    if (!c.closed) c.sign(front, u0 + 0.95, u1 - 0.95, 3.55, 4.15, 0.22, `local:${ICONS[col.int(0, ICONS.length - 1)]}`);
  }
  c.pool(0, z1 + 1.4, 6);

  // roof
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  if (!pent) {
    plantRoom(c, mx - 2, mz - 2, mx + 2, mz + 2, top, 2.8, shade(wall, 0.9));
    if (r.chance(0.35)) waterTank(c, x0 + 3.5, mz, top, 1.4);
    else hvac(c, x1 - 3.5, mz, top, 2.4, 1.8, 1.3);
  }
  door(c, rectSides(x0, z0, x1, z0 + 1).back, 2.5, 1.2, 2.3, P.ind.dockDoors);
  weeds(c, [[-c.hw + 1, -c.hd + 1, c.hw - 1, z0 - 0.5]]);
}

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x503);
  const kind = KINDS[(p.variant >>> 0) % KINDS.length];
  const storeys = requestedFloors(p, 3, 9) ?? c.shape.int(3, 7);
  buildMidrise(c, storeys, kind);
  return c.finish();
}

export const midriseFactory: AssetFactory = {
  id: 'ambient:midrise',
  footprints: [[1, 1], [2, 1], [2, 2]],
  triBudget: { lod0: 600, lod1: 40 },
  build,
};
