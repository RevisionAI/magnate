// Broadcast structures for the media family (art §4.2.14–15): a self-supporting square lattice tower (TV) and a
// guyed triangular mast (radio), both banded red / white with obstruction lights (§3.13).
import type { RGB } from '../../GeoBuilder';
import { Ctx, type V3 } from '../common-a/ctx';
import { aviationLight, strut } from '../common-a/kit';
import { P, X } from '../common-a/palette';

const band = (y: number, step: number): RGB => (Math.floor(y / step) % 2 === 0 ? X.mastRed : X.mastWhite);

/**
 * Self-supporting lattice tower: `sections` tapering stages from half-width `h0` at the base to `h1` at the top,
 * panels of ~8 m with corner legs, double-sided girders and X-bracing on all four faces; banded every `step` m.
 * A slim antenna mast with obstruction lights crowns it. LOD1: two banded solid frusta.
 */
export function latticeTower(c: Ctx, cx: number, cz: number, height: number, h0: number, h1: number, step = 12): void {
  const half = (y: number) => h0 + (h1 - h0) * (y / height);
  if (c.lod === 1) {
    const mid = height / 2;
    for (const [ya, yb, col] of [[0, mid, X.mastRed], [mid, height, X.mastWhite]] as const) {
      const a = half(ya), b = half(yb);
      const pts = (h: number, y: number): V3[] => [[cx - h, y, cz + h], [cx + h, y, cz + h], [cx + h, y, cz - h], [cx - h, y, cz - h]];
      const lo = pts(a, ya), hi = pts(b, yb);
      for (let i = 0; i < 4; i++) c.qa(lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i], col);
    }
    return;
  }
  const panels = Math.max(3, Math.round(height / 8));
  const ph = height / panels;
  // legs at the corners, counter-clockwise from above: front-left, front-right, back-right, back-left
  const corner = (k: number, y: number): V3 => {
    const h = half(y);
    const sx = k === 1 || k === 2 ? 1 : -1, sz = k === 0 || k === 1 ? 1 : -1;
    return [cx + sx * h, y, cz + sz * h];
  };
  const normals = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]] as const;
  for (let i = 0; i < panels; i++) {
    const ya = i * ph, yb = (i + 1) * ph;
    const col = band((ya + yb) / 2, step);
    const legW = Math.max(0.35, 0.75 - 0.4 * (ya / height));
    for (let k = 0; k < 4; k++) {
      const A = corner(k, ya), B = corner(k, yb);
      // legs: a 4-sided tapered prism between the panel ends
      c.qa([A[0] - legW / 2, ya, A[2] + legW / 2], [A[0] + legW / 2, ya, A[2] + legW / 2], [B[0] + legW / 2, yb, B[2] + legW / 2], [B[0] - legW / 2, yb, B[2] + legW / 2], col);
      c.qa([A[0] + legW / 2, ya, A[2] + legW / 2], [A[0] + legW / 2, ya, A[2] - legW / 2], [B[0] + legW / 2, yb, B[2] - legW / 2], [B[0] + legW / 2, yb, B[2] + legW / 2], col);
      c.qa([A[0] + legW / 2, ya, A[2] - legW / 2], [A[0] - legW / 2, ya, A[2] - legW / 2], [B[0] - legW / 2, yb, B[2] - legW / 2], [B[0] + legW / 2, yb, B[2] - legW / 2], col);
      c.qa([A[0] - legW / 2, ya, A[2] - legW / 2], [A[0] - legW / 2, ya, A[2] + legW / 2], [B[0] - legW / 2, yb, B[2] + legW / 2], [B[0] - legW / 2, yb, B[2] - legW / 2], col);
      // face k between legs k and k+1: girder at the panel top + X bracing
      const n = normals[k];
      // bracing of the first panel starts just above the footings so the strips never dip below ground
      const yc = Math.max(ya, 0.25);
      const C0 = corner(k, yc), C1 = corner((k + 1) % 4, yc), D0 = corner(k, yb), D1 = corner((k + 1) % 4, yb);
      strut(c, D0, D1, n, 0.35, col);
      strut(c, C0, D1, n, 0.28, col);
      strut(c, C1, D0, n, 0.28, col);
    }
  }
  // antenna mast and obstruction lights
  c.cyl(cx, cz, 0.35, height, height + 14, 6, X.mastWhite, X.mastRed, true);
  aviationLight(c, cx, cz, height + 14, 0.5);
  aviationLight(c, cx + h1, cz + h1, height, 0.4);
  aviationLight(c, cx - h1, cz - h1, height, 0.4);
  aviationLight(c, cx + half(height * 0.5), cz - half(height * 0.5), height * 0.5, 0.4);
  // equipment cabin at the foot
  c.box(cx - h0 * 0.45, 0, cz - h0 * 0.45, cx + h0 * 0.45, 3, cz + h0 * 0.45, P.wall.concrete, P.roof.tar);
}

/**
 * Guyed triangular mast (width w, height H) banded every `step` m, with guy wires from three levels to the given
 * anchors, dipole crossbars near the top and obstruction lights.
 */
export function guyedMast(c: Ctx, cx: number, cz: number, H: number, w: number, anchors: readonly [number, number][], step = 10): void {
  const r = w / Math.sqrt(3);
  const tri: [number, number][] = [0, 1, 2].map((i) => {
    const a = -Math.PI / 2 - (i / 3) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  });
  // LOD1 keeps the silhouette with two bands; LOD0 paints every 10 m band
  const bands = c.lod === 1 ? 2 : Math.ceil(H / step);
  const bh = c.lod === 1 ? H / 2 : step;
  for (let i = 0; i < bands; i++) {
    const y0 = i * bh, y1 = Math.min(H, (i + 1) * bh);
    c.prism(tri, y0, y1, c.lod === 1 ? (i === 0 ? X.mastRed : X.mastWhite) : band(y0 + 0.1, step), null, null);
  }
  aviationLight(c, cx, cz, H, 0.45);
  if (c.lod === 1) return;
  aviationLight(c, cx, cz + r, H * 0.5, 0.35);
  // guy wires: three levels to each anchor, anchors are concrete blocks
  for (const [ax, az] of anchors) {
    c.box(ax - 0.8, 0, az - 0.8, ax + 0.8, 0.9, az + 0.8, P.wall.concrete);
    for (const k of [0.36, 0.64, 0.92]) {
      const top: V3 = [cx, H * k, cz], foot: V3 = [ax, 0.9, az];
      const dx = ax - cx, dz = az - cz, l = Math.hypot(dx, dz) || 1;
      strut(c, top, foot, [-dz / l, 0, dx / l], 0.14, P.ind.galvanized);
    }
  }
  // dipole arrays near the top
  for (const [y, yaw] of [[H - 6, 0], [H - 10, Math.PI / 3], [H - 14, -Math.PI / 3]] as const) {
    const ex = Math.cos(yaw) * 2.2, ez = Math.sin(yaw) * 2.2;
    strut(c, [cx - ex, y, cz - ez], [cx + ex, y, cz + ez], [0, 1, 0], 0.18, P.ind.galvanized);
  }
}
