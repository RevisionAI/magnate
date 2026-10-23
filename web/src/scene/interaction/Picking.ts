// CPU picking (art §5.12; production version of Appendix A.9): Amanatides–Woo DDA over the plot grid plus an exact
// ray/AABB test per building. No GPU read-back. 20k random rays agree with a brute-force ray/box test
// (__tests__/Picking.test.ts).
// Conventions follow web/src/scene/units.ts: city centred on the origin, plot (0,0) = NW corner, +X east, +Z south.
import * as THREE from 'three';
import { PLOT_SIZE } from '../units';

export const PLOT_M = PLOT_SIZE;

export interface PickIndex {
  /** Grid size in plots. */
  w: number;
  h: number;
  /** Per plot (pz * w + px): building slot or -1 (roads, ambient, empty). */
  cellBuilding: Int32Array;
  /** Per building slot: minX, minY, minZ, maxX, maxY, maxZ in WORLD metres. */
  boxes: Float32Array;
  /** Building slot → building id. */
  ids: number[];
  /** Tallest building (m); bounds the search volume. */
  maxHeight: number;
}

export type PickResult =
  | { kind: 'building'; id: number; point: THREE.Vector3 }
  | { kind: 'plot'; px: number; pz: number; point: THREE.Vector3 }
  | null;

/** Input of `buildPickIndex`: rotated footprint in plots + world AABB. */
export interface PickEntry {
  id: number;
  px: number;
  pz: number;
  w: number;
  h: number;
  box: ArrayLike<number>;
}

/** Build a pick index from placed buildings (later entries win on overlapping plots). */
export function buildPickIndex(w: number, h: number, entries: Iterable<PickEntry>): PickIndex {
  const list = [...entries];
  const cellBuilding = new Int32Array(Math.max(0, w * h)).fill(-1);
  const boxes = new Float32Array(list.length * 6);
  const ids: number[] = [];
  let maxHeight = 1;
  list.forEach((e, slot) => {
    ids.push(e.id);
    for (let k = 0; k < 6; k++) boxes[slot * 6 + k] = e.box[k];
    maxHeight = Math.max(maxHeight, e.box[4]);
    for (let z = Math.max(0, e.pz); z < Math.min(h, e.pz + e.h); z++) {
      for (let x = Math.max(0, e.px); x < Math.min(w, e.px + e.w); x++) cellBuilding[z * w + x] = slot;
    }
  });
  return { w, h, cellBuilding, boxes, ids, maxHeight: maxHeight + 1 };
}

/** Ray/AABB slab test against box `i` of a packed array; returns the entry distance (0 inside) or Infinity. */
export function rayBox(ox: number, oy: number, oz: number, ix: number, iy: number, iz: number, b: ArrayLike<number>, i: number): number {
  const o = i * 6;
  let a = (b[o] - ox) * ix, c = (b[o + 3] - ox) * ix;
  let t0 = Math.min(a, c), t1 = Math.max(a, c);
  a = (b[o + 1] - oy) * iy; c = (b[o + 4] - oy) * iy;
  t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
  a = (b[o + 2] - oz) * iz; c = (b[o + 5] - oz) * iz;
  t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
  // NaN (0 × ∞ on an axis-parallel ray exactly on a slab plane) fails both comparisons and counts as a miss.
  return t1 >= Math.max(t0, 0) ? Math.max(t0, 0) : Infinity;
}

const _vol = new Float32Array(6);

/** Nearest building along the ray, else the ground plot it reaches (y = 0), else null. */
export function pick(ray: THREE.Ray, idx: PickIndex): PickResult {
  const d = ray.direction, o = ray.origin;
  const ix = 1 / d.x, iy = 1 / d.y, iz = 1 / d.z;
  const halfW = (idx.w * PLOT_M) / 2, halfH = (idx.h * PLOT_M) / 2;
  _vol[0] = -halfW; _vol[1] = 0; _vol[2] = -halfH; _vol[3] = halfW; _vol[4] = idx.maxHeight; _vol[5] = halfH;
  const tGround = d.y < 0 ? -o.y / d.y : Infinity;
  const tEnter = rayBox(o.x, o.y, o.z, ix, iy, iz, _vol, 0);
  if (Number.isFinite(tEnter) && idx.ids.length > 0) {
    // DDA in grid space (gx = (x + halfW) / PLOT_M) from where the ray enters the city volume.
    const gx0 = (o.x + d.x * (tEnter + 1e-3) + halfW) / PLOT_M, gz0 = (o.z + d.z * (tEnter + 1e-3) + halfH) / PLOT_M;
    let px = Math.min(idx.w - 1, Math.max(0, Math.floor(gx0))), pz = Math.min(idx.h - 1, Math.max(0, Math.floor(gz0)));
    const stepX = d.x > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
    const tDX = d.x !== 0 ? Math.abs(PLOT_M / d.x) : Infinity, tDZ = d.z !== 0 ? Math.abs(PLOT_M / d.z) : Infinity;
    let tMaxX = d.x !== 0 ? ((stepX > 0 ? px + 1 : px) * PLOT_M - halfW - o.x) / d.x : Infinity;
    let tMaxZ = d.z !== 0 ? ((stepZ > 0 ? pz + 1 : pz) * PLOT_M - halfH - o.z) / d.z : Infinity;
    let best = Infinity, bestSlot = -1, last = -2;
    for (let guard = 0; guard < 4 * (idx.w + idx.h); guard++) {
      const slot = idx.cellBuilding[pz * idx.w + px];
      if (slot >= 0 && slot !== last) {
        const t = rayBox(o.x, o.y, o.z, ix, iy, iz, idx.boxes, slot);
        if (t < best) { best = t; bestSlot = slot; }
        last = slot;
      }
      const tCellExit = Math.min(tMaxX, tMaxZ);
      if (best <= tCellExit || tCellExit > tGround) break;     // nearest hit found, or the ray reached the ground
      if (tMaxX < tMaxZ) { px += stepX; tMaxX += tDX; } else { pz += stepZ; tMaxZ += tDZ; }
      if (px < 0 || pz < 0 || px >= idx.w || pz >= idx.h) break;
    }
    if (bestSlot >= 0 && best <= tGround) return { kind: 'building', id: idx.ids[bestSlot], point: ray.at(best, new THREE.Vector3()) };
  }
  if (!Number.isFinite(tGround)) return null;
  const g = ray.at(tGround, new THREE.Vector3());
  const gpx = Math.floor((g.x + halfW) / PLOT_M), gpz = Math.floor((g.z + halfH) / PLOT_M);
  return gpx >= 0 && gpz >= 0 && gpx < idx.w && gpz < idx.h ? { kind: 'plot', px: gpx, pz: gpz, point: g } : null;
}

/** Ground plot under a ray for a grid without buildings (placement over an empty index). */
export function pickGround(ray: THREE.Ray, w: number, h: number): { px: number; pz: number; gx: number; gz: number; point: THREE.Vector3 } | null {
  const d = ray.direction, o = ray.origin;
  if (d.y >= 0) return null;
  const t = -o.y / d.y;
  const point = ray.at(t, new THREE.Vector3());
  const gx = point.x / PLOT_M + w / 2, gz = point.z / PLOT_M + h / 2;
  return { px: Math.floor(gx), pz: Math.floor(gz), gx, gz, point };
}
