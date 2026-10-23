// Decode the bridge `cityLayout` payload (E3a CityLayoutDto) into typed per-plot arrays the renderer, the chunk
// worker, the road network and picking all share. Pure and deterministic; runs on the main thread and in the worker.
// Per-plot encodings (status e3a-citygen §3): `plots.kinds/roads/districts/slopes` are one character per plot,
// row-major with i = pz·gridW + px; `terrain.heights` are (gridW+1)·(gridH+1) corner heights with the water surface
// at 0 m. When `plots` is missing (older engine builds) the arrays are derived from roads, parcels and water rects.
import type { CityClimate } from '@/bridge/protocol';
import { defaultClimate } from '../../env/Seasons';
import { PLOT_SIZE } from '../../units';
import {
  D_APARTMENTS, D_CBD, D_CIVIC, D_COMMERCIAL, D_HOUSES, D_INDUSTRIAL, D_MIXED, D_NONE, D_PARK, D_PORT, D_RURAL,
  K_BEACH, K_BRIDGE, K_LAKE, K_OPEN, K_PARCEL, K_RIVER, K_ROAD, K_SEA, R_ARTERIAL, R_COLLECTOR, R_HIGHWAY,
  R_LOCAL, R_NONE, SHORE_BEACH, SHORE_NONE, SHORE_QUAY,
  type CityGrid, type CityLayoutWire, type ParcelInfo,
} from './types';

const KIND_CODES: Record<string, number> = { p: K_PARCEL, r: K_ROAD, b: K_BRIDGE, s: K_SEA, v: K_RIVER, l: K_LAKE, h: K_BEACH, o: K_OPEN };
const DISTRICT_CODES: Record<string, number> = {
  '.': D_NONE, C: D_CBD, c: D_COMMERCIAL, m: D_MIXED, a: D_APARTMENTS, h: D_HOUSES, i: D_INDUSTRIAL, p: D_PORT, g: D_RURAL, k: D_PARK, v: D_CIVIC,
};
const DISTRICT_NAMES: Record<string, number> = {
  cbd: D_CBD, commercial: D_COMMERCIAL, mixed: D_MIXED, apartments: D_APARTMENTS, houses: D_HOUSES, industrial: D_INDUSTRIAL,
  port: D_PORT, rural: D_RURAL, park: D_PARK, civic: D_CIVIC,
};
const ZONE_DISTRICT: Record<string, number> = {
  residential: D_HOUSES, commercial: D_COMMERCIAL, industrial: D_INDUSTRIAL, agricultural: D_RURAL, port: D_PORT, park: D_PARK, civic: D_CIVIC,
};
const CLIMATES: ReadonlySet<string> = new Set(['temperate', 'warm', 'cold', 'arid']);

/** Road class rank for a road's `roadClass` (E3a) or `kind` (bridge-spec). */
export function roadClassOf(roadClass: string | undefined, kind: string): number {
  switch (roadClass ?? '') {
    case 'local': return R_LOCAL;
    case 'collector': return R_COLLECTOR;
    case 'arterial': return R_ARTERIAL;
    case 'highway': return R_HIGHWAY;
  }
  return kind === 'highway' ? R_HIGHWAY : kind === 'arterial' ? R_ARTERIAL : R_LOCAL;
}

function waterKindCode(kind: string | undefined): number {
  return kind === 'river' ? K_RIVER : kind === 'lake' ? K_LAKE : K_SEA;
}

/** Decode a layout. Throws on structurally invalid payloads (missing grid size). */
export function decodeLayout(wire: CityLayoutWire): CityGrid {
  const W = wire.gridW | 0, H = wire.gridH | 0;
  if (!(W > 0 && H > 0)) throw new Error(`cityLayout ${wire.cityId}: invalid grid ${wire.gridW}×${wire.gridH}`);
  const n = W * H;
  const kind = new Uint8Array(n);
  const road = new Uint8Array(n);
  const bridge = new Uint8Array(n);
  const district = new Uint8Array(n);
  const landValue = new Float32Array(n);
  const traffic = new Float32Array(n);
  const parcelAt = new Int32Array(n).fill(-1);
  const shore = new Uint8Array(n);
  const lanes = new Uint8Array(n);
  let slope: Uint8Array | null = null;
  const inside = (px: number, pz: number) => px >= 0 && pz >= 0 && px < W && pz < H;

  // ---- parcels (+ ambient development)
  const ambientByParcel = new Map<number, { kind: string; floors: number; variant: number }>();
  for (const a of wire.ambient ?? []) ambientByParcel.set(a.parcelId, { kind: a.kind, floors: a.floors | 0, variant: a.variant | 0 });
  const parcels: ParcelInfo[] = [];
  const parcelById = new Map<number, ParcelInfo>();
  const sortedParcels = [...(wire.parcels ?? [])].sort((a, b) => a.id - b.id);
  for (const p of sortedParcels) {
    const info: ParcelInfo = {
      id: p.id, index: parcels.length, px: p.px, pz: p.pz, w: Math.max(1, p.w), h: Math.max(1, p.h), zone: p.zone,
      district: (p.district ? DISTRICT_NAMES[p.district] : undefined) ?? ZONE_DISTRICT[p.zone] ?? D_NONE,
      facing: (((p.facing ?? 0) % 4) + 4) % 4 as 0 | 1 | 2 | 3,
      vacant: p.vacant ?? !ambientByParcel.has(p.id),
      landmark: p.landmark ?? null,
      depositId: p.depositId ?? null,
      ambient: ambientByParcel.get(p.id) ?? null,
      landValuePerPlot: p.landValuePerPlot, traffic: p.traffic, forSale: p.forSale,
      ownerId: p.ownerId ?? null, buildingId: p.buildingId ?? null,
    };
    parcels.push(info);
    parcelById.set(p.id, info);
    for (let z = info.pz; z < info.pz + info.h; z++) {
      for (let x = info.px; x < info.px + info.w; x++) if (inside(x, z)) parcelAt[z * W + x] = info.index;
    }
  }

  // ---- roads: lanes per plot (always from the road list), class/kind fallback
  const roadsSorted = [...(wire.roads ?? [])].sort((a, b) => a.id - b.id);
  const fallbackRoad = new Uint8Array(n);
  const fallbackBridge = new Uint8Array(n);
  for (const r of roadsSorted) {
    const cls = roadClassOf(r.roadClass, r.kind);
    for (const pt of r.path ?? []) {
      if (!inside(pt.px, pt.pz)) continue;
      const i = pt.pz * W + pt.px;
      if (cls > fallbackRoad[i]) fallbackRoad[i] = cls;
      if (r.bridge) fallbackBridge[i] = 1;
      lanes[i] = Math.max(lanes[i], Math.min(255, r.lanes | 0));
    }
  }

  // ---- water rects: kind fallback + shore treatment
  const waterKind = new Uint8Array(n);
  for (const wr of wire.water ?? []) {
    const k = waterKindCode(wr.kind);
    const s = wr.shore === 'quay' ? SHORE_QUAY : wr.shore === 'beach' ? SHORE_BEACH : SHORE_NONE;
    for (let z = wr.pz; z < wr.pz + wr.h; z++) {
      for (let x = wr.px; x < wr.px + wr.w; x++) {
        if (!inside(x, z)) continue;
        const i = z * W + x;
        waterKind[i] = k;
        if (s > shore[i]) shore[i] = s;
      }
    }
  }

  const plots = wire.plots;
  if (plots && plots.kinds?.length === n) {
    for (let i = 0; i < n; i++) {
      kind[i] = KIND_CODES[plots.kinds[i]] ?? K_OPEN;
      const rc = plots.roads ? plots.roads.charCodeAt(i) - 48 : 0;
      road[i] = rc >= 0 && rc <= 4 ? rc : 0;
      district[i] = plots.districts ? DISTRICT_CODES[plots.districts[i]] ?? D_NONE : D_NONE;
      landValue[i] = plots.landValue?.[i] ?? 0;
      traffic[i] = plots.traffic?.[i] ?? 0;
    }
    if (plots.slopes && plots.slopes.length === n) {
      slope = new Uint8Array(n);
      for (let i = 0; i < n; i++) slope[i] = Math.min(3, Math.max(0, plots.slopes.charCodeAt(i) - 48));
    }
  } else {
    for (let i = 0; i < n; i++) {
      if (fallbackRoad[i]) kind[i] = waterKind[i] ? K_BRIDGE : K_ROAD;
      else if (waterKind[i]) kind[i] = waterKind[i];
      else if (parcelAt[i] >= 0) kind[i] = K_PARCEL;
      else kind[i] = K_OPEN;
      road[i] = fallbackRoad[i];
      const p = parcelAt[i] >= 0 ? parcels[parcelAt[i]] : null;
      district[i] = p ? p.district : D_NONE;
      landValue[i] = p ? p.landValuePerPlot : 0;
      traffic[i] = p ? p.traffic : 0;
    }
  }
  for (let i = 0; i < n; i++) {
    if (kind[i] === K_ROAD || kind[i] === K_BRIDGE) {
      if (road[i] === R_NONE) road[i] = fallbackRoad[i] || R_LOCAL;
      if (lanes[i] === 0) lanes[i] = road[i] === R_ARTERIAL || road[i] === R_HIGHWAY ? 4 : 2;
      if (kind[i] === K_BRIDGE) bridge[i] = 1;
    } else {
      road[i] = R_NONE;
    }
  }

  // ---- terrain corner heights
  let heights: Float32Array | null = null;
  const th = wire.terrain?.heights;
  if (th && th.length === (W + 1) * (H + 1)) {
    let any = false;
    heights = new Float32Array(th.length);
    for (let i = 0; i < th.length; i++) {
      const v = Number.isFinite(th[i]) ? th[i] : 0;
      heights[i] = v;
      if (Math.abs(v) > 1e-3) any = true;
    }
    if (!any) heights = null;
  }

  const climate: CityClimate = wire.climate && CLIMATES.has(wire.climate) ? (wire.climate as CityClimate) : defaultClimate(wire.cityId);
  return {
    cityId: wire.cityId,
    layoutRev: wire.layoutRev | 0,
    seed: (wire.seed ?? 1) | 0,
    climate,
    gridW: W,
    gridH: H,
    kind, road, bridge, district, slope, landValue, traffic, parcelAt, parcels, parcelById, shore, heights,
    landmarks: wire.landmarks ?? [],
    deposits: wire.deposits ?? [],
    cbd: wire.cbd ?? { x: W / 2, z: H / 2 },
    urbanRadius: wire.urbanRadius ?? Math.min(W, H) * 0.4,
    lanes,
  };
}

// ------------------------------------------------------------------------------------------------ geometry helpers

/** World X of the west edge of plot column px. */
export function plotEdgeX(grid: Pick<CityGrid, 'gridW'>, px: number): number {
  return (px - grid.gridW / 2) * PLOT_SIZE;
}

/** World Z of the north edge of plot row pz. */
export function plotEdgeZ(grid: Pick<CityGrid, 'gridH'>, pz: number): number {
  return (pz - grid.gridH / 2) * PLOT_SIZE;
}

/** Corner height (m) at corner (cx, cz), clamped to the grid; 0 on flat cities. */
export function cornerHeight(grid: Pick<CityGrid, 'gridW' | 'gridH' | 'heights'>, cx: number, cz: number): number {
  const h = grid.heights;
  if (!h) return 0;
  const x = Math.min(grid.gridW, Math.max(0, cx)), z = Math.min(grid.gridH, Math.max(0, cz));
  return h[z * (grid.gridW + 1) + x];
}

/** Bilinear ground height (m) of the natural terrain at a world point; 0 on flat cities. */
export function terrainHeightAt(grid: Pick<CityGrid, 'gridW' | 'gridH' | 'heights'>, x: number, z: number): number {
  if (!grid.heights) return 0;
  const gx = x / PLOT_SIZE + grid.gridW / 2, gz = z / PLOT_SIZE + grid.gridH / 2;
  const cx = Math.min(grid.gridW - 1, Math.max(0, Math.floor(gx))), cz = Math.min(grid.gridH - 1, Math.max(0, Math.floor(gz)));
  const fx = Math.min(1, Math.max(0, gx - cx)), fz = Math.min(1, Math.max(0, gz - cz));
  const h00 = cornerHeight(grid, cx, cz), h10 = cornerHeight(grid, cx + 1, cz);
  const h01 = cornerHeight(grid, cx, cz + 1), h11 = cornerHeight(grid, cx + 1, cz + 1);
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/** Flat terrace height of a parcel: the mean of its corner heights (rounded to 5 cm so neighbours line up). */
export function parcelTerrace(grid: Pick<CityGrid, 'gridW' | 'gridH' | 'heights'>, p: Pick<ParcelInfo, 'px' | 'pz' | 'w' | 'h'>): number {
  if (!grid.heights) return 0;
  let sum = 0, count = 0;
  for (let z = p.pz; z <= p.pz + p.h; z++) {
    for (let x = p.px; x <= p.px + p.w; x++) { sum += cornerHeight(grid, x, z); count++; }
  }
  return Math.round((sum / count) * 20) / 20;
}

/** Mean natural height of one plot (its four corners). */
export function plotHeight(grid: Pick<CityGrid, 'gridW' | 'gridH' | 'heights'>, px: number, pz: number): number {
  if (!grid.heights) return 0;
  return (cornerHeight(grid, px, pz) + cornerHeight(grid, px + 1, pz) + cornerHeight(grid, px, pz + 1) + cornerHeight(grid, px + 1, pz + 1)) / 4;
}

