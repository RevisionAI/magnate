// Park — ambient archetype `ambient:park` (art §4.3; any lot size, footprints from 1×1 to 5×5 and strips).
// Lawn #86AE5E with paths in the plaza colour laid out by seed — a cross, diagonals, a ring with spurs, or a
// meandering walk — a central feature (fountain, bandstand or statue), a pond on 3×3 and larger, a playground on
// 2×2 and larger, a café kiosk with parasols on 3×3 and larger, benches and path lamps along the walks, hedges on
// small parks and trees at about one per 90 m² of lawn (instanced, seasonal). LOD1: lawn, main paths and the pond.
import type { AssetFactory, AssetOutput, AssetParams, LotFrame } from '../../AssetFactory';
import type { GeoBuilder, RGB } from '../../GeoBuilder';
import { FL_PAVED, FL_SNOW, FL_VEG, Y_GROUND } from '../common-a/constants';
import { Ctx, ngonPts, type XZ } from '../common-a/ctx';
import { bandBetween, fountain, path, pond, propLine, statue, strut, superPts } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';
import type { Rng } from '../common-a/rng';

type Layout = 'cross' | 'diagonal' | 'ring' | 'meander';
const LAYOUTS: readonly Layout[] = ['cross', 'diagonal', 'ring', 'meander'];

/** Keep-out shapes for tree placement. */
type Zone = { kind: 'seg'; x0: number; z0: number; x1: number; z1: number; r: number } | { kind: 'disc'; x: number; z: number; r: number } | { kind: 'rect'; x0: number; z0: number; x1: number; z1: number };

function build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const c = new Ctx(b, lot, p, 'ambient', 0x60b);
  const r = c.shape, col = c.color;
  const hw = c.hw, hd = c.hd;
  const minSide = Math.min(c.W, c.D);
  const small = minSide < 40, large = minSide >= 66;
  let layout = LAYOUTS[(p.variant >>> 0) % LAYOUTS.length];
  if (small && (layout === 'ring' || layout === 'meander')) layout = (p.variant >>> 0) % 2 === 0 ? 'cross' : 'diagonal';
  const stone = col.pick([P.wall.stone, P.wall.limestone, P.wall.concrete]);
  const zones: Zone[] = [];
  const pw = small ? 2.4 : 3.2;

  c.ground(-hw + 0.3, -hd + 0.3, hw - 0.3, hd - 0.3, P.ground.park, FL_VEG | FL_SNOW, 0.03);

  // --- paths
  const segs: [number, number, number, number, number][] = [];
  const seg = (x0: number, z0: number, x1: number, z1: number, w = pw) => segs.push([x0, z0, x1, z1, w]);
  let ringPts: XZ[] | null = null;
  if (layout === 'cross') {
    seg(-hw + 0.3, 0, hw - 0.3, 0);
    seg(0, -hd + 0.3, 0, hd - 0.3);
  } else if (layout === 'diagonal') {
    // corners pulled in so the path's width stays on the lot
    seg(-hw + 2.2, -hd + 2.2, hw - 2.2, hd - 2.2);
    seg(-hw + 2.2, hd - 2.2, hw - 2.2, -hd + 2.2);
  } else if (layout === 'ring') {
    const a = hw - Math.max(7, c.W * 0.16), bb = hd - Math.max(7, c.D * 0.16);
    ringPts = superPts(0, 0, a, bb, 2.6, 16);
    seg(0, bb, 0, hd - 0.3);
    seg(0, -bb, 0, -hd + 0.3);
    seg(a, 0, hw - 0.3, 0);
    seg(-a, 0, -hw + 0.3, 0);
  } else {
    // meander: a wandering walk from the street front to the back, with a branch to one side
    const n = large ? 6 : 4;
    let prev: XZ = [r.range(-hw * 0.3, hw * 0.3), hd - 2];
    for (let i = 1; i <= n; i++) {
      const z = hd - 2 - ((2 * hd - 4) * i) / n;
      const next: XZ = [i === n ? r.range(-hw * 0.3, hw * 0.3) : r.range(-hw * 0.55, hw * 0.55), z];
      seg(prev[0], prev[1], next[0], next[1]);
      prev = next;
    }
    const bz = r.range(hd * 0.15, hd * 0.4), side = r.chance(0.5) ? 1 : -1;
    seg(0, bz, side * (hw - 2), bz + r.range(-hd * 0.1, hd * 0.1));
  }
  // keep-out zones from every walk (also at LOD1, so the pond lands on the same spot in both builds)
  for (const [x0, z0, x1, z1, w] of segs) zones.push({ kind: 'seg', x0, z0, x1, z1, r: w / 2 + 1.8 });
  const inner = ringPts?.map(([x, z]) => {
    const l = Math.hypot(x, z) || 1;
    return [x - (x / l) * pw, z - (z / l) * pw] as XZ;
  });
  if (ringPts) {
    for (let i = 0; i < ringPts.length; i++) {
      const a = ringPts[i], bb = ringPts[(i + 1) % ringPts.length];
      zones.push({ kind: 'seg', x0: a[0], z0: a[1], x1: bb[0], z1: bb[1], r: pw + 1.6 });
    }
  }
  // the city band keeps two straight walks (the ring layout shows its spurs as a cross)
  const lod1Segs = layout === 'ring' ? [[0, -hd + 0.3, 0, hd - 0.3, pw], [-hw + 0.3, 0, hw - 0.3, 0, pw]] : segs.slice(0, 2);
  for (const [x0, z0, x1, z1, w] of c.lod === 0 ? segs : lod1Segs) path(c, x0, z0, x1, z1, w);
  if (c.lod === 0 && layout === 'meander') for (let i = 0; i + 1 < segs.length - 1; i++) c.disc(segs[i][2], segs[i][3], pw / 2, Y_GROUND + 0.012, 6, P.road.plaza);
  if (ringPts && inner && c.lod === 0) bandBetween(c, ringPts, inner, Y_GROUND + 0.011, P.road.plaza, FL_PAVED | FL_SNOW);

  // --- central feature zone first (so the pond, playground and kiosk keep clear of it)
  const centre = layout !== 'meander';
  const fr = small ? 4 : large ? 8 : 5;
  if (centre) zones.push({ kind: 'disc', x: 0, z: 0, r: fr + 2 });

  // --- pond (3×3 and larger) in the first free spot
  let pondAt: [number, number, number, number] | null = null;
  if (large) {
    const rx = Math.min(c.W * 0.11, 12), rz = Math.min(c.D * 0.085, 9);
    const spot = findSpot(c, zones, rx * 2 + 1, rz * 2 + 1, r.chance(0.5) ? 1 : -1);
    if (spot) {
      pondAt = [spot[0], spot[1], rx, rz];
      if (c.lod === 0) pond(c, spot[0], spot[1], rx, rz, 12);
      else c.groundFan(spot[0], spot[1], ngonPts(spot[0], spot[1], rx - 0.6, rz - 0.6, 8), P.water.shallow, 0, Y_GROUND + 0.04);
      zones.push({ kind: 'rect', x0: spot[0] - rx - 2, z0: spot[1] - rz - 2, x1: spot[0] + rx + 2, z1: spot[1] + rz + 2 });
    }
  }
  if (c.lod === 1) return c.finish();

  // --- central feature
  if (centre) {
    c.disc(0, 0, fr, Y_GROUND + 0.02, 12, P.road.plaza);
    if (small) statue(c, 0, 0, stone, 2.0);
    else if (layout === 'ring') bandstand(c, 0, 0, large ? 5 : 4, stone, col.pick([P.roof.copper, P.roof.slate, P.roof.tile]));
    else fountain(c, 0, 0, large ? 5 : 3.6, stone);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      c.prop('bench', Math.cos(a) * (fr - 1.2), Math.sin(a) * (fr - 1.2), Math.atan2(-Math.cos(a), -Math.sin(a)));
    }
    c.pool(0, 0, fr + 2);
  }

  // --- playground (2×2 and larger) and café kiosk (3×3 and larger) in free spots
  if (!small) {
    const side = pondAt ? -Math.sign(pondAt[0]) || 1 : 1;
    for (const [w, d] of [[16, 12], [12, 9]] as const) {
      const spot = findSpot(c, zones, w + 1, d + 1, side);
      if (!spot) continue;
      playground(c, spot[0], spot[1], w, d, r);
      zones.push({ kind: 'rect', x0: spot[0] - w / 2 - 1, z0: spot[1] - d / 2 - 1, x1: spot[0] + w / 2 + 1, z1: spot[1] + d / 2 + 1 });
      break;
    }
  }
  if (large) {
    const spot = findSpot(c, zones, 13, 9, pondAt ? Math.sign(pondAt[0]) || -1 : -1);
    if (spot) {
      kiosk(c, spot[0], spot[1] - 1.2, col.pick(X.awnings));
      zones.push({ kind: 'rect', x0: spot[0] - 7.5, z0: spot[1] - 5.5, x1: spot[0] + 7.5, z1: spot[1] + 5.5 });
    }
  }

  // --- benches and lamps along the walks
  for (const [x0, z0, x1, z1, w] of segs) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 10) continue;
    const ux = (x1 - x0) / len, uz = (z1 - z0) / len, nx = -uz, nz = ux;
    for (let t = 9; t < len - 6; t += 18) {
      const s = r.chance(0.5) ? 1 : -1;
      const bx = x0 + ux * t + nx * s * (w / 2 + 1.0), bz = z0 + uz * t + nz * s * (w / 2 + 1.0);
      if (inLot(c, bx, bz, 1)) c.prop('bench', bx, bz, Math.atan2(-nx * s, -nz * s));
      const lx = x0 + ux * (t + 9) - nx * s * (w / 2 + 0.8), lz = z0 + uz * (t + 9) - nz * s * (w / 2 + 0.8);
      if (t + 9 < len - 3 && inLot(c, lx, lz, 0.8)) {
        c.prop('lamp.path', lx, lz, 0);
        c.pool(lx, lz, 5);
      }
    }
  }

  // --- hedges round small parks (with gaps at the path ends), trees on the lawn
  if (small) {
    const gaps = segs.flatMap(([x0, z0, x1, z1]) => [[x0, z0], [x1, z1]] as XZ[]);
    const clear = (x: number, z: number) => gaps.every(([gx, gz]) => Math.hypot(gx - x, gz - z) > 3.2);
    for (const [ax, az, bx2] of [[-hw + 0.8, hd - 0.8, hw - 0.8], [-hw + 0.8, -hd + 0.8, hw - 0.8]] as const) {
      const n = Math.round((bx2 - ax) / 2.1);
      for (let i = 0; i < n; i++) {
        const x = ax + ((i + 0.5) * (bx2 - ax)) / n;
        if (clear(x, az)) c.prop('hedge', x, az, 0);
      }
    }
  } else {
    propLine(c, 'hedge', -hw + 0.8, -hd + 0.8, -hw * 0.25, -hd + 0.8, 2.1);
  }
  const target = Math.round((c.W * c.D) / 90);
  const placed: XZ[] = [];
  const edge = 1.6;
  for (let tries = 0; placed.length < target && tries < target * 12; tries++) {
    const x = r.range(-hw + edge, hw - edge), z = r.range(-hd + edge, hd - edge);
    if (!zones.every((zn) => clearOf(zn, x, z))) continue;
    if (!placed.every(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 > 16)) continue;
    placed.push([x, z]);
    const k = r.f();
    c.tree(x, z, k < 0.66 ? 'deciduous' : k < 0.86 ? 'conifer' : 'poplar', large ? 1.1 : 1);
  }
  return c.finish();
}

/**
 * Centre of a w × d rectangle that lies inside the lot (1.5 m margin) and clear of every zone: the quadrant centres
 * first (mirrored by `side`), then the axes, then a coarse grid scan preferring the street half. Null when nothing fits.
 */
function findSpot(c: Ctx, zones: readonly Zone[], w: number, d: number, side: number): XZ | null {
  const W = c.W, D = c.D;
  const cands: XZ[] = [];
  for (const [fx, fz] of [[0.27, 0.25], [0.27, -0.25], [0.3, 0], [0, 0.3], [0, -0.3], [0.2, 0.2], [0.2, -0.2], [0.33, 0.33], [0.33, -0.33]] as const) {
    cands.push([side * fx * W, fz * D], [-side * fx * W, fz * D]);
  }
  const step = Math.max(3, Math.min(W, D) / 16);
  const grid: XZ[] = [];
  for (let x = -c.hw + w / 2 + 1.5; x <= c.hw - w / 2 - 1.5; x += step) for (let z = -c.hd + d / 2 + 1.5; z <= c.hd - d / 2 - 1.5; z += step) grid.push([x, z]);
  grid.sort((a, b) => b[1] - a[1] + 0.25 * (Math.abs(a[0] - side * W * 0.25) - Math.abs(b[0] - side * W * 0.25)));
  for (const [x, z] of [...cands, ...grid]) {
    if (Math.abs(x) + w / 2 > c.hw - 1.5 || Math.abs(z) + d / 2 > c.hd - 1.5) continue;
    if (zones.every((zn) => rectClear(zn, x - w / 2, z - d / 2, x + w / 2, z + d / 2))) return [x, z];
  }
  return null;
}

/** Whether the rectangle [x0,x1]×[z0,z1] stays clear of a zone (nearest-point tests; segments are walked). */
function rectClear(zn: Zone, x0: number, z0: number, x1: number, z1: number): boolean {
  const dist = (px: number, pz: number) => Math.hypot(px - Math.max(x0, Math.min(x1, px)), pz - Math.max(z0, Math.min(z1, pz)));
  if (zn.kind === 'rect') return x1 < zn.x0 || x0 > zn.x1 || z1 < zn.z0 || z0 > zn.z1;
  if (zn.kind === 'disc') return dist(zn.x, zn.z) > zn.r;
  const len = Math.hypot(zn.x1 - zn.x0, zn.z1 - zn.z0), n = Math.max(2, Math.ceil(len / 1.2));
  for (let i = 0; i <= n; i++) if (dist(zn.x0 + ((zn.x1 - zn.x0) * i) / n, zn.z0 + ((zn.z1 - zn.z0) * i) / n) <= zn.r) return false;
  return true;
}

function inLot(c: Ctx, x: number, z: number, m: number): boolean {
  return Math.abs(x) <= c.hw - m && Math.abs(z) <= c.hd - m;
}

function clearOf(zn: Zone, x: number, z: number): boolean {
  if (zn.kind === 'disc') return Math.hypot(x - zn.x, z - zn.z) > zn.r;
  if (zn.kind === 'rect') return x < zn.x0 || x > zn.x1 || z < zn.z0 || z > zn.z1;
  const dx = zn.x1 - zn.x0, dz = zn.z1 - zn.z0, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - zn.x0) * dx + (z - zn.z0) * dz) / l2));
  return Math.hypot(x - (zn.x0 + dx * t), z - (zn.z0 + dz * t)) > zn.r;
}

/** Octagonal bandstand: stone platform, eight slim posts, a conical roof. */
function bandstand(c: Ctx, x: number, z: number, rad: number, stone: RGB, roof: RGB): void {
  c.cyl(x, z, rad, 0, 0.9, 8, stone, shade(stone, 1.06));
  for (const [px, pz] of ngonPts(x, z, rad - 0.4, rad - 0.4, 8)) c.cyl(px, pz, 0.12, 0.9, 3.6, 4, P.wall.warmWhite, P.wall.warmWhite, false);
  c.cyl(x, z, rad + 0.2, 3.6, 3.9, 8, P.wall.warmWhite, P.wall.warmWhite, false);
  c.cone(x, z, rad + 0.5, 0, 3.9, 3.9 + rad * 0.55, 8, roof);
}

/** Playground on a w × d sand surface: swing frame, slide with a platform, climbing frame (muted primaries). */
function playground(c: Ctx, x: number, z: number, w: number, d: number, r: Rng): void {
  const [cA, cB] = [r.pick(X.play), r.pick(X.play)];
  const k = w / 16;
  c.ground(x - w / 2, z - d / 2, x + w / 2, z + d / 2, P.ground.sand, FL_SNOW, Y_GROUND + 0.02);
  // swings: two A-frames (legs start just above the ground so the strips never dip below it), top bar, seats
  const sx = x - 3.5 * k;
  for (const dx of [-2.2, 2.2]) {
    strut(c, [sx + dx, 0.07, z - 1.2], [sx + dx, 2.4, z], [1, 0, 0], 0.12, cA);
    strut(c, [sx + dx, 0.07, z + 1.2], [sx + dx, 2.4, z], [1, 0, 0], 0.12, cA);
  }
  c.box(sx - 2.3, 2.35, z - 0.06, sx + 2.3, 2.47, z + 0.06, cA);
  for (const dx of [-0.9, 0.9]) c.box(sx + dx - 0.25, 0.45, z - 0.15, sx + dx + 0.25, 0.52, z + 0.15, X.lampPole);
  // slide: platform tower and a sloped chute
  const px = x + 4.2 * k;
  c.box(px - 0.8, 0, z - 2.3, px + 0.8, 1.6, z - 0.7, cB, shade(cB, 1.05));
  c.qa([px - 0.45, 1.6, z - 0.7], [px - 0.45, 0.2, z + Math.min(2.6, d / 2 - 0.6)], [px + 0.45, 0.2, z + Math.min(2.6, d / 2 - 0.6)], [px + 0.45, 1.6, z - 0.7], P.ind.silver);
  // climbing frame (larger playgrounds)
  if (w >= 14) c.box(x + 0.4, 0, z + 2.2, x + 2.4, 1.2, z + 4.2, X.timber, shade(X.timber, 1.1));
}

/** Café kiosk with an awning and two parasols over tables. */
function kiosk(c: Ctx, x: number, z: number, awning: RGB): void {
  c.ground(x - 6, z - 2.5, x + 6, z + 5, P.road.plaza, FL_PAVED | FL_SNOW, Y_GROUND + 0.015);
  c.box(x - 2.5, 0, z - 2, x + 2.5, 3, z + 1, P.wall.warmWhite, P.roof.tar);
  c.qa([x - 2.7, 2.6, z + 2.4], [x + 2.7, 2.6, z + 2.4], [x + 2.7, 3.0, z + 1.0], [x - 2.7, 3.0, z + 1.0], awning);
  c.box(x - 2.2, 1.0, z + 1.0, x + 2.2, 1.1, z + 1.4, X.timber);
  for (const dx of [-3.8, 3.8]) {
    c.cyl(x + dx, z + 3.2, 0.05, 0, 2.3, 4, X.lampPole, X.lampPole, false);
    c.cone(x + dx, z + 3.2, 1.4, 0, 2.1, 2.6, 6, shade(awning, 1.05));
  }
}

export const parkFactory: AssetFactory = {
  id: 'ambient:park',
  footprints: [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [3, 3], [4, 4], [5, 5]],
  triBudget: { lod0: 400, lod1: 20 },
  build,
};
