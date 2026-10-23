// Build one 10 × 10-plot chunk (art §5.4): ground, roads and bridges, banks and quays, every parcel whose centre
// falls in the chunk (ambient development or vacant lot) and every company building whose footprint centre falls in
// it. Pure and deterministic: the same (layout, job) gives byte-identical arrays (tested). Runs in chunk.worker.ts
// and, as a fallback, on the main thread.
import { seasonOfMonth } from '../../assets/AssetFactory';
import { K_BEACH, K_OPEN, K_PARCEL, isRoadKind, isWaterKind } from '../layout/types';
import { CHUNK_PLOTS, type ChunkJob, type ChunkResult } from '../chunkProtocol';
import type { CityBuildContext } from './CityBuildContext';
import { ChunkWriter } from './ChunkWriter';
import { buildBeachPlot, buildOpenPlot, sideWalls, warpedOwn } from './ground';
import { buildCompany, buildParcel } from './lots';
import { buildRoadTile } from './RoadBuilder';

/** Parcel indices per chunk (by the plot under the parcel centre), cached per context. */
const parcelLists = new WeakMap<CityBuildContext, number[][]>();

export function parcelsByChunk(ctx: CityBuildContext): number[][] {
  let lists = parcelLists.get(ctx);
  if (lists) return lists;
  lists = Array.from({ length: ctx.chunkCols * ctx.chunkRows }, () => [] as number[]);
  for (const p of ctx.grid.parcels) lists[ctx.chunkOfRect(p.px, p.pz, p.w, p.h)].push(p.index);
  parcelLists.set(ctx, lists);
  return lists;
}

export function chunkCount(ctx: CityBuildContext): number {
  return ctx.chunkCols * ctx.chunkRows;
}

export function buildChunk(ctx: CityBuildContext, job: ChunkJob): ChunkResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  ctx.setCovers(job.covers);
  const w = new ChunkWriter();
  const month = ((((Math.round(job.month) - 1) % 12) + 12) % 12) + 1;
  const season = seasonOfMonth(month);
  const cx = job.chunk % ctx.chunkCols, cz = Math.floor(job.chunk / ctx.chunkCols);
  const px0 = cx * CHUNK_PLOTS, pz0 = cz * CHUNK_PLOTS;
  const px1 = Math.min(ctx.W, px0 + CHUNK_PLOTS), pz1 = Math.min(ctx.H, pz0 + CHUNK_PLOTS);

  // ---- plots that are not lots: roads, bridges, beaches, open land (water is drawn by the render core)
  for (let pz = pz0; pz < pz1; pz++) {
    for (let px = px0; px < px1; px++) {
      if (ctx.coveredBy(px, pz) >= 0) continue;
      const i = pz * ctx.W + px;
      const k = ctx.grid.kind[i];
      if (k === K_PARCEL || isWaterKind(k)) continue;
      if (isRoadKind(k)) {
        const tile = ctx.net.tile(px, pz);
        if (tile) buildRoadTile(ctx, w, tile, { district: ctx.grid.district[i], climate: ctx.grid.climate, season });
      } else if (k === K_BEACH) {
        buildBeachPlot(ctx, w, px, pz);
      } else if (k === K_OPEN) {
        buildOpenPlot(ctx, w, px, pz, season);
      } else {
        buildOpenPlot(ctx, w, px, pz, season);
      }
      sideWalls(ctx, w, px, pz, warpedOwn(ctx, px, pz));
    }
  }

  // ---- parcels owned by this chunk
  for (const index of parcelsByChunk(ctx)[job.chunk] ?? []) buildParcel(ctx, w, ctx.grid.parcels[index], month);

  // ---- company buildings owned by this chunk (sorted by id: deterministic order)
  for (const c of [...job.companies].sort((a, b) => a.id - b.id)) buildCompany(ctx, w, c, month);

  const done = w.finish();
  return {
    layoutKey: job.layoutKey, jobId: job.jobId, chunk: job.chunk,
    lod0: done.lod0, lod1: done.lod1, props: done.props, signs: w.signs, pools: done.pools, lampHeads: done.lampHeads,
    emitters: w.emitters, animated: w.animated, picks: w.picks, monthly: w.monthly,
    buildMs: typeof performance !== 'undefined' ? performance.now() - t0 : 0,
  };
}

/** Transferable buffers of a result (for postMessage). */
export function transferables(r: ChunkResult): Transferable[] {
  const out: Transferable[] = [];
  for (const a of [r.lod0, r.lod1]) out.push(a.position.buffer, a.normal.buffer, a.color.buffer, a.fuv.buffer, a.facade.buffer, a.extra.buffer, a.index.buffer);
  for (const k of Object.keys(r.props)) out.push(r.props[k].buffer);
  out.push(r.pools.buffer, r.lampHeads.buffer);
  return out.filter((b, i, all) => all.indexOf(b) === i) as Transferable[];
}
