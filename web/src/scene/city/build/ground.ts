// Ground of the plots that are not lots: open land and beaches (terrain-following), the walls every surface draws on
// its higher sides (terrace retaining walls, river and sea banks, quays), and the edge apron that lets a hilly city
// meet the flat outskirts ring (W1 flattens the outskirts to 0 m within 150 m of the city).
import type { GeoBuilder, RGB } from '../../assets/GeoBuilder';
import { WORLD_RGB, mixRgb, shade } from '../../assets/palette';
import { treeLook } from '../../assets/familiesA';
import { FLAG_SNOWABLE, FLAG_VEGETATION } from '../../materials/CityMaterial';
import { hash3 } from '../../env/rng';
import { PLOT_SIZE } from '../../units';
import { D_CBD, D_COMMERCIAL, D_INDUSTRIAL, D_PORT, K_BEACH, R_HIGHWAY, SHORE_BEACH, SHORE_QUAY, isWaterKind } from '../layout/types';
import { carriageHalfWidth } from '../RoadNetwork';
import { WATER_BANK_BOTTOM, type CityBuildContext } from './CityBuildContext';
import type { ChunkWriter } from './ChunkWriter';
import { boxW, quadUp, rectUp, wall } from './prims';

const STONE: RGB = WORLD_RGB.wall.stone;
const QUAY: RGB = WORLD_RGB.wall.concrete;
const COPING: RGB = [0xc9, 0xc5, 0xbc];
const FENDER: RGB = [0x2b, 0x2e, 0x33];
const BANK: RGB = [0x8a, 0x86, 0x6e];
const APRON_M = 130;

/** Open land ('o' plots): meadow with a few shrubs and trees, following the terrain. */
export function buildOpenPlot(ctx: CityBuildContext, w: ChunkWriter, px: number, pz: number, season: number): void {
  const x0 = ctx.x0(px), z0 = ctx.z0(pz);
  const seed = ctx.grid.seed;
  const dry = ctx.grid.climate === 'warm' || ctx.grid.climate === 'arid';
  const base = dry ? WORLD_RGB.ground.dryGrass : WORLD_RGB.ground.meadow;
  const col = shade(base, 0.96 + 0.06 * hash3(px, pz, seed, 3));
  w.both((b) => {
    b.flags = FLAG_VEGETATION | FLAG_SNOWABLE;
    rectUp(b, x0, z0, x0 + PLOT_SIZE, z0 + PLOT_SIZE, 0, col);
  }, ctx.terrain);
  const n = Math.floor(hash3(px, pz, seed, 5) * 4);
  for (let k = 0; k < n; k++) {
    const x = x0 + 3 + hash3(px, pz, seed, 10 + k) * (PLOT_SIZE - 6), z = z0 + 3 + hash3(pz, px, seed, 20 + k) * (PLOT_SIZE - 6);
    const r = hash3(px + k, pz, seed, 30);
    const look = treeLook(r < 0.3 ? 'conifer' : 'deciduous', season, r, hash3(px, pz + k, seed, 31), hash3(px, pz, seed, 32 + k));
    w.prop(look.family, x, ctx.terrain(x, z), z, r * 6.28, 0.7 + 0.5 * r, look.color);
  }
}

/** Beach plots: sand sloping into the water where it meets it. */
export function buildBeachPlot(ctx: CityBuildContext, w: ChunkWriter, px: number, pz: number): void {
  const x0 = ctx.x0(px), z0 = ctx.z0(pz);
  const col = shade(WORLD_RGB.ground.sand, 0.97 + 0.05 * hash3(px, pz, ctx.grid.seed, 7));
  w.both((b) => {
    b.flags = FLAG_SNOWABLE;
    // 2 × 2 sub-quads so the dip reads as a slope rather than a fold.
    const h = PLOT_SIZE / 2;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) rectUp(b, x0 + i * h, z0 + j * h, x0 + (i + 1) * h, z0 + (j + 1) * h, 0, col);
  }, ctx.beach);
}

/** Districts whose waterfront is walled (quays and embankments) whatever the water rect says. */
const WALLED = new Set([D_CBD, D_COMMERCIAL, D_INDUSTRIAL, D_PORT]);

/** Colour of the wall a land surface (plot px, pz) shows towards a lower neighbour (nx, nz). */
function wallColour(ctx: CityBuildContext, px: number, pz: number, nx: number, nz: number): { rgb: RGB; quay: boolean } {
  const k = ctx.kindAt(nx, nz);
  if (k >= 0 && isWaterKind(k)) {
    const s = ctx.grid.shore[nz * ctx.W + nx];
    const own = pz * ctx.W + px;
    // Company lots (a seaport's berth), roads and downtown/industrial land meet the water with a quay wall.
    const walled = ctx.coveredBy(px, pz) >= 0 || ctx.isRoadish(px, pz) || WALLED.has(ctx.grid.district[own]);
    if (s === SHORE_QUAY || (walled && s !== SHORE_BEACH)) return { rgb: QUAY, quay: true };
    if (s === SHORE_BEACH) return { rgb: mixRgb(WORLD_RGB.ground.sand, BANK, 0.4), quay: false };
    return { rgb: ctx.grid.climate === 'warm' ? mixRgb(BANK, WORLD_RGB.ground.sand, 0.4) : BANK, quay: false };
  }
  return { rgb: STONE, quay: false };
}

/**
 * Walls on the sides of plot (px, pz) where its surface (`own(xa, za, xb, zb)`) is higher than the neighbour's.
 * Edges inside `same` (e.g. the rest of the same parcel) are skipped. Returns nothing; writes into both LODs.
 */
export function sideWalls(ctx: CityBuildContext, w: ChunkWriter, px: number, pz: number, own: (xa: number, za: number, xb: number, zb: number) => [number, number], same?: (nx: number, nz: number) => boolean): void {
  for (const s of ctx.sides(px, pz)) {
    if (same?.(s.nx, s.nz)) continue;
    const nb = ctx.surfaceAt(s.nx, s.nz, s.xa, s.za, s.xb, s.zb);
    if (!nb) {
      if (ctx.hilly) apron(ctx, w, px, pz, s, own(s.xa, s.za, s.xb, s.zb));
      continue;
    }
    const mine = own(s.xa, s.za, s.xb, s.zb);
    if (mine[0] <= nb[0] + 0.02 && mine[1] <= nb[1] + 0.02) continue;
    const { rgb, quay } = wallColour(ctx, px, pz, s.nx, s.nz);
    // Orient the segment so the wall faces outwards (wall() picks the winding from the normal).
    w.both((b, lod) => {
      b.flags = 0;
      wall(b, s.xa, s.za, s.xb, s.zb, nb[0], nb[1], mine[0], mine[1], s.n, rgb);
      if (quay && lod === 0) quayDetail(b, s, mine);
    }, null);
  }
}

/** Coping strip along the quay edge, black fenders on the wall face every 10 m. */
function quayDetail(b: GeoBuilder, s: { xa: number; za: number; xb: number; zb: number; n: [number, number] }, top: [number, number]): void {
  const len = Math.hypot(s.xb - s.xa, s.zb - s.za);
  const ux = (s.xb - s.xa) / len, uz = (s.zb - s.za) / len;
  const [nx, nz] = s.n;
  const y = Math.max(top[0], top[1]);
  // Coping: 0.6 m band just inside the edge, 6 cm proud.
  const ix = -nx * 0.6, iz = -nz * 0.6;
  quadUp(b, [s.xa, y + 0.06, s.za], [s.xb, y + 0.06, s.zb], [s.xb + ix, y + 0.06, s.zb + iz], [s.xa + ix, y + 0.06, s.za + iz], COPING);
  wall(b, s.xa, s.za, s.xb, s.zb, y, y, y + 0.06, y + 0.06, s.n, COPING);
  for (let d = 4; d < len - 2; d += 10) {
    const x = s.xa + ux * d, z = s.za + uz * d;
    const x0 = Math.min(x, x + nx * 0.35) - Math.abs(uz) * 0.4, x1 = Math.max(x, x + nx * 0.35) + Math.abs(uz) * 0.4;
    const z0 = Math.min(z, z + nz * 0.35) - Math.abs(ux) * 0.4, z1 = Math.max(z, z + nz * 0.35) + Math.abs(ux) * 0.4;
    boxW(b, x0, -1.6, z0, x1, y - 0.25, z1, FENDER);
  }
}

/** Sloped apron from a city edge outwards to just below the outskirts ground (hilly cities only). */
function apron(ctx: CityBuildContext, w: ChunkWriter, px: number, pz: number, s: { xa: number; za: number; xb: number; zb: number; n: [number, number] }, top: [number, number]): void {
  if (top[0] < 0.05 && top[1] < 0.05) return;
  const [nx, nz] = s.n;
  const ox = nx * APRON_M, oz = nz * APRON_M, end = -0.6;
  const k = ctx.kindAt(px, pz);
  const dry = ctx.grid.climate === 'warm' || ctx.grid.climate === 'arid';
  const col = k === K_BEACH ? WORLD_RGB.ground.sand : dry ? WORLD_RGB.ground.dryGrass : WORLD_RGB.ground.meadow;
  // Corners of the grid: widen the apron sideways so neighbouring aprons overlap instead of leaving a notch.
  const W = ctx.W, H = ctx.H;
  const corner = (px === 0 || px === W - 1) && (pz === 0 || pz === H - 1);
  const ext = corner ? APRON_M : 0;
  const ux = (s.xb - s.xa) / PLOT_SIZE, uz = (s.zb - s.za) / PLOT_SIZE;
  const xa = s.xa - ux * (atStart(px, pz, s, W, H) ? ext : 0), za = s.za - uz * (atStart(px, pz, s, W, H) ? ext : 0);
  const xb = s.xb + ux * (atEnd(px, pz, s, W, H) ? ext : 0), zb = s.zb + uz * (atEnd(px, pz, s, W, H) ? ext : 0);
  w.both((b) => {
    b.flags = FLAG_VEGETATION | FLAG_SNOWABLE;
    quadUp(b, [s.xa, top[0], s.za], [s.xb, top[1], s.zb], [s.xb + ox, end, s.zb + oz], [s.xa + ox, end, s.za + oz], col);
    if (xa !== s.xa || za !== s.za) quadUp(b, [xa, end, za], [s.xa, top[0], s.za], [s.xa + ox, end, s.za + oz], [xa + ox, end, za + oz], col);
    if (xb !== s.xb || zb !== s.zb) quadUp(b, [s.xb, top[1], s.zb], [xb, end, zb], [xb + ox, end, zb + oz], [s.xb + ox, end, s.zb + oz], col);
    // Highway exits carry their carriageway down the apron.
    const t = ctx.net.tile(px, pz);
    if (t && t.cls === R_HIGHWAY) {
      const hw = carriageHalfWidth(t.cls, t.lanes);
      const mx = (s.xa + s.xb) / 2, mz = (s.za + s.zb) / 2, ym = (top[0] + top[1]) / 2;
      quadUp(b, [mx - ux * hw, ym + 0.04, mz - uz * hw], [mx + ux * hw, ym + 0.04, mz + uz * hw], [mx + ux * hw + ox, end + 0.04, mz + uz * hw + oz], [mx - ux * hw + ox, end + 0.04, mz - uz * hw + oz], WORLD_RGB.road.asphaltDark);
    }
  }, null);
}

/** The segment runs west→east or north→south; its start is at the lower coordinate. */
function atStart(px: number, pz: number, s: { xa: number; za: number; xb: number; zb: number }, _W: number, _H: number): boolean {
  return s.za === s.zb ? px === 0 : pz === 0;
}

function atEnd(px: number, pz: number, s: { xa: number; za: number; xb: number; zb: number }, W: number, H: number): boolean {
  return s.za === s.zb ? px === W - 1 : pz === H - 1;
}

/** Warped-surface wall helper: own heights from the plot's warp function. */
export function warpedOwn(ctx: CityBuildContext, px: number, pz: number): (xa: number, za: number, xb: number, zb: number) => [number, number] {
  return (xa, za, xb, zb) => ctx.surfaceAt(px, pz, xa, za, xb, zb) ?? [0, 0];
}

export { WATER_BANK_BOTTOM };
