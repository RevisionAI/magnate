// small_farm (3×3, art §4.2.9, L1–L3) and large_farm (5×5, §4.2.10): a red barn with an owner ridge cap and roof
// panel, galvanized silos, a farmhouse, and crop rows whose colour and height follow the game month. Levels add a
// grain dryer + second silo (L2) and a centre-pivot irrigation arm + machinery shed (L3). Construction override
// (art §4.1): A = ploughing, B = sowing front-to-back while the farmyard frames rise, C = first green.
import { FLAG_SNOWABLE } from '../../../materials/CityMaterial';
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import { Facade, FACE_NX, FACE_NZ, FACE_PX, type GeoBuilder, type RGB } from '../../GeoBuilder';
import { ASSET_RGB, WORLD_RGB, hexRgb, shade } from '../../palette';
import { concreteFrame, siteCabins, stageT } from '../construction/site';
import { cropLook, fieldRows, type CropLook } from '../common-b/crops';
import { flagpole, ground, roofBoard, silo, tree, weeds, yardLamp } from '../common-b/details';
import { Kit } from '../common-b/kit';
import { cropsFor, type CropKind } from '../common-b/products';

const G = WORLD_RGB.ground;
const BARN_RED = ASSET_RGB.barnRed;
const SHINGLE = WORLD_RGB.roof.shingle;
const GRAVEL = G.gravel;
const FARM_CROPS: readonly CropKind[] = ['wheat', 'sugarcane', 'cotton'];

export interface Rect { x0: number; z0: number; x1: number; z1: number; }

/** Red barn (art §4.2.9): walls #A8483A, shingle gable roof with an owner ridge cap and a 4 × 4 m owner roof panel,
 *  big white-trimmed doors on the front. ~70 triangles. */
export function barn(k: Kit, r: Rect, eaves = 6, rise = 4): void {
  const zm = (r.z0 + r.z1) / 2, xm = (r.x0 + r.x1) / 2;
  k.box(r.x0, 0, r.z0, r.x1, eaves, r.z1, BARN_RED, BARN_RED, null, false);
  k.roof(() => k.flagged(FLAG_SNOWABLE, () => k.gable(r.x0, r.z0, r.x1, r.z1, eaves, rise, SHINGLE, BARN_RED, true, 0.5)));
  const owner = k.closed ? ASSET_RGB.closedGrey : k.ownerRgb;
  // ridge cap
  k.beam([r.x0 - 0.5, eaves + rise + 0.08, zm], [r.x1 + 0.5, eaves + rise + 0.08, zm], 0.7, 0.28, owner, 4, true);
  // 4 × 4 m owner roof panel on the street-side slope
  const half = (r.z1 - r.z0) / 2 + 0.5, len = Math.hypot(half, rise);
  const ny = half / len, nz = rise / len;
  const at = (x: number, f: number): [number, number, number] => [x, eaves + rise * f + 0.05 * ny, r.z1 + 0.5 - half * f + 0.05 * nz];
  const f0 = 0.3, f1 = Math.min(0.92, f0 + 4 / len);
  k.quad(at(xm - 2, f0), at(xm + 2, f0), at(xm + 2, f1), at(xm - 2, f1), [0, ny, nz], owner);
  if (k.lod0) {
    // doors with the classic white X-trim
    const dw = Math.min(5, (r.x1 - r.x0) * 0.32), dh = Math.min(4.6, eaves - 0.8), z = r.z1 + 0.04;
    const door = k.closed ? ASSET_RGB.boarded : shade(BARN_RED, 0.72);
    const white = WORLD_RGB.wall.warmWhite;
    k.quad([xm - dw / 2, 0.02, z], [xm + dw / 2, 0.02, z], [xm + dw / 2, dh, z], [xm - dw / 2, dh, z], [0, 0, 1], door);
    trim(k, xm - dw / 2, 0.1, xm + dw / 2, dh - 0.1, z + 0.02, 0.22, white);
    trim(k, xm + dw / 2, 0.1, xm - dw / 2, dh - 0.1, z + 0.02, 0.22, white);
    k.quad([xm - dw / 2 - 0.2, dh, z + 0.03], [xm + dw / 2 + 0.2, dh, z + 0.03], [xm + dw / 2 + 0.2, dh + 0.25, z + 0.03], [xm - dw / 2 - 0.2, dh + 0.25, z + 0.03], [0, 0, 1], white);
  }
}

/** Diagonal trim strip on a +Z-facing wall plane. */
function trim(k: Kit, x0: number, y0: number, x1: number, y1: number, z: number, w: number, rgb: RGB): void {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * (w / 2), py = (dx / len) * (w / 2);
  k.quad([x0 + px, y0 + py, z], [x0 - px, y0 - py, z], [x1 - px, y1 - py, z], [x1 + px, y1 + py, z], [0, 0, 1], rgb);
}

/** Farmhouse, 1.5 floors with a 38° gable (art §4.2.9), warm-white walls, HOUSE windows, chimney stub. ~40 tris. */
export function farmhouse(k: Kit, r: Rect, roofRgb: RGB = WORLD_RGB.roof.tile): void {
  const eaves = 4.6, rise = ((r.z1 - r.z0) / 2) * Math.tan((38 * Math.PI) / 180);
  const fac = !k.closed ? ([Facade.HOUSE, (k.p.seed >>> 3) & 255, 30, 30] as const) : null;
  k.box(r.x0, 0, r.z0, r.x1, eaves, r.z1, WORLD_RGB.wall.warmWhite, WORLD_RGB.wall.warmWhite, fac, false);
  k.flagged(FLAG_SNOWABLE, () => k.gable(r.x0, r.z0, r.x1, r.z1, eaves, rise, roofRgb, WORLD_RGB.wall.warmWhite, true, 0.4));
  if (k.lod0) k.boxAt(r.x0 + 1.6, (r.z0 + r.z1) / 2 - 1, 0.8, 0.8, eaves + rise * 0.4, rise * 0.75 + 0.6, WORLD_RGB.industry.chimneyBrick);
}

/** Open-fronted machinery shed (L3), low gable roof; a tractor parked inside. ~40 triangles. */
function machineryShed(k: Kit, r: Rect): void {
  const h = 6;
  const wall = WORLD_RGB.industry.galvanized;
  k.boxFaces(r.x0, 0, r.z0, r.x1, h, r.z1, FACE_NZ | FACE_PX | FACE_NX, wall, wall);
  k.quad([r.x0 + 0.2, 0.05, r.z1 - 0.2], [r.x1 - 0.2, 0.05, r.z1 - 0.2], [r.x1 - 0.2, h - 0.2, r.z1 - 0.2], [r.x0 + 0.2, h - 0.2, r.z1 - 0.2], [0, 0, 1], shade(wall, 0.35)); // dark interior
  k.flagged(FLAG_SNOWABLE, () => k.gable(r.x0, r.z0, r.x1, r.z1, h, 1.6, WORLD_RGB.roof.slate, wall, true, 0.5));
  k.prop('tractor', (r.x0 + r.x1) / 2 - 3, (r.z0 + r.z1) / 2 + 1, 0);
}

/** Grain dryer tower with hopper (L2). ~40 triangles. */
function grainDryer(k: Kit, x: number, z: number): void {
  const g = WORLD_RGB.industry.galvanized;
  k.boxAt(x, z, 3.6, 3.6, 0, 12, g, shade(g, 1.05));
  k.cone(x, z, 2.2, 0.4, 12, 14, 6, shade(g, 1.1));
  if (k.lod0) k.beam([x + 1.8, 13, z], [x + 7, 9, z], 0.35, 0.35, shade(g, 0.85), 3);
}

/** Post-and-rail fence along a rectangle with an optional gate gap on the front (+Z) side (LOD0 only). */
export function postFence(k: Kit, r: Rect, spacing = 8, gate: readonly [number, number] | null = null): void {
  if (!k.lod0) return;
  const wood = hexRgb('#8A7458');
  const sides: [number, number, number, number][] = [[r.x0, r.z1, r.x1, r.z1], [r.x1, r.z0, r.x1, r.z1], [r.x0, r.z0, r.x1, r.z0], [r.x0, r.z0, r.x0, r.z1]];
  sides.forEach(([ax, az, bx, bz], si) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      if (si === 0 && gate && x > gate[0] + 0.5 && x < gate[1] - 0.5) continue;
      k.beam([x, 0, z], [x, 1.3, z], 0.16, 0.16, wood, 3);
    }
    if (si === 0 && gate) {
      if (gate[0] > ax) k.beam([ax, 1.0, az], [gate[0], 1.0, az], 0.08, 0.12, wood, 3);
      if (gate[1] < bx) k.beam([gate[1], 1.0, az], [bx, 1.0, az], 0.08, 0.12, wood, 3);
    } else {
      k.beam([ax, 1.0, az], [bx, 1.0, bz], 0.08, 0.12, wood, 3);
    }
  });
}

/** Round hay bales on a harvested wheat field (Sep–Oct). */
function hayBales(k: Kit, r: Rect, n: number): void {
  if (!k.lod0) return;
  const straw = hexRgb('#CDB672');
  for (let i = 0; i < n; i++) {
    const x = r.x0 + 3 + (r.x1 - r.x0 - 6) * k.rnd(), z = r.z0 + 3 + (r.z1 - r.z0 - 6) * k.rnd();
    k.cylAlong([x - 0.6, 0.78, z], [x + 0.6, 0.78, z], 0.75, 6, straw, shade(straw, 0.85));
  }
}

/** Crop look for a field of this farm (closed farms go fallow). */
function lookFor(k: Kit, crop: CropKind): CropLook {
  return cropLook(k.closed ? 'fallow' : crop, k.month);
}

/** City-band field: one slab in the canopy colour (rows are invisible at that distance). */
function fieldLod1(k: Kit, crop: CropKind, r: Rect): void {
  const look = lookFor(k, crop);
  const c = mixLook(look);
  k.flagged(FLAG_SNOWABLE, () => k.slab(r.x0, r.z0, r.x1, r.z1, 0.05, c));
}

function mixLook(look: CropLook): RGB {
  const t = look.cover;
  return [Math.round(look.ground[0] * (1 - t) + look.top[0] * t), Math.round(look.ground[1] * (1 - t) + look.top[1] * t), Math.round(look.ground[2] * (1 - t) + look.top[2] * t)];
}

/** A crop field (rows at LOD0, a single slab at LOD1) with seasonal extras. */
function field(k: Kit, crop: CropKind, r: Rect, opts: { look?: CropLook; sown?: number } = {}): void {
  if (!k.lod0) { fieldLod1(k, crop, r); return; }
  const look = opts.look ?? lookFor(k, crop);
  fieldRows(k, k.closed ? 'fallow' : crop, r.x0, r.z0, r.x1, r.z1, { look, sown: opts.sown });
  if (!opts.look && !k.closed && crop === 'wheat' && (k.month === 9 || k.month === 10)) hayBales(k, r, k.month === 9 ? 4 : 6);
}

function tractorFor(k: Kit, fieldRect: Rect, yardX: number, yardZ: number): void {
  if (k.closed) return;
  const fieldWork = [3, 4, 5, 8, 9, 10].includes(k.month);
  if (fieldWork && k.complete) {
    const z = fieldRect.z0 + (fieldRect.z1 - fieldRect.z0) * (0.3 + 0.4 * k.rnd());
    k.prop('tractor', fieldRect.x0 + (fieldRect.x1 - fieldRect.x0) * (0.25 + 0.5 * k.rnd()), z, Math.PI / 2);
  } else {
    k.prop('tractor', yardX, yardZ, -Math.PI / 3);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// small_farm — 72 × 72 m
// ---------------------------------------------------------------------------------------------------------------

const SF = {
  yard: { x0: -35, z0: -35, x1: -11, z1: -11 },
  barn: { x0: -34, z0: -34, x1: -18, z1: -24 },
  house: { x0: -34, z0: -21, x1: -24, z1: -13 },
  lane: { x0: -35, z0: -11, x1: -31, z1: 35.5 },
  fieldA: { x0: -9, z0: -35, x1: 35, z1: -12 },
  fieldA3: { x0: 13, z0: -35, x1: 35, z1: -12 },
  shed: { x0: -9, z0: -35, x1: 11, z1: -23 },
  fieldB: { x0: -29.5, z0: -9.5, x1: 35, z1: 34.5 },
} as const;

function buildSmallFarm(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const k = new Kit(b, lot, p, { mirror: (p.variant & 1) === 1 });
  const crops = cropsFor(p.productIds, p.seed, FARM_CROPS);
  const L = k.level;
  const building = p.stage === 'foundation' || p.stage === 'structure' || p.stage === 'finishing';

  ground(k, -35.8, -35.8, 35.8, 35.8, G.yard, 0.02);
  ground(k, SF.lane.x0, SF.lane.z0, SF.lane.x1, SF.lane.z1, GRAVEL, 0.045);
  ground(k, SF.yard.x0, SF.yard.z0, SF.yard.x1, SF.yard.z1, GRAVEL, 0.04);

  const fieldA = L >= 3 && !building ? SF.fieldA3 : SF.fieldA;
  if (building) {
    farmSite(k, [SF.fieldB, fieldA], crops, [SF.barn, SF.house], 6);
    return k.finish();
  }

  field(k, crops[0], SF.fieldB);
  field(k, crops[1] ?? crops[0], fieldA);
  if (!k.lod0) {
    // city band: footprint boxes in roof colours (owner flag on the barn roof), silos as one block
    lodBox(k, SF.barn, 8, SHINGLE, BARN_RED, true);
    lodBox(k, SF.house, 6.2, WORLD_RGB.roof.tile, WORLD_RGB.wall.warmWhite, false);
    lodBox(k, { x0: -17.5, z0: L >= 2 ? -33.5 : -33.5, x1: -11.5, z1: L >= 2 ? -19.9 : -27.5 }, 15, WORLD_RGB.industry.galvanized, WORLD_RGB.industry.galvanized, false);
    if (L >= 3) lodBox(k, SF.shed, 6.8, WORLD_RGB.roof.slate, WORLD_RGB.industry.galvanized, false);
    return k.finish();
  }

  barn(k, SF.barn);
  farmhouse(k, SF.house);
  silo(k, -14.5, -30.5, 3, 14, WORLD_RGB.industry.galvanized, k.lod0 ? 12 : 6);
  if (L >= 2) {
    silo(k, -14.5, -22.5, 2.6, 12, WORLD_RGB.industry.galvanized, k.lod0 ? 12 : 6);
    grainDryer(k, -20.5, -16.5);
  }
  if (L >= 3) {
    machineryShed(k, SF.shed);
    // centre-pivot irrigation in the big field, visible Apr–Sep (art §4.2.9)
    if (k.month >= 4 && k.month <= 9 && !k.closed) {
      const cx = (SF.fieldB.x0 + SF.fieldB.x1) / 2, cz = (SF.fieldB.z0 + SF.fieldB.z1) / 2;
      k.boxAt(cx, cz, 1.6, 1.6, 0, 4.2, WORLD_RGB.industry.galvanized);
      k.part('irrigationArm', cx, 0, cz, 0, { extent: 20, active: k.running });
    }
  }
  tractorFor(k, SF.fieldB, -18, -15);
  postFence(k, { x0: -35.6, z0: -35.6, x1: 35.6, z1: 35.6 }, 8, [SF.lane.x0 - 0.6, SF.lane.x1 + 0.8]);
  flagpole(k, -29.6, 33.5, 9);
  roofBoard(k, -24.5, 34.2, 0, 5, 1.4, 'pz', 1.0); // farm-gate sign with the owner wordmark (glows at night)
  yardLamp(k, -12.5, -12.5, 7, Math.PI * 1.25);
  weeds(k, 3, [-34, -34, -12, -12]);
  return k.finish();
}

// ---------------------------------------------------------------------------------------------------------------
// large_farm — 120 × 120 m
// ---------------------------------------------------------------------------------------------------------------

const LF = {
  lane: { x0: -3, z0: -26, x1: 3, z1: 59.6 },
  yard: { x0: -30, z0: -57, x1: 30, z1: -24 },
  barn1: { x0: -29, z0: -55, x1: -9, z1: -43 },
  barn2: { x0: 9, z0: -55, x1: 29, z1: -43 },
  shed: { x0: -7.5, z0: -55, x1: 7.5, z1: -26 },
  house: { x0: 13, z0: -38, x1: 25, z1: -29 },
  pond: { x0: -56, z0: -55, x1: -35, z1: -40 },
  fields: [
    { x0: -58, z0: 20, x1: -5, z1: 58 },
    { x0: 5, z0: 20, x1: 58, z1: 58 },
    { x0: -58, z0: -21, x1: -5, z1: 18 },
    { x0: 5, z0: -21, x1: 58, z1: 18 },
    { x0: 33, z0: -55, x1: 58, z1: -23 },
  ],
} as const;

function buildLargeFarm(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const k = new Kit(b, lot, p, { mirror: (p.variant & 1) === 1 });
  const crops = cropsFor(p.productIds, p.seed, FARM_CROPS);
  const building = p.stage === 'foundation' || p.stage === 'structure' || p.stage === 'finishing';

  ground(k, -59.8, -59.8, 59.8, 59.8, G.yard, 0.02);
  ground(k, LF.lane.x0, LF.lane.z0, LF.lane.x1, LF.lane.z1, GRAVEL, 0.045);
  ground(k, LF.yard.x0, LF.yard.z0, LF.yard.x1, LF.yard.z1, GRAVEL, 0.04);

  if (building) {
    farmSite(k, LF.fields, crops, [LF.barn1, LF.barn2, LF.shed, LF.house], 7);
    return k.finish();
  }
  LF.fields.forEach((f, i) => field(k, crops[i % crops.length], f));
  if (!k.lod0) {
    lodBox(k, LF.barn1, 9.5, SHINGLE, BARN_RED, true);
    lodBox(k, LF.barn2, 9.5, SHINGLE, BARN_RED, true);
    lodBox(k, LF.shed, 8, WORLD_RGB.roof.slate, WORLD_RGB.industry.galvanized, false);
    lodBox(k, { x0: -27, z0: -39, x1: -7.5, z1: -33 }, 17, WORLD_RGB.industry.galvanized, WORLD_RGB.industry.galvanized, false);
    lodBox(k, LF.house, 6.5, WORLD_RGB.roof.slate, WORLD_RGB.wall.warmWhite, false);
    return k.finish();
  }

  barn(k, LF.barn1, 7, 4.6);
  barn(k, LF.barn2, 7, 4.6);
  // machinery shed 30 × 15 at the head of the lane (long axis along the lane)
  const g = WORLD_RGB.industry.galvanized;
  k.box(LF.shed.x0, 0, LF.shed.z0, LF.shed.x1, 7, LF.shed.z1, g, g, null, false);
  k.roof(() => k.flagged(FLAG_SNOWABLE, () => k.gable(LF.shed.x0, LF.shed.z0, LF.shed.x1, LF.shed.z1, 7, 2.4, WORLD_RGB.roof.slate, g, false, 0.5)));
  if (k.lod0) k.quad([-4.5, 0.05, LF.shed.z1 + 0.03], [4.5, 0.05, LF.shed.z1 + 0.03], [4.5, 5.5, LF.shed.z1 + 0.03], [-4.5, 5.5, LF.shed.z1 + 0.03], [0, 0, 1], shade(g, 0.35));
  for (const x of [-24, -17, -10.5]) silo(k, x, -36, 3, 16, g, k.lod0 ? 12 : 6);
  farmhouse(k, LF.house, WORLD_RGB.roof.slate);
  if (k.lod0) {
    // pond with a muddy rim (CityMaterial has no water shader; the colour is the §3.3 water mid tone)
    const pts = octagon(LF.pond);
    k.prism(pts.map(([x, z]) => [x, z] as const), 0.02, 0.06, ASSET_RGB.pondEdge, ASSET_RGB.pondEdge);
    k.prism(octagon(inset(LF.pond, 1.4)), 0.06, 0.09, ASSET_RGB.pond, ASSET_RGB.pond);
    // windbreak tree line on the north (back) edge
    for (let x = -56; x <= 56; x += 6.2) tree(k, x + (k.rnd() - 0.5) * 1.5, -58 + (k.rnd() - 0.5), 0.85 + 0.35 * k.rnd());
  }
  tractorFor(k, LF.fields[0], -2, -20);
  postFence(k, { x0: -59.6, z0: -59.6, x1: 59.6, z1: 59.6 }, 10, [LF.lane.x0 - 0.5, LF.lane.x1 + 0.5]);
  flagpole(k, 5, 58.5, 9);
  roofBoard(k, 10.5, 58.2, 0, 6, 1.6, 'pz', 1.0); // farm-gate sign
  yardLamp(k, 0, -24, 7, 0);
  weeds(k, 4, [-28, -55, 28, -26]);
  return k.finish();
}

/** City-band stand-in: a box with the roof colour on top (owner-roof flag on the main mass). 10 triangles. */
export function lodBox(k: Kit, r: Rect, h: number, roofRgb: RGB, wall: RGB, main: boolean): void {
  const write = () => k.box(r.x0, 0, r.z0, r.x1, h, r.z1, wall, roofRgb);
  if (main) k.roof(write); else write();
}

function octagon(r: Rect): [number, number][] {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, rx = (r.x1 - r.x0) / 2, rz = (r.z1 - r.z0) / 2;
  return Array.from({ length: 8 }, (_, i) => {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cz + Math.sin(a) * rz] as [number, number];
  });
}

function inset(r: Rect, d: number): Rect {
  return { x0: r.x0 + d, z0: r.z0 + d, x1: r.x1 - d, z1: r.z1 - d };
}

// ---------------------------------------------------------------------------------------------------------------
// Farm construction (art §4.1 type override): A ploughing, B sowing + frames, C first green
// ---------------------------------------------------------------------------------------------------------------

export function farmSite(k: Kit, fields: readonly Rect[], crops: readonly CropKind[], buildings: readonly Rect[], eaves: number): void {
  const t = stageT(k.stage, k.progress);
  const meadow = G.meadow;
  if (k.stage === 'foundation') {
    // ploughing: the front share of every field is turned soil, the rest still meadow
    for (const f of fields) {
      const zCut = f.z1 - (f.z1 - f.z0) * t;
      k.flagged(FLAG_SNOWABLE, () => k.slab(f.x0, f.z0, f.x1, zCut, 0.05, meadow));
      fieldRows(k, 'wheat', f.x0, zCut, f.x1, f.z1, { look: cropLook('wheat', 1) });
    }
    const f0 = fields[0];
    k.prop('tractor', (f0.x0 + f0.x1) / 2, f0.z1 - (f0.z1 - f0.z0) * t, Math.PI / 2);
    for (const r of buildings) k.flagged(FLAG_SNOWABLE, () => k.slab(r.x0, r.z0, r.x1, r.z1, 0.06, shade(G.soil, 0.9)));
  } else if (k.stage === 'structure') {
    // sowing front to back; farmyard frames rise
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      fieldRows(k, crops[i % crops.length], f.x0, f.z0, f.x1, f.z1, { look: cropLook('wheat', 3), sown: t });
    }
    const f0 = fields[0];
    k.prop('tractor', (f0.x0 + f0.x1) / 2, f0.z1 - (f0.z1 - f0.z0) * t, -Math.PI / 2);
    for (const r of buildings) concreteFrame(k, r, Math.max(0.5, eaves * t), eaves);
  } else {
    // first green, buildings standing (roofs on)
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      fieldRows(k, crops[i % crops.length], f.x0, f.z0, f.x1, f.z1, { look: firstGreen(crops[i % crops.length]) });
    }
    buildings.forEach((r, i) => {
      if (!k.lod0) lodBox(k, r, eaves + 2, i === 0 ? SHINGLE : WORLD_RGB.roof.tile, i === 0 ? BARN_RED : WORLD_RGB.wall.warmWhite, i === 0);
      else if (i === 0) barn(k, r, eaves, eaves * 0.65);
      else farmhouse(k, r);
    });
  }
  const yard0 = buildings[0];
  siteCabins(k, yard0.x0 + 1, Math.min(k.hd - 4, yard0.z1 + 5));
  flagpole(k, -k.hw + 5, k.hd - 2.5, 9);
}

function firstGreen(crop: CropKind): CropLook {
  const g = cropLook(crop === 'fallow' ? 'wheat' : crop, 4);
  return { ...g, height: Math.max(0.2, g.height * 0.8) };
}

export const smallFarm: AssetFactory = {
  id: 'small_farm',
  family: 'extraction',
  footprints: [[3, 3]],
  triBudget: { lod0: 1500, lod1: 60 },
  build: buildSmallFarm,
};

export const largeFarm: AssetFactory = {
  id: 'large_farm',
  family: 'extraction',
  footprints: [[5, 5]],
  triBudget: { lod0: 2500, lod1: 100 },
  build: buildLargeFarm,
};
