// Classical building parts for the civic family (art §4.3): temple portico (podium, steps, colonnade, entablature,
// pediment), domes on drums, rusticated blocks with cornice and balustrade, pilasters, civic flags and uplighting.
// Used by the city hall, stock exchange, bank and the university library.
import type { RGB } from '../../GeoBuilder';
import { EM, FAC } from '../common-a/constants';
import { Ctx, FACADE, Side, ngonPts, type Fac } from '../common-a/ctx';
import { colonnade, flagpole, pediment } from '../common-a/kit';
import { P, X, shade } from '../common-a/palette';

/** Stone for civic masonry (limestone dominates; art §4.3 "limestone, stone"). */
export const CIVIC_STONES: readonly RGB[] = [P.wall.limestone, P.wall.limestone, P.wall.stone, P.wall.sandWall, P.wall.warmWhite, P.wall.greige];
/** Civic roofs: copper domes and blue-grey slate (government buildings read blue-grey, caplab §5.6). */
export const CIVIC_ROOFS: readonly RGB[] = [P.roof.copper, P.roof.slate];

/** Monumental storeys (6 m floors, 4 m bays: tall windows) for halls, exchanges and libraries. */
export const GRAND: Fac = { style: FAC.HOUSE, floor: 6.0, bay: 4.0 };

export interface PorticoSpec {
  /** Number of columns and their radius. */
  cols: number;
  r: number;
  /** Podium height (the top step) and the column top above the ground. */
  base: number;
  colTop: number;
  /** Portico depth measured out from the wall. */
  depth: number;
  /** Entablature height and pediment rise (rise 0 = flat attic, no pediment). */
  entH: number;
  rise: number;
  stone: RGB;
  roof: RGB;
}

/**
 * Temple front on side `s` spanning u0..u1: podium with a flight of steps to the street and columns (LOD0), then the
 * entablature and pediment (also at LOD1). Roughly 21 + 8 · steps + 16 · cols triangles at LOD0, 8–13 at LOD1.
 */
export function portico(c: Ctx, s: Side, u0: number, u1: number, t: PorticoSpec): void {
  const a0 = u0 - 0.8, a1 = u1 + 0.8;
  const top = shade(t.stone, 1.05);
  if (c.lod === 0) {
    // podium, a flight of steps widening towards the street, the columns (the city band keeps the roof only)
    c.sideBox(s, a0, a1, 0, t.base, 0, t.depth + 0.6, t.stone, top);
    const n = Math.max(2, Math.min(6, Math.round(t.base / 0.18)));
    for (let k = 1; k < n; k++) {
      const y = (t.base * (n - k)) / n;
      c.sideBox(s, a0 - k * 0.35, a1 + k * 0.35, 0, y, t.depth + 0.6 + (k - 1) * 0.45, t.depth + 0.6 + k * 0.45, t.stone, top);
    }
    colonnade(c, s, u0 + t.r + 0.4, u1 - t.r - 0.4, t.cols, t.r, t.base, t.colTop, t.depth - t.r - 0.5, shade(t.stone, 1.06));
  }
  if (t.rise > 0) pediment(c, s, u0, u1, t.colTop, t.entH, t.rise, t.depth, t.stone, t.roof);
  else c.sideBox(s, u0, u1, t.colTop, t.colTop + t.entH, -0.2, t.depth, t.stone, top);
}

/**
 * Drum with tall windows, a ledge, a dome and a lantern with a finial. Returns the top of the finial.
 * LOD1: a hexagonal drum with a two-ring dome (30 triangles) so the landmark still reads at city zoom.
 */
export function drumDome(c: Ctx, x: number, z: number, y0: number, r: number, drumH: number, domeRise: number, stone: RGB, dome: RGB, segs = 16): number {
  if (c.lod === 1) {
    c.prism(ngonPts(x, z, r, r, 6), y0, y0 + drumH, stone, FACADE.civic, null, { vBase: y0 - 5 });
    c.dome(x, y0 + drumH, z, r + 0.4, domeRise, 2, 6, dome);
    return y0 + drumH + domeRise;
  }
  c.prism(ngonPts(x, z, r, r, segs), y0, y0 + drumH, stone, FACADE.civic, null, { vBase: y0 - 5 });
  const ly = y0 + drumH;
  c.prism(ngonPts(x, z, r + 0.6, r + 0.6, segs), ly, ly + 0.6, shade(stone, 1.05), null, shade(stone, 1.05));
  c.dome(x, ly + 0.6, z, r + 0.2, domeRise, 4, segs, dome);
  const lt = ly + 0.6 + domeRise;
  c.cyl(x, z, r * 0.16, lt - 0.3, lt + 2.2, 8, stone, dome);
  c.cone(x, z, r * 0.2, 0, lt + 2.2, lt + 3.6, 8, dome);
  c.cyl(x, z, 0.08, lt + 3.6, lt + 5.0, 4, X.bronze, X.bronze);
  return lt + 5.0;
}

export interface BlockSpec {
  /** Rusticated base height (blank, darker stone). */
  base: number;
  /** Facade for the storeys above the base (null = blank). */
  fac: Fac | null;
  roof: RGB;
  /** Cornice at the top of the facade and a balustrade above it (LOD0). */
  cornice?: boolean;
  balustrade?: boolean;
  /** Walls to emit (bit mask as Ctx.mass: 1 front, 2 right, 4 back, 8 left). */
  sides?: number;
}

/**
 * Classical masonry block: a rusticated base, storeys with tall windows, a projecting cornice and a balustrade.
 * About 58 triangles at LOD0 and 10 at LOD1 (a single mass with the same windows and roof colour).
 */
export function classicalBlock(c: Ctx, x0: number, z0: number, x1: number, z1: number, h: number, stone: RGB, t: BlockSpec): void {
  const sides = t.sides ?? 15;
  if (c.lod === 1) {
    c.mass(x0, z0, x1, z1, 0, h, stone, t.fac, t.roof, { vBase: t.base, sides });
    return;
  }
  if (t.base > 0) c.mass(x0, z0, x1, z1, 0, t.base, shade(stone, 0.86), null, null, { sides });
  c.mass(x0, z0, x1, z1, t.base, h, stone, t.fac, t.roof, { vBase: t.base, sides });
  if (t.cornice !== false) c.cornice(x0, z0, x1, z1, h - 0.7, shade(stone, 1.04), 0.7, 0.45);
  if (t.balustrade) c.parapet(x0, z0, x1, z1, h, shade(stone, 0.97), 1.0, 0.35);
}

/** Engaged pilasters: `n` flat piers on side `s` between u0 and u1 (classical wall rhythm), w wide, `out` deep. */
export function pilasters(c: Ctx, s: Side, u0: number, u1: number, n: number, y0: number, y1: number, w: number, out: number, col: RGB): void {
  if (c.lod === 1) return;
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? (u0 + u1) / 2 : u0 + ((u1 - u0) * i) / (n - 1);
    c.sideBox(s, u - w / 2, u + w / 2, y0, y1, 0, out, col);
  }
}

/** Flagpole with the city flag (civic blue). */
export function cityFlag(c: Ctx, x: number, z: number, h: number, base = 0): void {
  if (c.lod === 1) return;
  flagpole(c, x, z, h, X.cityFlag, base);
}

/** Warm uplight strip at the foot of a facade (civic buildings glow from below at night, art §4.3). */
export function uplight(c: Ctx, s: Side, u0: number, u1: number, y = 0.15): void {
  if (c.lod === 1) return;
  c.panel(s, u0, u1, y, y + 0.3, 0.12, X.warmLight, c.closed ? 0 : EM.soft);
}

/** Bronze double doors (bank, exchange, hall), flush with the wall. */
export function bronzeDoors(c: Ctx, s: Side, u: number, w: number, h: number, y0 = 0): void {
  if (c.lod === 1) return;
  c.panel(s, u - w / 2, u + w / 2, y0, y0 + h, 0.05, X.bronze);
  c.panel(s, u - 0.05, u + 0.05, y0, y0 + h, 0.07, shade(X.bronze, 0.75));
}
