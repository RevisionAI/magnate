import { describe, expect, it } from 'vitest';
import { CityBuildContext } from '../build/CityBuildContext';
import { buildChunk, chunkCount, parcelsByChunk } from '../build/buildChunk';
import type { ChunkJob, ChunkResult, CompanySpec } from '../chunkProtocol';
import { CHUNK_PLOTS, PROP_STRIDE } from '../chunkProtocol';
import { K_PARCEL } from '../layout/types';
import { loadLayout } from './fixtures';

function job(chunk: number, companies: CompanySpec[] = [], month = 6): ChunkJob {
  return { layoutKey: 'k', jobId: 1, chunk, month, companies, covers: companies.map((c) => ({ id: c.id, px: c.px, pz: c.pz, w: c.w, h: c.h })) };
}

function same(a: ChunkResult, b: ChunkResult): boolean {
  const eq = (x: ArrayLike<number>, y: ArrayLike<number>) => x.length === y.length && Array.prototype.every.call(x, (v: number, i: number) => Object.is(v, y[i]));
  for (const k of ['position', 'normal', 'color', 'fuv', 'facade', 'extra', 'index'] as const) {
    if (!eq(a.lod0[k], b.lod0[k]) || !eq(a.lod1[k], b.lod1[k])) return false;
  }
  return JSON.stringify(Object.keys(a.props)) === JSON.stringify(Object.keys(b.props)) && Object.keys(a.props).every((k) => eq(a.props[k], b.props[k]))
    && JSON.stringify(a.picks) === JSON.stringify(b.picks) && JSON.stringify(a.emitters) === JSON.stringify(b.emitters);
}

/** A company on the first vacant parcel of `district`-like predicate that fits w × h. */
function companyOn(ctx: CityBuildContext, typeId: string, category: string, w: number, h: number, extra: Partial<CompanySpec> = {}): CompanySpec {
  const p = ctx.grid.parcels.find((q) => q.vacant && !q.landmark && q.depositId === null && q.w >= w && q.h >= h && q.zone !== 'agricultural')!;
  return {
    id: 7, typeId, category, owner: 0, companyId: '1', level: 1, stage: 'complete', progress: 1, px: p.px, pz: p.pz, w, h, turns: p.facing,
    utilization: 0.75, products: [], ...extra,
  };
}

describe('buildChunk', () => {
  const ctx = new CityBuildContext(loadLayout('portbay'));
  const hill = new CityBuildContext(loadLayout('hilltown'));

  it('is deterministic: the same (layout, job) gives byte-identical output', () => {
    const c = ctx.chunkOfPlot(Math.floor(ctx.grid.cbd.x), Math.floor(ctx.grid.cbd.z));
    const a = buildChunk(ctx, job(c));
    const b = buildChunk(new CityBuildContext(loadLayout('portbay')), job(c));
    expect(a.lod0.triangleCount).toBeGreaterThan(1000);
    expect(same(a, b)).toBe(true);
  });

  it('covers the city: every parcel belongs to exactly one chunk; every chunk builds finite geometry within budget', () => {
    const lists = parcelsByChunk(ctx);
    expect(lists.flat().length).toBe(ctx.grid.parcels.length);
    expect(new Set(lists.flat()).size).toBe(ctx.grid.parcels.length);
    let total0 = 0, total1 = 0;
    for (let c = 0; c < chunkCount(ctx); c++) {
      const r = buildChunk(ctx, job(c));
      total0 += r.lod0.triangleCount;
      total1 += r.lod1.triangleCount;
      expect(r.lod1.triangleCount).toBeLessThanOrEqual(r.lod0.triangleCount);
      expect(r.lod0.position.every((v) => Number.isFinite(v))).toBe(true);
      for (const k of Object.keys(r.props)) expect(r.props[k].length % PROP_STRIDE).toBe(0);
      // 4-byte aligned attribute buffers (WebGL vertex fetch).
      expect(r.lod0.color.byteLength % 4).toBe(0);
    }
    // Art D7 / §5.4: the whole Portbay LOD0 stays well inside the 700k-triangle frame budget.
    expect(total0).toBeLessThan(600_000);
    expect(total1).toBeLessThan(total0 * 0.6);
  }, 60_000);

  it('ambient lots under a company footprint are suppressed and the company gets a pick box', () => {
    const co = companyOn(ctx, 'supermarket', 'supermarket', 2, 2);
    const chunk = ctx.chunkOfRect(co.px, co.pz, co.w, co.h);
    const before = buildChunk(ctx, job(chunk));
    const after = buildChunk(ctx, job(chunk, [co]));
    const pid = ctx.grid.parcels[ctx.grid.parcelAt[co.pz * ctx.W + co.px]].id;
    expect(before.picks.some((p) => p.kind === 'ambient' && p.id === pid)).toBe(true);
    expect(after.picks.some((p) => p.kind === 'ambient' && p.id === pid)).toBe(false);
    const pick = after.picks.find((p) => p.kind === 'company' && p.id === co.id)!;
    expect(pick).toBeDefined();
    const [x0, , z0, x1, y1, z1] = pick.box;
    expect(y1).toBeGreaterThan(4);
    // The box lies on the footprint (± a few metres of awnings).
    expect(x0).toBeGreaterThanOrEqual(ctx.x0(co.px) - 3);
    expect(x1).toBeLessThanOrEqual(ctx.x0(co.px + co.w) + 3);
    expect(z0).toBeGreaterThanOrEqual(ctx.z0(co.pz) - 3);
    expect(z1).toBeLessThanOrEqual(ctx.z0(co.pz + co.h) + 3);
    // Reset the shared context's covers for the other tests.
    ctx.setCovers([]);
  });

  it('builds construction stages and closed buildings', () => {
    for (const stage of ['foundation', 'structure', 'finishing', 'closed'] as const) {
      const co = companyOn(ctx, 'supermarket', 'supermarket', 2, 2, { stage, progress: stage === 'closed' ? 1 : stage === 'foundation' ? 0.1 : stage === 'structure' ? 0.5 : 0.9 });
      const r = buildChunk(ctx, job(ctx.chunkOfRect(co.px, co.pz, co.w, co.h), [co]));
      expect(r.picks.some((p) => p.kind === 'company' && p.id === co.id)).toBe(true);
      expect(r.lod0.triangleCount).toBeGreaterThan(0);
    }
    ctx.setCovers([]);
  });

  it('factories emit smoke at the company terrace and carry the building id', () => {
    const co = companyOn(ctx, 'factory_small', 'factory', 3, 3);
    const r = buildChunk(ctx, job(ctx.chunkOfRect(co.px, co.pz, co.w, co.h), [co]));
    const mine = r.emitters.filter((e) => e.buildingId === co.id);
    expect(mine.length).toBeGreaterThan(0);
    for (const e of mine) expect(e.owner).toBe(0);
    ctx.setCovers([]);
  });

  it('Hilltown: terraces lift lots off y = 0 and slopes get real normals (flank shading)', () => {
    let maxY = -Infinity, tilted = 0;
    for (let c = 0; c < chunkCount(hill); c++) {
      const r = buildChunk(hill, job(c));
      const P = r.lod0.position, N = r.lod0.normal;
      for (let v = 0; v < r.lod0.vertexCount; v++) {
        maxY = Math.max(maxY, P[v * 3 + 1]);
        if (N[v * 4 + 1] > 64 && N[v * 4 + 1] < 126) tilted++;
      }
    }
    expect(maxY).toBeGreaterThan(30);
    expect(tilted).toBeGreaterThan(500);
  });

  it('chunks are 10 × 10 plots and the month only matters for crop chunks', () => {
    expect(CHUNK_PLOTS).toBe(10);
    expect(hill.chunkCols).toBe(Math.ceil(hill.W / 10));
    let monthly = 0, nonMonthly = 0;
    for (let c = 0; c < chunkCount(hill); c++) (buildChunk(hill, job(c)).monthly ? monthly++ : nonMonthly++);
    expect(monthly).toBeGreaterThan(0);
    expect(nonMonthly).toBeGreaterThan(0);
    // Parcels exist only on parcel plots.
    for (const p of hill.grid.parcels) expect(hill.grid.kind[p.pz * hill.W + p.px]).toBe(K_PARCEL);
  });
});
