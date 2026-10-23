// Road tiles (art §3.2 cross-sections, §5.15): carriageway and sidewalk cells from the tile's neighbour mask, curbs,
// quarter-disc corner fillets, lane markings (LOD0 only), zebras and stop lines, medians and guard rails, bridges with
// parapets and piers, and the street furniture (lamps with light pools, street trees, traffic signals, bus shelters)
// as instanced props. Everything is written in world metres at y = 0 relative and lifted by the tile's warp function
// (terrain, or the bridge arch).
import type { GeoBuilder, RGB } from '../../assets/GeoBuilder';
import { WORLD_RGB, shade } from '../../assets/palette';
import { treeLook } from '../../assets/familiesA';
import { FLAG_PAVED, FLAG_SNOWABLE, FLAG_VEGETATION } from '../../materials/CityMaterial';
import { hash3 } from '../../env/rng';
import { PLOT_SIZE } from '../../units';
import { D_APARTMENTS, D_CBD, D_COMMERCIAL, D_HOUSES, D_MIXED, D_PARK, R_ARTERIAL, R_HIGHWAY, R_NONE } from '../layout/types';
import { MASK_E, MASK_N, MASK_S, MASK_W, carriageHalfWidth, cornerRadius, type RoadTile } from '../RoadNetwork';
import type { CityBuildContext } from './CityBuildContext';
import type { ChunkWriter } from './ChunkWriter';
import { boxW, lineUp, rectUp, triUp, wall } from './prims';

const C = {
  asphalt: WORLD_RGB.road.asphalt,
  asphaltDark: WORLD_RGB.road.asphaltDark,
  sidewalk: WORLD_RGB.road.sidewalk,
  curb: WORLD_RGB.road.curb,
  marking: WORLD_RGB.road.marking,
  yellow: WORLD_RGB.road.markingYellow,
  verge: WORLD_RGB.ground.grass,
  median: WORLD_RGB.ground.park,
  deck: [0x9a, 0x98, 0x90] as RGB,
  parapet: [0xc9, 0xc5, 0xbc] as RGB,
  pier: WORLD_RGB.wall.concreteDark,
  rail: [0xa7, 0xad, 0xb3] as RGB,
  barrier: WORLD_RGB.wall.concrete,
};

const HALF = PLOT_SIZE / 2;
const CURB = 0.15;
const PAINT = 0.025;
const DECK_THICK = 1.2;

interface Rect { x0: number; z0: number; x1: number; z1: number }

/** Arm directions: [dx, dz, mask bit]. */
const ARMS = [[0, -1, MASK_N], [1, 0, MASK_E], [0, 1, MASK_S], [-1, 0, MASK_W]] as const;

/** Carriageway rectangles of a tile in plot-local coordinates (origin at the plot centre, +X east, +Z south). */
export function carriageRects(ctx: CityBuildContext, t: RoadTile): Rect[] {
  const cw = carriageHalfWidth(t.cls, t.lanes);
  const rects: Rect[] = [{ x0: -cw, z0: -cw, x1: cw, z1: cw }];
  for (const [dx, dz, bit] of ARMS) {
    if (!(t.mask & bit)) continue;
    const n = ctx.net.tile(t.px + dx, t.pz + dz);
    const aw = Math.min(cw, n ? carriageHalfWidth(n.cls, n.lanes) : cw);
    if (dz === -1) rects.push({ x0: -aw, z0: -HALF, x1: aw, z1: -cw });
    else if (dz === 1) rects.push({ x0: -aw, z0: cw, x1: aw, z1: HALF });
    else if (dx === 1) rects.push({ x0: cw, z0: -aw, x1: HALF, z1: aw });
    else rects.push({ x0: -HALF, z0: -aw, x1: -cw, z1: aw });
  }
  return rects;
}

function inside(rects: readonly Rect[], x: number, z: number): boolean {
  for (const r of rects) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
  return false;
}

/** Corner fillet radius for a quadrant (0 NE, 1 SE, 2 SW, 3 NW), or 0 when none. */
function filletRadius(ctx: CityBuildContext, t: RoadTile, q: number, cw: number, rects: readonly Rect[]): number {
  const [a, b] = [[MASK_N, MASK_E], [MASK_E, MASK_S], [MASK_S, MASK_W], [MASK_W, MASK_N]][q];
  if (!(t.mask & a) || !(t.mask & b)) return 0;
  const sx = q === 0 || q === 1 ? 1 : -1, sz = q === 0 || q === 3 ? -1 : 1;
  if (ctx.isRoadish(t.px + sx, t.pz + sz)) return 0;
  // Only where both arms run at the full centre width (same-class crossings); mixed widths keep square corners.
  const armAt = (x: number, z: number) => inside(rects, x, z);
  if (!armAt(sx * (cw - 0.01), sz * (HALF - 0.01)) || !armAt(sx * (HALF - 0.01), sz * (cw - 0.01))) return 0;
  const r = Math.min(cornerRadius(t.cls), HALF - cw - 0.5);
  return r >= 1.5 ? r : 0;
}

/** Fillet radius used to keep furniture off the rounded corner (same rule as filletRadius). */
function fallbackFillet(cls: number, cw: number): number {
  const r = Math.min(cornerRadius(cls), HALF - cw - 0.5);
  return r >= 1.5 ? r : 0;
}

export interface RoadOptions {
  /** District of the plot (street trees in residential and commercial areas). */
  district: number;
  climate: string;
  season: number;
}

/** Writes one road (or bridge) tile into both LODs, plus furniture props. */
export function buildRoadTile(ctx: CityBuildContext, w: ChunkWriter, t: RoadTile, o: RoadOptions): void {
  const cx = ctx.x0(t.px) + HALF, cz = ctx.z0(t.pz) + HALF;
  const cw = carriageHalfWidth(t.cls, t.lanes);
  const rects = carriageRects(ctx, t);
  const highway = t.cls === R_HIGHWAY;
  const bridge = t.bridge;
  const fn = bridge ? ctx.bridge : ctx.terrain;
  const seed = ctx.grid.seed;
  const asphalt = shade(t.cls >= R_ARTERIAL ? C.asphaltDark : C.asphalt, 0.97 + 0.06 * hash3(t.px, t.pz, seed, 7));
  const fillets = [0, 1, 2, 3].map((q) => (bridge || highway ? 0 : filletRadius(ctx, t, q, cw, rects)));
  const alongX = t.mask === (MASK_E | MASK_W) || (t.mask & (MASK_E | MASK_W)) !== 0 && (t.mask & (MASK_N | MASK_S)) === 0;
  const alongZ = t.mask === (MASK_N | MASK_S) || (t.mask & (MASK_N | MASK_S)) !== 0 && (t.mask & (MASK_E | MASK_W)) === 0;
  const straight = t.type === 'straight';

  w.both((b, lod) => {
    // ---- cells from the breakpoints of every rectangle edge
    const xs = new Set<number>([-HALF, HALF]), zs = new Set<number>([-HALF, HALF]);
    for (const r of rects) { xs.add(r.x0); xs.add(r.x1); zs.add(r.z0); zs.add(r.z1); }
    const X = [...xs].sort((a, c) => a - c), Z = [...zs].sort((a, c) => a - c);
    const nonRoadSide = (dx: number, dz: number) => !ctx.isRoadish(t.px + dx, t.pz + dz);
    for (let i = 0; i + 1 < X.length; i++) {
      for (let j = 0; j + 1 < Z.length; j++) {
        const x0 = X[i], x1 = X[i + 1], z0 = Z[j], z1 = Z[j + 1];
        if (x1 - x0 < 1e-3 || z1 - z0 < 1e-3) continue;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if (inside(rects, mx, mz)) {
          b.flags = FLAG_PAVED | FLAG_SNOWABLE;
          rectUp(b, cx + x0, cz + z0, cx + x1, cz + z1, 0, asphalt);
          continue;
        }
        // Sidewalk (or highway verge) cell; corner cells with a fillet are drawn below.
        const q = mx > 0 ? (mz < 0 ? 0 : 1) : (mz > 0 ? 2 : 3);
        const r = fillets[q];
        const isCorner = r > 0 && Math.abs(mx) > cw && Math.abs(mz) > cw;
        if (isCorner) continue;
        const top = highway ? 0.02 : CURB;
        b.flags = highway ? FLAG_VEGETATION | FLAG_SNOWABLE : FLAG_PAVED | FLAG_SNOWABLE;
        rectUp(b, cx + x0, cz + z0, cx + x1, cz + z1, top, highway ? C.verge : C.sidewalk);
        if (highway) continue;
        b.flags = 0;
        // Curb faces towards carriageway cells (inside the plot or across the plot edge) and at the plot edge
        // towards non-road land.
        const faceN = z0 > -HALF + 1e-3 ? inside(rects, mx, z0 - 0.01) : nonRoadSide(0, -1) || carriageAcross(ctx, t, mx, -1, 'z');
        const faceS = z1 < HALF - 1e-3 ? inside(rects, mx, z1 + 0.01) : nonRoadSide(0, 1) || carriageAcross(ctx, t, mx, 1, 'z');
        const faceW = x0 > -HALF + 1e-3 ? inside(rects, x0 - 0.01, mz) : nonRoadSide(-1, 0) || carriageAcross(ctx, t, mz, -1, 'x');
        const faceE = x1 < HALF - 1e-3 ? inside(rects, x1 + 0.01, mz) : nonRoadSide(1, 0) || carriageAcross(ctx, t, mz, 1, 'x');
        if (lod === 0 || bridge) {
          if (faceN) wall(b, cx + x1, cz + z0, cx + x0, cz + z0, 0, 0, top, top, [0, -1], C.curb);
          if (faceS) wall(b, cx + x0, cz + z1, cx + x1, cz + z1, 0, 0, top, top, [0, 1], C.curb);
          if (faceW) wall(b, cx + x0, cz + z0, cx + x0, cz + z1, 0, 0, top, top, [-1, 0], C.curb);
          if (faceE) wall(b, cx + x1, cz + z1, cx + x1, cz + z0, 0, 0, top, top, [1, 0], C.curb);
        }
      }
    }
    // ---- corner fillets
    for (let q = 0; q < 4; q++) {
      const r = fillets[q];
      if (r <= 0) continue;
      corner(b, cx, cz, cw, r, q, asphalt, lod);
    }
    // ---- medians, guard rails
    if (straight && (alongX || alongZ)) {
      if (t.cls === R_ARTERIAL && !bridge) {
        b.flags = FLAG_VEGETATION | FLAG_SNOWABLE;
        if (alongX) boxW(b, cx - HALF, 0, cz - 1, cx + HALF, CURB, cz + 1, C.curb, C.median);
        else boxW(b, cx - 1, 0, cz - HALF, cx + 1, CURB, cz + HALF, C.curb, C.median);
      } else if (highway) {
        b.flags = 0;
        if (alongX) boxW(b, cx - HALF, 0, cz - 0.3, cx + HALF, 0.8, cz + 0.3, C.barrier);
        else boxW(b, cx - 0.3, 0, cz - HALF, cx + 0.3, 0.8, cz + HALF, C.barrier);
      }
    }
    // ---- markings (LOD0)
    if (lod === 0) markings(ctx, b, t, cx, cz, cw, alongX, alongZ);
    // ---- bridge structure
    if (bridge) bridgeStructure(b, t, cx, cz, cw, alongX, lod, hash3(t.px, t.pz, seed, 31) < 0.5);
  }, fn);

  furniture(ctx, w, t, cx, cz, cw, alongX, alongZ, o);
}

/** Whether the neighbouring tile across a plot edge has carriageway at the shared edge point. */
function carriageAcross(ctx: CityBuildContext, t: RoadTile, along: number, dir: number, axis: 'x' | 'z'): boolean {
  const n = axis === 'z' ? ctx.net.tile(t.px, t.pz + dir) : ctx.net.tile(t.px + dir, t.pz);
  if (!n) return false;
  const rects = carriageRects(ctx, n);
  return axis === 'z' ? inside(rects, along, -dir * (HALF - 0.01)) : inside(rects, -dir * (HALF - 0.01), along);
}

/** Quarter-disc corner: sidewalk with a rounded inner corner, the asphalt fillet and the curved curb. */
function corner(b: GeoBuilder, cx: number, cz: number, cw: number, r: number, q: number, asphalt: RGB, lod: 0 | 1): void {
  const sx = q === 0 || q === 1 ? 1 : -1, sz = q === 0 || q === 3 ? -1 : 1;
  const P = (u: number, v: number, y: number): number[] => [cx + sx * u, y, cz + sz * v];
  const seg = lod === 0 ? 8 : 3;
  // Canonical quadrant: u along x (outwards), v along z (outwards); inner corner I = (cw, cw), centre C = (cw+r, cw+r).
  const arc: Array<[number, number]> = [];
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * (Math.PI / 2);
    // From A = (cw, cw + r) (on the u = cw curb) to B = (cw + r, cw) (on the v = cw curb), bulging towards I.
    arc.push([cw + r - r * Math.cos(a), cw + r - r * Math.sin(a)]);
  }
  b.flags = FLAG_PAVED | FLAG_SNOWABLE;
  const Cc: [number, number] = [cw + r, cw + r];
  const ring: Array<[number, number]> = [[cw, HALF], [HALF, HALF], [HALF, cw], ...arc.slice().reverse(), [cw, cw + r]];
  // Fan from the circle centre over the sidewalk outline (star-shaped from C).
  for (let k = 0; k + 1 < ring.length; k++) {
    const p = ring[k], n = ring[k + 1];
    if (Math.hypot(p[0] - n[0], p[1] - n[1]) < 1e-4) continue;
    triUp(b, P(Cc[0], Cc[1], CURB), P(p[0], p[1], CURB), P(n[0], n[1], CURB), WORLD_RGB.road.sidewalk);
  }
  const last = ring[ring.length - 1], first = ring[0];
  triUp(b, P(Cc[0], Cc[1], CURB), P(last[0], last[1], CURB), P(first[0], first[1], CURB), WORLD_RGB.road.sidewalk);
  // Asphalt fillet: fan from the inner corner over the arc.
  for (let k = 0; k + 1 < arc.length; k++) triUp(b, P(cw, cw, 0), P(arc[k][0], arc[k][1], 0), P(arc[k + 1][0], arc[k + 1][1], 0), asphalt);
  // Curbs: straight parts along u = cw (v from cw + r to HALF) and v = cw (u from cw + r to HALF), and the arc.
  b.flags = 0;
  const curbSeg = (u0: number, v0: number, u1: number, v1: number, nu: number, nv: number) => {
    const a = P(u0, v0, 0), c = P(u1, v1, 0);
    wall(b, a[0], a[2], c[0], c[2], 0, 0, CURB, CURB, [sx * nu, sz * nv], C.curb);
  };
  if (lod === 0) {
    curbSeg(cw, cw + r, cw, HALF, -1, 0);
    curbSeg(cw + r, cw, HALF, cw, 0, -1);
    for (let k = 0; k + 1 < arc.length; k++) {
      const [u0, v0] = arc[k], [u1, v1] = arc[k + 1];
      const mu = (u0 + u1) / 2 - Cc[0], mv = (v0 + v1) / 2 - Cc[1], ml = Math.hypot(mu, mv) || 1;
      curbSeg(u0, v0, u1, v1, mu / ml, mv / ml);
    }
  }
}

function markings(ctx: CityBuildContext, b: GeoBuilder, t: RoadTile, cx: number, cz: number, cw: number, alongX: boolean, alongZ: boolean): void {
  b.flags = FLAG_PAVED;
  const straight = t.type === 'straight';
  // Line helper in tile-local "along / across" coordinates for the run axis.
  const L = (a0: number, c0: number, a1: number, c1: number, wid: number, rgb: RGB) => {
    if (alongX) lineUp(b, cx + a0, cz + c0, cx + a1, cz + c1, wid, PAINT, rgb);
    else lineUp(b, cx + c0, cz + a0, cx + c1, cz + a1, wid, PAINT, rgb);
  };
  if (straight && (alongX || alongZ)) {
    const phase = (alongX ? t.px : t.pz) % 2 === 0 ? 0 : 3;
    if (t.cls === R_HIGHWAY) {
      for (let k = 0; k < 4; k++) {
        const a = -HALF + 1.5 + k * 6;
        for (const off of [4.5, -4.5]) L(a, off, a + 3, off, 0.15, C.marking);
      }
      L(-HALF, cw - 0.4, HALF, cw - 0.4, 0.15, C.marking);
      L(-HALF, -cw + 0.4, HALF, -cw + 0.4, 0.15, C.marking);
      L(-HALF, 1.2, HALF, 1.2, 0.15, C.yellow);
      L(-HALF, -1.2, HALF, -1.2, 0.15, C.yellow);
    } else if (t.cls === R_ARTERIAL) {
      for (let k = 0; k < 3; k++) {
        const a = -HALF + phase + k * 9 + 1;
        if (a + 3 > HALF) continue;
        L(a, 4.25, a + 3, 4.25, 0.12, C.marking);
        L(a, -4.25, a + 3, -4.25, 0.12, C.marking);
      }
      L(-HALF, cw - 0.35, HALF, cw - 0.35, 0.12, C.marking);
      L(-HALF, -cw + 0.35, HALF, -cw + 0.35, 0.12, C.marking);
    } else {
      for (let k = 0; k < 4; k++) {
        const a = -HALF + 1.5 + k * 6;
        L(a, 0, a + 3, 0, 0.14, C.marking);
      }
      // Parking-bay ticks every 6 m on both sides (lane edge 3.5 m → curb 6 m).
      for (let k = 0; k <= 4; k++) {
        const a = -HALF + k * 6;
        if (a <= -HALF + 0.5 || a >= HALF - 0.5) continue;
        L(a, 3.6, a, 5.6, 0.12, C.marking);
        L(a, -3.6, a, -5.6, 0.12, C.marking);
      }
    }
    // Zebras (and stop lines on arterials) on the sides that face an intersection.
    const dirs: Array<[number, number]> = alongX ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      const n = ctx.net.tile(t.px + dx, t.pz + dz);
      if (!n || (n.type !== 'tee' && n.type !== 'cross')) continue;
      const s = dx + dz;           // +1 towards +X/+Z
      const zebraW = t.cls === R_HIGHWAY ? 0 : cw - 0.4;
      for (let off = -zebraW + 0.3; off + 0.6 <= zebraW; off += 1.2) {
        const a0 = s * (HALF - 1), a1 = s * (HALF - 5);
        if (alongX) rectUp(b, cx + a0, cz + off, cx + a1, cz + off + 0.6, PAINT, C.marking);
        else rectUp(b, cx + off, cz + a0, cx + off + 0.6, cz + a1, PAINT, C.marking);
      }
      if (t.cls === R_ARTERIAL) {
        // Stop line across the lanes that approach the intersection (right-hand traffic: the half right of travel).
        const a = s * (HALF - 6.2);
        const lo = alongX ? (s > 0 ? 1 : -cw) : (s > 0 ? -cw : 1), hi = alongX ? (s > 0 ? cw : -1) : (s > 0 ? -1 : cw);
        if (alongX) rectUp(b, cx + a - 0.2, cz + lo, cx + a + 0.2, cz + hi, PAINT, C.marking);
        else rectUp(b, cx + lo, cz + a - 0.2, cx + hi, cz + a + 0.2, PAINT, C.marking);
      }
    }
  } else if (t.type === 'deadEnd') {
    // Turning-circle paint: a ring of short dashes.
    const r = Math.min(cw - 1.2, 4.5);
    for (let k = 0; k < 12; k += 2) {
      const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2;
      lineUp(b, cx + Math.cos(a0) * r, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, cz + Math.sin(a1) * r, 0.14, PAINT, C.marking);
    }
  }
}

function bridgeStructure(b: GeoBuilder, _t: RoadTile, cx: number, cz: number, cw: number, alongX: boolean, lod: 0 | 1, pier: boolean): void {
  b.flags = 0;
  const side = cw + 2.6;
  // Deck fascia (the slab edge seen from the water), parapets on both sides.
  if (alongX) {
    wall(b, cx + HALF, cz - side, cx - HALF, cz - side, -DECK_THICK, -DECK_THICK, CURB, CURB, [0, -1], C.deck);
    wall(b, cx - HALF, cz + side, cx + HALF, cz + side, -DECK_THICK, -DECK_THICK, CURB, CURB, [0, 1], C.deck);
    rectUp(b, cx - HALF, cz - side, cx + HALF, cz - cw, CURB, C.sidewalk);
    rectUp(b, cx - HALF, cz + cw, cx + HALF, cz + side, CURB, C.sidewalk);
    boxW(b, cx - HALF, CURB, cz - side, cx + HALF, CURB + 1.1, cz - side + 0.35, C.parapet);
    boxW(b, cx - HALF, CURB, cz + side - 0.35, cx + HALF, CURB + 1.1, cz + side, C.parapet);
    if (pier || lod === 1) boxW(b, cx - 1.4, -6, cz - side + 1, cx + 1.4, -DECK_THICK, cz + side - 1, C.pier);
  } else {
    wall(b, cx - side, cz - HALF, cx - side, cz + HALF, -DECK_THICK, -DECK_THICK, CURB, CURB, [-1, 0], C.deck);
    wall(b, cx + side, cz + HALF, cx + side, cz - HALF, -DECK_THICK, -DECK_THICK, CURB, CURB, [1, 0], C.deck);
    rectUp(b, cx - side, cz - HALF, cx - cw, cz + HALF, CURB, C.sidewalk);
    rectUp(b, cx + cw, cz - HALF, cx + side, cz + HALF, CURB, C.sidewalk);
    boxW(b, cx - side, CURB, cz - HALF, cx - side + 0.35, CURB + 1.1, cz + HALF, C.parapet);
    boxW(b, cx + side - 0.35, CURB, cz - HALF, cx + side, CURB + 1.1, cz + HALF, C.parapet);
    if (pier || lod === 1) boxW(b, cx - side + 1, -6, cz - 1.4, cx + side - 1, -DECK_THICK, cz + 1.4, C.pier);
  }
}

/** Lamps (with pools), street trees, traffic signals and bus shelters for one tile. */
function furniture(ctx: CityBuildContext, w: ChunkWriter, t: RoadTile, cx: number, cz: number, cw: number, alongX: boolean, alongZ: boolean, o: RoadOptions): void {
  const seed = ctx.grid.seed;
  const fn = t.bridge ? ctx.bridge : ctx.terrain;
  const lamp = (x: number, z: number, rotY: number) => {
    const y = fn(x, z) + CURB;
    w.prop('lamp.street', x, y, z, rotY);
    const hx = x + Math.sin(rotY) * 1.8, hz = z + Math.cos(rotY) * 1.8;
    w.lampHead(hx, y + 7.7, hz);
    w.pool(hx, fn(hx, hz) + 0.05, hz, 7);
  };
  if (t.type === 'straight' && (alongX || alongZ)) {
    const off = cw + (t.cls === R_HIGHWAY ? 2.5 : 0.8);
    const arterial = t.cls >= R_ARTERIAL;
    if (t.cls === R_HIGHWAY) {
      // Tall median lamps every other plot.
      if (((alongX ? t.px : t.pz) & 1) === 0) {
        if (alongX) { lamp(cx, cz - 0.6, Math.PI); lamp(cx, cz + 0.6, 0); } else { lamp(cx - 0.6, cz, -Math.PI / 2); lamp(cx + 0.6, cz, Math.PI / 2); }
      }
    } else if (alongX) {
      // Lamps face the road (+Z of the prop points at the carriageway).
      if (arterial) { lamp(cx - 4, cz - off, 0); lamp(cx + 4, cz + off, Math.PI); } else { lamp(cx - 6, cz - off, 0); lamp(cx + 6, cz + off, Math.PI); }
    } else {
      if (arterial) { lamp(cx - off, cz + 4, Math.PI / 2); lamp(cx + off, cz - 4, -Math.PI / 2); } else { lamp(cx - off, cz + 6, Math.PI / 2); lamp(cx + off, cz - 6, -Math.PI / 2); }
    }
    // Street trees: planting strips on streets in residential and commercial districts; grates on arterials.
    const d = o.district;
    const leafy = d === D_HOUSES || d === D_APARTMENTS || d === D_MIXED || d === D_COMMERCIAL || d === D_PARK || (d === D_CBD && arterial);
    if (leafy && !t.bridge && t.cls !== R_HIGHWAY) {
      const tOff = arterial ? cw + 3.2 : cw + 1.3;
      for (const along of [-9, 3]) {
        for (const side of [-1, 1]) {
          const h = hash3(t.px * 4 + (along > 0 ? 1 : 0), t.pz * 2 + (side > 0 ? 1 : 0), seed, 23);
          if (h < (arterial ? 0.1 : 0.25)) continue;
          const x = alongX ? cx + along * side : cx + side * tOff, z = alongX ? cz + side * tOff : cz + along * side;
          const species = o.climate === 'warm' && h > 0.7 ? 'palm' : h > 0.88 ? 'poplar' : 'deciduous';
          const look = treeLook(species, o.season, h, hash3(t.px, t.pz, seed, 29 + along), hash3(t.pz, t.px, seed, 37 + side));
          w.prop(look.family, x, fn(x, z) + CURB, z, h * 6.28, 0.75 + 0.3 * h, look.color);
        }
      }
    }
    // Bus shelters on arterials about every sixth plot.
    if (t.cls === R_ARTERIAL && !t.bridge && hash3(t.px, t.pz, seed, 41) < 0.16) {
      const side = hash3(t.px, t.pz, seed, 43) < 0.5 ? -1 : 1;
      const so = cw + 2.6;
      const x = alongX ? cx + 2 : cx + side * so, z = alongX ? cz + side * so : cz + 2;
      const rotY = alongX ? (side < 0 ? 0 : Math.PI) : (side < 0 ? Math.PI / 2 : -Math.PI / 2);
      w.prop('busShelter', x, fn(x, z) + CURB, z, rotY);
    }
  } else if (t.type === 'tee' || t.type === 'cross' || t.type === 'corner') {
    const node = t.node >= 0 ? ctx.net.nodes[t.node] : null;
    if (node?.signal) {
      // Four mast-arm signals, one per approach: pole at the left curb before the junction, arm across the lanes.
      for (const [dx, dz, bit] of ARMS) {
        if (!(t.mask & bit)) continue;
        const ux = -dx, uz = -dz;               // travel direction of traffic arriving from that arm
        const lx = uz, lz = -ux;                // left of travel
        const back = cw + fallbackFillet(t.cls, cw) + 1.0;
        const px = cx + dx * back + lx * (cw + 0.8), pz = cz + dz * back + lz * (cw + 0.8);
        const rotY = Math.atan2(-uz, ux);
        w.prop('signal.traffic', px, fn(px, pz) + CURB, pz, rotY);
      }
    } else if (t.type !== 'corner') {
      // Corner lamps at unsignalised junctions.
      const qx = hash3(t.px, t.pz, seed, 51) < 0.5 ? 1 : -1, qz = hash3(t.px, t.pz, seed, 53) < 0.5 ? 1 : -1;
      if (!ctx.isRoadish(t.px + qx, t.pz + qz) && ctx.net.classAt(t.px + qx, t.pz) !== R_NONE && ctx.net.classAt(t.px, t.pz + qz) !== R_NONE) {
        lamp(cx + qx * (cw + 0.8), cz + qz * (cw + fallbackFillet(t.cls, cw) + 1.5), Math.atan2(-qx, 0));
      }
    }
  }
}
