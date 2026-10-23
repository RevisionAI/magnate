// What the render core and the audio frame need from a decoded layout: the SceneWorld (W1 status §2.6: water per
// plot, highway exits, relief, climate) and the land-use grid for the AudioFrame (summed-area tables), plus the
// per-plot surface heights and parcel ids picking uses.
import { LandUseGrid, LANDUSE_COMMERCIAL, LANDUSE_CONSTRUCTION, LANDUSE_GREEN, LANDUSE_INDUSTRIAL, LANDUSE_NONE, LANDUSE_RESIDENTIAL, LANDUSE_ROAD, LANDUSE_WATER } from '../audio/AudioFrameProducer';
import { WATER_LAKE, WATER_NONE, WATER_RIVER, WATER_SEA, defaultRelief, type HighwayExit, type SceneWorld } from '../env/World';
import type { Climate } from '../env/Seasons';
import {
  D_APARTMENTS, D_CBD, D_CIVIC, D_COMMERCIAL, D_HOUSES, D_INDUSTRIAL, D_MIXED, D_PARK, D_PORT, D_RURAL, K_BEACH, K_BRIDGE,
  K_LAKE, K_OPEN, K_PARCEL, K_RIVER, K_ROAD, K_SEA, R_HIGHWAY, type CityGrid,
} from './layout/types';
import type { CityBuildContext } from './build/CityBuildContext';
import type { CompanySpec } from './chunkProtocol';

const WATER_OF: Record<number, number> = { [K_SEA]: WATER_SEA, [K_RIVER]: WATER_RIVER, [K_LAKE]: WATER_LAKE };

/** Per-plot water mask for W1 (bridges count as the water under them). */
export function waterMask(grid: CityGrid): Uint8Array | null {
  const W = grid.gridW, H = grid.gridH;
  const out = new Uint8Array(W * H);
  let any = false;
  for (let i = 0; i < out.length; i++) {
    const w = WATER_OF[grid.kind[i]];
    if (w) { out[i] = w; any = true; }
  }
  // Bridges: the most common water kind among the 4-neighbours (rivers by default).
  for (let pz = 0; pz < H; pz++) {
    for (let px = 0; px < W; px++) {
      const i = pz * W + px;
      if (grid.kind[i] !== K_BRIDGE) continue;
      const counts = [0, 0, 0, 0];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = px + dx, z = pz + dz;
        if (x < 0 || z < 0 || x >= W || z >= H) continue;
        const w = WATER_OF[grid.kind[z * W + x]];
        if (w) counts[w]++;
      }
      let best = WATER_RIVER;
      for (const k of [WATER_SEA, WATER_RIVER, WATER_LAKE]) if (counts[k] > counts[best]) best = k;
      out[i] = best;
      any = true;
    }
  }
  return any ? out : null;
}

/** Highway exits: highway tiles on the map edge whose road continues outwards. */
export function highwayExits(grid: CityGrid): HighwayExit[] {
  const W = grid.gridW, H = grid.gridH;
  const out: HighwayExit[] = [];
  const isHw = (x: number, z: number) => grid.road[z * W + x] === R_HIGHWAY && (grid.kind[z * W + x] === K_ROAD || grid.kind[z * W + x] === K_BRIDGE);
  for (let x = 0; x < W; x++) {
    if (isHw(x, 0) && (H < 2 || isHw(x, 1))) out.push({ edge: 'N', at: x });
    if (isHw(x, H - 1) && (H < 2 || isHw(x, H - 2))) out.push({ edge: 'S', at: x });
  }
  for (let z = 0; z < H; z++) {
    if (isHw(0, z) && (W < 2 || isHw(1, z))) out.push({ edge: 'W', at: z });
    if (isHw(W - 1, z) && (W < 2 || isHw(W - 2, z))) out.push({ edge: 'E', at: z });
  }
  return out;
}

export function sceneWorldOf(grid: CityGrid, population: number): SceneWorld {
  return {
    cityId: grid.cityId, gridW: grid.gridW, gridH: grid.gridH, seed: grid.seed >>> 0 || 1, climate: grid.climate as Climate,
    water: waterMask(grid), reliefM: defaultRelief(grid.cityId), highways: highwayExits(grid), population,
  };
}

const AMBIENT_USE: Record<string, number> = {
  house: LANDUSE_RESIDENTIAL, rowhouse: LANDUSE_RESIDENTIAL, villa: LANDUSE_RESIDENTIAL, apartment: LANDUSE_RESIDENTIAL,
  midrise: LANDUSE_COMMERCIAL, office: LANDUSE_COMMERCIAL, shop: LANDUSE_COMMERCIAL, strip_mall: LANDUSE_COMMERCIAL,
  plaza: LANDUSE_COMMERCIAL, parking: LANDUSE_COMMERCIAL, park: LANDUSE_GREEN, field: LANDUSE_GREEN, forest: LANDUSE_GREEN,
  orchard: LANDUSE_GREEN, vineyard: LANDUSE_GREEN, pasture: LANDUSE_GREEN, scrub: LANDUSE_GREEN, factory: LANDUSE_INDUSTRIAL,
  warehouse: LANDUSE_INDUSTRIAL, tank_farm: LANDUSE_INDUSTRIAL,
};

function districtUse(d: number): number {
  switch (d) {
    case D_CBD: case D_COMMERCIAL: case D_MIXED: return LANDUSE_COMMERCIAL;
    case D_APARTMENTS: case D_HOUSES: return LANDUSE_RESIDENTIAL;
    case D_INDUSTRIAL: case D_PORT: return LANDUSE_INDUSTRIAL;
    case D_RURAL: case D_PARK: case D_CIVIC: return LANDUSE_GREEN;
    default: return LANDUSE_NONE;
  }
}

const CATEGORY_USE: Record<string, number> = {
  factory: LANDUSE_INDUSTRIAL, warehouse: LANDUSE_INDUSTRIAL, seaport: LANDUSE_INDUSTRIAL, mine: LANDUSE_INDUSTRIAL,
  oil_well: LANDUSE_INDUSTRIAL, farm: LANDUSE_GREEN, plantation: LANDUSE_GREEN,
};

/** Land use per plot (LANDUSE_*), with company buildings on top (construction sites as construction). */
export function landUseOf(grid: CityGrid, companies: readonly CompanySpec[]): Uint8Array {
  const W = grid.gridW, H = grid.gridH;
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) {
    const k = grid.kind[i];
    if (k === K_ROAD || k === K_BRIDGE) out[i] = k === K_BRIDGE ? LANDUSE_WATER : LANDUSE_ROAD;
    else if (WATER_OF[k]) out[i] = LANDUSE_WATER;
    else if (k === K_BEACH || k === K_OPEN) out[i] = LANDUSE_GREEN;
    else if (k === K_PARCEL) {
      const p = grid.parcelAt[i] >= 0 ? grid.parcels[grid.parcelAt[i]] : null;
      const kind = p?.ambient?.kind ?? '';
      out[i] = AMBIENT_USE[kind] ?? (kind.startsWith('civic:') ? LANDUSE_COMMERCIAL : kind.startsWith('deposit:') ? LANDUSE_GREEN : districtUse(grid.district[i]));
    }
  }
  for (const c of companies) {
    const use = c.stage !== 'complete' && c.stage !== 'closed' ? LANDUSE_CONSTRUCTION : CATEGORY_USE[c.category] ?? LANDUSE_COMMERCIAL;
    for (let z = c.pz; z < c.pz + c.h; z++) for (let x = c.px; x < c.px + c.w; x++) if (x >= 0 && z >= 0 && x < W && z < H) out[z * W + x] = use;
  }
  return out;
}

export function landUseGrid(grid: CityGrid, companies: readonly CompanySpec[], coastal: boolean, population: number): LandUseGrid {
  return new LandUseGrid(grid.cityId, grid.gridW, grid.gridH, landUseOf(grid, companies), { coastal, population });
}

/** Ground surface per plot for picking: parcel terraces, company terraces, natural terrain elsewhere, water at −0.35. */
export function surfaceHeights(ctx: CityBuildContext): Float32Array {
  const out = new Float32Array(ctx.W * ctx.H);
  for (let pz = 0; pz < ctx.H; pz++) {
    for (let px = 0; px < ctx.W; px++) {
      const i = pz * ctx.W + px;
      const x = ctx.x0(px) + 12, z = ctx.z0(pz) + 12;
      const cover = ctx.coveredBy(px, pz);
      if (cover >= 0) out[i] = ctx.companyTerrace.get(cover) ?? 0;
      else if (WATER_OF[ctx.grid.kind[i]]) out[i] = -0.35;
      else if (ctx.grid.kind[i] === K_PARCEL && ctx.grid.parcelAt[i] >= 0) out[i] = ctx.terrace[ctx.grid.parcelAt[i]];
      else out[i] = ctx.warpFn(px, pz)(x, z);
    }
  }
  return out;
}

/** Parcel id per plot (−1 = none). */
export function parcelIds(grid: CityGrid): Int32Array {
  const out = new Int32Array(grid.gridW * grid.gridH).fill(-1);
  for (let i = 0; i < out.length; i++) if (grid.parcelAt[i] >= 0) out[i] = grid.parcels[grid.parcelAt[i]].id;
  return out;
}

export { WATER_NONE };
