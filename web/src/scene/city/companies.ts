// Company buildings: bridge BuildingVisualDto (+ CityActivityDto) → the chunk builder's CompanySpec. Placement fields
// are used as given (source 'bridge'/'auto' interim placements, or 'engine' plots once E3b lands): (px, pz) is the NW
// plot of the rotated footprint; rotation 0/90/180/270 puts the front S/E/N/W (E3a Placement). Interim placements
// carry no meaningful rotation, so square footprints face their best road instead (art §5.3).
import type { BuildingVisualDto, CityActivityDto } from '@/bridge/protocol';
import { stageForProgress, type Stage } from '../assets/AssetFactory';
import { R_ARTERIAL, R_COLLECTOR, R_HIGHWAY, R_LOCAL, isRoadKind } from './layout/types';
import type { CompanySpec } from './chunkProtocol';
import type { CityBuildContext } from './build/CityBuildContext';

/** Live activity per building id. */
export interface ActivityRow { utilization: number | null; unitsSold: number; transfersIn: number; transfersOut: number; revenue: number }

export function activityById(a: CityActivityDto | null | undefined): Map<number, ActivityRow> {
  const out = new Map<number, ActivityRow>();
  if (!a) return out;
  a.ids.forEach((id, i) => out.set(id, {
    utilization: a.utilization?.[i] ?? null, unitsSold: a.unitsSold?.[i] ?? 0, transfersIn: a.transfersIn?.[i] ?? 0,
    transfersOut: a.transfersOut?.[i] ?? 0, revenue: a.revenue?.[i] ?? 0,
  }));
  return out;
}

/** Utilization 0..1: producers report it; stores use the car-park fill rule (art §3.16). */
export function liveUtilization(row: ActivityRow | undefined): number {
  if (!row) return 0.6;
  if (row.utilization !== null && Number.isFinite(row.utilization)) return clamp01(row.utilization);
  if (row.unitsSold > 0) return clamp01(Math.log10(1 + row.unitsSold) / 6.5);
  return row.revenue > 0 ? 0.5 : 0.35;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

const ROAD_SCORE: Record<number, number> = { [R_ARTERIAL]: 3, [R_COLLECTOR]: 2, [R_LOCAL]: 2, [R_HIGHWAY]: 1 };

/**
 * Facing of a footprint from road adjacency (art §5.3): score the road plots along each side (arterial 3, street 2,
 * highway 1), argmax with ties S, E, N, W; with no adjacent road, the side nearest to a road.
 */
export function facingFor(ctx: CityBuildContext, px: number, pz: number, w: number, h: number): 0 | 1 | 2 | 3 {
  const score = [0, 0, 0, 0];
  const at = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= ctx.W || z >= ctx.H) return 0;
    const i = z * ctx.W + x;
    return isRoadKind(ctx.grid.kind[i]) ? ROAD_SCORE[ctx.grid.road[i]] ?? 2 : 0;
  };
  for (let x = px; x < px + w; x++) { score[0] += at(x, pz + h); score[2] += at(x, pz - 1); }
  for (let z = pz; z < pz + h; z++) { score[1] += at(px + w, z); score[3] += at(px - 1, z); }
  let best = 0;
  for (let k = 1; k < 4; k++) if (score[k] > score[best]) best = k;
  if (score[best] > 0) return best as 0 | 1 | 2 | 3;
  // No frontage: the side whose outward ray meets a road first.
  const dist = [Infinity, Infinity, Infinity, Infinity];
  const probe = (k: number, x: number, z: number, dx: number, dz: number) => {
    for (let s = 1; s < 40; s++) {
      const xx = x + dx * s, zz = z + dz * s;
      if (xx < 0 || zz < 0 || xx >= ctx.W || zz >= ctx.H) return;
      if (isRoadKind(ctx.grid.kind[zz * ctx.W + xx])) { dist[k] = Math.min(dist[k], s); return; }
    }
  };
  for (let x = px; x < px + w; x++) { probe(0, x, pz + h - 1, 0, 1); probe(2, x, pz, 0, -1); }
  for (let z = pz; z < pz + h; z++) { probe(1, px + w - 1, z, 1, 0); probe(3, px, z, -1, 0); }
  for (let k = 1; k < 4; k++) if (dist[k] < dist[best]) best = k;
  return best as 0 | 1 | 2 | 3;
}

/** Steps of construction progress the renderer distinguishes (a chunk rebuilds at most this often per project). */
export const PROGRESS_STEPS = 20;

/** Whole months of a construction schedule (started → completesAt), at least 1. */
export function constructionMonths(c: { started: { year: number; month: number }; completesAt: { year: number; month: number } }): number {
  return Math.max(1, (c.completesAt.year - c.started.year) * 12 + (c.completesAt.month - c.started.month));
}

/**
 * Construction stage and progress of a building (E3b: status `underConstruction` + `construction.progress`, which
 * the engine advances at each month close). `monthFraction` (0..1, the game clock inside the current month)
 * interpolates the days in between: one month of a schedule of N months is 1/N of the progress. Progress stays below
 * 1 until the engine reports the building complete, and is quantised to PROGRESS_STEPS so chunk rebuilds stay rare.
 * Without construction data, `underConstruction` draws mid-build.
 */
export function stageOf(dto: BuildingVisualDto, monthFraction = 0): { stage: Stage; progress: number } {
  if (dto.status === 'closed') return { stage: 'closed', progress: 1 };
  const c = dto.construction;
  const p = c?.progress;
  if (c && p !== undefined && Number.isFinite(p) && p < 1) {
    const f = Math.min(1, Math.max(0, Number.isFinite(monthFraction) ? monthFraction : 0));
    const live = Math.min(0.999, Math.max(0, p) + f / constructionMonths(c));
    const q = Math.max(Math.max(0, p), Math.floor(live * PROGRESS_STEPS) / PROGRESS_STEPS);
    return { stage: stageForProgress(q), progress: q };
  }
  if (dto.status === 'underConstruction') return { stage: 'structure', progress: 0.5 };
  return { stage: 'complete', progress: 1 };
}

/** Quantised utilization (steps of 0.25) so ordinary swings never rebuild a chunk; live values go to emitters. */
export function quantiseUtilization(u: number): number {
  return Math.round(clamp01(u) * 4) / 4;
}

export function specFromVisual(ctx: CityBuildContext, dto: BuildingVisualDto, activity: ActivityRow | undefined, monthFraction = 0): CompanySpec | null {
  const pl = dto.placement;
  if (!pl) return null;
  const rot = ((((pl.rotation ?? 0) / 90) % 4) + 4) % 4;
  let turns = (Math.round(rot) & 3) as 0 | 1 | 2 | 3;
  const fw = Math.max(1, dto.footprintW | 0), fh = Math.max(1, dto.footprintH | 0);
  const w = turns % 2 === 0 ? fw : fh, h = turns % 2 === 0 ? fh : fw;
  if (pl.source !== 'engine' && w === h) turns = facingFor(ctx, pl.px, pl.pz, w, h);
  const { stage, progress } = stageOf(dto, monthFraction);
  const util = liveUtilization(activity);
  const spec: CompanySpec = {
    id: dto.id, typeId: dto.typeId, category: dto.category, owner: Math.min(7, Math.max(0, dto.colorIndex | 0)),
    companyId: String(dto.ownerId), level: (Math.min(3, Math.max(1, dto.level | 0)) as 1 | 2 | 3), stage, progress,
    px: pl.px, pz: pl.pz, w, h, turns, utilization: quantiseUtilization(util), products: [...(dto.products ?? [])],
  };
  if (activity) {
    spec.activity = {
      transfersIn: activity.transfersIn, transfersOut: activity.transfersOut, unitsSold: activity.unitsSold,
      shipAtBerth: activity.transfersIn + activity.transfersOut > 0,
    };
    // Quantise activity like utilization: log buckets, so a chunk only rebuilds when the dock picture changes.
    const q = (v: number) => (v > 0 ? Math.round(10 ** (Math.round(Math.log10(1 + v) * 2) / 2)) : 0);
    spec.activity.transfersIn = q(activity.transfersIn);
    spec.activity.transfersOut = q(activity.transfersOut);
    spec.activity.unitsSold = q(activity.unitsSold);
  }
  return spec;
}
