// Shared asset toolkit tests (W4 owns GeoBuilder, shapes, palette, AssetFactory helpers and Instancing; W3 builds on
// them). Pure Node tests: no GPU. They pin the low-level contracts every family relies on:
//   * index/vertex counts per primitive (budgets are counted in triangles),
//   * stored normals are unit length, agree with the triangle winding (front faces are counter-clockwise, so a
//     mismatch means a face that three.js culls) and point outward on convex solids,
//   * the placement / local-frame transforms used for emitters, parts, signs and props match the vertices,
//   * attribute layouts stay 4-byte aligned (Metal / ANGLE), palettes mirror tokens.ts.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { OWNER_COLORS, NEUTRAL_OWNER, WORLD } from '../../../theme/tokens';
import { lotFrame, monthOf, progressInStage, seasonOfMonth, stageForProgress } from '../AssetFactory';
import { FACE_ALL, FACE_NX, FACE_PZ, FACE_SIDES, FACE_TOP, GeoBuilder, toBufferGeometry, type BuiltArrays, type RGB } from '../GeoBuilder';
import { buildPartitionedFamily, CELL_M } from '../Instancing';
import { ASSET_RGB, CONTAINER_RGB, hexRgb, linearToSrgb, mixRgb, NEUTRAL_RGB, OWNER_RGB, ownerHex, ownerRgb, rgbHex, shade, srgbToLinear, tintHex, vehicleBodyHex, WORLD_RGB } from '../palette';
import * as S from '../shapes';

const GREY: RGB = [128, 128, 128];

type V3 = [number, number, number];

function vtx(a: BuiltArrays, i: number): V3 {
  return [a.position[i * 3], a.position[i * 3 + 1], a.position[i * 3 + 2]];
}

function storedNormal(a: BuiltArrays, i: number): V3 {
  return [a.normal[i * 4] / 127, a.normal[i * 4 + 1] / 127, a.normal[i * 4 + 2] / 127];
}

function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function len(a: V3): number { return Math.hypot(a[0], a[1], a[2]); }

interface TriCheck { tris: number; badLength: number; badWinding: number; inward: number; minDot: number }

/** Checks every triangle: unit stored normals, winding agrees with the stored normal, and (when `center` is given)
 *  the normal points away from the centre (convex solids). Degenerate triangles are skipped. */
function checkTriangles(a: BuiltArrays, center?: V3): TriCheck {
  const r: TriCheck = { tris: 0, badLength: 0, badWinding: 0, inward: 0, minDot: 1 };
  for (let t = 0; t < a.index.length; t += 3) {
    const i0 = a.index[t], i1 = a.index[t + 1], i2 = a.index[t + 2];
    const p0 = vtx(a, i0), p1 = vtx(a, i1), p2 = vtx(a, i2);
    const g = cross(sub(p1, p0), sub(p2, p0));
    const area2 = len(g);
    r.tris++;
    if (area2 < 1e-7) continue;
    const n = storedNormal(a, i0);
    const nl = len(n);
    if (Math.abs(nl - 1) > 0.02) r.badLength++;
    const d = dot(g, n) / (area2 * nl);
    r.minDot = Math.min(r.minDot, d);
    if (d < 0.9) r.badWinding++;
    if (center) {
      const c: V3 = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
      if (dot(n, sub(c, center)) < -1e-4) r.inward++;
    }
  }
  return r;
}

function expectClean(r: TriCheck): void {
  expect(r.tris).toBeGreaterThan(0);
  expect(r.badLength).toBe(0);
  expect(r.badWinding).toBe(0);
  expect(r.inward).toBe(0);
}

function build(fn: (b: GeoBuilder) => void): BuiltArrays {
  const b = new GeoBuilder();
  fn(b);
  return b.finish();
}

describe('GeoBuilder primitives', () => {
  it('quad writes 4 vertices and 6 indices; tri writes 3 and 3', () => {
    const q = build((b) => b.quad([0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], GREY));
    expect(q.vertexCount).toBe(4);
    expect(q.index.length).toBe(6);
    expect(q.triangleCount).toBe(2);
    expectClean(checkTriangles(q));
    const t = build((b) => b.tri([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], GREY));
    expect(t.vertexCount).toBe(3);
    expect(t.index.length).toBe(3);
    expect(t.triangleCount).toBe(1);
    expectClean(checkTriangles(t));
  });

  it('box writes 5 outward quads (no bottom), 4 without the top', () => {
    const a = build((b) => b.box(-2, 0, -3, 4, 5, 1, GREY));
    expect(a.triangleCount).toBe(10);
    expect(a.vertexCount).toBe(20);
    expectClean(checkTriangles(a, [1, 2.5, -1]));
    const open = build((b) => b.box(-2, 0, -3, 4, 5, 1, GREY, GREY, null, false));
    expect(open.triangleCount).toBe(8);
    for (let i = 0; i < open.vertexCount; i++) expect(Math.abs(storedNormal(open, i)[1])).toBeLessThan(0.01);
  });

  it('boxFaces honours the face bits', () => {
    expect(build((b) => b.boxFaces(0, 0, 0, 1, 1, 1, FACE_ALL, GREY)).triangleCount).toBe(10);
    expect(build((b) => b.boxFaces(0, 0, 0, 1, 1, 1, FACE_SIDES, GREY)).triangleCount).toBe(8);
    expect(build((b) => b.boxFaces(0, 0, 0, 1, 1, 1, FACE_PZ | FACE_TOP, GREY)).triangleCount).toBe(4);
    const nx = build((b) => b.boxFaces(0, 0, 0, 1, 1, 1, FACE_NX, GREY));
    expect(storedNormal(nx, 0)[0]).toBeCloseTo(-1, 2);
    expectClean(checkTriangles(build((b) => b.boxFaces(0, 0, 0, 2, 3, 4, FACE_ALL, GREY)), [1, 1.5, 2]));
  });

  it('box walls carry facade UVs in metres (u along the wall, v = height)', () => {
    const a = build((b) => b.box(0, 0, 0, 6, 4, 2, GREY, GREY, [5, 1, 40, 50]));
    // first quad = +Z wall: u runs 0..6, v = 0..4
    expect([a.fuv[0], a.fuv[1], a.fuv[2], a.fuv[3], a.fuv[4], a.fuv[5]]).toEqual([0, 0, 6, 0, 6, 4]);
    expect([a.facade[0], a.facade[1], a.facade[2], a.facade[3]]).toEqual([5, 1, 40, 50]);
  });

  it('writes colour, tint weight, owner, flags and the owner-roof flag on up-facing faces only', () => {
    const b = new GeoBuilder();
    b.owner = 3; b.tint = 0; b.flags = 8; b.ownerRoof = true;
    b.box(0, 0, 0, 1, 1, 1, [10, 20, 30], [40, 50, 60]);
    const a = b.finish();
    for (let i = 0; i < a.vertexCount; i++) {
      expect(a.color[i * 4 + 3]).toBe(0);
      expect(a.extra[i * 4 + 2]).toBe(3);
      const up = storedNormal(a, i)[1] > 0.9;
      expect(a.extra[i * 4 + 1]).toBe(8 | (up ? 1 : 0));
      expect([a.color[i * 4], a.color[i * 4 + 1], a.color[i * 4 + 2]]).toEqual(up ? [40, 50, 60] : [10, 20, 30]);
    }
  });

  it('ownerRoofMinNy (default 0.9, the reference) decides which pitched faces count as roof', () => {
    const pitched = (minNy?: number) => {
      const b = new GeoBuilder();
      b.owner = 1; b.ownerRoof = true;
      if (minNy !== undefined) b.ownerRoofMinNy = minNy;
      S.gableRoof(b, -5, -4, 5, 4, 3, 3, GREY, GREY); // 37° slopes: normal.y ≈ 0.8
      const a = b.finish();
      let flagged = 0;
      for (let i = 0; i < a.vertexCount; i++) if (a.extra[i * 4 + 1] & 1) flagged++;
      return flagged;
    };
    expect(pitched()).toBe(0);
    expect(pitched(0.5)).toBe(8); // both slopes, never the vertical gable ends
    expect(new GeoBuilder().ownerRoofMinNy).toBe(0.9);
  });

  it('never sets the owner-roof flag without an owner', () => {
    const b = new GeoBuilder();
    b.ownerRoof = true; // owner stays 255
    b.box(0, 0, 0, 1, 1, 1, GREY);
    const a = b.finish();
    for (let i = 0; i < a.vertexCount; i++) expect(a.extra[i * 4 + 1] & 1).toBe(0);
  });

  it('place() rotates positions and normals by quarter turns (front +Z faces east at facing E)', () => {
    const b = new GeoBuilder();
    b.place(100, -50, 1);
    b.quad([0, 0, 5], [1, 0, 5], [1, 1, 5], [0, 1, 5], [0, 0, 1], GREY);
    const a = b.finish();
    expect(vtx(a, 0)).toEqual([105, 0, -50]);
    const n = storedNormal(a, 0);
    expect(n[0]).toBeCloseTo(1, 2);
    expect(n[2]).toBeCloseTo(0, 2);
    expectClean(checkTriangles(a));
  });

  it('toWorld / dirToWorld / worldYaw agree with written vertices (placement + local frame)', () => {
    for (let qt = 0; qt < 4; qt++) {
      for (const yaw of [0, 0.7, -2.1]) {
        const b = new GeoBuilder();
        b.place(12, -7, qt);
        b.setLocal(3, 1.5, -4, yaw);
        const p: V3 = [1.25, 2, -0.5];
        const expected = b.toWorld(p[0], p[1], p[2]);
        b.tri(p, [p[0] + 1, p[1], p[2]], [p[0], p[1] + 1, p[2]], [0, 0, 1], GREY);
        const a = b.finish();
        const got = vtx(a, 0);
        for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(expected[k], 4);
        // +Z forward in the frame maps to (sin yaw, 0, cos yaw) in the world — the three.js rotation.y convention
        const d = b.dirToWorld(0, 0, 1);
        const wy = b.worldYaw(0);
        expect(d[0]).toBeCloseTo(Math.sin(wy), 6);
        expect(d[2]).toBeCloseTo(Math.cos(wy), 6);
        const n = storedNormal(a, 0);
        expect(n[0]).toBeCloseTo(d[0], 1);
        expect(n[2]).toBeCloseTo(d[2], 1);
      }
    }
  });

  it('clearLocal() restores the plain lot frame (bit-identical to the reference builder)', () => {
    const plain = build((b) => { b.place(5, 6, 2); b.box(0, 0, 0, 2, 2, 2, GREY); });
    const cleared = build((b) => { b.place(5, 6, 2); b.setLocal(9, 9, 9, 1); b.clearLocal(); b.box(0, 0, 0, 2, 2, 2, GREY); });
    expect(Array.from(cleared.position)).toEqual(Array.from(plain.position));
    expect(Array.from(cleared.normal)).toEqual(Array.from(plain.normal));
  });

  it('bounds() measures only the vertices written since a mark', () => {
    const b = new GeoBuilder();
    expect(b.bounds()).toBeNull();
    b.box(0, 0, 0, 1, 1, 1, GREY);
    const mark = b.vertexCount;
    b.place(10, 20);
    b.box(-1, 0, -2, 1, 3, 2, GREY);
    expect(b.bounds(mark)).toEqual([9, 0, 18, 11, 3, 22]);
    expect(b.bounds()).toEqual([0, 0, 0, 11, 3, 22]);
    expect(b.bounds(b.vertexCount)).toBeNull();
  });

  it('saveState / restoreState round-trip placement, local frame, tint, owner, ownerRoof and flags', () => {
    const b = new GeoBuilder();
    b.place(1, 2, 3, 4);
    b.setLocal(5, 6, 7, 0.5);
    b.tint = 12; b.owner = 4; b.ownerRoof = true; b.flags = 6;
    const st = b.saveState();
    b.place(0, 0); b.clearLocal(); b.tint = 255; b.owner = 255; b.ownerRoof = false; b.flags = 0;
    b.restoreState(st);
    expect(b.saveState()).toEqual(st);
    expect(b.toWorld(0, 0, 0)).toEqual(new GeoBuilder().place(1, 2, 3, 4).setLocal(5, 6, 7, 0.5).toWorld(0, 0, 0));
  });

  it('finish() returns compact arrays; u16 indices up to 65,535 vertices, u32 beyond', () => {
    const small = build((b) => b.box(0, 0, 0, 1, 1, 1, GREY));
    expect(small.index).toBeInstanceOf(Uint16Array);
    expect(small.position.length).toBe(small.vertexCount * 3);
    expect(small.normal.length).toBe(small.vertexCount * 4);
    expect(small.color.length).toBe(small.vertexCount * 4);
    expect(small.fuv.length).toBe(small.vertexCount * 2);
    expect(small.facade.length).toBe(small.vertexCount * 4);
    expect(small.extra.length).toBe(small.vertexCount * 4);
    const big = build((b) => { for (let i = 0; i < 3300; i++) b.box(i, 0, 0, i + 0.5, 1, 1, GREY); });
    expect(big.vertexCount).toBeGreaterThan(65535);
    expect(big.index).toBeInstanceOf(Uint32Array);
    expect(big.index[big.index.length - 1]).toBe(big.vertexCount - 1);
  });

  it('toBufferGeometry keeps every attribute 4-byte aligned', () => {
    const g = toBufferGeometry(build((b) => b.box(0, 0, 0, 1, 1, 1, GREY)));
    for (const name of ['position', 'normal', 'color', 'fuv', 'facade', 'extra']) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      expect((attr.itemSize * attr.array.BYTES_PER_ELEMENT) % 4).toBe(0);
    }
    expect((g.getAttribute('normal') as THREE.BufferAttribute).normalized).toBe(true);
    expect((g.getAttribute('color') as THREE.BufferAttribute).normalized).toBe(true);
    expect(g.boundingSphere).not.toBeNull();
    g.dispose();
  });
});

describe('shapes', () => {
  it('cylinder: n side quads + n cap triangles, outward', () => {
    const a = build((b) => S.cylinder(b, 2, 3, 1.5, 0, 6, 10, GREY));
    expect(a.triangleCount).toBe(30);
    expectClean(checkTriangles(a, [2, 3, 3]));
    expect(build((b) => S.cylinder(b, 0, 0, 1, 0, 1, 8, GREY, GREY, false)).triangleCount).toBe(16);
  });

  it('cone and frustum are outward', () => {
    const c = build((b) => S.cone(b, 0, 0, 2, 0, 1, 5, 8, GREY));
    expect(c.triangleCount).toBe(8);
    expectClean(checkTriangles(c, [0, 2, 0]));
    const f = build((b) => S.cone(b, 0, 0, 2, 1, 0, 3, 6, GREY));
    expect(f.triangleCount).toBe(12);
    expectClean(checkTriangles(f, [0, 1.5, 0]));
  });

  it('blob is a closed outward solid', () => {
    const a = build((b) => S.blob(b, 1, 4, -1, 2, 1.5, 2.5, 4, 7, GREY));
    expect(a.triangleCount).toBe(2 * 7 + 2 * 2 * 7);
    expectClean(checkTriangles(a, [1, 4, -1]));
  });

  it('gable, hip and sawtooth roofs face up or sideways, never down, with consistent winding', () => {
    for (const alongX of [true, false]) {
      const g = build((b) => S.gableRoof(b, -5, -3, 5, 3, 4, 2, GREY, GREY, alongX));
      expect(g.triangleCount).toBe(6);
      const r = checkTriangles(g, [0, 4.5, 0]);
      expectClean(r);
    }
    for (const [w, d] of [[10, 6], [6, 10]]) {
      const h = build((b) => S.hipRoof(b, -w / 2, -d / 2, w / 2, d / 2, 3, 2, GREY));
      expect(h.triangleCount).toBe(6);
      expectClean(checkTriangles(h, [0, 3.2, 0]));
    }
    const s = build((b) => S.sawtoothRoof(b, -20, -18, 20, 18, 10, 2.8, 5, GREY, GREY, 40));
    expect(s.triangleCount).toBe(5 * 6);
    const r = checkTriangles(s);
    expect(r.badWinding).toBe(0);
    expect(r.badLength).toBe(0);
    let glazing = 0;
    for (let i = 0; i < s.vertexCount; i++) {
      const n = storedNormal(s, i);
      expect(n[1]).toBeGreaterThan(-0.01);
      if (n[2] < -0.99) glazing++;
    }
    expect(glazing).toBe(5 * 4); // one north-facing glazed quad per tooth
    // glazing glows (emissive byte) and nothing else does
    let lit = 0;
    for (let i = 0; i < s.vertexCount; i++) if (s.extra[i * 4] === 40) lit++;
    expect(lit).toBe(glazing);
  });

  it('slab, disc and strip face up', () => {
    for (const a of [
      build((b) => S.slab(b, 0, 0, 4, 2, 0.1, GREY)),
      build((b) => S.disc(b, 0, 0, 3, 0.2, 9, GREY)),
      build((b) => S.strip(b, -3, 1, 4, 6, 0.3, 0.05, GREY)),
      build((b) => S.strip(b, 4, 6, -3, 1, 0.3, 0.05, GREY)),
    ]) {
      expectClean(checkTriangles(a));
      for (let i = 0; i < a.vertexCount; i++) expect(storedNormal(a, i)[1]).toBeCloseTo(1, 2);
    }
    expect(build((b) => S.disc(b, 0, 0, 3, 0.2, 9, GREY)).triangleCount).toBe(9);
  });

  it('quadOut / triOut flip the winding to face the outward hint', () => {
    for (const out of [[0, 0, 1], [0, 0, -1]] as const) {
      const a = build((b) => S.quadOut(b, [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], out, GREY));
      expectClean(checkTriangles(a));
      expect(Math.sign(storedNormal(a, 0)[2])).toBe(out[2]);
      const t = build((b) => S.triOut(b, [0, 0, 0], [1, 0, 0], [0, 1, 0], out, GREY));
      expectClean(checkTriangles(t));
      expect(Math.sign(storedNormal(t, 0)[2])).toBe(out[2]);
    }
  });

  it('beam: oriented prism along any direction, outward, with optional caps', () => {
    const cases: [V3, V3][] = [[[0, 0, 0], [0, 10, 0]], [[1, 2, 3], [7, 2, 3]], [[0, 0, 0], [3, 4, -5]], [[2, 9, 1], [-4, 1, 6]]];
    for (const [p0, p1] of cases) {
      const mid: V3 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
      const four = build((b) => S.beam(b, p0, p1, 0.6, 0.4, GREY, 4, true));
      expect(four.triangleCount).toBe(12);
      expectClean(checkTriangles(four, mid));
      const three = build((b) => S.beam(b, p0, p1, 0.5, 0.5, GREY, 3, true));
      expect(three.triangleCount).toBe(8);
      expectClean(checkTriangles(three, mid));
    }
    expect(build((b) => S.beam(b, [1, 1, 1], [1, 1, 1], 1, 1, GREY)).triangleCount).toBe(0);
  });

  it('cylinderAlong: n quads plus 2n cap triangles, outward on any axis; frustum allowed', () => {
    const a = build((b) => S.cylinderAlong(b, [0, 1, 0], [6, 1, 0], 0.9, 8, GREY));
    expect(a.triangleCount).toBe(8 * 2 + 16);
    expectClean(checkTriangles(a, [3, 1, 0]));
    const open = build((b) => S.cylinderAlong(b, [0, 0, 0], [0, 0, 4], 1, 6, GREY, null));
    expect(open.triangleCount).toBe(12);
    const tapered = build((b) => S.cylinderAlong(b, [0, 0, 0], [0, 5, 0], 2, 8, GREY, GREY, 0, 1));
    expectClean(checkTriangles(tapered, [0, 2.5, 0]));
  });

  it('prism: convex extrusion in either winding with perimeter UVs', () => {
    const ccw: [number, number][] = [[0, 0], [10, 0], [12, 5], [5, 9], [-2, 4]];
    for (const pts of [ccw, [...ccw].reverse()]) {
      const a = build((b) => S.prism(b, pts, 1, 4, GREY));
      expect(a.triangleCount).toBe(5 * 2 + 3);
      expectClean(checkTriangles(a, [5, 2.5, 3.5]));
    }
    const a = build((b) => S.prism(b, [[0, 0], [4, 0], [4, 3]], 0, 2, GREY, GREY, [5, 0, 20, 50]));
    // u accumulates along the perimeter: 0 → 4 on the first wall, 4 → 7 on the second
    expect(a.fuv[2]).toBeCloseTo(4, 5);
  });

  it('mound is an outward dome', () => {
    const a = build((b) => S.mound(b, 5, -3, 10, 7, 8, 12, GREY));
    expect(a.triangleCount).toBe(12 * 2 * 2 + 12);
    expectClean(checkTriangles(a, [5, 2, -3]));
  });

  it('latticeTower and trussBeam cost what their docs say and keep consistent winding', () => {
    const t = build((b) => S.latticeTower(b, 0, 0, 4, 2, 0, 30, 6, 0.3, 0.15, GREY));
    expect(t.triangleCount).toBe(32 + 6 * 6 * 4);
    const rt = checkTriangles(t);
    expect(rt.badWinding).toBe(0);
    expect(rt.badLength).toBe(0);
    const front = build((b) => S.latticeTower(b, 0, 0, 4, 2, 0, 30, 6, 0.3, 0.15, GREY, S.LATTICE_PZ));
    expect(front.triangleCount).toBe(32 + 6 * 6);
    const tr = build((b) => S.trussBeam(b, [0, 10, 0], [0, 10, 30], 2, 2.5, 8, 0.3, 0.15, GREY));
    expect(tr.triangleCount).toBe(4 * 8 + 2 * 8 * 6);
    const rr = checkTriangles(tr);
    expect(rr.badWinding).toBe(0);
    expect(rr.badLength).toBe(0);
  });

  it('axisFrame returns an orthonormal basis for any direction', () => {
    for (const d of [[0, 1, 0], [1, 0, 0], [0, 0, -1], [0.6, 0.8, 0]] as V3[]) {
      const [s, u] = S.axisFrame(d);
      expect(len(s as V3)).toBeCloseTo(1, 6);
      expect(len(u as V3)).toBeCloseTo(1, 6);
      expect(dot(s as V3, d)).toBeCloseTo(0, 6);
      expect(dot(u as V3, d)).toBeCloseTo(0, 6);
      expect(dot(s as V3, u as V3)).toBeCloseTo(0, 6);
    }
  });
});

describe('deterministic randomness', () => {
  it('mulberry32 is reproducible and uniform in [0, 1)', () => {
    const a = S.mulberry32(42), b = S.mulberry32(42);
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 5000).toBeGreaterThan(0.47);
    expect(sum / 5000).toBeLessThan(0.53);
    expect(S.mulberry32(1)()).not.toBe(S.mulberry32(2)());
  });

  it('hash01 and fnv1a are stable pure functions', () => {
    expect(S.hash01(7, 3)).toBe(S.hash01(7, 3));
    for (let i = 0; i < 200; i++) {
      const h = S.hash01(i, i * 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
    expect(S.fnv1a('metropolis', 3, 4, 'supermarket')).toBe(S.fnv1a('metropolis', 3, 4, 'supermarket'));
    expect(S.fnv1a('metropolis', 3, 4, 'supermarket')).not.toBe(S.fnv1a('metropolis', 4, 3, 'supermarket'));
    expect(S.fnv1a('ab', 'c')).not.toBe(S.fnv1a('a', 'bc')); // the separator keeps part boundaries
    expect(Number.isInteger(S.fnv1a('x'))).toBe(true);
    expect(S.fnv1a('x')).toBeGreaterThanOrEqual(0);
  });
});

describe('palette (re-exports tokens.ts as sRGB bytes)', () => {
  it('parses and formats hex colours', () => {
    expect(hexRgb('#2F7DE1')).toEqual([47, 125, 225]);
    expect(hexRgb('abc')).toEqual([170, 187, 204]);
    expect(() => hexRgb('#12345')).toThrow();
    expect(rgbHex([47, 125, 225])).toBe('#2F7DE1');
    expect(rgbHex(hexRgb(WORLD.ground.grass))).toBe(WORLD.ground.grass.toUpperCase());
  });

  it('mirrors tokens.ts exactly', () => {
    expect(OWNER_RGB.map(rgbHex)).toEqual(OWNER_COLORS.map((c) => c.toUpperCase()));
    expect(rgbHex(NEUTRAL_RGB)).toBe(NEUTRAL_OWNER.toUpperCase());
    for (const [groupName, group] of Object.entries(WORLD)) {
      if (groupName === 'vehicles') continue;
      for (const [key, hex] of Object.entries(group as Record<string, string>)) {
        expect(rgbHex((WORLD_RGB as unknown as Record<string, Record<string, RGB>>)[groupName][key])).toBe(hex.toUpperCase());
      }
    }
    expect(WORLD_RGB.vehicles.bodies.reduce((s, [, share]) => s + share, 0)).toBeCloseTo(1, 6);
  });

  it('owner helpers fall back to neutral for 255 and out-of-range indices', () => {
    expect(ownerRgb(0)).toEqual(OWNER_RGB[0]);
    expect(ownerRgb(7)).toEqual(OWNER_RGB[7]);
    for (const bad of [255, -1, 8, 2.5, Number.NaN]) {
      expect(ownerRgb(bad)).toEqual(NEUTRAL_RGB);
      expect(ownerHex(bad)).toBe(NEUTRAL_OWNER);
    }
  });

  it('tintHex finds the instance colour that turns a base vertex colour into a target (linear multiply)', () => {
    expect(tintHex([255, 255, 255], [47, 125, 225])).toBe('#2F7DE1'); // white base: the target itself
    expect(tintHex([120, 140, 90], [120, 140, 90])).toBe('#FFFFFF');
    const base = hexRgb('#D0A870');
    for (const target of [hexRgb('#72A852'), hexRgb('#C0633A'), hexRgb('#8A7F70')]) {
      const m = hexRgb(tintHex(base, target));
      for (let i = 0; i < 3; i++) {
        const got = linearToSrgb(srgbToLinear(base[i]) * srgbToLinear(m[i]));
        expect(Math.abs(got - target[i])).toBeLessThanOrEqual(2);
      }
    }
    for (let c = 0; c <= 255; c += 17) expect(linearToSrgb(srgbToLinear(c))).toBe(c);
  });

  it('shade / mixRgb clamp to bytes; vehicle colours follow the distribution', () => {
    expect(shade([200, 100, 50], 2)).toEqual([255, 200, 100]);
    expect(shade([200, 100, 50], 0.5)).toEqual([100, 50, 25]);
    expect(mixRgb([0, 0, 0], [255, 255, 255], 0.5)).toEqual([128, 128, 128]);
    expect(mixRgb([0, 0, 0], [255, 255, 255], 7)).toEqual([255, 255, 255]);
    expect(vehicleBodyHex(0)).toBe(WORLD.vehicles.bodies[0][0]);
    expect(vehicleBodyHex(0.9999)).toBe(WORLD.vehicles.bodies[WORLD.vehicles.bodies.length - 1][0]);
    expect(CONTAINER_RGB).toHaveLength(8);
    for (const c of Object.values(ASSET_RGB)) for (const v of c) expect(Number.isInteger(v) && v >= 0 && v <= 255).toBe(true);
  });
});

describe('AssetFactory helpers', () => {
  it('maps progress to the art §4.1 stages', () => {
    expect(stageForProgress(0)).toBe('foundation');
    expect(stageForProgress(0.2499)).toBe('foundation');
    expect(stageForProgress(0.25)).toBe('structure');
    expect(stageForProgress(0.8499)).toBe('structure');
    expect(stageForProgress(0.85)).toBe('finishing');
    expect(stageForProgress(0.999)).toBe('finishing');
    expect(stageForProgress(1)).toBe('complete');
    expect(stageForProgress(Number.NaN)).toBe('complete');
  });

  it('clamps progress into the stage range', () => {
    expect(progressInStage('structure', 0.1)).toBe(0.25);
    expect(progressInStage('structure', 0.95)).toBeLessThan(0.85);
    expect(progressInStage('finishing', 0.9)).toBe(0.9);
    expect(progressInStage('foundation', Number.NaN)).toBe(0);
    expect(progressInStage('complete', 0.3)).toBe(1);
    expect(progressInStage('closed', 0.3)).toBe(1);
  });

  it('derives months and seasons', () => {
    expect(monthOf({ month: 13, season: 0 })).toBe(1);
    expect(monthOf({ month: 0, season: 0 })).toBe(12);
    expect(monthOf({ month: 7.4, season: 0 })).toBe(7);
    expect(monthOf({ season: 0 })).toBe(4);
    expect(monthOf({ season: 2 })).toBe(10);
    expect(monthOf({ month: Number.NaN, season: 3 })).toBe(1);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(seasonOfMonth)).toEqual([3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3]);
  });

  it('builds lot frames with the facing → quarter-turn mapping of art §3.2', () => {
    expect(lotFrame(0, 0, 5, 3, 'S').quarterTurns).toBe(0);
    expect(lotFrame(0, 0, 5, 3, 'E').quarterTurns).toBe(1);
    expect(lotFrame(0, 0, 5, 3, 'N').quarterTurns).toBe(2);
    expect(lotFrame(0, 0, 5, 3, 'W').quarterTurns).toBe(3);
    const f = lotFrame(10, 20, 5, 3, 'E');
    expect([f.widthM, f.depthM]).toEqual([120, 72]);
  });
});

describe('Instancing', () => {
  it('partitions instances into 400 m cells in a stable order and honours the prop height', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial();
    const group = buildPartitionedFamily(geo, mat, [
      { x: 10, z: 10, rotY: 0, scale: 1 },
      { x: CELL_M + 5, z: 10, rotY: 1, scale: 2, y: 7.5, color: '#ff0000' },
      { x: 20, z: 30, rotY: 0, scale: 1 },
    ], false);
    expect(group.children).toHaveLength(2);
    const meshes = group.children as THREE.InstancedMesh[];
    expect(meshes[0].count).toBe(2);
    expect(meshes[1].count).toBe(1);
    const m = new THREE.Matrix4();
    meshes[1].getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(p.y).toBeCloseTo(7.5, 6);
    expect(meshes[1].boundingSphere).not.toBeNull();
    geo.dispose();
    mat.dispose();
  });
});
