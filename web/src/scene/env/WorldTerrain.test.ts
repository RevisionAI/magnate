import { describe, expect, it } from 'vitest';
import { PLOT_SIZE } from '../units';
import { WATER_NONE, WATER_RIVER, WATER_SEA, cityRect, riverMouths, seaEdges, type SceneWorld } from './World';
import { TerrainModel, WATER_LEVEL } from './Terrain';
import { chamferDistance } from './Water';

/** 20×20 city: sea along the north edge (3 rows), a 2-plot river from the sea to the south edge at x = 12–13. */
function world(): SceneWorld {
  const W = 20, H = 20;
  const water = new Uint8Array(W * H);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (z < 3) water[z * W + x] = WATER_SEA;
      else if (x === 12 || x === 13) water[z * W + x] = WATER_RIVER;
    }
  }
  return { cityId: 'test', gridW: W, gridH: H, seed: 42, climate: 'temperate', water, reliefM: 40, highways: [{ edge: 'W', at: 10 }], population: 100000 };
}

describe('SceneWorld helpers', () => {
  it('city rectangle is centred on the origin at 24 m plots', () => {
    expect(cityRect({ gridW: 80, gridH: 60 })).toEqual({ minX: -960, maxX: 960, minZ: -720, maxZ: 720 });
    expect(PLOT_SIZE).toBe(24);
  });
  it('detects sea edges and river mouths', () => {
    const w = world();
    expect(seaEdges(w)).toEqual(['N']);
    expect(riverMouths(w)).toEqual([{ edge: 'S', from: 12, to: 13 }]);
    expect(seaEdges({ ...w, water: null })).toEqual([]);
  });
});

describe('TerrainModel', () => {
  const t = new TerrainModel(world());
  const r = t.rect;

  it('is flat at y = 0 on city land and below the waterline under city water', () => {
    expect(t.heightAt(-100, 100)).toBe(0);
    expect(t.heightAt(r.minX + 12.5 * PLOT_SIZE, 0)).toBeLessThan(WATER_LEVEL);          // river plot
    expect(t.heightAt(0, r.minZ + PLOT_SIZE)).toBeLessThan(WATER_LEVEL);                  // sea plot
  });

  it('continues the sea beyond the coastal edge and keeps dry land elsewhere', () => {
    expect(t.isLand(0, r.minZ - 800)).toBe(false);                                         // open sea, north
    expect(t.isLand(r.minX - 900, 300)).toBe(true);                                        // west hinterland
    expect(t.seaAt(0, r.maxZ + 600)).toBe(0);                                              // south is inland
  });

  it('flattens the ground next to the city so the urban edge meets the terrain', () => {
    expect(Math.abs(t.heightAt(r.minX - 20, 200))).toBeLessThan(0.5);
    expect(Math.abs(t.heightAt(300, r.maxZ + 30))).toBeLessThan(0.5);
  });

  it('carves the river channel beyond the south edge', () => {
    const x = r.minX + 13 * PLOT_SIZE;                                                     // centre of the 2-plot river
    expect(t.isLand(x, r.maxZ + 40)).toBe(false);
  });

  it('is deterministic for a seed', () => {
    const a = new TerrainModel(world()), b = new TerrainModel(world());
    for (const [x, z] of [[-3000, 2500], [4100, -1800], [1200, 3900]]) expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
  });

  it('grades the highway corridor', () => {
    const z = (10 + 0.5) * PLOT_SIZE - (20 * PLOT_SIZE) / 2;
    expect(t.highwayAt(r.minX - 500, z)).toBe(1);
    expect(Math.abs(t.heightAt(r.minX - 500, z))).toBeLessThan(0.01);
  });
});

describe('chamferDistance', () => {
  it('measures texel distance to the nearest land texel', () => {
    const w = 7, h = 1;
    const land = new Uint8Array([1, 0, 0, 0, 0, 0, 1]);
    expect(Array.from(chamferDistance(land, w, h))).toEqual([0, 1, 2, 3, 2, 1, 0]);
    const d = chamferDistance(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0]), 3, 3);
    expect(d[8]).toBeCloseTo(2 * Math.SQRT2, 6);
  });
});

describe('WATER_NONE', () => {
  it('is zero so a fresh mask means dry land', () => {
    expect(WATER_NONE).toBe(0);
  });
});
