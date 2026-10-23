import { describe, expect, it } from 'vitest';
import { decodeLayout, terrainHeightAt, parcelTerrace, cornerHeight } from '../layout/decode';
import { K_BRIDGE, K_OPEN, K_PARCEL, K_ROAD, K_SEA, R_NONE, SHORE_QUAY, isRoadKind, isWaterKind } from '../layout/types';
import { PLOT_SIZE } from '../../units';
import { loadLayout } from './fixtures';

describe('decodeLayout', () => {
  it('decodes the per-plot strings by index (i = pz·gridW + px)', () => {
    const wire = loadLayout('portbay');
    const g = decodeLayout(wire);
    expect(g.gridW * g.gridH).toBe(wire.plots!.kinds.length);
    const codes: Record<string, number> = { p: K_PARCEL, r: K_ROAD, b: K_BRIDGE, s: K_SEA, o: K_OPEN };
    for (let i = 0; i < g.kind.length; i += 7) {
      const c = wire.plots!.kinds[i];
      if (codes[c] !== undefined) expect(g.kind[i]).toBe(codes[c]);
      expect(g.road[i]).toBe(isRoadKind(g.kind[i]) ? Number(wire.plots!.roads[i]) : R_NONE);
    }
    expect(g.climate).toBe('warm');
    expect(g.heights).toBeNull();
  });

  it('maps every parcel onto its plots and every road plot carries a class and lanes', () => {
    const g = decodeLayout(loadLayout('portbay'));
    for (const p of g.parcels) {
      for (let z = p.pz; z < p.pz + p.h; z++) for (let x = p.px; x < p.px + p.w; x++) {
        expect(g.parcelAt[z * g.gridW + x]).toBe(p.index);
        expect(g.kind[z * g.gridW + x]).toBe(K_PARCEL);
      }
      expect(g.parcelById.get(p.id)).toBe(p);
      expect([0, 1, 2, 3]).toContain(p.facing);
    }
    for (let i = 0; i < g.kind.length; i++) {
      if (!isRoadKind(g.kind[i])) continue;
      expect(g.road[i]).toBeGreaterThan(0);
      expect(g.lanes[i]).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the shore treatment of the water rects (Portbay has quays)', () => {
    const g = decodeLayout(loadLayout('portbay'));
    let quays = 0, water = 0;
    for (let i = 0; i < g.kind.length; i++) {
      if (isWaterKind(g.kind[i])) water++;
      if (g.shore[i] === SHORE_QUAY) quays++;
    }
    expect(water).toBeGreaterThan(100);
    expect(quays).toBeGreaterThan(0);
  });

  it('derives the grid from roads, parcels and water when the plots block is missing (older engines)', () => {
    const wire = loadLayout('portbay');
    const full = decodeLayout(wire);
    delete wire.plots;
    const derived = decodeLayout(wire);
    let same = 0;
    for (let i = 0; i < full.kind.length; i++) {
      // Roads, parcels and water agree exactly; beaches/open land become open land.
      const a = full.kind[i], b = derived.kind[i];
      if (isRoadKind(a) || a === K_PARCEL || isWaterKind(a)) { expect(b).toBe(a); same++; } else expect(b).toBe(K_OPEN);
    }
    expect(same).toBeGreaterThan(full.kind.length * 0.8);
  });

  it('reads Hilltown terrain: corner heights, bilinear ground and flat parcel terraces', () => {
    const g = decodeLayout(loadLayout('hilltown'));
    expect(g.heights).not.toBeNull();
    expect(g.heights!.length).toBe((g.gridW + 1) * (g.gridH + 1));
    expect(g.slope).not.toBeNull();
    const max = Math.max(...g.heights!);
    expect(max).toBeGreaterThan(20);
    // Ground at a plot corner equals the corner height; mid-edge is the average of the two corners.
    const cx = 20, cz = 20;
    const x = (cx - g.gridW / 2) * PLOT_SIZE, z = (cz - g.gridH / 2) * PLOT_SIZE;
    expect(terrainHeightAt(g, x, z)).toBeCloseTo(cornerHeight(g, cx, cz), 4);
    expect(terrainHeightAt(g, x + PLOT_SIZE / 2, z)).toBeCloseTo((cornerHeight(g, cx, cz) + cornerHeight(g, cx + 1, cz)) / 2, 4);
    // A terrace lies within its corners' range.
    for (const p of g.parcels.slice(0, 60)) {
      const t = parcelTerrace(g, p);
      let lo = Infinity, hi = -Infinity;
      for (let zz = p.pz; zz <= p.pz + p.h; zz++) for (let xx = p.px; xx <= p.px + p.w; xx++) { lo = Math.min(lo, cornerHeight(g, xx, zz)); hi = Math.max(hi, cornerHeight(g, xx, zz)); }
      expect(t).toBeGreaterThanOrEqual(lo - 0.06);
      expect(t).toBeLessThanOrEqual(hi + 0.06);
    }
  });

  it('rejects an empty grid', () => {
    const wire = loadLayout('portbay');
    wire.gridW = 0;
    expect(() => decodeLayout(wire)).toThrow(/invalid grid/);
  });
});
