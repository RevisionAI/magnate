// Row houses — ambient archetype `ambient:rowhouse` (art §4.3 "Row houses"): four 5.5 m units with party walls
// on a 1×1 lot, 2–3 floors on a plinth, alternating wall colours, stoops or steps, fenced back yards.
// Four archetypes: brownstone (flat roof, cornice, stoops), terrace (continuous gable, chimneys), modern
// townhouses (stepped flat roofs, canopies) and bay-window terrace.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, FL_VEG } from '../common-a/constants';
import { Ctx, FACADE, rectSides, type Fac } from '../common-a/ctx';
import { canopy, door, eaveFascia, weeds } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

type Kind = 'brownstone' | 'terrace' | 'modern' | 'bay';
const KINDS: readonly Kind[] = ['brownstone', 'terrace', 'modern', 'bay'];
const PLINTH = 0.6;
const FLOOR = 3.0;
const UNITS = 4;

const PALETTES: Record<Kind, readonly RGB[]> = {
  brownstone: [P.wall.brick, P.wall.terracotta, P.wall.sandWall, shade(P.wall.brick, 0.88)],
  terrace: [P.wall.cream, P.wall.sage, P.wall.powderBlue, P.wall.peach, P.wall.lilacGrey, P.wall.warmWhite],
  modern: [P.wall.greige, P.wall.warmWhite, P.wall.concrete, P.wall.limestone],
  bay: [P.wall.brick, P.wall.cream, P.wall.sandWall, P.wall.stone],
};

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x402);
  const kind = KINDS[(p.variant >>> 0) % KINDS.length];
  const r = c.shape, col = c.color;
  const x0 = -c.hw + 1, x1 = c.hw - 1;
  const uw = (x1 - x0) / UNITS;
  const zf = c.hd - (kind === 'brownstone' ? 4.2 : 3.5), zb = zf - 11;
  const baseFloors = kind === 'brownstone' ? 3 : kind === 'modern' ? 2 : 2;
  const pal = PALETTES[kind];
  const start = col.int(0, pal.length - 1);
  const unitCol = (i: number) => pal[(start + i) % pal.length];
  const floorsOf = (i: number) => (kind === 'modern' ? (i % 2 === (start & 1) ? 3 : 2) : baseFloors);
  const topOf = (i: number) => PLINTH + floorsOf(i) * FLOOR;
  const maxTop = PLINTH + Math.max(...Array.from({ length: UNITS }, (_, i) => floorsOf(i))) * FLOOR;
  const roofCol = kind === 'brownstone' || kind === 'modern' ? col.pick([P.roof.tar, P.roof.gravel, P.roof.flat]) : col.pick([P.roof.slate, P.roof.shingle, P.roof.tile]);
  const plinthCol = kind === 'modern' ? P.wall.concreteDark : P.wall.stone;
  const pitchRise = 11 / 2 * Math.tan((r.range(32, 38) * Math.PI) / 180);

  c.ground(-c.hw + 0.3, -c.hd + 0.3, c.hw - 0.3, zb, P.ground.yard, FL_VEG | FL_SNOW, 0.03);
  if (c.lod === 1) {
    const gable = kind === 'terrace' || kind === 'bay';
    c.mass(x0, zb, x1, zf, 0, maxTop, unitCol(0), FACADE.house, gable ? null : roofCol);
    if (gable) c.gable(x0, zb, x1, zf, maxTop, pitchRise, roofCol, unitCol(0), true, 0.3);
    return c.finish();
  }

  const unitFac: Fac = { style: FACADE.house.style, floor: FLOOR, bay: uw / 2 };
  // --- units: plinth band, facade walls (party walls only where exposed), flat roofs for flat-roof kinds
  for (let i = 0; i < UNITS; i++) {
    const ux0 = x0 + i * uw, ux1 = ux0 + uw, top = topOf(i);
    const sides = 1 | 4 | (i === UNITS - 1 || kind === 'modern' ? 2 : 0) | (i === 0 || kind === 'modern' ? 8 : 0);
    c.mass(ux0, zb, ux1, zf, 0, PLINTH, plinthCol, null, null, { sides: 1 | 4 | (i === UNITS - 1 ? 2 : 0) | (i === 0 ? 8 : 0) });
    const flat = kind === 'brownstone' || kind === 'modern';
    c.mass(ux0, zb, ux1, zf, PLINTH, top, unitCol(i), unitFac, flat ? roofCol : null, {
      vBase: PLINTH,
      sides,
      facs: { left: i === 0 ? FACADE.house : null, right: i === UNITS - 1 ? FACADE.house : null },
    });
    if (kind === 'modern') c.cornice(ux0, zb, ux1, zf, top - 0.3, P.wall.concreteDark, 0.3, 0.12);
  }
  if (kind === 'brownstone') {
    const front = rectSides(x0, zb, x1, zf).front;
    c.sideBox(front, -0.4, front.len + 0.4, maxTop - 0.7, maxTop, 0, 0.55, P.wall.warmWhite, P.wall.warmWhite);
    c.sideBox(front, 0, front.len, PLINTH + FLOOR - 0.15, PLINTH + FLOOR + 0.15, 0, 0.2, P.wall.stone, P.wall.stone);
  }
  if (kind === 'terrace' || kind === 'bay') {
    c.gable(x0, zb, x1, zf, maxTop, pitchRise, roofCol, unitCol(0), true, 0.3);
    eaveFascia(c, x0, zb, x1, zf, maxTop, 0.3, true, P.wall.warmWhite);
    // chimney stacks straddling the party walls
    for (let i = 1; i < UNITS; i += 2) c.boxc(x0 + i * uw, (zb + zf) / 2 - 0.4, 0.9, 0.8, maxTop - 0.2, pitchRise + 0.7, P.ind.chimneyBrick, P.wall.concreteDark);
  }

  // --- entrances: doors mirrored in pairs at the shared party wall, stoops / steps / canopies
  const doorCol = col.pick(X.doors);
  for (let i = 0; i < UNITS; i++) {
    const ux0 = x0 + i * uw;
    const s = rectSides(ux0, zb, ux0 + uw, zf).front;
    const du = i % 2 === 0 ? uw - 1.0 : 1.0;
    if (kind === 'bay') {
      // two-storey bay window on the other half of the unit
      const bu = i % 2 === 0 ? 1.55 : uw - 1.55;
      c.mass(ux0 + bu - 1.25, zf, ux0 + bu + 1.25, zf + 0.8, PLINTH, PLINTH + 2 * FLOOR, unitCol(i), { style: FACADE.house.style, floor: FLOOR, bay: 1.25 }, roofCol, { vBase: PLINTH, sides: 11 });
      c.mass(ux0 + bu - 1.25, zf, ux0 + bu + 1.25, zf + 0.8, 0, PLINTH, plinthCol, null, null, { sides: 11 });
    }
    if (kind === 'brownstone') {
      door(c, s, du, 1.1, 2.4, doorCol, PLINTH * 2);
      c.sideBox(s, du - 0.8, du + 0.8, 0, PLINTH * 2, 0, 1.6, P.wall.stone, shade(P.wall.stone, 1.05));
    } else if (kind === 'modern') {
      door(c, s, du, 1.1, 2.3, X.screenDark, 0);
      canopy(c, s, du, 1.8, 1.1, 2.75, P.wall.concreteDark, 0.12);
    } else {
      door(c, s, du, 1.0, 2.2, doorCol, PLINTH);
      c.sideBox(s, du - 0.65, du + 0.65, 0, PLINTH, 0, 0.6, plinthCol);
    }
  }

  // --- front: paved area (brownstone/modern) or front gardens behind a low hedge (terrace/bay)
  if (kind === 'brownstone' || kind === 'modern') {
    c.ground(x0, zf, x1, c.hd - 0.3, P.road.plaza, FL_PAVED | FL_SNOW);
  } else {
    c.ground(x0, zf, x1, c.hd - 0.3, P.ground.yard, FL_VEG | FL_SNOW);
    c.withFlags(FL_VEG | FL_SNOW, () => c.box(x0, 0, c.hd - 1.0, x1, 0.8, c.hd - 0.6, P.veg.leaf3));
  }

  // --- back yards: party fences and the rear fence; a tree in every other yard
  const fenceCol = r.chance(0.5) ? P.wall.greige : X.timber;
  for (let i = 1; i < UNITS; i++) c.box(x0 + i * uw - 0.04, 0, -c.hd + 1, x0 + i * uw + 0.04, 1.6, zb, fenceCol);
  c.box(x0, 0, -c.hd + 1, x1, 1.6, -c.hd + 1.08, fenceCol);
  c.box(x0, 0, -c.hd + 1.08, x0 + 0.08, 1.6, zb, fenceCol);
  c.box(x1 - 0.08, 0, -c.hd + 1.08, x1, 1.6, zb, fenceCol);
  for (let i = 0; i < UNITS; i++) {
    if (r.chance(0.55)) c.tree(x0 + (i + 0.5) * uw, r.range(-c.hd + 3, zb - 2.5), r.chance(0.15) ? 'conifer' : 'deciduous', 0.75);
  }
  weeds(c, [[x0, -c.hd + 1.5, x1, zb - 0.5]]);
  return c.finish();
}

export const rowhouseFactory: AssetFactory = {
  id: 'ambient:rowhouse',
  footprints: [[1, 1]],
  triBudget: { lod0: 260, lod1: 24 },
  build,
};
