// Animated parts (art bible §5.20): geometry authored in PIVOT space plus a pure pose function, so the renderer can
// draw each kind as one InstancedMesh and animate it from instance data (pivot, yaw, phase, active) with no uploads
// for periodic motion. Owner paint: faces written with tint 255 on a white base take the instance colour (set it to
// the owner colour); everything else uses tint 0 and keeps its own colour.
//
// Frame per part: origin = pivot, +Z = the part's "forward" (beam towards the horsehead, jib towards the hook, arm
// along its length), +Y up. AnimatedPart.rotY yaws that frame in the world. Motion is applied in the part frame
// BEFORE the yaw: world = T(pivot) · R_y(rotY) · Motion(t) · S(scale).
import type { AnimatedPart, AnimatedPartKind } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { ASSET_RGB, WORLD_RGB, hexRgb, shade } from '../../palette';
import * as S from '../../shapes';

export interface PartMotion {
  /** rock: angle = amplitude·sin(θ); spin: angle = θ; shuttle: offset = amplitude·sin(θ) along the axis. */
  mode: 'rock' | 'spin' | 'shuttle';
  axis: 'x' | 'y' | 'z';
  /** Radians (rock) or metres (shuttle; AnimatedPart.extent overrides). Unused for spin. */
  amplitude: number;
  /** Seconds per full cycle. */
  period: number;
  /** Extra phase in cycles (keeps the pumpjack crank in step with its beam). */
  offset?: number;
}

export interface PartSpec {
  readonly kind: AnimatedPartKind;
  readonly motion: PartMotion;
  /** Triangle budget per instance (art §4.2.13: beam + head ≤ 120, crank ≤ 60). */
  readonly triBudget: number;
  readonly castShadow: boolean;
  /** Default AnimatedPart.extent for kinds whose geometry depends on it. */
  readonly defaultExtent?: number;
  /** Writes the part in pivot space. `extent` is AnimatedPart.extent (or defaultExtent). */
  build(b: GeoBuilder, extent?: number): void;
}

const WHITE: RGB = [255, 255, 255];
const IRON = ASSET_RGB.pumpjackIron;
const STEEL = shade(WORLD_RGB.industry.galvanized, 0.78);
const DARK = ASSET_RGB.dockShelter;
const GLASS = WORLD_RGB.industry.glass;
const YELLOW = ASSET_RGB.haulTruck;
const DEG = Math.PI / 180;

/** Run fn with the given tint weight (255 = instance colour paints these faces). */
function tinted(b: GeoBuilder, tint: number, fn: () => void): void {
  const prev = b.tint;
  b.tint = tint;
  try { fn(); } finally { b.tint = prev; }
}

/** Extrude a convex polygon given in the part's (z, y) plane along X from x0 to x1 (horsehead, counterweights). */
function extrudeX(b: GeoBuilder, zy: ReadonlyArray<readonly [number, number]>, x0: number, x1: number, rgb: RGB): void {
  const n = zy.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += zy[i][0] * zy[(i + 1) % n][1] - zy[(i + 1) % n][0] * zy[i][1];
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const [za, ya] = zy[i], [zb, yb] = zy[(i + 1) % n];
    const dz = zb - za, dy = yb - ya;
    S.quadOut(b, [x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb], [0, -sign * dz, sign * dy].map((v, k) => (k === 0 ? 0 : v)), rgb);
  }
  for (let i = 1; i < n - 1; i++) {
    S.triOut(b, [x0, zy[0][1], zy[0][0]], [x0, zy[i][1], zy[i][0]], [x0, zy[i + 1][1], zy[i + 1][0]], [-1, 0, 0], rgb);
    S.triOut(b, [x1, zy[0][1], zy[0][0]], [x1, zy[i][1], zy[i][0]], [x1, zy[i + 1][1], zy[i + 1][0]], [1, 0, 0], rgb);
  }
}

function buildPumpjackBeam(b: GeoBuilder): void {
  tinted(b, 255, () => {
    // walking beam 11 m (art §4.2.13), owner livery; pivot on the saddle bearing at the beam centre line
    b.box(-0.3, -0.45, -4.7, 0.3, 0.45, 5.2, WHITE, WHITE);
    // horsehead: curved face towards +Z (bridle side)
    extrudeX(b, [[5.0, 0.9], [5.75, 0.8], [6.3, 0.2], [6.45, -0.8], [6.25, -1.9], [5.8, -2.7], [5.2, -2.3], [5.0, -0.6]], -0.4, 0.4, WHITE);
  });
  tinted(b, 0, () => {
    b.box(-0.85, -0.65, -4.95, 0.85, -0.25, -4.45, IRON, IRON); // equalizer
    S.beam(b, [0.75, -0.5, -4.7], [0.75, -4.3, -4.5], 0.18, 0.18, IRON, 4); // pitman arms down to the crank pins
    S.beam(b, [-0.75, -0.5, -4.7], [-0.75, -4.3, -4.5], 0.18, 0.18, IRON, 4);
    S.beam(b, [0, -0.45, -0.6], [0, -0.45, 0.6], 0.7, 0.3, IRON, 4); // saddle bearing
  });
}

function buildPumpjackCrank(b: GeoBuilder): void {
  tinted(b, 0, () => {
    b.box(-1.0, -0.22, -0.22, 1.0, 0.22, 0.22, IRON, IRON); // crank shaft hub
    for (const x of [-0.85, 0.85]) {
      S.beam(b, [x, -0.4, 0], [x, 2.1, 0], 0.22, 0.5, IRON, 4, true); // crank arm (rest pose: pointing up)
      b.box(x - 0.28, 1.15, -0.85, x + 0.28, 2.25, 0.85, shade(IRON, 1.12), shade(IRON, 1.12)); // counterweight
    }
  });
}

function buildSheaveWheel(b: GeoBuilder): void {
  const r = 2.25, inner = 1.95, t = 0.18, segs = 10;
  tinted(b, 0, () => {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const o0 = [0, Math.cos(a0) * r, Math.sin(a0) * r], o1 = [0, Math.cos(a1) * r, Math.sin(a1) * r];
      const i0 = [0, Math.cos(a0) * inner, Math.sin(a0) * inner], i1 = [0, Math.cos(a1) * inner, Math.sin(a1) * inner];
      const mid = [0, Math.cos((a0 + a1) / 2), Math.sin((a0 + a1) / 2)];
      S.quadOut(b, [-t, o0[1], o0[2]], [t, o0[1], o0[2]], [t, o1[1], o1[2]], [-t, o1[1], o1[2]], mid, STEEL);
      S.quadOut(b, [t, o0[1], o0[2]], [t, i0[1], i0[2]], [t, i1[1], i1[2]], [t, o1[1], o1[2]], [1, 0, 0], STEEL);
      S.quadOut(b, [-t, o0[1], o0[2]], [-t, i0[1], i0[2]], [-t, i1[1], i1[2]], [-t, o1[1], o1[2]], [-1, 0, 0], STEEL);
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI;
      S.beam(b, [0, -Math.cos(a) * inner, -Math.sin(a) * inner], [0, Math.cos(a) * inner, Math.sin(a) * inner], 0.14, 0.14, STEEL, 3);
    }
    b.box(-0.32, -0.3, -0.3, 0.32, 0.3, 0.3, DARK, DARK); // hub
  });
}

function buildCraneJib(b: GeoBuilder, extent = 40): void {
  const L = Math.max(15, extent);
  const white = hexRgb('#E8E4D8');
  const yellowJib = ASSET_RGB.derrick; // tower cranes read best in safety yellow
  tinted(b, 0, () => {
    b.box(-1.6, -0.6, -1.6, 1.6, 0.4, 1.6, IRON, IRON); // slewing platform
    S.trussBeam(b, [0, 0.9, 1.4], [0, 0.9, L], 1.3, 1.5, 8, 0.16, 0.08, yellowJib); // jib
    S.beam(b, [0, 0.5, -1.4], [0, 0.5, -12], 1.5, 0.6, yellowJib, 4, true); // counter-jib girder
    // cat-head (A-frame) and pendants to both tips
    S.beam(b, [-0.8, 0.4, -0.8], [0, 7, 0], 0.2, 0.2, yellowJib, 3);
    S.beam(b, [0.8, 0.4, -0.8], [0, 7, 0], 0.2, 0.2, yellowJib, 3);
    S.beam(b, [-0.8, 0.4, 0.8], [0, 7, 0], 0.2, 0.2, yellowJib, 3);
    S.beam(b, [0.8, 0.4, 0.8], [0, 7, 0], 0.2, 0.2, yellowJib, 3);
    S.beam(b, [0, 7, 0], [0, 1.7, L * 0.62], 0.08, 0.08, DARK, 3);
    S.beam(b, [0, 7, 0], [0, 0.8, -11], 0.08, 0.08, DARK, 3);
    b.box(1.0, -0.4, 1.0, 3.0, 2.0, 3.4, white, white); // operator cab
    b.quad([1.0, 0.6, 3.42], [3.0, 0.6, 3.42], [3.0, 1.8, 3.42], [1.0, 1.8, 3.42], [0, 0, 1], GLASS);
    const tz = L * 0.55; // trolley + hook block
    b.box(-0.8, 0.0, tz - 1, 0.8, 0.5, tz + 1, IRON, IRON);
    S.beam(b, [-0.25, 0, tz], [-0.25, -14, tz], 0.06, 0.06, DARK, 3);
    S.beam(b, [0.25, 0, tz], [0.25, -14, tz], 0.06, 0.06, DARK, 3);
    b.box(-0.5, -15.2, tz - 0.4, 0.5, -14, tz + 0.4, YELLOW, YELLOW);
  });
  tinted(b, 255, () => {
    b.box(-1.3, -1.6, -12.4, 1.3, 1.4, -9.6, WHITE, WHITE); // counterweight in owner colour (art §4.1)
  });
}

function buildGantryTrolley(b: GeoBuilder): void {
  const spreader = ASSET_RGB.haulTruck;
  tinted(b, 0, () => {
    b.box(-3.4, -0.8, -2.6, 3.4, 1.6, 2.6, hexRgb('#D9D6CE'), hexRgb('#C9C6BE')); // trolley carriage on the boom
    b.box(1.6, -3.6, -1.4, 3.6, -0.8, 1.6, hexRgb('#E8E4D8'), hexRgb('#E8E4D8')); // operator cab under the trolley
    b.quad([1.6, -3.0, 1.62], [3.6, -3.0, 1.62], [3.6, -1.4, 1.62], [1.6, -1.4, 1.62], [0, 0, 1], GLASS);
    for (const [x, z] of [[-2.2, -1.0], [2.2, -1.0], [-2.2, 1.0], [2.2, 1.0]] as const) {
      S.beam(b, [x, -0.8, z], [x * 2.6, -22, z], 0.07, 0.07, DARK, 3); // hoist ropes
    }
    b.box(-6.2, -22.6, -1.3, 6.2, -22, 1.3, spreader, spreader); // spreader (aligned with the berth)
    b.box(-6.1, -25.2, -1.22, 6.1, -22.6, 1.22, hexRgb('#2F6F9F'), hexRgb('#2B6590')); // a 40 ft box on the hook
  });
}

function buildExcavatorArm(b: GeoBuilder): void {
  tinted(b, 0, () => {
    S.beam(b, [0, 0, 0], [0, 3.3, 3.6], 0.6, 0.75, YELLOW, 4, true); // boom
    S.beam(b, [0, 3.3, 3.6], [0, 0.6, 6.1], 0.45, 0.55, YELLOW, 4, true); // stick
    S.beam(b, [0, 0.7, 0.9], [0, 2.7, 2.6], 0.22, 0.22, DARK, 3); // hydraulic ram
    b.box(-0.6, 0.0, 5.7, 0.6, 1.0, 6.7, shade(YELLOW, 0.8), shade(YELLOW, 0.8)); // bucket
  });
}

function buildIrrigationArm(b: GeoBuilder, extent = 20): void {
  const L = Math.max(8, extent);
  const g = WORLD_RGB.industry.galvanized;
  tinted(b, 0, () => {
    S.cylinderAlong(b, [0, 3.6, 0.4], [0, 3.6, L], 0.14, 5, g, null);
    const spans = Math.max(1, Math.round(L / 12));
    for (let i = 0; i < spans; i++) {
      const z0 = (i / spans) * L, z1 = ((i + 1) / spans) * L, zm = (z0 + z1) / 2;
      S.beam(b, [0, 3.6, z0 + 0.3], [0, 2.5, zm], 0.06, 0.06, STEEL, 3); // under-truss
      S.beam(b, [0, 2.5, zm], [0, 3.6, z1], 0.06, 0.06, STEEL, 3);
      // A-frame drive tower with two wheels
      S.beam(b, [-1.4, 0.6, z1], [0, 3.6, z1], 0.14, 0.14, g, 3);
      S.beam(b, [1.4, 0.6, z1], [0, 3.6, z1], 0.14, 0.14, g, 3);
      b.box(-1.7, 0.0, z1 - 0.5, -1.1, 1.1, z1 + 0.5, DARK, DARK);
      b.box(1.1, 0.0, z1 - 0.5, 1.7, 1.1, z1 + 0.5, DARK, DARK);
    }
  });
}

function buildFlag(b: GeoBuilder): void {
  // 3 × 2 m flag hanging off the pole top towards +X, with one fold so it reads as cloth
  tinted(b, 255, () => {
    const pts = [[0.05, 0, 0], [1.5, 0, 0.18], [3.0, 0, -0.05]];
    for (let i = 0; i < 2; i++) {
      const a = pts[i], c = pts[i + 1];
      const lo = (p: number[]) => [p[0], -2, p[2]];
      S.quadOut(b, lo(a), lo(c), c, a, [-(c[2] - a[2]), 0, c[0] - a[0]], WHITE);
      S.quadOut(b, lo(a), lo(c), c, a, [c[2] - a[2], 0, -(c[0] - a[0])], WHITE);
    }
  });
}

function buildFan(b: GeoBuilder): void {
  tinted(b, 0, () => {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const p = (r: number, w: number) => [c * r - s * w, 0.05, s * r + c * w];
      S.quadOut(b, p(0.15, -0.14), p(0.95, -0.2), p(0.95, 0.2), p(0.15, 0.14), [0, 1, 0], STEEL);
    }
    S.disc(b, 0, 0, 0.2, 0.08, 6, DARK);
  });
}

function buildWindowCleaner(b: GeoBuilder): void {
  tinted(b, 0, () => {
    b.box(-2, -0.6, -0.5, 2, 0.4, 0.5, hexRgb('#D8DCE0'), hexRgb('#D8DCE0'));
    S.beam(b, [-1.8, 0.4, 0], [-1.8, 8, 0], 0.04, 0.04, DARK, 3);
    S.beam(b, [1.8, 0.4, 0], [1.8, 8, 0], 0.04, 0.04, DARK, 3);
  });
}

/** Every animated part kind: motion (art §5.20 periods) and geometry. */
export const PART_SPECS: Readonly<Record<AnimatedPartKind, PartSpec>> = {
  pumpjackBeam: { kind: 'pumpjackBeam', motion: { mode: 'rock', axis: 'x', amplitude: 18 * DEG, period: 7.5 }, triBudget: 120, castShadow: true, build: buildPumpjackBeam },
  pumpjackCrank: { kind: 'pumpjackCrank', motion: { mode: 'spin', axis: 'x', amplitude: 0, period: 7.5, offset: -0.25 }, triBudget: 60, castShadow: true, build: buildPumpjackCrank },
  sheaveWheel: { kind: 'sheaveWheel', motion: { mode: 'spin', axis: 'x', amplitude: 0, period: 2.8 }, triBudget: 120, castShadow: false, build: buildSheaveWheel },
  craneJib: { kind: 'craneJib', motion: { mode: 'rock', axis: 'y', amplitude: 60 * DEG, period: 20 }, triBudget: 360, castShadow: true, defaultExtent: 40, build: buildCraneJib },
  gantryTrolley: { kind: 'gantryTrolley', motion: { mode: 'shuttle', axis: 'z', amplitude: 30, period: 200 }, triBudget: 120, castShadow: false, defaultExtent: 30, build: buildGantryTrolley },
  excavatorArm: { kind: 'excavatorArm', motion: { mode: 'rock', axis: 'x', amplitude: 25 * DEG, period: 4 }, triBudget: 60, castShadow: false, build: buildExcavatorArm },
  irrigationArm: { kind: 'irrigationArm', motion: { mode: 'spin', axis: 'y', amplitude: 0, period: 120 }, triBudget: 200, castShadow: false, defaultExtent: 20, build: buildIrrigationArm },
  flag: { kind: 'flag', motion: { mode: 'rock', axis: 'y', amplitude: 14 * DEG, period: 3.2 }, triBudget: 16, castShadow: false, build: buildFlag },
  fan: { kind: 'fan', motion: { mode: 'spin', axis: 'y', amplitude: 0, period: 1.2 }, triBudget: 24, castShadow: false, build: buildFan },
  windowCleaner: { kind: 'windowCleaner', motion: { mode: 'shuttle', axis: 'y', amplitude: 8, period: 60 }, triBudget: 40, castShadow: false, defaultExtent: 8, build: buildWindowCleaner },
};

/** Pose of a part at time t (seconds) in its own frame: a rotation `angle` (radians) about `axis`, then a translation
 *  `offset` along `axis`. Inactive parts rest at angle 0 / offset 0. Pure (shared by the gallery and the renderer). */
export interface PartPose { axis: 'x' | 'y' | 'z'; angle: number; offset: number; }

export function partPose(part: Pick<AnimatedPart, 'kind' | 'phase' | 'active' | 'extent'>, tSec: number, out: PartPose = { axis: 'y', angle: 0, offset: 0 }): PartPose {
  const m = PART_SPECS[part.kind].motion;
  out.axis = m.axis;
  out.angle = 0;
  out.offset = 0;
  if (part.active === false) return out;
  const cycles = tSec / m.period + (part.phase || 0) + (m.offset ?? 0);
  const theta = cycles * Math.PI * 2;
  if (m.mode === 'rock') out.angle = m.amplitude * Math.sin(theta);
  else if (m.mode === 'spin') out.angle = theta % (Math.PI * 2);
  else out.offset = (part.extent ?? m.amplitude) * Math.sin(theta);
  return out;
}
