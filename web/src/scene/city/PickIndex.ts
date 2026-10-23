// CPU picking over the plot grid (art §5.12, D9): an Amanatides–Woo DDA walks the plots under the ray and tests the
// exact AABB of the lot standing on each plot (company buildings and ambient development, boxes from the factories via
// the chunk worker). The ground hit uses each plot's surface height (terraces and terrain on Hilltown/Riverside), so
// placement and plot queries land on the right plot on slopes. O(cells on the ray), no GPU read-back.
import * as THREE from 'three';
import { PLOT_SIZE } from '../units';
import type { PickEntry } from './chunkProtocol';

export type CityPick =
  | { kind: 'building'; id: number; point: THREE.Vector3; px: number; pz: number }
  | { kind: 'parcel'; parcelId: number; point: THREE.Vector3; px: number; pz: number }
  | { kind: 'plot'; px: number; pz: number; point: THREE.Vector3; parcelId: number | null };

interface Slot { kind: 'company' | 'ambient'; id: number; box: Float32Array; cells: number[] }

export class PickIndex {
  readonly w: number;
  readonly h: number;
  /** Lot slot per plot (−1 = none). */
  private readonly cellSlot: Int32Array;
  private readonly slots: (Slot | null)[] = [];
  private readonly slotByKey = new Map<string, number>();
  /** Ground surface height per plot (m). */
  private readonly surface: Float32Array;
  /** Parcel id per plot (−1 = none). */
  private readonly parcelId: Int32Array;
  private maxHeight = 1;

  constructor(w: number, h: number, surface: Float32Array, parcelId: Int32Array) {
    this.w = w;
    this.h = h;
    this.cellSlot = new Int32Array(w * h).fill(-1);
    this.surface = surface;
    this.parcelId = parcelId;
    for (let i = 0; i < surface.length; i++) this.maxHeight = Math.max(this.maxHeight, surface[i] + 1);
  }

  /** Register (or replace) a lot's pick box over its plots. */
  set(entry: PickEntry, plots: ReadonlyArray<readonly [number, number]>): void {
    const key = `${entry.kind}:${entry.id}`;
    let slot = this.slotByKey.get(key);
    if (slot === undefined) {
      slot = this.slots.length;
      this.slots.push(null);
      this.slotByKey.set(key, slot);
    }
    this.clearSlotCells(slot);
    const cells: number[] = [];
    for (const [px, pz] of plots) {
      if (px < 0 || pz < 0 || px >= this.w || pz >= this.h) continue;
      this.cellSlot[pz * this.w + px] = slot;
      cells.push(pz * this.w + px);
    }
    this.slots[slot] = { kind: entry.kind, id: entry.id, box: Float32Array.from(entry.box), cells };
    this.maxHeight = Math.max(this.maxHeight, entry.box[4] + 1);
  }

  /** Remove a lot (e.g. an ambient building suppressed by a company, or a demolished building). */
  remove(kind: 'company' | 'ambient', id: number): void {
    const slot = this.slotByKey.get(`${kind}:${id}`);
    if (slot === undefined) return;
    this.clearSlotCells(slot);
    this.slots[slot] = null;
  }

  private clearSlotCells(slot: number): void {
    const s = this.slots[slot];
    if (!s) return;
    for (const i of s.cells) if (this.cellSlot[i] === slot) this.cellSlot[i] = -1;
  }

  /** World AABB of a lot, or null. */
  box(kind: 'company' | 'ambient', id: number): THREE.Box3 | null {
    const slot = this.slotByKey.get(`${kind}:${id}`);
    const s = slot === undefined ? null : this.slots[slot];
    if (!s) return null;
    return new THREE.Box3(new THREE.Vector3(s.box[0], s.box[1], s.box[2]), new THREE.Vector3(s.box[3], s.box[4], s.box[5]));
  }

  /** Replace the per-plot ground heights (company pads changed). */
  setSurface(surface: Float32Array): void {
    this.surface.set(surface);
    for (let i = 0; i < surface.length; i++) this.maxHeight = Math.max(this.maxHeight, surface[i] + 1);
  }

  /** Replace the per-plot parcel ids (a new layout revision of the same city). */
  setParcelIds(parcelId: Int32Array): void {
    this.parcelId.set(parcelId);
  }

  surfaceAt(px: number, pz: number): number {
    if (px < 0 || pz < 0 || px >= this.w || pz >= this.h) return 0;
    return this.surface[pz * this.w + px];
  }

  /** Nearest lot or ground plot along the ray (null when the ray misses the city). */
  pick(ray: THREE.Ray): CityPick | null {
    const o = ray.origin, d = ray.direction;
    const halfW = (this.w * PLOT_SIZE) / 2, halfH = (this.h * PLOT_SIZE) / 2;
    const minY = -3;
    const tEnter = rayBox(o, d, -halfW, minY, -halfH, halfW, this.maxHeight, halfH);
    if (!Number.isFinite(tEnter)) return null;
    const p0 = new THREE.Vector3().copy(d).multiplyScalar(tEnter + 1e-4).add(o);
    let px = clampInt(Math.floor((p0.x + halfW) / PLOT_SIZE), 0, this.w - 1);
    let pz = clampInt(Math.floor((p0.z + halfH) / PLOT_SIZE), 0, this.h - 1);
    const stepX = d.x > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
    const tDX = d.x !== 0 ? Math.abs(PLOT_SIZE / d.x) : Infinity, tDZ = d.z !== 0 ? Math.abs(PLOT_SIZE / d.z) : Infinity;
    let tMaxX = d.x !== 0 ? ((stepX > 0 ? px + 1 : px) * PLOT_SIZE - halfW - o.x) / d.x : Infinity;
    let tMaxZ = d.z !== 0 ? ((stepZ > 0 ? pz + 1 : pz) * PLOT_SIZE - halfH - o.z) / d.z : Infinity;
    let tCell = tEnter;
    let best = Infinity, bestSlot = -1, last = -2;
    for (let guard = 0; guard < 4 * (this.w + this.h) + 8; guard++) {
      const i = pz * this.w + px;
      const slot = this.cellSlot[i];
      if (slot >= 0 && slot !== last) {
        const s = this.slots[slot];
        if (s) {
          const t = rayBox(o, d, s.box[0], s.box[1], s.box[2], s.box[3], s.box[4], s.box[5]);
          if (t < best) { best = t; bestSlot = slot; }
        }
        last = slot;
      }
      const tExit = Math.min(tMaxX, tMaxZ);
      // Ground of this plot: where the ray drops below the plot's surface inside the cell — or at once, when it enters
      // the cell already below it (the retaining wall of a higher terrace).
      {
        const below = o.y + d.y * tCell <= this.surface[i];
        const tg = below ? tCell : d.y < 0 ? (this.surface[i] - o.y) / d.y : Infinity;
        if (tg >= tCell - 1e-6 && tg <= tExit + 1e-6 && tg < best) {
          const point = ray.at(tg, new THREE.Vector3());
          const pid = this.parcelId[i];
          return { kind: 'plot', px, pz, point, parcelId: pid >= 0 ? pid : null };
        }
      }
      if (best <= tExit) break;
      tCell = tExit;
      if (tMaxX < tMaxZ) { px += stepX; tMaxX += tDX; } else { pz += stepZ; tMaxZ += tDZ; }
      if (px < 0 || pz < 0 || px >= this.w || pz >= this.h) break;
    }
    if (bestSlot >= 0) {
      const s = this.slots[bestSlot]!;
      const point = ray.at(best, new THREE.Vector3());
      const gx = clampInt(Math.floor((point.x + halfW) / PLOT_SIZE), 0, this.w - 1), gz = clampInt(Math.floor((point.z + halfH) / PLOT_SIZE), 0, this.h - 1);
      return s.kind === 'company'
        ? { kind: 'building', id: s.id, point, px: gx, pz: gz }
        : { kind: 'parcel', parcelId: s.id, point, px: gx, pz: gz };
    }
    return null;
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Slab test: entry distance (≥ 0) of the ray into the box, or Infinity. */
function rayBox(o: THREE.Vector3, d: THREE.Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let t0 = -Infinity, t1 = Infinity;
  const lo = [x0, y0, z0], hi = [x1, y1, z1], oc = [o.x, o.y, o.z], dc = [d.x, d.y, d.z];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(dc[k]) < 1e-12) {
      if (oc[k] < lo[k] || oc[k] > hi[k]) return Infinity;
      continue;
    }
    let a = (lo[k] - oc[k]) / dc[k], c = (hi[k] - oc[k]) / dc[k];
    if (a > c) { const t = a; a = c; c = t; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
  }
  return t1 >= Math.max(t0, 0) ? Math.max(t0, 0) : Infinity;
}
