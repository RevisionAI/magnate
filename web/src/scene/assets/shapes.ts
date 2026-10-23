// Shared low-poly primitives on top of GeoBuilder (local lot frame: +Z = street
// front, Y up, metres). Flat-shaded: every face gets its own normal. Used by all
// asset families; extend here (additively) rather than duplicating in families.
import type { FacadeParams, GeoBuilder, RGB } from './GeoBuilder';

const TAU = Math.PI * 2;

function faceNormal(a: number[], b: number[], c: number[]): number[] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Quad with its normal computed from the corners (a-b-c-d counter-clockwise). */
export function quadAuto(b: GeoBuilder, a: number[], bb: number[], c: number[], d: number[], rgb: RGB, fac: FacadeParams | null = null, uv: number[][] | null = null, em = 0): void {
  b.quad(a, bb, c, d, faceNormal(a, bb, c), rgb, fac, uv, em);
}

/** Triangle with its normal computed from the corners. */
export function triAuto(b: GeoBuilder, a: number[], bb: number[], c: number[], rgb: RGB, em = 0): void {
  b.tri(a, bb, c, faceNormal(a, bb, c), rgb, em);
}

/** Vertical prism (cylinder when segments ≥ 8): tanks, silos, chimneys, columns. */
export function cylinder(b: GeoBuilder, cx: number, cz: number, r: number, y0: number, y1: number, segments: number, side: RGB, top: RGB = side, capTop = true, em = 0): void {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * TAU, a1 = ((i + 1) / segments) * TAU;
    const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
    const am = (a0 + a1) / 2;
    b.quad([x1, y0, z1], [x0, y0, z0], [x0, y1, z0], [x1, y1, z1], [Math.cos(am), 0, Math.sin(am)], side, null, null, em);
    if (capTop) b.tri([cx, y1, cz], [x1, y1, z1], [x0, y1, z0], [0, 1, 0], top, em);
  }
}

/** Cone / pyramid frustum from radius r0 at y0 to r1 at y1 (r1 = 0 → cone). */
export function cone(b: GeoBuilder, cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, segments: number, rgb: RGB, em = 0): void {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * TAU, a1 = ((i + 1) / segments) * TAU;
    const p00 = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0];
    const p01 = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
    const p10 = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1];
    const p11 = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
    if (r1 <= 1e-4) triAuto(b, p01, p00, [cx, y1, cz], rgb, em);
    else quadAuto(b, p01, p00, p10, p11, rgb, null, null, em);
  }
}

/** Low-poly sphere-ish blob (tree crowns, domes). rings ≥ 2, segments ≥ 5. */
export function blob(b: GeoBuilder, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, rings: number, segments: number, rgb: RGB, em = 0): void {
  for (let j = 0; j < rings; j++) {
    const t0 = (j / rings) * Math.PI, t1 = ((j + 1) / rings) * Math.PI;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * TAU, a1 = ((i + 1) / segments) * TAU;
      const p = (t: number, a: number) => [cx + Math.sin(t) * Math.cos(a) * rx, cy + Math.cos(t) * ry, cz + Math.sin(t) * Math.sin(a) * rz];
      const A = p(t0, a0), B = p(t0, a1), C = p(t1, a1), D = p(t1, a0);
      if (j === 0) triAuto(b, A, C, D, rgb, em);
      else if (j === rings - 1) triAuto(b, A, B, D, rgb, em);
      else quadAuto(b, A, B, C, D, rgb, null, null, em);
    }
  }
}

/** Gable roof over the rectangle [x0,x1]×[z0,z1] at eave height y, ridge rise h. Ridge runs along X when alongX. */
export function gableRoof(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, roof: RGB, gable: RGB, alongX = true, overhang = 0.4): void {
  const ox0 = x0 - overhang, ox1 = x1 + overhang, oz0 = z0 - overhang, oz1 = z1 + overhang;
  if (alongX) {
    const zm = (z0 + z1) / 2;
    quadAuto(b, [ox0, y, oz1], [ox1, y, oz1], [ox1, y + h, zm], [ox0, y + h, zm], roof);
    quadAuto(b, [ox1, y, oz0], [ox0, y, oz0], [ox0, y + h, zm], [ox1, y + h, zm], roof);
    triAuto(b, [x1, y, z1], [x1, y, z0], [x1, y + h, zm], gable);
    triAuto(b, [x0, y, z0], [x0, y, z1], [x0, y + h, zm], gable);
  } else {
    const xm = (x0 + x1) / 2;
    quadAuto(b, [ox1, y, oz1], [ox1, y, oz0], [xm, y + h, oz0], [xm, y + h, oz1], roof);
    quadAuto(b, [ox0, y, oz0], [ox0, y, oz1], [xm, y + h, oz1], [xm, y + h, oz0], roof);
    triAuto(b, [x0, y, z1], [x1, y, z1], [xm, y + h, z1], gable);
    triAuto(b, [x1, y, z0], [x0, y, z0], [xm, y + h, z0], gable);
  }
}

/** Hip roof (four slopes) over [x0,x1]×[z0,z1]; ridge along the longer side. */
export function hipRoof(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, roof: RGB, overhang = 0.4): void {
  const ox0 = x0 - overhang, ox1 = x1 + overhang, oz0 = z0 - overhang, oz1 = z1 + overhang;
  const w = ox1 - ox0, d = oz1 - oz0;
  if (w >= d) {
    const inset = d / 2, zm = (oz0 + oz1) / 2;
    const r0 = [ox0 + inset, y + h, zm], r1 = [ox1 - inset, y + h, zm];
    quadAuto(b, [ox0, y, oz1], [ox1, y, oz1], r1, r0, roof);
    quadAuto(b, [ox1, y, oz0], [ox0, y, oz0], r0, r1, roof);
    triAuto(b, [ox1, y, oz1], [ox1, y, oz0], r1, roof);
    triAuto(b, [ox0, y, oz0], [ox0, y, oz1], r0, roof);
  } else {
    const inset = w / 2, xm = (ox0 + ox1) / 2;
    const r0 = [xm, y + h, oz0 + inset], r1 = [xm, y + h, oz1 - inset];
    quadAuto(b, [ox1, y, oz1], [ox1, y, oz0], r0, r1, roof);
    quadAuto(b, [ox0, y, oz0], [ox0, y, oz1], r1, r0, roof);
    triAuto(b, [ox0, y, oz1], [ox1, y, oz1], r1, roof);
    triAuto(b, [ox1, y, oz0], [ox0, y, oz0], r0, roof);
  }
}

/** Sawtooth (north-light) factory roof along X over [x0,x1]×[z0,z1]: n teeth, glazed vertical faces towards -Z.
 *  `glassEm` (0..255) makes the glazing glow at night (a running factory). */
export function sawtoothRoof(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, teeth: number, roof: RGB, glass: RGB, glassEm = 0): void {
  const step = (z1 - z0) / teeth;
  for (let i = 0; i < teeth; i++) {
    const za = z0 + i * step, zb = za + step;
    quadAuto(b, [x0, y, zb], [x1, y, zb], [x1, y + h, za], [x0, y + h, za], roof);
    quadAuto(b, [x1, y, za], [x0, y, za], [x0, y + h, za], [x1, y + h, za], glass, null, null, glassEm);
    triAuto(b, [x1, y, zb], [x1, y, za], [x1, y + h, za], roof);
    triAuto(b, [x0, y, za], [x0, y, zb], [x0, y + h, za], roof);
  }
}

/** Flat slab / ground patch (top face only) — lots, parking, pads. */
export function slab(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, rgb: RGB): void {
  b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], rgb);
}

/** Box helper taking centre + size (sizes in metres). */
export function boxAt(b: GeoBuilder, cx: number, cz: number, w: number, d: number, y0: number, h: number, wall: RGB, roof: RGB = wall, fac: FacadeParams | null = null): void {
  b.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, wall, roof, fac);
}

/** Deterministic 0..1 hash for seeded variation inside factories. */
export function hash01(seed: number, salt: number): number {
  let h = (seed * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Parse "#RRGGBB" into an RGB byte triple for GeoBuilder. */
export function rgb(hex: string): RGB {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ---------------------------------------------------------------------------------------------------------------
// W4 additions (additive). Everything below writes outward-facing, flat-shaded faces: the winding is chosen from an
// `outward` hint, so callers never have to reason about vertex order. Points are [x, y, z] in the current frame.
// ---------------------------------------------------------------------------------------------------------------

type Vec = ArrayLike<number>;

function v3(x: number, y: number, z: number): number[] { return [x, y, z]; }
function add3(a: Vec, b: Vec): number[] { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub3(a: Vec, b: Vec): number[] { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function mul3(a: Vec, k: number): number[] { return [a[0] * k, a[1] * k, a[2] * k]; }
function dot3(a: Vec, b: Vec): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a: Vec, b: Vec): number[] { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function unit3(a: Vec): number[] { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/** Two unit vectors (side, up) perpendicular to the unit direction d; `up` leans towards +Y (or +X for vertical d). */
export function axisFrame(d: Vec): [number[], number[]] {
  const ref = Math.abs(d[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const s = unit3(cross3(d, ref));
  return [s, cross3(s, d)];
}

/** Quad a-b-c-d whose winding is flipped if needed so its normal points along `outward`. */
export function quadOut(b: GeoBuilder, a: number[], bb: number[], c: number[], d: number[], outward: Vec, rgb: RGB, fac: FacadeParams | null = null, uv: number[][] | null = null, em = 0): void {
  const n = faceNormal(a, bb, c);
  if (dot3(n, outward) >= 0) b.quad(a, bb, c, d, n, rgb, fac, uv, em);
  else b.quad(d, c, bb, a, [-n[0], -n[1], -n[2]], rgb, fac, uv ? [uv[3], uv[2], uv[1], uv[0]] : null, em);
}

/** Triangle whose winding is flipped if needed so its normal points along `outward`. */
export function triOut(b: GeoBuilder, a: number[], bb: number[], c: number[], outward: Vec, rgb: RGB, em = 0): void {
  const n = faceNormal(a, bb, c);
  if (dot3(n, outward) >= 0) b.tri(a, bb, c, n, rgb, em);
  else b.tri(c, bb, a, [-n[0], -n[1], -n[2]], rgb, em);
}

/** Oriented box between two points with a w × h cross-section: lattice members, struts, pipes, booms, conveyors.
 *  `h` runs along the "up-ish" axis of the member. sides = 3 gives a triangular prism (6 triangles) for thin members
 *  that only need a silhouette; caps close the ends (only needed when an end is visible). */
export function beam(b: GeoBuilder, p0: Vec, p1: Vec, w: number, h: number, rgb: RGB, sides: 3 | 4 = 4, caps = false, em = 0): void {
  const d = sub3(p1, p0);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return;
  const dn = mul3(d, 1 / len);
  const [s, u] = axisFrame(dn);
  const ring: number[][] = [];
  if (sides === 4) {
    const hw = w / 2, hh = h / 2;
    ring.push(add3(mul3(s, hw), mul3(u, hh)), add3(mul3(s, -hw), mul3(u, hh)), add3(mul3(s, -hw), mul3(u, -hh)), add3(mul3(s, hw), mul3(u, -hh)));
  } else {
    const r = w / Math.sqrt(3);
    for (let k = 0; k < 3; k++) {
      const t = Math.PI / 2 + (k * TAU) / 3;
      ring.push(add3(mul3(s, Math.cos(t) * r), mul3(u, Math.sin(t) * r * (h / w))));
    }
  }
  for (let k = 0; k < ring.length; k++) {
    const ra = ring[k], rb = ring[(k + 1) % ring.length];
    quadOut(b, add3(p0, ra), add3(p1, ra), add3(p1, rb), add3(p0, rb), add3(ra, rb), rgb, null, null, em);
  }
  if (caps) {
    const back = mul3(dn, -1);
    if (ring.length === 4) {
      quadOut(b, add3(p0, ring[0]), add3(p0, ring[1]), add3(p0, ring[2]), add3(p0, ring[3]), back, rgb, null, null, em);
      quadOut(b, add3(p1, ring[0]), add3(p1, ring[1]), add3(p1, ring[2]), add3(p1, ring[3]), dn, rgb, null, null, em);
    } else {
      triOut(b, add3(p0, ring[0]), add3(p0, ring[1]), add3(p0, ring[2]), back, rgb, em);
      triOut(b, add3(p1, ring[0]), add3(p1, ring[1]), add3(p1, ring[2]), dn, rgb, em);
    }
  }
}

/** Cylinder (or frustum when r1 ≠ r0) along any axis from p0 to p1: horizontal tanks, pipes, drums, wheels, rollers.
 *  capRgb = null leaves both ends open. */
export function cylinderAlong(b: GeoBuilder, p0: Vec, p1: Vec, r0: number, segments: number, side: RGB, capRgb: RGB | null = side, em = 0, r1 = r0): void {
  const d = sub3(p1, p0);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return;
  const dn = mul3(d, 1 / len);
  const [s, u] = axisFrame(dn);
  const dirs: number[][] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * TAU;
    dirs.push(add3(mul3(s, Math.cos(t)), mul3(u, Math.sin(t))));
  }
  for (let i = 0; i < segments; i++) {
    const da = dirs[i], db = dirs[(i + 1) % segments];
    quadOut(b, add3(p0, mul3(da, r0)), add3(p1, mul3(da, r1)), add3(p1, mul3(db, r1)), add3(p0, mul3(db, r0)), add3(da, db), side, null, null, em);
  }
  if (capRgb) {
    const back = mul3(dn, -1);
    for (let i = 0; i < segments; i++) {
      const da = dirs[i], db = dirs[(i + 1) % segments];
      if (r0 > 1e-4) triOut(b, [p0[0], p0[1], p0[2]], add3(p0, mul3(da, r0)), add3(p0, mul3(db, r0)), back, capRgb, em);
      if (r1 > 1e-4) triOut(b, [p1[0], p1[1], p1[2]], add3(p1, mul3(da, r1)), add3(p1, mul3(db, r1)), dn, capRgb, em);
    }
  }
}

/** Vertical extrusion of a convex polygon given in XZ (either winding): ship hulls, wedges, angled sheds. Walls get
 *  facade UVs (u runs along the perimeter) so procedural windows work on them. */
export function prism(b: GeoBuilder, pts: ReadonlyArray<readonly [number, number]>, y0: number, y1: number, wall: RGB, top: RGB = wall, fac: FacadeParams | null = null, capTop = true, em = 0): void {
  const n = pts.length;
  if (n < 3) return;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [xa, za] = pts[i], [xb, zb] = pts[(i + 1) % n];
    area += xa * zb - xb * za;
  }
  const sign = area > 0 ? 1 : -1;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const [xa, za] = pts[i], [xb, zb] = pts[(i + 1) % n];
    const dx = xb - xa, dz = zb - za, len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const out = [sign * dz, 0, -sign * dx];
    quadOut(b, [xa, y0, za], [xb, y0, zb], [xb, y1, zb], [xa, y1, za], out, wall, fac, [[u, y0], [u + len, y0], [u + len, y1], [u, y1]], em);
    u += len;
  }
  if (capTop) {
    const [x0, z0] = pts[0];
    for (let i = 1; i < n - 1; i++) {
      const [xa, za] = pts[i], [xb, zb] = pts[i + 1];
      triOut(b, [x0, y1, z0], [xa, y1, za], [xb, y1, zb], [0, 1, 0], top, em);
    }
  }
}

/** Rounded heap (ore stockpile, spoil heap, gravel pile) with an elliptical base rx × rz and height h. */
export function mound(b: GeoBuilder, cx: number, cz: number, rx: number, rz: number, h: number, segments: number, rgb: RGB, y0 = 0, em = 0): void {
  const rings: [number, number][] = [[1, 0], [0.64, 0.66], [0.24, 0.94]];
  const pt = (i: number, ring: number) => {
    const t = (i / segments) * TAU, [r, f] = rings[ring];
    return v3(cx + Math.cos(t) * rx * r, y0 + h * f, cz + Math.sin(t) * rz * r);
  };
  for (let i = 0; i < segments; i++) {
    const t = ((i + 0.5) / segments) * TAU;
    const radial = [Math.cos(t) / Math.max(rx, 1e-3), 0, Math.sin(t) / Math.max(rz, 1e-3)];
    for (let k = 0; k < rings.length - 1; k++) {
      const out = add3(unit3(radial), [0, 0.4 + k * 0.6, 0]);
      quadOut(b, pt(i, k), pt(i + 1, k), pt(i + 1, k + 1), pt(i, k + 1), out, rgb, null, null, em);
    }
    triOut(b, pt(i, rings.length - 1), pt(i + 1, rings.length - 1), [cx, y0 + h, cz], [0, 1, 0], rgb, em);
  }
}

/** Flat disc (pads, tank lids, pivot hubs) facing up at height y. */
export function disc(b: GeoBuilder, cx: number, cz: number, r: number, y: number, segments: number, rgb: RGB, em = 0): void {
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * TAU, a1 = ((i + 1) / segments) * TAU;
    triOut(b, [cx, y, cz], [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r], [0, 1, 0], rgb, em);
  }
}

/** Painted strip on the ground between two XZ points (bay lines, crane rails, lane markings). */
export function strip(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, width: number, y: number, rgb: RGB, em = 0): void {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const px = (-dz / len) * (width / 2), pz = (dx / len) * (width / 2);
  quadOut(b, [x0 + px, y, z0 + pz], [x0 - px, y, z0 - pz], [x1 - px, y, z1 - pz], [x1 + px, y, z1 + pz], [0, 1, 0], rgb, null, null, em);
}

/** Bits for latticeTower faces: which faces get bracing. */
export const LATTICE_PZ = 1, LATTICE_NX = 2, LATTICE_NZ = 4, LATTICE_PX = 8, LATTICE_ALL = 15;

/** Square lattice tower (tower-crane masts, derricks, headframe legs, flood masts): four corner legs plus Warren
 *  (zig-zag) bracing on the selected faces, tapering from size0 at y0 to size1 at y1. Cost: 32 + 6·panels·faces tris. */
export function latticeTower(b: GeoBuilder, cx: number, cz: number, size0: number, size1: number, y0: number, y1: number, panels: number, legW: number, braceW: number, rgb: RGB, faces = LATTICE_ALL, em = 0): void {
  const corner = (k: number, t: number): number[] => {
    const hs = (size0 + (size1 - size0) * t) / 2;
    const sx = k === 0 || k === 3 ? 1 : -1, sz = k === 0 || k === 1 ? 1 : -1;
    return [cx + sx * hs, y0 + (y1 - y0) * t, cz + sz * hs];
  };
  for (let k = 0; k < 4; k++) beam(b, corner(k, 0), corner(k, 1), legW, legW, rgb, 4, false, em);
  const faceBits = [LATTICE_PZ, LATTICE_NX, LATTICE_NZ, LATTICE_PX];
  for (let f = 0; f < 4; f++) {
    if (!(faces & faceBits[f])) continue;
    const ka = f, kb = (f + 1) % 4;
    for (let i = 0; i < panels; i++) {
      const t0 = i / panels, t1 = (i + 1) / panels;
      const flip = (i + f) % 2 === 0;
      beam(b, corner(flip ? ka : kb, t0), corner(flip ? kb : ka, t1), braceW, braceW, rgb, 3, false, em);
    }
  }
}

/** Truss girder between two points (crane booms and jibs, conveyor galleries, gantry girders): four chords of a
 *  width × depth section plus Warren lacing on the two vertical sides (and optionally the top). */
export function trussBeam(b: GeoBuilder, p0: Vec, p1: Vec, width: number, depth: number, panels: number, chordW: number, braceW: number, rgb: RGB, laceTop = false, em = 0): void {
  const d = sub3(p1, p0);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return;
  const dn = mul3(d, 1 / len);
  const [s, u] = axisFrame(dn);
  const off = (sx: number, uy: number) => add3(mul3(s, (sx * width) / 2), mul3(u, (uy * depth) / 2));
  const corners = [off(1, 1), off(-1, 1), off(-1, -1), off(1, -1)];
  for (const c of corners) beam(b, add3(p0, c), add3(p1, c), chordW, chordW, rgb, 4, false, em);
  const at = (c: number[], t: number) => add3(add3(p0, mul3(d, t)), c);
  const laces: [number[], number[]][] = [[corners[0], corners[3]], [corners[1], corners[2]]];
  if (laceTop) laces.push([corners[0], corners[1]]);
  for (const [top, bottom] of laces) {
    for (let i = 0; i < panels; i++) {
      const t0 = i / panels, t1 = (i + 1) / panels;
      if (i % 2 === 0) beam(b, at(top, t0), at(bottom, t1), braceW, braceW, rgb, 3, false, em);
      else beam(b, at(bottom, t0), at(top, t1), braceW, braceW, rgb, 3, false, em);
    }
  }
}

/** mulberry32 PRNG: the only randomness source allowed in factories (art §5.4). Returns uniform values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a over the string forms of the parts (with a separator), e.g. fnv1a(cityId, px, pz, typeId) (§4.1). */
export function fnv1a(...parts: ReadonlyArray<string | number>): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
