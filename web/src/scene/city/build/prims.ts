// Small geometry helpers for the city layer (ground, curbs, walls) on top of GeoBuilder, in world coordinates at
// y = 0 relative (the chunk writer lifts them afterwards). Every helper picks the winding from the intended normal,
// so callers never reason about vertex order.
import type { GeoBuilder, RGB } from '../../assets/GeoBuilder';
import { quadOut, triOut } from '../../assets/shapes';

const UP = [0, 1, 0] as const;

/** Up-facing axis-aligned rectangle (corners in any order). */
export function rectUp(b: GeoBuilder, ax: number, az: number, bx: number, bz: number, y: number, rgb: RGB, em = 0): void {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  if (x1 - x0 < 1e-4 || z1 - z0 < 1e-4) return;
  b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], rgb, null, null, em);
}

/** Up-facing quad with per-corner heights (a, b, c, d around the rectangle in any rotational order). */
export function quadUp(b: GeoBuilder, a: number[], bb: number[], c: number[], d: number[], rgb: RGB): void {
  quadOut(b, a, bb, c, d, UP, rgb);
}

export function triUp(b: GeoBuilder, a: number[], bb: number[], c: number[], rgb: RGB): void {
  triOut(b, a, bb, c, UP, rgb);
}

/**
 * Vertical wall along a segment (x0, z0) → (x1, z1) from heights bottom (b0, b1) to top (t0, t1), facing `normal`
 * (a horizontal unit vector). Degenerate walls (top ≤ bottom at both ends) are skipped; a crossing wall becomes a
 * triangle on the side where the top is above the bottom.
 */
export function wall(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, bot0: number, bot1: number, top0: number, top1: number, normal: readonly [number, number], rgb: RGB): void {
  const d0 = top0 - bot0, d1 = top1 - bot1;
  const n = [normal[0], 0, normal[1]];
  if (d0 <= 0.01 && d1 <= 0.01) return;
  if (d0 > 0.01 && d1 > 0.01) {
    quadOut(b, [x0, bot0, z0], [x1, bot1, z1], [x1, top1, z1], [x0, top0, z0], n, rgb);
    return;
  }
  // Crossing: find where top meets bottom.
  const t = d0 / (d0 - d1);
  const xm = x0 + (x1 - x0) * t, zm = z0 + (z1 - z0) * t, ym = bot0 + (bot1 - bot0) * t;
  if (d0 > 0.01) triOut(b, [x0, bot0, z0], [xm, ym, zm], [x0, top0, z0], n, rgb);
  else triOut(b, [xm, ym, zm], [x1, bot1, z1], [x1, top1, z1], n, rgb);
}

/** Axis-aligned box (all faces outward) in world coordinates. */
export function boxW(b: GeoBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, side: RGB, top: RGB = side, em = 0): void {
  b.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], side, null, null, em);
  b.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], side, null, null, em);
  b.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], side, null, null, em);
  b.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], side, null, null, em);
  b.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], top, null, null, em);
}

/** Thin painted line between two points on the ground (width w, at height y). */
export function lineUp(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, w: number, y: number, rgb: RGB): void {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  if (len < 1e-4) return;
  const nx = (-dz / len) * (w / 2), nz = (dx / len) * (w / 2);
  quadUp(b, [x0 - nx, y, z0 - nz], [x1 - nx, y, z1 - nz], [x1 + nx, y, z1 + nz], [x0 + nx, y, z0 + nz], rgb);
}
