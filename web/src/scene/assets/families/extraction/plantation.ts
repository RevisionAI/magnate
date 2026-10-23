// small_plantation (3×3, art §4.2.11). Coffee: shrub rows (instanced) on three terraces with 0.6 m steps, shade trees
// every 12 m, a drying patio with beans in Oct–Dec, red cherries on the shrubs in Sep–Nov, a processing shed with an
// owner roof panel. Hops: 6 m trellis poles with wires and bines whose height follows the month (0 in Jan–Mar, 2 m in
// May, 5.5 m in Jul–Aug, cut in Sep) and an oast house (brick kiln, conical roof, white cowl). Other crops fall back
// to row fields. Construction uses the farm override (plough, sow, first green).
import { FLAG_SNOWABLE, FLAG_VEGETATION } from '../../../materials/CityMaterial';
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { ASSET_RGB, WORLD_RGB, hexRgb, shade } from '../../palette';
import { cropLook, fieldRows } from '../common-b/crops';
import { flagpole, ground, roofBoard, tree, weeds } from '../common-b/details';
import { Kit } from '../common-b/kit';
import { cropsFor, type CropKind } from '../common-b/products';
import { farmSite, farmhouse, lodBox, postFence, type Rect } from './farm';

const G = WORLD_RGB.ground;
const SOIL = shade(G.soil, 0.96);
const TERRACE_WALL = WORLD_RGB.wall.stone;
const PLANTATION_CROPS: readonly CropKind[] = ['coffee', 'hops'];

/** Processing shed / stowage with a gable roof and a 4 × 4 m owner roof panel. ~40 triangles. */
function shed(k: Kit, r: Rect, eaves: number, wall: RGB, roofRgb: RGB): void {
  const rise = Math.min(3.2, (r.z1 - r.z0) * 0.32);
  k.box(r.x0, 0, r.z0, r.x1, eaves, r.z1, wall, wall, null, false);
  k.roof(() => k.flagged(FLAG_SNOWABLE, () => k.gable(r.x0, r.z0, r.x1, r.z1, eaves, rise, roofRgb, wall, true, 0.5)));
  const owner = k.closed ? ASSET_RGB.closedGrey : k.ownerRgb;
  const half = (r.z1 - r.z0) / 2 + 0.5, len = Math.hypot(half, rise), ny = half / len, nz = rise / len, xm = (r.x0 + r.x1) / 2;
  const at = (x: number, f: number): [number, number, number] => [x, eaves + rise * f + 0.05 * ny, r.z1 + 0.5 - half * f + 0.05 * nz];
  const f1 = Math.min(0.95, 0.25 + 4 / len);
  k.quad(at(xm - 2, 0.25), at(xm + 2, 0.25), at(xm + 2, f1), at(xm - 2, f1), [0, ny, nz], owner);
  if (k.lod0) k.quad([xm - 2.2, 0.03, r.z1 + 0.03], [xm + 2.2, 0.03, r.z1 + 0.03], [xm + 2.2, Math.min(3.8, eaves - 0.6), r.z1 + 0.03], [xm - 2.2, Math.min(3.8, eaves - 0.6), r.z1 + 0.03], [0, 0, 1], k.closed ? ASSET_RGB.boarded : WORLD_RGB.industry.dockDoors);
}

// ---- coffee -----------------------------------------------------------------------------------------------------------

const COFFEE = {
  shed: { x0: -34, z0: 8, x1: -18, z1: 18 },
  patio: { x0: -34, z0: 21, x1: -16, z1: 33 },
  // terraces step up towards the back (0, 0.6, 1.2 m)
  t1: { x0: -12, z0: -4, x1: 35, z1: 34, y: 0 },
  t2: { x0: -35, z0: -20, x1: 35, z1: -4, y: 0.6 },
  t3: { x0: -35, z0: -35, x1: 35, z1: -20, y: 1.2 },
} as const;

function coffee(k: Kit): void {
  const C = COFFEE;
  const cherries = !k.closed && k.month >= 9 && k.month <= 11;
  const beans = !k.closed && (k.month >= 10 || k.month === 12);
  ground(k, C.t1.x0, C.t1.z0, C.t1.x1, C.t1.z1, SOIL, 0.04);
  // terraces 2 and 3: stone-faced risers with soil on top
  for (const t of [C.t2, C.t3]) k.flagged(FLAG_SNOWABLE, () => k.box(t.x0, 0, t.z0, t.x1, t.y, t.z1, TERRACE_WALL, SOIL));
  // patio + beans drying (Oct–Dec)
  ground(k, C.patio.x0, C.patio.z0, C.patio.x1, C.patio.z1, ASSET_RGB.patio, 0.06);
  if (beans && k.lod0) for (let i = 0; i < 3; i++) k.slab(C.patio.x0 + 1.2 + i * 5.6, C.patio.z0 + 1.5, C.patio.x0 + 5.6 + i * 5.6, C.patio.z1 - 1.5, 0.08, ASSET_RGB.beans);
  shed(k, C.shed, 6, WORLD_RGB.wall.cream, WORLD_RGB.roof.tile);
  if (!k.lod0) {
    // city band: canopy colour over the terraces
    const canopy = k.closed ? G.dryGrass : WORLD_RGB.crops.coffee;
    for (const t of [C.t1, C.t2, C.t3]) k.flagged(FLAG_VEGETATION, () => k.slab(t.x0 + 0.8, t.z0 + 0.8, t.x1 - 0.8, t.z1 - 0.8, t.y + 1.0, canopy));
    return;
  }
  if (k.closed) return;
  const family = cherries ? 'coffeeShrubCherry' : 'coffeeShrub';
  for (const t of [C.t1, C.t2, C.t3]) {
    const rows = Math.floor((t.z1 - t.z0 - 1.6) / 3.0);
    for (let r = 0; r < rows; r++) {
      const z = t.z1 - 1.6 - r * 3.0;
      for (let x = t.x0 + 1.6; x <= t.x1 - 1.4; x += 2.7) {
        k.prop(family, x + (k.rnd() - 0.5) * 0.3, z, k.rnd() * Math.PI, { y: t.y, scale: 0.85 + 0.25 * k.rnd() });
      }
    }
    // shade trees every 12 m
    for (let x = t.x0 + 6; x < t.x1 - 3; x += 12) {
      for (let z = t.z1 - 5.6; z > t.z0 + 2; z -= 12) tree(k, x, z, 1.05 + 0.2 * k.rnd(), { y: t.y, evergreen: true }); // tropical shade trees
    }
  }
}

// ---- hops -------------------------------------------------------------------------------------------------------------

const HOPS = {
  yard: { x0: -12, z0: -34, x1: 35, z1: 34 },
  kiln: { x: -27, z: 25 },
  stowage: { x0: -34, z0: 9, x1: -20, z1: 18 },
  house: { x0: -34, z0: -14, x1: -24, z1: -6 },
} as const;

/** Bine height by month (art §4.2.11). */
export function bineHeight(month: number): number {
  return [0, 0, 0, 0.8, 2, 4, 5.5, 5.5, 0, 0, 0, 0][(((Math.round(month) - 1) % 12) + 12) % 12];
}

function hops(k: Kit): void {
  const Y = HOPS.yard;
  const h = k.closed ? 0 : bineHeight(k.month);
  ground(k, Y.x0, Y.z0, Y.x1, Y.z1, SOIL, 0.04);
  const pole = hexRgb('#7A6650'), wire = hexRgb('#4A4E55');
  const bine = k.month <= 6 ? WORLD_RGB.crops.hopsGrowing : WORLD_RGB.crops.hops;
  if (k.lod0) {
    for (let z = Y.z1 - 1.5; z > Y.z0 + 1; z -= 3.3) {
      for (let x = Y.x0 + 1; x <= Y.x1 - 0.9; x += 9.8) k.beam([x, 0, z], [x, 6, z], 0.18, 0.18, pole, 3);
      k.beam([Y.x0 + 1, 5.9, z], [Y.x1 - 0.9, 5.9, z], 0.05, 0.05, wire, 3);
      if (h > 0.05) {
        // bines climbing the strings: a double-sided green curtain along the row
        k.flagged(FLAG_VEGETATION, () => {
          k.quad([Y.x0 + 1.2, 0.05, z], [Y.x1 - 1.1, 0.05, z], [Y.x1 - 1.1, h, z], [Y.x0 + 1.2, h, z], [0, 0, 1], bine);
          k.quad([Y.x0 + 1.2, 0.05, z], [Y.x1 - 1.1, 0.05, z], [Y.x1 - 1.1, h, z], [Y.x0 + 1.2, h, z], [0, 0, -1], shade(bine, 0.9));
        });
      } else if (k.month === 9 && !k.closed) {
        k.strip(Y.x0 + 1.2, z, Y.x1 - 1.1, z, 0.5, 0.08, WORLD_RGB.crops.stubble); // cut bines
      } else {
        // off-season: grassed alleys between the hills, bare crowns along the row
        k.strip(Y.x0 + 1.2, z - 1.65, Y.x1 - 1.1, z - 1.65, 1.9, 0.06, k.closed ? G.dryGrass : shade(G.meadow, 0.96));
        k.strip(Y.x0 + 1.2, z, Y.x1 - 1.1, z, 0.45, 0.07, shade(SOIL, 0.85));
      }
    }
  } else {
    if (h > 0.05) k.flagged(FLAG_VEGETATION, () => k.slab(Y.x0 + 1, Y.z0 + 1, Y.x1 - 1, Y.z1 - 1, Math.min(h, 4), bine));
  }
  // oast house: brick kiln Ø6 × 8 m, conical roof, white cowl; stowage barn alongside
  const { x, z } = HOPS.kiln;
  const brick = WORLD_RGB.wall.brick;
  k.cyl(x, z, 3, 0, 8, k.lod0 ? 10 : 4, brick, brick, false);
  k.flagged(FLAG_SNOWABLE, () => k.cone(x, z, 3.35, 0.45, 8, 13.5, k.lod0 ? 10 : 4, WORLD_RGB.roof.tile));
  if (k.lod0) {
    k.cyl(x, z, 0.45, 13.5, 14.3, 6, ASSET_RGB.oastCowl);
    k.prism([[x - 0.8, z - 0.2], [x + 0.6, z - 0.7], [x + 0.9, z + 0.6], [x - 0.6, z + 0.8]], 14.3, 15.4, ASSET_RGB.oastCowl, ASSET_RGB.oastCowl);
    k.beam([x + 0.2, 15.6, z], [x + 1.6, 15.1, z], 0.15, 0.6, ASSET_RGB.oastCowl, 4, true); // cowl vane
  }
  shed(k, HOPS.stowage, 6, WORLD_RGB.wall.warmWhite, WORLD_RGB.roof.tile);
  if (k.lod0) farmhouse(k, HOPS.house, WORLD_RGB.roof.slate);
  else lodBox(k, HOPS.house, 6, WORLD_RGB.roof.slate, WORLD_RGB.wall.warmWhite, false);
}

// ---- factory ----------------------------------------------------------------------------------------------------------

function buildPlantation(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const k = new Kit(b, lot, p, { mirror: (p.variant & 1) === 1 });
  const crops = cropsFor(p.productIds, p.seed + p.variant * 8, PLANTATION_CROPS);
  const crop = crops[0];
  const building = p.stage === 'foundation' || p.stage === 'structure' || p.stage === 'finishing';
  ground(k, -35.8, -35.8, 35.8, 35.8, G.yard, 0.02);
  ground(k, -35, 34, -14, 35.6, G.gravel, 0.05);
  if (building) {
    farmSite(k, [{ x0: -12, z0: -34, x1: 35, z1: 34 }], [crop === 'hops' || crop === 'coffee' ? 'wheat' : crop], [COFFEE.shed, HOPS.house], 6);
    return k.finish();
  }
  if (crop === 'coffee') coffee(k);
  else if (crop === 'hops') hops(k);
  else {
    // a plantation of an arable crop: rows over the planted area + the processing shed
    if (k.lod0) fieldRows(k, k.closed ? 'fallow' : crop, -12, -34, 35, 34, { look: cropLook(k.closed ? 'fallow' : crop, k.month) });
    else k.slab(-12, -34, 35, 34, 0.05, cropLook(k.closed ? 'fallow' : crop, k.month).top);
    shed(k, COFFEE.shed, 6, WORLD_RGB.wall.cream, WORLD_RGB.roof.tile);
  }
  if (k.lod0) {
    postFence(k, { x0: -35.6, z0: -35.6, x1: 35.6, z1: 35.6 }, 8, [-35.6, -14]);
    flagpole(k, -13, 34.6, 9);
  }
  if (k.lod0) roofBoard(k, -8.5, 34.8, 0, 5, 1.4, 'pz', 1.0); // estate sign with the owner wordmark (glows at night)
  weeds(k, 3);
  return k.finish();
}

export const smallPlantation: AssetFactory = {
  id: 'small_plantation',
  family: 'extraction',
  footprints: [[3, 3]],
  triBudget: { lod0: 1800, lod1: 60 },
  build: buildPlantation,
};
