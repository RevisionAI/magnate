import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildPickIndex, pick, pickGround, PLOT_M, rayBox, type PickEntry } from '../Picking';
import { footprintOfBox } from '../CitySource';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random city of non-overlapping buildings on a w × h grid. */
function randomCity(w: number, h: number, count: number, seed: number): PickEntry[] {
  const r = rng(seed);
  const taken = new Uint8Array(w * h);
  const out: PickEntry[] = [];
  const halfW = (w * PLOT_M) / 2, halfH = (h * PLOT_M) / 2;
  for (let tries = 0; out.length < count && tries < count * 50; tries++) {
    const fw = 1 + Math.floor(r() * 4), fh = 1 + Math.floor(r() * 4);
    const px = Math.floor(r() * (w - fw)), pz = Math.floor(r() * (h - fh));
    let free = true;
    for (let z = pz; z < pz + fh && free; z++) for (let x = px; x < px + fw && free; x++) free = !taken[z * w + x];
    if (!free) continue;
    for (let z = pz; z < pz + fh; z++) for (let x = px; x < px + fw; x++) taken[z * w + x] = 1;
    const inset = 1 + r() * 3, height = 6 + r() * 140;
    const box = [px * PLOT_M - halfW + inset, 0, pz * PLOT_M - halfH + inset, (px + fw) * PLOT_M - halfW - inset, height, (pz + fh) * PLOT_M - halfH - inset];
    out.push({ id: 1000 + out.length, px, pz, w: fw, h: fh, box });
  }
  return out;
}

function bruteForce(ray: THREE.Ray, entries: PickEntry[]): number | null {
  let best = Infinity, id: number | null = null;
  const o = ray.origin, d = ray.direction;
  const tGround = d.y < 0 ? -o.y / d.y : Infinity;
  for (const e of entries) {
    const t = rayBox(o.x, o.y, o.z, 1 / d.x, 1 / d.y, 1 / d.z, e.box, 0);
    if (t < best) { best = t; id = e.id; }
  }
  return best <= tGround ? id : null;
}

describe('Picking (grid DDA)', () => {
  it('agrees with a brute-force ray/box test on 20,000 random rays', () => {
    const W = 40, H = 30;
    const entries = randomCity(W, H, 120, 7);
    const idx = buildPickIndex(W, H, entries);
    const r = rng(42);
    let buildingHits = 0;
    const mismatches: string[] = [];
    for (let i = 0; i < 20000; i++) {
      // Camera-like rays: from above the city looking down at 25–80° below the horizon.
      const origin = new THREE.Vector3((r() - 0.5) * W * PLOT_M * 1.6, 60 + r() * 2400, (r() - 0.5) * H * PLOT_M * 1.6);
      const target = new THREE.Vector3((r() - 0.5) * W * PLOT_M, 0, (r() - 0.5) * H * PLOT_M);
      const ray = new THREE.Ray(origin, target.sub(origin).normalize());
      const expected = bruteForce(ray, entries);
      const got = pick(ray, idx);
      const gotId = got?.kind === 'building' ? got.id : null;
      if (gotId !== expected && mismatches.length < 5) mismatches.push(`ray ${i}: got ${gotId}, brute force ${expected}`);
      if (gotId !== null) buildingHits++;
    }
    expect(mismatches).toEqual([]);
    expect(buildingHits).toBeGreaterThan(2000);
  }, 30_000);

  it('returns the ground plot when no building is hit', () => {
    const idx = buildPickIndex(10, 10, []);
    const ray = new THREE.Ray(new THREE.Vector3(5, 300, 5), new THREE.Vector3(0, -1, 0));
    const res = pick(ray, idx);
    expect(res?.kind).toBe('plot');
    if (res?.kind === 'plot') expect([res.px, res.pz]).toEqual([5, 5]);
  });

  it('returns null off the city and for rays above the horizon', () => {
    const idx = buildPickIndex(10, 10, []);
    expect(pick(new THREE.Ray(new THREE.Vector3(5000, 100, 0), new THREE.Vector3(0, -1, 0)), idx)).toBeNull();
    expect(pick(new THREE.Ray(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, 1, 0)), idx)).toBeNull();
  });

  it('builds the cell map from footprints and keeps the tallest height', () => {
    const idx = buildPickIndex(6, 4, [
      { id: 7, px: 1, pz: 1, w: 2, h: 2, box: [0, 0, 0, 1, 30, 1] },
      { id: 9, px: 4, pz: 0, w: 1, h: 1, box: [0, 0, 0, 1, 80, 1] },
    ]);
    expect(idx.ids).toEqual([7, 9]);
    expect(idx.cellBuilding[1 * 6 + 1]).toBe(0);
    expect(idx.cellBuilding[2 * 6 + 2]).toBe(0);
    expect(idx.cellBuilding[0 * 6 + 4]).toBe(1);
    expect(idx.cellBuilding[0]).toBe(-1);
    expect(idx.maxHeight).toBeGreaterThanOrEqual(80);
  });

  it('maps ground hits to continuous grid coordinates', () => {
    const g = pickGround(new THREE.Ray(new THREE.Vector3(-PLOT_M * 2.5, 100, 0), new THREE.Vector3(0, -1, 0)), 10, 10);
    expect(g?.px).toBe(2);
    expect(g?.gx).toBeCloseTo(2.5);
  });

  it('derives a footprint from a world box', () => {
    // A 2×3-plot lot at plot (3, 4) of a 10 × 10 grid, flush with the plot edges.
    const half = 5 * PLOT_M;
    const box = [3 * PLOT_M - half, 0, 4 * PLOT_M - half, 5 * PLOT_M - half, 20, 7 * PLOT_M - half];
    expect(footprintOfBox(box, 10, 10)).toEqual({ px: 3, pz: 4, w: 2, h: 3 });
  });
});
