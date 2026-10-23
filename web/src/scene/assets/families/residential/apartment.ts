// Apartment block — ambient archetype `ambient:apartment` (art §4.3): 2×2–3×3 lots, 4–15 floors (from
// `AmbientDto.floors` via FamilyParams.floors, else seeded), 3.0 m floors on a 1.0 m plinth, 0.7 m parapet.
// Six archetypes: slab, point tower, L-block, U-shaped perimeter block, twin slabs, stepped slab.
// Balconies on ~30% of blocks (LOD0 only), rooftop plant rooms / water tanks, entrance canopy, courtyard trees,
// a small residents' car park when there is room.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, FL_VEG } from '../common-a/constants';
import { Ctx, FACADE, rectSides, requestedFloors, type Side } from '../common-a/ctx';
import { canopy, door, hvac, parkingLot, plantRoom, waterTank, weeds } from '../common-a/kit';
import { APT_WALLS, FLAT_ROOFS, P, X, shade } from '../common-a/palette';

const PLINTH = 1.0;
const FLOOR = 3.0;
const BALCONY_CAP = 110; // boxes (8 triangles each) — keeps the worst case inside the 1,500-triangle budget

type Kind = 'slab' | 'point' | 'ell' | 'perimeter' | 'twin' | 'stepped';
const KINDS: readonly Kind[] = ['slab', 'point', 'ell', 'perimeter', 'twin', 'stepped'];

interface Wing {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  floors: number;
  /** Faces that get balconies (bit mask: 1 front, 4 back). */
  balconies: number;
}

function wings(kind: Kind, hw: number, hd: number, floors: number, big: boolean): Wing[] {
  const d = big ? 14 : 13;
  switch (kind) {
    case 'slab': {
      const L = big ? 60 : 40, z1 = hd - (big ? 12 : 8);
      return [{ x0: -L / 2, z0: z1 - d, x1: L / 2, z1, floors, balconies: 5 }];
    }
    case 'point': {
      const s = 22, f = Math.round(floors * 1.35);
      return [{ x0: -s / 2, z0: -s / 2 + (big ? 6 : 2), x1: s / 2, z1: s / 2 + (big ? 6 : 2), floors: f, balconies: 1 }];
    }
    case 'ell': {
      const z1 = hd - 5;
      return [
        { x0: -hw, z0: z1 - d, x1: hw - (big ? 8 : 4), z1, floors, balconies: 1 },
        { x0: -hw, z0: -hd + 2, x1: -hw + d, z1: z1 - d, floors, balconies: 0 },
      ];
    }
    case 'perimeter': {
      const z1 = hd - 3;
      return [
        { x0: -hw, z0: z1 - d, x1: hw, z1, floors, balconies: 4 },
        { x0: -hw, z0: -hd, x1: -hw + d, z1: z1 - d, floors, balconies: 0 },
        { x0: hw - d, z0: -hd, x1: hw, z1: z1 - d, floors, balconies: 0 },
      ];
    }
    case 'twin': {
      const L = big ? 52 : 36, gap = big ? 16 : 10, z1 = hd - (big ? 6 : 4);
      return [
        { x0: -L / 2, z0: z1 - 12, x1: L / 2, z1, floors, balconies: 1 },
        { x0: -L / 2, z0: z1 - 24 - gap, x1: L / 2, z1: z1 - 12 - gap, floors: Math.max(4, floors - 2), balconies: 1 },
      ];
    }
    default: {
      const L = big ? 60 : 40, z1 = hd - (big ? 10 : 7), lo = Math.max(3, floors - 3);
      return [
        { x0: -L / 2, z0: z1 - d, x1: 0, z1, floors, balconies: 5 },
        { x0: 0, z0: z1 - d, x1: L / 2, z1, floors: lo, balconies: 5 },
      ];
    }
  }
}

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x404);
  const kind = KINDS[(p.variant >>> 0) % KINDS.length];
  const r = c.shape, col = c.color;
  const big = Math.min(c.W, c.D) >= 60;
  const hw = c.hw - 1, hd = c.hd - 1;
  const floors = requestedFloors(p, 4, 15) ?? r.int(big ? 5 : 4, big ? 11 : 8);
  const ws = wings(kind, hw, hd, floors, big);
  const wall = col.pick(APT_WALLS);
  const plinthCol = shade(wall, 0.72);
  const roof = col.chance(0.15) ? P.roof.green : col.pick(FLAT_ROOFS);
  const brick = wall === P.wall.brick;
  const withBalconies = r.chance(0.3) || kind === 'point';
  const balconyCol = col.pick([P.wall.warmWhite, P.wall.concrete, shade(wall, 1.08)]);
  const topOf = (w: Wing) => PLINTH + w.floors * FLOOR;

  // lawn over the whole lot; LOD1 = the masses
  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  if (c.lod === 1) {
    for (const w of ws) c.mass(w.x0, w.z0, w.x1, w.z1, 0, topOf(w), wall, FACADE.apartment, roof);
    return c.finish();
  }

  let balconies = 0;
  ws.forEach((w, i) => {
    const top = topOf(w);
    c.mass(w.x0, w.z0, w.x1, w.z1, 0, PLINTH, plinthCol, null, null);
    c.mass(w.x0, w.z0, w.x1, w.z1, PLINTH, top, wall, FACADE.apartment, roof, { vBase: PLINTH });
    c.parapet(w.x0, w.z0, w.x1, w.z1, top, shade(wall, 0.95), 0.7, 0.3);
    // rooftop: lift overrun + plant; water tank on older (brick) blocks
    const mx = (w.x0 + w.x1) / 2, mz = (w.z0 + w.z1) / 2, len = w.x1 - w.x0, dep = w.z1 - w.z0;
    const along = len >= dep;
    if (along) plantRoom(c, mx - 3 + (i % 2) * 6, mz - 2.5, mx + 1 + (i % 2) * 6, mz + 2.5, top, 3.0, shade(wall, 0.9));
    else plantRoom(c, mx - 2.5, mz - 2, mx + 2.5, mz + 2, top, 3.0, shade(wall, 0.9));
    if (brick && i === 0) waterTank(c, along ? w.x0 + 5 : mx, along ? mz : w.z0 + 5, top);
    else if (r.chance(0.6)) hvac(c, along ? w.x1 - 4.5 : mx + 2, along ? mz + 1 : w.z1 - 4, top);
    // balconies: 1.4 m deep slabs with solid railings on 3 of every 5 bays
    if (withBalconies && w.balconies) {
      const sides = rectSides(w.x0, w.z0, w.x1, w.z1);
      const faces: Side[] = [];
      if (w.balconies & 1) faces.push(sides.front);
      if (w.balconies & 4) faces.push(sides.back);
      if (kind === 'point') faces.push(sides.right, sides.left, sides.back);
      for (const s of faces) {
        const bays = Math.max(1, Math.round(s.len / 3.3)), bay = s.len / bays;
        for (let f = 1; f < w.floors; f++) {
          const y = PLINTH + f * FLOOR;
          for (let g = 0; g + 3 <= bays; g += 5) {
            if (balconies >= BALCONY_CAP) break;
            c.sideBox(s, (g + 1) * bay + 0.1, (g + Math.min(3, bays - g - 1) + 1) * bay - 0.1, y - 0.2, y + 1.0, 0, 1.4, balconyCol);
            balconies++;
          }
        }
      }
    }
  });

  // entrance on the street face of the first wing
  const main = ws[0];
  const front = rectSides(main.x0, main.z0, main.x1, main.z1).front;
  const du = front.len / 2 + (kind === 'perimeter' ? 0 : r.range(-0.15, 0.15) * front.len);
  door(c, front, du, 2.2, 2.6, X.screenDark);
  canopy(c, front, du, 4.5, 2.2, 3.6, P.wall.concreteDark, 0.3);
  c.ground(front.x(du) - 1.5, main.z1, front.x(du) + 1.5, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);

  // residents' car park in the deepest free strip behind the block(s)
  const backZ = Math.min(...ws.map((w) => w.z0));
  if (kind !== 'perimeter' && kind !== 'ell' && backZ - (-hd) >= 13) {
    const pz1 = backZ - 2;
    parkingLot(c, -Math.min(hw, 26), Math.max(-hd, pz1 - 17), Math.min(hw, 26), pz1, { fill: 0.55, aisle: 6, maxPerRow: 18 });
  }

  // trees: front lawn row and courtyard / back garden
  const fz0 = main.z1 + 2.5, fz1 = c.hd - 3;
  if (fz1 - fz0 > 1) {
    for (let x = -hw + 3; x <= hw - 3; x += r.range(8, 11)) if (Math.abs(x - front.x(du)) > 3.5) c.tree(x, r.range(fz0, fz1), 'deciduous');
  }
  if (kind === 'perimeter') {
    const cx0 = -hw + 16, cx1 = hw - 16, cz0 = -hd + 2, cz1 = main.z0 - 2;
    c.ground(cx0 + 4, cz0 + 4, cx1 - 4, cz1 - 4, P.ground.park, FL_VEG | FL_SNOW, 0.05);
    for (let i = 0; i < 6; i++) c.tree(r.range(cx0, cx1), r.range(cz0, cz1), r.chance(0.3) ? 'conifer' : 'deciduous');
  } else if (kind === 'twin' || kind === 'ell') {
    for (let i = 0; i < 4; i++) c.tree(r.range(-hw + 18, hw - 3), r.range(-hd + 3, main.z0 - 4), 'deciduous');
  }
  weeds(c, [[-hw + 1, main.z1 + 1, hw - 1, c.hd - 1.5]]);
  return c.finish();
}

export const apartmentFactory: AssetFactory = {
  id: 'ambient:apartment',
  footprints: [[2, 2], [3, 3]],
  // art §4.3: 900 triangles without balconies, 1,500 with
  triBudget: { lod0: 1500, lod1: 60 },
  build,
};

