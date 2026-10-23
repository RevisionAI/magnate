// Geometry for the instanced prop families (art §4.3 "Trees", "Street lights", "Traffic lights", "Bus stop",
// "Billboards", "Cars"; §5.5 instancing; §5.8 distance bands).
//
// Every builder writes one prop in its own frame: origin at the ground contact point, +Y up, +Z "forward"
// (a lamp arm and a traffic-light mast reach towards +Z, i.e. over the carriageway; a car's nose and a bench's
// seat face +Z). Instances are placed with `PropInstance {x, z, rotY, scale}`.
//
// Instance colours: parts authored white with tint weight 255 take the instance colour as their final colour
// (tree crowns, car and van bodies), so those families need a colour per instance (`needsColor`). Parts with tint
// weight 0 (trunks, glass, lamps, poles) are never recoloured.
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { cone, cylinder } from '../../shapes';
import { EM, FL_SNOW, FL_VEG } from '../common-a/constants';
import { P, X } from '../common-a/palette';
import type { PropId } from '../common-a/propIds';

type V3 = [number, number, number];

function normal(a: V3, b: V3, c: V3): number[] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** Triangle with outward winding fixed up against a reference interior point. */
function triOut(b: GeoBuilder, a: V3, c1: V3, c2: V3, inside: V3, col: RGB, em = 0): void {
  const n = normal(a, c1, c2);
  const mx = (a[0] + c1[0] + c2[0]) / 3 - inside[0], my = (a[1] + c1[1] + c2[1]) / 3 - inside[1], mz = (a[2] + c1[2] + c2[2]) / 3 - inside[2];
  if (n[0] * mx + n[1] * my + n[2] * mz >= 0) b.tri(a, c1, c2, n, col, em);
  else b.tri(a, c2, c1, [-n[0], -n[1], -n[2]], col, em);
}

/** Box without its bottom face (props sit on the ground or on a parent part). */
function box(b: GeoBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: RGB, top = true, em = 0): void {
  b.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], col, null, null, em);
  b.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], col, null, null, em);
  b.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], col, null, null, em);
  b.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], col, null, null, em);
  if (top) b.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], col, null, null, em);
}

/** Flat quad facing up at height y. */
function flat(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, col: RGB): void {
  b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], col);
}

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V: V3[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI],
  [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const ICO_F: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];
/** Fixed per-vertex radial jitter: crowns read as foliage clumps rather than perfect gems. */
const ICO_J = [1.0, 0.92, 1.06, 0.95, 1.04, 0.9, 1.08, 0.97, 0.93, 1.05, 0.96, 1.02];

/** Icosahedral crown (20 triangles), flat shaded. */
function icoCrown(b: GeoBuilder, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: RGB): void {
  const len = Math.hypot(1, PHI);
  const v = ICO_V.map((p, i): V3 => [cx + (p[0] / len) * rx * ICO_J[i], cy + (p[1] / len) * ry * ICO_J[i], cz + (p[2] / len) * rz * ICO_J[i]]);
  const c: V3 = [cx, cy, cz];
  for (const [a, b1, c1] of ICO_F) triOut(b, v[a], v[b1], v[c1], c, col);
}

/** Octahedron (8 triangles): every tree's LOD1, and small twiggy crowns. */
function octa(b: GeoBuilder, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: RGB): void {
  const top: V3 = [cx, cy + ry, cz], bot: V3 = [cx, cy - ry, cz];
  const ring: V3[] = [[cx + rx, cy, cz], [cx, cy, cz + rz], [cx - rx, cy, cz], [cx, cy, cz - rz]];
  const c: V3 = [cx, cy, cz];
  for (let i = 0; i < 4; i++) {
    triOut(b, top, ring[i], ring[(i + 1) % 4], c, col);
    triOut(b, bot, ring[i], ring[(i + 1) % 4], c, col);
  }
}

/** Elongated crown: rings × segs lat-long blob with outward winding (poplars). */
function latLongCrown(b: GeoBuilder, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, rings: number, segs: number, col: RGB): void {
  const c: V3 = [cx, cy, cz];
  const p = (j: number, i: number): V3 => {
    const t = (j / rings) * Math.PI, a = (i / segs) * Math.PI * 2;
    return [cx + Math.sin(t) * Math.cos(a) * rx, cy + Math.cos(t) * ry, cz + Math.sin(t) * Math.sin(a) * rz];
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const A = p(j, i), B = p(j, i + 1), C = p(j + 1, i + 1), D = p(j + 1, i);
      if (j === 0) triOut(b, A, C, D, c, col);
      else if (j === rings - 1) triOut(b, A, B, D, c, col);
      else {
        triOut(b, A, B, C, c, col);
        triOut(b, A, C, D, c, col);
      }
    }
  }
}

/** Tapered n-sided trunk segment between two centres (no caps). */
function trunkSegment(b: GeoBuilder, a: V3, r0: number, c: V3, r1: number, n: number, col: RGB): void {
  for (let i = 0; i < n; i++) {
    const t0 = (i / n) * Math.PI * 2, t1 = ((i + 1) / n) * Math.PI * 2;
    const p00: V3 = [a[0] + Math.cos(t0) * r0, a[1], a[2] + Math.sin(t0) * r0];
    const p01: V3 = [a[0] + Math.cos(t1) * r0, a[1], a[2] + Math.sin(t1) * r0];
    const p10: V3 = [c[0] + Math.cos(t0) * r1, c[1], c[2] + Math.sin(t0) * r1];
    const p11: V3 = [c[0] + Math.cos(t1) * r1, c[1], c[2] + Math.sin(t1) * r1];
    const mid: V3 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
    triOut(b, p00, p01, p11, mid, col);
    triOut(b, p00, p11, p10, mid, col);
  }
}

const WHITE = X.white;

/** Run `fn` with the given tint weight and flags, then restore. */
function withState(b: GeoBuilder, tint: number, flags: number, fn: () => void): void {
  const t = b.tint, f = b.flags;
  b.tint = tint;
  b.flags = flags;
  fn();
  b.tint = t;
  b.flags = f;
}

const crown = (b: GeoBuilder, fn: () => void) => withState(b, 255, FL_VEG | FL_SNOW, fn);
const solid = (b: GeoBuilder, fn: () => void) => withState(b, 0, 0, fn);
const body = (b: GeoBuilder, fn: () => void) => withState(b, 255, FL_SNOW, fn);

// ------------------------------------------------------------------------------------------- trees

function treeDeciduous(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return crown(b, () => octa(b, 0, 4.4, 0, 2.6, 2.3, 2.6, WHITE));
  solid(b, () => cylinder(b, 0, 0, 0.28, 0, 3.0, 5, P.veg.trunk, P.veg.trunk, false));
  crown(b, () => icoCrown(b, 0, 4.4, 0, 2.6, 2.3, 2.6, WHITE));
}

function treeConifer(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return crown(b, () => octa(b, 0, 4.4, 0, 2.0, 3.8, 2.0, WHITE));
  solid(b, () => cylinder(b, 0, 0, 0.2, 0, 1.2, 4, P.veg.trunk, P.veg.trunk, false));
  crown(b, () => {
    cone(b, 0, 0, 2.3, 0, 0.9, 5.6, 7, WHITE);
    cone(b, 0, 0, 1.7, 0, 3.7, 8.2, 7, WHITE);
  });
}

function treePoplar(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return crown(b, () => octa(b, 0, 5.2, 0, 1.5, 3.4, 1.5, WHITE));
  solid(b, () => cylinder(b, 0, 0, 0.22, 0, 2.2, 5, P.veg.trunk, P.veg.trunk, false));
  crown(b, () => latLongCrown(b, 0, 5.2, 0, 1.5, 3.4, 1.5, 3, 6, WHITE));
}

function treePalm(b: GeoBuilder, lod: 0 | 1): void {
  const topC: V3 = [0.7, 7.6, 0];
  if (lod === 1) return crown(b, () => octa(b, topC[0], topC[1] - 0.4, 0, 3.0, 1.0, 3.0, WHITE));
  const mid: V3 = [0.3, 4.0, 0];
  solid(b, () => {
    trunkSegment(b, [0, 0, 0], 0.3, mid, 0.24, 5, P.ground.rock);
    trunkSegment(b, mid, 0.24, topC, 0.2, 5, P.ground.rock);
  });
  crown(b, () => {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
      const base: V3 = [topC[0], topC[1] + 0.1, topC[2]];
      const tip: V3 = [topC[0] + dx * 3.6, topC[1] - 1.5, topC[2] + dz * 3.6];
      const l: V3 = [topC[0] + dx * 1.8 + px * 0.55, topC[1] - 0.15, topC[2] + dz * 1.8 + pz * 0.55];
      const r: V3 = [topC[0] + dx * 1.8 - px * 0.55, topC[1] - 0.15, topC[2] + dz * 1.8 - pz * 0.55];
      const below: V3 = [topC[0] + dx * 1.8, topC[1] - 3, topC[2] + dz * 1.8];
      triOut(b, base, l, r, below, WHITE);
      triOut(b, l, tip, r, below, WHITE);
    }
  });
}

function treeBare(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return crown(b, () => octa(b, 0, 4.8, 0, 1.6, 1.5, 1.6, WHITE));
  solid(b, () => {
    cylinder(b, 0, 0, 0.28, 0, 3.6, 5, P.veg.trunk, P.veg.trunk, false);
    const fork: V3 = [0, 2.8, 0];
    trunkSegment(b, fork, 0.12, [1.5, 5.0, 0.4], 0.05, 3, P.veg.trunk);
    trunkSegment(b, fork, 0.12, [-1.1, 5.2, 1.0], 0.05, 3, P.veg.trunk);
    trunkSegment(b, fork, 0.12, [-0.4, 5.3, -1.4], 0.05, 3, P.veg.trunk);
  });
  crown(b, () => octa(b, 0, 4.8, 0, 1.6, 1.5, 1.6, WHITE));
}

// ------------------------------------------------------------------------------------------- street furniture

/** Street light (art §4.3): pole Ø0.18 × 8 m, 1.8 m arm towards +Z, emissive LED head. Hidden beyond 800 m. */
function lampStreet(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return;
  solid(b, () => {
    box(b, -0.18, 0, -0.18, 0.18, 0.6, 0.18, X.lampPole, false);
    cylinder(b, 0, 0, 0.11, 0.6, 8.0, 4, X.lampPole, X.lampPole, false);
    box(b, -0.06, 7.82, -0.06, 0.06, 7.94, 1.75, X.lampPole);
    box(b, -0.14, 7.66, 1.45, 0.14, 7.86, 2.15, X.lampHead, true, EM.lamp);
  });
}

/** Park path lamp: 3.6 m post with a lantern. */
function lampPath(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return;
  solid(b, () => {
    cylinder(b, 0, 0, 0.07, 0, 3.2, 4, X.lampPole, X.lampPole, false);
    box(b, -0.17, 3.2, -0.17, 0.17, 3.6, 0.17, X.lampHead, false, EM.lamp);
    cone(b, 0, 0, 0.3, 0, 3.6, 3.85, 4, X.lampPole);
  });
}

/** Signal aspect positions (prop frame) so the traffic module can overlay an active-phase glow. */
export const SIGNAL_HEADS = [
  { x: -0.22, z: 5.2, yRed: 5.95, yAmber: 5.6, yGreen: 5.25 },
  { x: -0.22, z: 0.0, yRed: 3.35, yAmber: 3.0, yGreen: 2.65 },
] as const;

/** Traffic light (art §4.3): corner pole 6.8 m with a 7 m mast arm over +Z; heads face −X (oncoming traffic). */
function signalTraffic(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return;
  solid(b, () => {
    box(b, -0.13, 0, -0.13, 0.13, 6.8, 0.13, X.signalPole);
    box(b, -0.08, 6.3, 0.1, 0.08, 6.48, 7.0, X.signalPole);
    for (const h of SIGNAL_HEADS) {
      box(b, -0.2, h.yGreen - 0.25, h.z - 0.16, 0.12, h.yRed + 0.25, h.z + 0.16, X.signalPole);
      // seen from −X, +Z is screen-right: list the lens corners counter-clockwise from there
      const lamp = (y: number, col: RGB) => b.quad([-0.21, y - 0.13, h.z - 0.12], [-0.21, y - 0.13, h.z + 0.12], [-0.21, y + 0.13, h.z + 0.12], [-0.21, y + 0.13, h.z - 0.12], [-1, 0, 0], col, null, null, EM.faint);
      lamp(h.yRed, X.aviation);
      lamp(h.yAmber, P.ind.safetyYellow);
      lamp(h.yGreen, X.signalGreen);
    }
  });
}

/** Park / street bench, 1.8 m, seat facing +Z. */
function bench(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return;
  solid(b, () => {
    box(b, -0.9, 0.42, -0.2, 0.9, 0.5, 0.22, X.timber);
    box(b, -0.9, 0.55, -0.24, 0.9, 0.95, -0.18, X.timber);
    b.quad([-0.8, 0, 0.18], [-0.7, 0, 0.18], [-0.7, 0.42, 0.18], [-0.8, 0.42, 0.18], [0, 0, 1], X.lampPole);
    b.quad([0.7, 0, 0.18], [0.8, 0, 0.18], [0.8, 0.42, 0.18], [0.7, 0.42, 0.18], [0, 0, 1], X.lampPole);
  });
}

/** Bus shelter 4 × 1.5 × 2.6 m (art §4.3): glass walls, blue roof, bench, lit ad panel; open side faces +Z. */
function busShelter(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) {
    solid(b, () => box(b, -2.1, 0, -0.75, 2.1, 2.62, 0.75, P.ind.industrialBlue));
    return;
  }
  solid(b, () => {
    box(b, -2.1, 2.5, -0.8, 2.1, 2.62, 0.85, P.ind.industrialBlue);
    box(b, -2.05, 0, 0.55, -1.95, 2.5, 0.65, X.lampPole, false);
    box(b, 1.95, 0, 0.55, 2.05, 2.5, 0.65, X.lampPole, false);
    const g = P.ind.glass2;
    // back glass, both faces
    b.quad([-2.0, 0.1, -0.7], [2.0, 0.1, -0.7], [2.0, 2.5, -0.7], [-2.0, 2.5, -0.7], [0, 0, 1], g);
    b.quad([2.0, 0.1, -0.72], [-2.0, 0.1, -0.72], [-2.0, 2.5, -0.72], [2.0, 2.5, -0.72], [0, 0, -1], g);
    // left side glass, both faces
    b.quad([-2.0, 0.1, -0.7], [-2.0, 0.1, 0.6], [-2.0, 2.5, 0.6], [-2.0, 2.5, -0.7], [-1, 0, 0], g);
    b.quad([-1.98, 0.1, 0.6], [-1.98, 0.1, -0.7], [-1.98, 2.5, -0.7], [-1.98, 2.5, 0.6], [1, 0, 0], g);
    // right side: lit advertising panel, both faces
    b.quad([2.0, 0.1, 0.6], [2.0, 0.1, -0.7], [2.0, 2.4, -0.7], [2.0, 2.4, 0.6], [1, 0, 0], P.wall.warmWhite, null, null, EM.soft);
    b.quad([1.98, 0.1, -0.7], [1.98, 0.1, 0.6], [1.98, 2.4, 0.6], [1.98, 2.4, -0.7], [-1, 0, 0], P.wall.warmWhite, null, null, EM.soft);
    box(b, -1.4, 0.45, -0.62, 1.4, 0.5, -0.25, X.timber);
  });
}

/** Roadside billboard 12 × 4 m on an 8 m pole (art §4.3); the ad face looks +Z. LOD1 keeps the board. */
function billboard(b: GeoBuilder, lod: 0 | 1): void {
  solid(b, () => {
    if (lod === 1) {
      box(b, -6, 8, -0.2, 6, 12, 0.2, X.signalPole);
      return;
    }
    box(b, -0.3, 0, -0.3, 0.3, 8.0, 0.3, X.signalPole, false);
    box(b, -6.1, 7.9, -0.25, 6.1, 12.1, 0.1, X.signalPole);
    b.quad([-6, 8.0, 0.12], [6, 8.0, 0.12], [6, 12.0, 0.12], [-6, 12.0, 0.12], [0, 0, 1], P.ind.tankWhite, null, null, EM.faint);
    box(b, -3.2, 12.1, 0.1, -2.8, 12.3, 1.0, X.lampHead, true, EM.lamp);
    box(b, 2.8, 12.1, 0.1, 3.2, 12.3, 1.0, X.lampHead, true, EM.lamp);
  });
}

/** Ad face corners of a billboard instance (world space) for the ad atlas — same frame as `billboard`. */
export function billboardFaceCorners(x: number, z: number, rotY: number, scale = 1): [number, number, number][] {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const pt = (lx: number, ly: number): [number, number, number] => {
    const px = lx * scale, pz = 0.14 * scale;
    return [x + px * c + pz * s, ly * scale, z - px * s + pz * c];
  };
  return [pt(-6, 8), pt(6, 8), pt(6, 12), pt(-6, 12)];
}

/** Hedge segment 2.0 × 1.2 × 0.9 m along X (seasonal, snowable). */
function hedge(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return;
  withState(b, 255, FL_VEG | FL_SNOW, () => box(b, -1.0, 0, -0.45, 1.0, 1.2, 0.45, P.veg.leaf3));
}

/** Timber fence segment 2.4 m along X: one post and two rails (instance colour may repaint it). */
function fence(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return;
  withState(b, 255, 0, () => {
    box(b, -1.26, 0, -0.06, -1.14, 1.2, 0.06, P.wall.greige);
    box(b, -1.2, 0.4, -0.03, 1.2, 0.5, 0.03, P.wall.greige);
    box(b, -1.2, 0.9, -0.03, 1.2, 1.0, 0.03, P.wall.greige);
  });
}

// ------------------------------------------------------------------------------------------- vehicles

/** Parked car proxy (sedan 4.5 × 1.8 × 1.45 m, nose +Z): white body takes the instance colour. */
function carParked(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) {
    body(b, () => box(b, -0.9, 0.2, -2.25, 0.9, 1.3, 2.25, WHITE));
    return;
  }
  sedan(b, (fn) => body(b, fn), WHITE);
}

/**
 * Sedan shell shared by the parked car and the police car: contact quad, body (painted inside `paint`, which sets
 * the tint state), cabin glass, tyres, head and tail lights. 34 triangles.
 */
function sedan(b: GeoBuilder, paint: (fn: () => void) => void, col: RGB): void {
  solid(b, () => flat(b, -1.0, -2.4, 1.0, 2.4, 0.02, X.contact));
  paint(() => {
    box(b, -0.9, 0.2, -2.25, 0.9, 0.82, 2.25, col, false);
    // bonnet + boot deck
    b.quad([-0.9, 0.82, 2.25], [0.9, 0.82, 2.25], [0.9, 0.82, -2.25], [-0.9, 0.82, -2.25], [0, 1, 0], col);
    b.quad([-0.72, 1.42, 0.42], [0.72, 1.42, 0.42], [0.72, 1.42, -0.95], [-0.72, 1.42, -0.95], [0, 1, 0], col);
  });
  solid(b, () => {
    const g = X.cabinGlass;
    const bl: V3 = [-0.84, 0.82, -1.3], br: V3 = [0.84, 0.82, -1.3], fl: V3 = [-0.84, 0.82, 1.05], fr: V3 = [0.84, 0.82, 1.05];
    const tbl: V3 = [-0.72, 1.42, -0.95], tbr: V3 = [0.72, 1.42, -0.95], tfl: V3 = [-0.72, 1.42, 0.42], tfr: V3 = [0.72, 1.42, 0.42];
    const inside: V3 = [0, 1.1, 0];
    const quadOut = (a: V3, c1: V3, c2: V3, d: V3) => {
      triOut(b, a, c1, c2, inside, g);
      triOut(b, a, c2, d, inside, g);
    };
    quadOut(fl, fr, tfr, tfl); // windscreen
    quadOut(br, bl, tbl, tbr); // rear window
    quadOut(fr, br, tbr, tfr); // right side
    quadOut(bl, fl, tfl, tbl); // left side
    wheels(b, 0.91, [1.45, -1.45], 0.36, 0.56);
    // tail lights (rear, −Z) and head lights (front, +Z)
    b.quad([0.35, 0.55, -2.26], [-0.35, 0.55, -2.26], [-0.35, 0.72, -2.26], [0.35, 0.72, -2.26], [0, 0, -1], X.aviation);
    b.quad([-0.8, 0.55, 2.26], [0.8, 0.55, 2.26], [0.8, 0.7, 2.26], [-0.8, 0.7, 2.26], [0, 0, 1], X.lampHead);
  });
}

/** Tyre quads on both flanks at half-width `x` for each axle position (radius r, height h). */
function wheels(b: GeoBuilder, x: number, axles: readonly number[], r: number, h: number): void {
  const tyre = X.contact;
  for (const zc of axles) {
    b.quad([x, 0.0, zc + r], [x, 0.0, zc - r], [x, h, zc - r], [x, h, zc + r], [1, 0, 0], tyre);
    b.quad([-x, 0.0, zc - r], [-x, 0.0, zc + r], [-x, h, zc + r], [-x, h, zc - r], [-1, 0, 0], tyre);
  }
}

// ------------------------------------------------------------------------------------------- service vehicles
// Civic fleet parked at police stations, fire stations and hospitals. Fixed liveries (tint weight 0, no instance
// colour); light bars are emissive so stations read at night.

const POLICE_WHITE: RGB = [236, 238, 240];

/** Police car (sedan, nose +Z): white with a blue door band and a blue roof light bar. */
function carPolice(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) {
    solid(b, () => box(b, -0.9, 0.2, -2.25, 0.9, 1.3, 2.25, POLICE_WHITE));
    return;
  }
  sedan(b, (fn) => solid(b, fn), POLICE_WHITE);
  solid(b, () => {
    b.quad([0.915, 0.42, 1.25], [0.915, 0.42, -1.3], [0.915, 0.66, -1.3], [0.915, 0.66, 1.25], [1, 0, 0], X.policeBlue);
    b.quad([-0.915, 0.42, -1.3], [-0.915, 0.42, 1.25], [-0.915, 0.66, 1.25], [-0.915, 0.66, -1.3], [-1, 0, 0], X.policeBlue);
    box(b, -0.58, 1.42, -0.28, 0.58, 1.58, 0.06, X.policeLight, true, EM.lamp);
  });
}

/** Fire engine 8.0 × 2.5 × 3.0 m (nose +Z): red cab and body, white stripe, ladder on the roof, light bar. */
function truckFire(b: GeoBuilder, lod: 0 | 1): void {
  const red = X.fireRed;
  if (lod === 1) {
    solid(b, () => box(b, -1.25, 0.3, -4.0, 1.25, 2.9, 4.0, red));
    return;
  }
  solid(b, () => {
    flat(b, -1.35, -4.1, 1.35, 4.1, 0.02, X.contact);
    box(b, -1.25, 0.35, 2.2, 1.25, 2.9, 4.0, red); // cab
    box(b, -1.25, 0.35, -4.0, 1.25, 2.75, 2.1, red); // equipment body
    b.quad([-1.1, 1.7, 4.01], [1.1, 1.7, 4.01], [1.1, 2.65, 4.01], [-1.1, 2.65, 4.01], [0, 0, 1], X.cabinGlass);
    b.quad([1.26, 1.7, 3.85], [1.26, 1.7, 2.45], [1.26, 2.6, 2.45], [1.26, 2.6, 3.85], [1, 0, 0], X.cabinGlass);
    b.quad([-1.26, 1.7, 2.45], [-1.26, 1.7, 3.85], [-1.26, 2.6, 3.85], [-1.26, 2.6, 2.45], [-1, 0, 0], X.cabinGlass);
    b.quad([1.26, 1.05, 2.0], [1.26, 1.05, -3.9], [1.26, 1.3, -3.9], [1.26, 1.3, 2.0], [1, 0, 0], WHITE);
    b.quad([-1.26, 1.05, -3.9], [-1.26, 1.05, 2.0], [-1.26, 1.3, 2.0], [-1.26, 1.3, -3.9], [-1, 0, 0], WHITE);
    // ladder: two silver rails on the roof
    box(b, -0.75, 2.75, -3.8, -0.6, 3.05, 2.6, P.ind.silver);
    box(b, 0.6, 2.75, -3.8, 0.75, 3.05, 2.6, P.ind.silver);
    box(b, -0.7, 2.9, 2.8, 0.7, 3.08, 3.15, X.policeLight, true, EM.lamp); // light bar
    wheels(b, 1.26, [3.0, -1.6, -3.0], 0.5, 1.0);
    b.quad([-1.1, 0.6, 4.02], [1.1, 0.6, 4.02], [1.1, 0.85, 4.02], [-1.1, 0.85, 4.02], [0, 0, 1], X.lampHead);
    b.quad([1.1, 0.6, -4.02], [-1.1, 0.6, -4.02], [-1.1, 0.85, -4.02], [1.1, 0.85, -4.02], [0, 0, -1], X.aviation);
  });
}

/** Ambulance 5.6 × 2.1 × 2.6 m box van (nose +Z): white with a red band and a blue light bar. */
function ambulance(b: GeoBuilder, lod: 0 | 1): void {
  const white: RGB = [240, 240, 236];
  if (lod === 1) {
    solid(b, () => box(b, -1.05, 0.3, -2.8, 1.05, 2.6, 2.8, white));
    return;
  }
  solid(b, () => {
    flat(b, -1.15, -2.9, 1.15, 2.9, 0.02, X.contact);
    box(b, -1.05, 0.3, -2.8, 1.05, 2.6, 1.5, white); // box body
    box(b, -1.0, 0.3, 1.5, 1.0, 1.25, 2.8, white); // bonnet
    b.quad([-0.95, 1.25, 2.6], [0.95, 1.25, 2.6], [0.95, 2.3, 1.52], [-0.95, 2.3, 1.52], [0, 0.7, 0.71], X.cabinGlass);
    for (const sx of [1, -1]) {
      const x = sx * 1.06, n = [sx, 0, 0];
      const z0 = sx > 0 ? 1.45 : -2.75, z1 = sx > 0 ? -2.75 : 1.45;
      b.quad([x, 1.15, z0], [x, 1.15, z1], [x, 1.45, z1], [x, 1.45, z0], n, X.cross);
    }
    b.quad([1.0, 1.15, -2.81], [-1.0, 1.15, -2.81], [-1.0, 1.45, -2.81], [1.0, 1.45, -2.81], [0, 0, -1], X.cross);
    box(b, -0.65, 2.6, 1.0, 0.65, 2.78, 1.35, X.policeLight, true, EM.lamp);
    wheels(b, 1.06, [1.9, -1.9], 0.4, 0.68);
    b.quad([0.35, 0.6, -2.82], [-0.35, 0.6, -2.82], [-0.35, 0.8, -2.82], [0.35, 0.8, -2.82], [0, 0, -1], X.aviation);
  });
}

/** Delivery / OB van 5.2 × 2.0 × 2.3 m (nose +Z); the white body takes the owner livery colour. */
function van(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) {
    body(b, () => box(b, -1.0, 0.25, -2.6, 1.0, 2.3, 2.6, WHITE));
    return;
  }
  solid(b, () => flat(b, -1.1, -2.75, 1.1, 2.75, 0.02, X.contact));
  body(b, () => {
    box(b, -1.0, 0.25, -2.6, 1.0, 2.3, 1.4, WHITE);
    box(b, -1.0, 0.25, 1.4, 1.0, 1.15, 2.6, WHITE);
  });
  solid(b, () => {
    const g = X.cabinGlass;
    b.quad([-0.95, 1.15, 2.45], [0.95, 1.15, 2.45], [0.95, 2.2, 1.42], [-0.95, 2.2, 1.42], [0, 0.7, 0.71], g);
    b.tri([1.0, 1.15, 2.4], [1.0, 1.15, 1.42], [1.0, 2.2, 1.42], [1, 0, 0], g);
    b.tri([-1.0, 1.15, 1.42], [-1.0, 1.15, 2.4], [-1.0, 2.2, 1.42], [-1, 0, 0], g);
    wheels(b, 1.01, [1.7, -1.7], 0.38, 0.62);
  });
}

/** Stack of newsprint reels (white cylinders Ø1.2 m): three standing, one on top. */
function paperRolls(b: GeoBuilder, lod: 0 | 1): void {
  if (lod === 1) return;
  withState(b, 255, FL_SNOW, () => {
    const c = P.ind.tankWhite;
    cylinder(b, -0.65, 0.4, 0.6, 0, 1.4, 6, c);
    cylinder(b, 0.65, 0.4, 0.6, 0, 1.4, 6, c);
    cylinder(b, 0, -0.7, 0.6, 0, 1.4, 6, c);
    cylinder(b, 0, 0.05, 0.6, 1.4, 2.8, 6, c);
  });
}

// ------------------------------------------------------------------------------------------- registry

export interface PropFamily {
  readonly id: PropId;
  /** Triangle budgets (art §4.3 / §5.10). lod1 = 0: the family is hidden beyond `maxDistance` instead. */
  readonly triBudget: { readonly lod0: number; readonly lod1: number };
  /** Casts sun shadows (trees per tier, art §3.10). */
  readonly castShadow: boolean;
  /** Camera-to-target distance (m) beyond which the family is hidden (art §5.8). Infinity = always shown. */
  readonly maxDistance: number;
  /** Distance beyond which LOD1 geometry replaces LOD0 (only when triBudget.lod1 > 0). */
  readonly lod1Distance: number;
  /** Parts are authored white and need an instance colour (tree crowns, car bodies, van livery). */
  readonly needsColor: boolean;
  /** Write one prop into `b` in the prop frame (origin at ground contact, +Z forward). */
  build(b: GeoBuilder, lod: 0 | 1): void;
}

function fam(id: PropId, lod0: number, lod1: number, castShadow: boolean, maxDistance: number, lod1Distance: number, needsColor: boolean, build: PropFamily['build']): PropFamily {
  return { id, triBudget: { lod0, lod1 }, castShadow, maxDistance, lod1Distance, needsColor, build };
}

/** Every instanced prop family the W3 factories emit, keyed by id (art §4.3 budgets, §5.8 bands). */
export const PROP_FAMILIES: Readonly<Record<PropId, PropFamily>> = {
  'tree.deciduous': fam('tree.deciduous', 38, 8, true, Infinity, 900, true, treeDeciduous),
  'tree.conifer': fam('tree.conifer', 38, 8, true, Infinity, 900, true, treeConifer),
  'tree.poplar': fam('tree.poplar', 38, 8, true, Infinity, 900, true, treePoplar),
  'tree.palm': fam('tree.palm', 38, 8, true, Infinity, 900, true, treePalm),
  'tree.bare': fam('tree.bare', 38, 8, true, Infinity, 900, true, treeBare),
  'lamp.street': fam('lamp.street', 36, 0, false, 800, 800, false, lampStreet),
  'lamp.path': fam('lamp.path', 24, 0, false, 600, 600, false, lampPath),
  'signal.traffic': fam('signal.traffic', 90, 0, false, 800, 800, false, signalTraffic),
  bench: fam('bench', 24, 0, false, 420, 420, false, bench),
  busShelter: fam('busShelter', 60, 10, false, 1100, 600, false, busShelter),
  billboard: fam('billboard', 40, 10, false, 1600, 900, false, billboard),
  hedge: fam('hedge', 10, 0, false, 900, 900, false, hedge),
  fence: fam('fence', 30, 0, false, 600, 600, false, fence),
  'car.parked': fam('car.parked', 40, 12, false, 700, 500, true, carParked),
  'car.police': fam('car.police', 60, 12, false, 700, 500, false, carPolice),
  'truck.fire': fam('truck.fire', 80, 12, false, 900, 500, false, truckFire),
  ambulance: fam('ambulance', 60, 12, false, 900, 500, false, ambulance),
  van: fam('van', 40, 12, false, 900, 500, true, van),
  paperRolls: fam('paperRolls', 80, 0, false, 700, 700, false, paperRolls),
};
