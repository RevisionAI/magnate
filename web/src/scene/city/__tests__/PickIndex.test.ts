import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PickIndex } from '../PickIndex';
import { mulberry32 } from '../../env/rng';

describe('PickIndex (grid DDA, art §5.12)', () => {
  const W = 30, H = 24, P = 24;
  const surface = new Float32Array(W * H);
  const parcel = new Int32Array(W * H).fill(-1);
  for (let i = 0; i < surface.length; i++) { surface[i] = (i % 7) * 0.5; parcel[i] = i % 3 === 0 ? i : -1; }
  const index = new PickIndex(W, H, surface, parcel);
  const rnd = mulberry32(7);
  const boxes: Array<{ id: number; box: THREE.Box3; plots: Array<[number, number]> }> = [];
  for (let id = 1; boxes.length < 90; id++) {
    const px = Math.floor(rnd() * (W - 3)), pz = Math.floor(rnd() * (H - 3)), w = 1 + Math.floor(rnd() * 3), h = 1 + Math.floor(rnd() * 3);
    if (boxes.some((b) => b.plots.some(([x, z]) => x >= px && x < px + w && z >= pz && z < pz + h))) continue;
    const x0 = (px - W / 2) * P, z0 = (pz - H / 2) * P;
    let floor = 0;
    for (let z = pz; z < pz + h; z++) for (let x = px; x < px + w; x++) floor = Math.max(floor, surface[z * W + x]);
    const box = new THREE.Box3(new THREE.Vector3(x0 + 2, floor, z0 + 2), new THREE.Vector3(x0 + w * P - 2, 5 + rnd() * 90, z0 + h * P - 2));
    const plots: Array<[number, number]> = [];
    for (let z = pz; z < pz + h; z++) for (let x = px; x < px + w; x++) plots.push([x, z]);
    boxes.push({ id, box, plots });
    index.set({ kind: id % 2 ? 'company' : 'ambient', id, box: [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z] }, plots);
  }

  it('agrees with brute force on random rays', () => {
    const ray = new THREE.Ray();
    const hit = new THREE.Vector3();
    let agree = 0, buildingHits = 0;
    for (let k = 0; k < 4000; k++) {
      ray.origin.set((rnd() - 0.5) * 1400, 200 + rnd() * 900, (rnd() - 0.5) * 1100);
      const target = new THREE.Vector3((rnd() - 0.5) * W * P, 0, (rnd() - 0.5) * H * P);
      ray.direction.copy(target).sub(ray.origin).normalize();
      let best = Infinity, bestId = -1;
      for (const b of boxes) if (ray.intersectBox(b.box, hit)) { const d = hit.distanceTo(ray.origin); if (d < best) { best = d; bestId = b.id; } }
      // Ground, exact brute force: over every plot column, the earliest t inside it where the ray is at or below its
      // surface (entering below it = hitting the retaining wall).
      let groundT = Infinity;
      for (let pz = 0; pz < H; pz++) for (let px = 0; px < W; px++) {
        const x0 = (px - W / 2) * P, z0 = (pz - H / 2) * P;
        let ta = 0, tb = Infinity;
        for (const [o, d, lo, hi] of [[ray.origin.x, ray.direction.x, x0, x0 + P], [ray.origin.z, ray.direction.z, z0, z0 + P]]) {
          if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) { ta = Infinity; } continue; }
          const a = (lo - o) / d, c = (hi - o) / d;
          ta = Math.max(ta, Math.min(a, c));
          tb = Math.min(tb, Math.max(a, c));
        }
        if (!(ta <= tb)) continue;
        const sY = surface[pz * W + px];
        const t = ray.origin.y + ray.direction.y * ta <= sY ? ta : (sY - ray.origin.y) / ray.direction.y;
        if (t >= ta && t <= tb && t < groundT) groundT = t;
      }
      const r = index.pick(ray);
      if (bestId >= 0 && best < groundT) {
        buildingHits++;
        expect(r && r.kind !== 'plot' ? (r.kind === 'building' ? r.id : r.parcelId) : null).toBe(bestId);
      } else if (Number.isFinite(groundT)) {
        expect(r?.kind).toBe('plot');
        expect(r!.point.distanceTo(ray.origin)).toBeCloseTo(groundT, 3);
      }
      agree++;
    }
    expect(agree).toBe(4000);
    expect(buildingHits).toBeGreaterThan(300);
  });

  it('reports parcel ids on ground hits, and removal clears a lot', () => {
    const b = boxes[0];
    const c = b.box.getCenter(new THREE.Vector3());
    const down = new THREE.Ray(new THREE.Vector3(c.x, 500, c.z), new THREE.Vector3(0, -1, 0));
    const first = index.pick(down)!;
    expect(first.kind).not.toBe('plot');
    index.remove(b.id % 2 ? 'company' : 'ambient', b.id);
    const after = index.pick(down)!;
    expect(after.kind).toBe('plot');
    if (after.kind === 'plot') {
      const i = after.pz * W + after.px;
      expect(after.parcelId).toBe(parcel[i] >= 0 ? parcel[i] : null);
      expect(after.point.y).toBeCloseTo(surface[i], 4);
    }
    expect(index.box(b.id % 2 ? 'company' : 'ambient', b.id)).toBeNull();
    expect(index.box(boxes[1].id % 2 ? 'company' : 'ambient', boxes[1].id)).not.toBeNull();
  });
});
