// Reference implementation from docs/overhaul/research/art-rendering.md Appendix A (assets/GeoBuilder.ts).
// Verified to type-check against three 0.186 / postprocessing 6.39.5 / camera-controls 3.1.2.
// GeoBuilder — append-only, allocation-light low-poly geometry writer used by every AssetFactory.
// Runs in a Web Worker (no THREE objects needed until toGeometry on the main thread).
// All attributes are 4-byte aligned (Metal/ANGLE friendly): 36 bytes per vertex + indices.
// W4 additions (additive, backward compatible): local sub-frames (setLocal/clearLocal), toWorld/dirToWorld/worldYaw
// for emitters, parts, signs and props, vertexCount + bounds() for pick boxes, saveState/restoreState for shared
// chunk builders, boxFaces() to skip hidden faces, tri(), and ownerRoofMinNy (owner-roof flag on pitched roofs).
import * as THREE from 'three';

export type RGB = readonly [number, number, number]; // sRGB bytes 0..255
export const enum Facade { NONE = 0, HOUSE = 1, APARTMENT = 2, CURTAIN = 3, SHOP = 4, INDUSTRIAL = 5, OFFICE = 6 }
export type FacadeParams = readonly [style: number, seed: number, floorOrWallDm: number, bayDm: number];

class Grow<T extends Float32Array | Int8Array | Uint8Array | Uint32Array> {
  arr: T; len = 0;
  constructor(private make: (n: number) => T, cap: number) { this.arr = make(cap); }
  reserve(n: number) { if (this.len + n <= this.arr.length) return; const next = this.make(Math.max(this.arr.length * 2, this.len + n)); next.set(this.arr.subarray(0, this.len) as never); this.arr = next; }
  view(): T { return this.arr.subarray(0, this.len) as T; }
}

export interface BuiltArrays {
  position: Float32Array; normal: Int8Array; color: Uint8Array; fuv: Float32Array; facade: Uint8Array; extra: Uint8Array;
  index: Uint16Array | Uint32Array; vertexCount: number; triangleCount: number;
}

/** World-space axis-aligned box [minX, minY, minZ, maxX, maxY, maxZ] (the Picking.ts box layout). */
export type Aabb = [number, number, number, number, number, number];

/** Face selection for GeoBuilder.boxFaces (OR the bits). Bottom faces are never emitted: the camera never looks up. */
export const FACE_PZ = 1, FACE_NZ = 2, FACE_PX = 4, FACE_NX = 8, FACE_TOP = 16;
export const FACE_SIDES = FACE_PZ | FACE_NZ | FACE_PX | FACE_NX;
export const FACE_ALL = FACE_SIDES | FACE_TOP;

/** Mutable GeoBuilder state that a factory changes while building (see GeoBuilder.saveState). */
export interface GeoState {
  tx: number; ty: number; tz: number; c: number; s: number;
  local: readonly [x: number, y: number, z: number, cos: number, sin: number] | null;
  tint: number; owner: number; ownerRoof: boolean; flags: number;
  /** Absent in states saved before this field existed (treated as the reference 0.9). */
  ownerRoofMinNy?: number;
}

export class GeoBuilder {
  private pos = new Grow((n) => new Float32Array(n), 3 * 4096);
  private nrm = new Grow((n) => new Int8Array(n), 4 * 4096);
  private col = new Grow((n) => new Uint8Array(n), 4 * 4096);
  private fuv = new Grow((n) => new Float32Array(n), 2 * 4096);
  private fac = new Grow((n) => new Uint8Array(n), 4 * 4096);
  private ext = new Grow((n) => new Uint8Array(n), 4 * 4096);
  private idx = new Grow((n) => new Uint32Array(n), 6 * 4096);
  private n = 0;
  // placement state (quarter-turn rotation about Y, then translation)
  private tx = 0; private ty = 0; private tz = 0; private c = 1; private s = 0;
  /** instance-tint weight written into color.a (255 = instanceColor fully applies, 0 = never) */
  tint = 255;
  /** 0..7 company owner index, 255 = none (written to extra.z). */
  owner = 255;
  /** set true by a factory while emitting ROOF faces of a company building: up-facing faces then get FLAG_OWNER_ROOF
   *  (tinted to the owner colour at city zoom). Never set it for fields, yards or parking — verified that painting whole
   *  lots reads as noise at overview. */
  ownerRoof = false;
  /** Minimum normal.y for a face to count as roof while `ownerRoof` is set (W4 addition). The reference value 0.9 only
   *  catches flat and low-pitch roofs; set ~0.5 while writing pitched roofs (barns, sheds, 30–40° gables) so they tint
   *  too. Walls (normal.y ≈ 0) never qualify. */
  ownerRoofMinNy = 0.9;
  /** extra flags OR-ed into every vertex (FLAG_VEGETATION | FLAG_PAVED | FLAG_SNOWABLE) */
  flags = 0;

  place(x: number, z: number, quarterTurns = 0, y = 0): this {
    const a = (quarterTurns & 3) * Math.PI / 2;
    this.tx = x; this.ty = y; this.tz = z; this.c = Math.round(Math.cos(a)); this.s = Math.round(Math.sin(a));
    return this;
  }

  // ---- Local sub-frame (additive; W4). Applied before the placement transform. ----
  private local: readonly [number, number, number, number, number] | null = null;

  /** Author a sub-assembly in its own frame: points become p_lot = R_y(yaw)·p + (x, y, z) before the lot placement.
   *  R_y uses the three.js rotation.y convention (+Z turns towards +X for positive yaw), so a part authored facing +Z
   *  and placed with `yaw` faces the same way an Object3D with rotation.y = yaw would. Arbitrary yaw is allowed (the
   *  lot placement itself stays quarter-turn). Undo with clearLocal(). */
  setLocal(x: number, y: number, z: number, yaw = 0): this {
    this.local = [x, y, z, Math.cos(yaw), Math.sin(yaw)];
    return this;
  }

  clearLocal(): this {
    this.local = null;
    return this;
  }

  /** Transform a point from the current (local, then placement) frame to world space — exactly what a vertex written
   *  now would get. Use it for emitters, animated-part pivots, sign corners and prop positions. */
  toWorld(x: number, y: number, z: number): [number, number, number] {
    if (this.local) {
      const [lx, ly, lz, lc, ls] = this.local;
      const X = lx + x * lc + z * ls, Z = lz - x * ls + z * lc;
      x = X; y = ly + y; z = Z;
    }
    const { c, s } = this;
    return [this.tx + x * c + z * s, this.ty + y, this.tz - x * s + z * c];
  }

  /** Rotate a direction (no translation) from the current frame to world space. */
  dirToWorld(x: number, y: number, z: number): [number, number, number] {
    if (this.local) {
      const lc = this.local[3], ls = this.local[4];
      const X = x * lc + z * ls, Z = -x * ls + z * lc;
      x = X; z = Z;
    }
    const { c, s } = this;
    return [x * c + z * s, y, -x * s + z * c];
  }

  /** World yaw (radians, three.js rotation.y) of something with yaw `localYaw` in the current frame. */
  worldYaw(localYaw = 0): number {
    const placementYaw = Math.atan2(this.s, this.c);
    const localYawOffset = this.local ? Math.atan2(this.local[4], this.local[3]) : 0;
    return placementYaw + localYawOffset + localYaw;
  }

  /** Number of vertices written so far. Take it before emitting an asset to measure only that asset (bounds). */
  get vertexCount(): number { return this.n; }

  /** World AABB of the vertices written since `fromVertex` (default: all), or null when there are none. */
  bounds(fromVertex = 0): Aabb | null {
    if (fromVertex >= this.n) return null;
    const P = this.pos.arr;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = fromVertex * 3, end = this.n * 3; i < end; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    return [x0, y0, z0, x1, y1, z1];
  }

  /** Snapshot of placement, local frame, tint, owner, ownerRoof and flags. Factories that share a chunk builder take
   *  one on entry and restoreState() on exit so the next building starts from a clean state. */
  saveState(): GeoState {
    return { tx: this.tx, ty: this.ty, tz: this.tz, c: this.c, s: this.s, local: this.local, tint: this.tint, owner: this.owner, ownerRoof: this.ownerRoof, flags: this.flags, ownerRoofMinNy: this.ownerRoofMinNy };
  }

  restoreState(st: GeoState): void {
    this.tx = st.tx; this.ty = st.ty; this.tz = st.tz; this.c = st.c; this.s = st.s; this.local = st.local;
    this.tint = st.tint; this.owner = st.owner; this.ownerRoof = st.ownerRoof; this.flags = st.flags;
    this.ownerRoofMinNy = st.ownerRoofMinNy ?? 0.9;
  }

  /** Like box() but only the faces selected by `faces` (FACE_* bits): skip faces hidden against another mass. */
  boxFaces(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces: number, wall: RGB, roof: RGB = wall, fac: FacadeParams | null = null, em = 0): void {
    const fw = (w: number) => [[0, y0], [w, y0], [w, y1], [0, y1]];
    if (faces & FACE_PZ) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], wall, fac, fw(x1 - x0), em);
    if (faces & FACE_NZ) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], wall, fac, fw(x1 - x0), em);
    if (faces & FACE_PX) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], wall, fac, fw(z1 - z0), em);
    if (faces & FACE_NX) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], wall, fac, fw(z1 - z0), em);
    if (faces & FACE_TOP) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], roof, null, null, em);
  }

  private vtx(x: number, y: number, z: number, nx: number, ny: number, nz: number, rgb: RGB, u: number, v: number, fac: FacadeParams | null, em: number): number {
    if (this.local) {
      // local sub-frame first (only when set, so plain lot-frame output is bit-identical to the reference builder)
      const [lx, ly, lz, lc, ls] = this.local;
      const X = lx + x * lc + z * ls, Z = lz - x * ls + z * lc;
      const NX = nx * lc + nz * ls, NZ = -nx * ls + nz * lc;
      x = X; y = ly + y; z = Z; nx = NX; nz = NZ;
    }
    const { c, s } = this;
    this.pos.reserve(3); this.nrm.reserve(4); this.col.reserve(4); this.fuv.reserve(2); this.fac.reserve(4); this.ext.reserve(4);
    const P = this.pos.arr, N = this.nrm.arr, C = this.col.arr, U = this.fuv.arr, F = this.fac.arr, E = this.ext.arr;
    let o = this.pos.len; P[o] = this.tx + x * c + z * s; P[o + 1] = this.ty + y; P[o + 2] = this.tz - x * s + z * c; this.pos.len += 3;
    o = this.nrm.len; N[o] = Math.round((nx * c + nz * s) * 127); N[o + 1] = Math.round(ny * 127); N[o + 2] = Math.round((-nx * s + nz * c) * 127); N[o + 3] = 0; this.nrm.len += 4;
    o = this.col.len; C[o] = rgb[0]; C[o + 1] = rgb[1]; C[o + 2] = rgb[2]; C[o + 3] = this.tint; this.col.len += 4;
    o = this.fuv.len; U[o] = u; U[o + 1] = v; this.fuv.len += 2;
    o = this.fac.len; F[o] = fac ? fac[0] : 0; F[o + 1] = fac ? fac[1] & 255 : 0; F[o + 2] = fac ? fac[2] : 0; F[o + 3] = fac ? fac[3] : 0; this.fac.len += 4;
    const roof = this.ownerRoof && this.owner !== 255 && ny > this.ownerRoofMinNy ? 1 : 0;
    o = this.ext.len; E[o] = em; E[o + 1] = this.flags | roof; E[o + 2] = this.owner; E[o + 3] = 0; this.ext.len += 4;
    return this.n++;
  }

  /** Quad a-b-c-d counter-clockwise seen from the normal side. uv = facade metres per corner. */
  quad(a: number[], b: number[], cc: number[], d: number[], n: RGB | number[], rgb: RGB, fac: FacadeParams | null = null, uv: number[][] | null = null, em = 0): void {
    const u = uv ?? [[0, 0], [0, 0], [0, 0], [0, 0]];
    const i0 = this.vtx(a[0], a[1], a[2], n[0], n[1], n[2], rgb, u[0][0], u[0][1], fac, em);
    const i1 = this.vtx(b[0], b[1], b[2], n[0], n[1], n[2], rgb, u[1][0], u[1][1], fac, em);
    const i2 = this.vtx(cc[0], cc[1], cc[2], n[0], n[1], n[2], rgb, u[2][0], u[2][1], fac, em);
    const i3 = this.vtx(d[0], d[1], d[2], n[0], n[1], n[2], rgb, u[3][0], u[3][1], fac, em);
    this.idx.reserve(6); const I = this.idx.arr; const o = this.idx.len;
    I[o] = i0; I[o + 1] = i1; I[o + 2] = i2; I[o + 3] = i0; I[o + 4] = i2; I[o + 5] = i3; this.idx.len += 6;
  }

  /** Triangle a-b-c counter-clockwise seen from the normal side (roof gables, cone caps, fans). */
  tri(a: number[], b: number[], cc: number[], n: RGB | number[], rgb: RGB, em = 0): void {
    const i0 = this.vtx(a[0], a[1], a[2], n[0], n[1], n[2], rgb, 0, 0, null, em);
    const i1 = this.vtx(b[0], b[1], b[2], n[0], n[1], n[2], rgb, 0, 0, null, em);
    const i2 = this.vtx(cc[0], cc[1], cc[2], n[0], n[1], n[2], rgb, 0, 0, null, em);
    this.idx.reserve(3); const I = this.idx.arr; const o = this.idx.len;
    I[o] = i0; I[o + 1] = i1; I[o + 2] = i2; this.idx.len += 3;
  }

  /** Axis-aligned box in the local lot frame (+Z = street front). Walls get facade UVs (u along wall, v = height). */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wall: RGB, roof: RGB = wall, fac: FacadeParams | null = null, top = true): void {
    const fw = (w: number) => [[0, y0], [w, y0], [w, y1], [0, y1]];
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], wall, fac, fw(x1 - x0));
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], wall, fac, fw(x1 - x0));
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], wall, fac, fw(z1 - z0));
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], wall, fac, fw(z1 - z0));
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], roof);
  }

  get triangleCount(): number { return this.idx.len / 3; }

  /** Worker side: hand out compact typed arrays (transferable). */
  finish(): BuiltArrays {
    const idx = this.idx.view();
    const index = this.n <= 65535 ? Uint16Array.from(idx) : idx.slice();
    return {
      position: this.pos.view().slice(), normal: this.nrm.view().slice(), color: this.col.view().slice(),
      fuv: this.fuv.view().slice(), facade: this.fac.view().slice(), extra: this.ext.view().slice(),
      index, vertexCount: this.n, triangleCount: idx.length / 3,
    };
  }
}

/** Main thread: wrap worker arrays into a BufferGeometry for CityMaterial. */
export function toBufferGeometry(a: BuiltArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 4, true));      // xyz used; w free
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 4, true));        // rgb sRGB, a = tint weight
  g.setAttribute('fuv', new THREE.BufferAttribute(a.fuv, 2));
  g.setAttribute('facade', new THREE.BufferAttribute(a.facade, 4, false));
  g.setAttribute('extra', new THREE.BufferAttribute(a.extra, 4, false));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
