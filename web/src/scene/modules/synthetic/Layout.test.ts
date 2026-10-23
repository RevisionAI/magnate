import { describe, expect, it } from 'vitest';
import { WATER_NONE, WATER_SEA } from '../../env/World';
import { KIND_LOT, KIND_PARK, KIND_RESERVED, KIND_ROAD, KIND_SHORE, KIND_WATER, layoutSyntheticCity } from './Layout';
import { buildSyntheticCity } from './Builder';

const opts = { gridW: 40, gridH: 36, seed: 20261001, coastal: true, river: true, reserveShare: 0.12 };

describe('synthetic city layout', () => {
  it('is deterministic for a seed', () => {
    const a = layoutSyntheticCity(opts), b = layoutSyntheticCity(opts);
    expect(Array.from(a.kind)).toEqual(Array.from(b.kind));
    expect(a.lots).toEqual(b.lots);
    expect(a.highways).toEqual(b.highways);
    const c = layoutSyntheticCity({ ...opts, seed: 7 });
    expect(Array.from(c.kind)).not.toEqual(Array.from(a.kind));
  });

  it('puts the sea on the north edge by default and keeps lots off roads and water', () => {
    const l = layoutSyntheticCity(opts);
    const W = l.gridW;
    expect(l.water[0]).toBe(WATER_SEA);                         // north-west corner plot
    expect(l.water[(l.gridH - 1) * W]).not.toBe(WATER_SEA);     // south edge is land/river
    for (const lot of l.lots) {
      expect(lot.px).toBeGreaterThanOrEqual(0);
      expect(lot.pz).toBeGreaterThanOrEqual(0);
      expect(lot.px + lot.w).toBeLessThanOrEqual(W);
      expect(lot.pz + lot.h).toBeLessThanOrEqual(l.gridH);
      for (let dz = 0; dz < lot.h; dz++) {
        for (let dx = 0; dx < lot.w; dx++) {
          const i = (lot.pz + dz) * W + lot.px + dx;
          if (lot.use !== 'park') {
            expect(l.kind[i]).toBe(KIND_LOT);
            expect(l.lotOf[i]).toBe(lot.id);
          }
          expect(l.water[i]).toBe(WATER_NONE);
        }
      }
    }
  });

  it('has a connected road grid with arterials, a shore strip and reserved development land', () => {
    const l = layoutSyntheticCity(opts);
    const count = (k: number) => l.kind.reduce((n, v) => n + (v === k ? 1 : 0), 0);
    expect(count(KIND_ROAD)).toBeGreaterThan(l.gridW * 4);
    expect(count(KIND_WATER)).toBeGreaterThan(l.gridW * 3);
    expect(count(KIND_SHORE)).toBeGreaterThan(0);
    expect(count(KIND_PARK)).toBeGreaterThanOrEqual(0);
    expect(count(KIND_RESERVED)).toBe(l.reserved.length);
    expect(l.reserved.length).toBeGreaterThan(9);
    expect(l.road.some((r) => r === 2)).toBe(true);           // arterials
    expect(l.highways.length).toBeGreaterThan(0);
  });

  it('builds chunk geometry within the art budgets and with aligned attributes', () => {
    const l = layoutSyntheticCity(opts);
    const city = buildSyntheticCity(l);
    expect(city.chunks.length).toBe(16);                       // 4 × 4 chunks of 10 × 10 plots
    expect(city.buildings).toBeGreaterThan(200);
    expect(city.triangles).toBeLessThan(250_000);
    expect(city.lamps.length).toBeGreaterThan(100);
    expect(city.landUse.length).toBe(l.gridW * l.gridH);
    for (const { arrays } of city.chunks) {
      expect(arrays.position.length).toBe(arrays.vertexCount * 3);
      expect(arrays.color.length).toBe(arrays.vertexCount * 4);
      expect(arrays.extra.length).toBe(arrays.vertexCount * 4);
      for (const a of [arrays.position, arrays.normal, arrays.color, arrays.fuv, arrays.facade, arrays.extra]) {
        const itemSize = a.length / arrays.vertexCount;
        expect((itemSize * a.BYTES_PER_ELEMENT) % 4).toBe(0);
      }
    }
    // Deterministic geometry.
    const again = buildSyntheticCity(layoutSyntheticCity(opts));
    expect(again.triangles).toBe(city.triangles);
    expect(Array.from(again.chunks[5].arrays.position.slice(0, 300))).toEqual(Array.from(city.chunks[5].arrays.position.slice(0, 300)));
  });
});
