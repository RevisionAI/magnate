// Higher-level building parts shared by the W3 families: roof dressing, entrances, awnings, signs, flags,
// classical orders, parking lots, emblems and the "closed" look. All work in the lot frame through a Ctx.
import type { RGB } from '../../GeoBuilder';
import { OWNER_EMBLEMS } from '@/theme/tokens';
import { EM, FL_PAVED, FL_SNOW, FL_VEG, Y_GROUND, Y_PAINT } from './constants';
import { Ctx, Side, type V3, type XZ } from './ctx';
import { P, X, shade } from './palette';
import type { PropId } from './propIds';

// ------------------------------------------------------------------------------------------- roofs

/** Fascia boards under the eaves of a pitched roof (crisp light line along the roof edge). */
export function eaveFascia(c: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, o: number, alongX: boolean | 'hip', col: RGB): void {
  const ox0 = x0 - o, ox1 = x1 + o, oz0 = z0 - o, oz1 = z1 + o, yb = y - 0.22, yt = y + 0.02;
  if (alongX === true || alongX === 'hip') {
    c.wall(ox0, oz1, ox1, oz1, yb, yt, col, null);
    c.wall(ox1, oz0, ox0, oz0, yb, yt, col, null);
  }
  if (alongX === false || alongX === 'hip') {
    c.wall(ox1, oz1, ox1, oz0, yb, yt, col, null);
    c.wall(ox0, oz0, ox0, oz1, yb, yt, col, null);
  }
}

/** Rooftop HVAC unit (3 × 2 × 1.5 m by default) with a dark fan grille on top. */
export function hvac(c: Ctx, x: number, z: number, y: number, w = 3, d = 2, h = 1.5, col: RGB = P.ind.galvanized): void {
  c.boxc(x, z, w, d, y, h, col, shade(col, 1.05));
  const r = Math.min(w, d) * 0.3;
  c.disc(x, z, r, y + h + 0.02, 6, P.ind.dockDoors);
}

/** Lift overrun / stair house on a flat roof. */
export function plantRoom(c: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, h: number, wall: RGB, roof: RGB = P.roof.tar): void {
  c.box(x0, y, z0, x1, y + h, z1, wall, roof);
}

/** Timber water tank on a low steel frame (older apartment blocks). */
export function waterTank(c: Ctx, x: number, z: number, y: number, r = 1.5): void {
  c.box(x - r * 0.8, y, z - r * 0.8, x + r * 0.8, y + 1.0, z + r * 0.8, X.lampPole, X.lampPole, false);
  c.cyl(x, z, r, y + 1.0, y + 3.6, 6, X.timber, X.timber, false);
  c.cone(x, z, r * 1.08, 0, y + 3.6, y + 4.6, 6, P.roof.tar);
}

/** Rows of tilted solar panels covering `share` of a flat roof (art §4.2.2 L3: 0.3 m gaps). */
export function solarRows(c: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, rowDepth = 1.7, gap = 0.9): void {
  const tilt = 0.55;
  c.withFlags(FL_SNOW, () => {
    for (let z = z1 - 0.5; z - rowDepth >= z0 + 0.5; z -= rowDepth + gap) {
      const zb = z, zt = z - rowDepth;
      // panel faces south (+Z) and up: low edge at the front
      c.qa([x0, y + 0.25, zb], [x1, y + 0.25, zb], [x1, y + 0.25 + tilt, zt], [x0, y + 0.25 + tilt, zt], P.roof.solar);
      c.qa([x1, y + 0.25 + tilt, zt], [x1, y, zt], [x0, y, zt], [x0, y + 0.25 + tilt, zt], X.lampPole);
    }
  });
}

/** Low glazed roof light (skylight strip). */
export function skylight(c: Ctx, x0: number, z0: number, x1: number, z1: number, y: number): void {
  c.box(x0, y, z0, x1, y + 0.5, z1, P.ind.galvanized, P.ind.glass2);
}

/** Thin mast with an aviation light on top (towers over 60 m, masts; art §3.13). */
export function antenna(c: Ctx, x: number, z: number, y: number, h: number, light = true): void {
  c.cyl(x, z, 0.12, y, y + h, 4, X.lampPole, X.lampPole, false);
  if (light) c.boxc(x, z, 0.4, 0.4, y + h, 0.4, X.aviation, X.aviation, EM.lamp);
}

/** Red obstruction light box (static; blinking needs a shader hook, see status doc). */
export function aviationLight(c: Ctx, x: number, z: number, y: number, s = 0.45): void {
  c.boxc(x, z, s, s, y, s, X.aviation, X.aviation, EM.lamp);
}

// ------------------------------------------------------------------------------------------- entrances and shopfronts

/** Flat entrance canopy over a door: slab `depth` deep, `w` wide, top at y. */
export function canopy(c: Ctx, s: Side, u: number, w: number, depth: number, y: number, col: RGB, thick = 0.25, em = 0): void {
  c.sideBox(s, u - w / 2, u + w / 2, y - thick, y, 0, depth, col, col, em, 0);
}

/** Door panel (flush, 4 cm proud of the wall). */
export function door(c: Ctx, s: Side, u: number, w: number, h: number, col: RGB, y0 = 0): void {
  c.panel(s, u - w / 2, u + w / 2, y0, y0 + h, 0.04, col);
}

/**
 * Sloped shop awning along a side: top edge on the wall at y1, front edge `depth` out at y0, with a valance.
 * `cols` alternate per segment (striped awnings); one colour = plain.
 */
export function awning(c: Ctx, s: Side, u0: number, u1: number, y0: number, y1: number, depth: number, cols: readonly RGB[], segments = 1): void {
  const n = Math.max(1, segments);
  const val = 0.3;
  c.withFlags(FL_SNOW, () => {
    for (let i = 0; i < n; i++) {
      const a = u0 + ((u1 - u0) * i) / n, b = u0 + ((u1 - u0) * (i + 1)) / n;
      const col = cols[i % cols.length];
      c.qa(s.p(a, y0, depth), s.p(b, y0, depth), s.p(b, y1, 0.02), s.p(a, y1, 0.02), col);
      c.panel(s, a, b, y0 - val, y0, depth, shade(col, 0.92));
    }
  });
  const end = shade(cols[0], 0.85);
  c.ta(s.p(u1, y1, 0.02), s.p(u1, y0, depth), s.p(u1, y0 - val, depth), end);
  c.ta(s.p(u0, y0 - val, depth), s.p(u0, y0, depth), s.p(u0, y1, 0.02), end);
}

/** Plywood boards over a shop's glazing band (closed / bankrupt, art §3.16): one board per 4.5 m bay. */
export function boardedUp(c: Ctx, s: Side, u0: number, u1: number, y0 = 0.3, y1 = 3.4): void {
  const n = Math.max(1, Math.round((u1 - u0) / 4.5));
  const w = (u1 - u0) / n;
  for (let i = 0; i < n; i++) c.panel(s, u0 + i * w + 0.12, u0 + (i + 1) * w - 0.12, y0, y1, 0.05, i % 2 ? X.boarded : shade(X.boarded, 1.08));
}

/** Three dry-grass weed patches on open parts of a closed lot (art §4.1). `areas` = candidate rectangles. */
export function weeds(c: Ctx, areas: readonly [number, number, number, number][]): void {
  if (!c.closed || areas.length === 0) return;
  const r = c.shape.fork(0x3eed);
  for (let i = 0; i < 3; i++) {
    const [x0, z0, x1, z1] = areas[i % areas.length];
    const w = Math.min(x1 - x0, 3.5), d = Math.min(z1 - z0, 2.5);
    if (w <= 0.5 || d <= 0.5) continue;
    const x = r.range(x0 + w / 2, x1 - w / 2), z = r.range(z0 + d / 2, z1 - d / 2);
    const k = r.range(0.6, 1);
    c.groundFan(
      x,
      z,
      [[x - w / 2, z + d * 0.3], [x - w * 0.1, z + d / 2], [x + w / 2, z + d * 0.2 * k], [x + w * 0.3, z - d / 2], [x - w * 0.4, z - d * 0.4]] as XZ[],
      P.ground.dryGrass,
      FL_VEG | FL_SNOW,
      Y_GROUND + 0.03,
    );
  }
}

// ------------------------------------------------------------------------------------------- owner paint and signage

/** Flagpole with a static flag (owner colour on company lots). The cloth hangs towards local +X. */
export function flagpole(c: Ctx, x: number, z: number, h: number, cloth: RGB, base = 0): void {
  c.cyl(x, z, 0.07, base, base + h, 4, P.wall.warmWhite, P.wall.warmWhite, false);
  c.boxc(x, z, 0.2, 0.2, base + h, 0.18, P.ind.safetyYellow);
  const top = base + h - 0.2, fh = Math.min(1.6, h * 0.14), fw = fh * 1.6;
  const k = shade(cloth, 0.9);
  // two-sided, two segments with a slight wave so it reads at street zoom
  const p0: V3 = [x + 0.08, top, z], p1: V3 = [x + 0.08 + fw * 0.5, top - 0.05, z + 0.18], p2: V3 = [x + 0.08 + fw, top - 0.12, z];
  const q0: V3 = [p0[0], top - fh, z], q1: V3 = [p1[0], top - fh - 0.05, z + 0.18], q2: V3 = [p2[0], top - fh - 0.12, z];
  c.qa(q0, q1, p1, p0, cloth);
  c.qa(q1, q2, p2, p1, k);
  c.qa(p0, p1, q1, q0, k);
  c.qa(p1, p2, q2, q1, cloth);
}

/** Free-standing pylon sign (owner colour, glowing, emblem plate) — e.g. at a supermarket entrance. */
export function pylon(c: Ctx, x: number, z: number, h: number, w: number, yaw = 0): void {
  const s = new Side(x - (w / 2) * Math.cos(yaw), z + (w / 2) * Math.sin(yaw), x + (w / 2) * Math.cos(yaw), z - (w / 2) * Math.sin(yaw));
  // legs
  c.boxc(s.x(0.25), s.z(0.25), 0.35, 0.35, 0, h * 0.45, P.wall.concreteDark);
  c.boxc(s.x(w - 0.25), s.z(w - 0.25), 0.35, 0.35, 0, h * 0.45, P.wall.concreteDark);
  // sign cabinet: both faces carry the wordmark
  const back = new Side(s.bx, s.bz, s.ax, s.az);
  c.sideBox(s, 0, w, h * 0.45, h, -0.3, 0.3, c.signC, P.wall.concreteDark, c.signEm, 0);
  c.panel(back, 0, w, h * 0.45, h, 0.3, c.signC, c.signEm);
  if (!c.closed) {
    c.sign(s, 0.2, w - 0.2, h * 0.5, h * 0.92, 0.32);
    c.sign(back, 0.2, w - 0.2, h * 0.5, h * 0.92, 0.32);
  }
}

/** Vertical banner (owner colour) hanging on a side between y0 and y1. */
export function banner(c: Ctx, s: Side, u: number, w: number, y0: number, y1: number, out = 0.35): void {
  c.sideBox(s, u - w / 2, u + w / 2, y0, y1, out - 0.1, out, c.own, c.own, c.closed ? 0 : EM.soft);
  c.panel(s, u - 0.06, u + 0.06, y0 - 0.2, y1 + 0.4, 0.06, X.lampPole);
}

/** Emblem outlines (unit radius, u right / v up), parallel to tokens.OWNER_EMBLEMS. Rings are drawn as annuli. */
function emblemPts(kind: (typeof OWNER_EMBLEMS)[number]): [number, number][] {
  const poly = (n: number, rot: number, r = 1): [number, number][] => Array.from({ length: n }, (_, i) => [Math.cos(rot + (i / n) * Math.PI * 2) * r, Math.sin(rot + (i / n) * Math.PI * 2) * r]);
  switch (kind) {
    case 'triangle': return poly(3, Math.PI / 2);
    case 'square': return poly(4, Math.PI / 4, 1.15);
    case 'diamond': return poly(4, Math.PI / 2, 1.15);
    case 'hexagon': return poly(6, 0);
    case 'star': return Array.from({ length: 10 }, (_, i) => {
      const a = Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 0.45 : 1;
      return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
    });
    case 'cross': {
      const t = 0.32;
      return [[t, -t], [1, -t], [1, t], [t, t], [t, 1], [-t, 1], [-t, t], [-1, t], [-1, -t], [-t, -t], [-t, -1], [t, -1]];
    }
    default: return poly(12, 0); // circle (and ring outline)
  }
}

/** Company emblem (owner's shape) as a flat glowing plate on a side, centred at (u, v), radius r. */
export function emblem(c: Ctx, s: Side, u: number, v: number, r: number, out: number, col: RGB, em: number, owner = c.owner): void {
  const kind = OWNER_EMBLEMS[owner >= 0 && owner < OWNER_EMBLEMS.length ? owner : 0];
  const pts = emblemPts(kind);
  const centre = s.p(u, v, out);
  if (kind === 'ring') {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      c.qa(s.p(u + a[0] * r * 0.62, v + a[1] * r * 0.62, out), s.p(u + a[0] * r, v + a[1] * r, out), s.p(u + b[0] * r, v + b[1] * r, out), s.p(u + b[0] * r * 0.62, v + b[1] * r * 0.62, out), col, em);
    }
    return;
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    c.ta(centre, s.p(u + a[0] * r, v + a[1] * r, out), s.p(u + b[0] * r, v + b[1] * r, out), col, em);
  }
}

/** Clock face with hands (city hall, church towers, stations); glows softly at night. */
export function clockFace(c: Ctx, s: Side, u: number, v: number, r: number, out = 0.06): void {
  const n = 12;
  const centre = s.p(u, v, out);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    c.ta(centre, s.p(u + Math.cos(a0) * r, v + Math.sin(a0) * r, out), s.p(u + Math.cos(a1) * r, v + Math.sin(a1) * r, out), P.wall.warmWhite, EM.faint);
  }
  const o2 = out + 0.03;
  c.qa(s.p(u - 0.06, v, o2), s.p(u + 0.06, v, o2), s.p(u + 0.06, v + r * 0.75, o2), s.p(u - 0.06, v + r * 0.75, o2), X.screenDark);
  c.qa(s.p(u, v - 0.05, o2), s.p(u + r * 0.55, v - 0.05, o2), s.p(u + r * 0.55, v + 0.05, o2), s.p(u, v + 0.05, o2), X.screenDark);
}

// ------------------------------------------------------------------------------------------- classical orders

/** Row of `n` round columns along a side, `out` metres in front of it, from y0 to y1. */
export function colonnade(c: Ctx, s: Side, u0: number, u1: number, n: number, r: number, y0: number, y1: number, out: number, col: RGB): void {
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? (u0 + u1) / 2 : u0 + ((u1 - u0) * i) / (n - 1);
    c.cyl(s.x(u, out), s.z(u, out), r, y0, y1, 8, col, col, false);
  }
}

/** Entablature + triangular pediment over a portico running along a side from u0 to u1, `depth` deep. */
export function pediment(c: Ctx, s: Side, u0: number, u1: number, y: number, entH: number, rise: number, depth: number, col: RGB, roof: RGB): void {
  c.sideBox(s, u0, u1, y, y + entH, -0.2, depth, col, col);
  const yt = y + entH, um = (u0 + u1) / 2;
  // tympanum (front triangle) and the two roof slopes back to the facade
  c.ta(s.p(u0, yt, depth), s.p(u1, yt, depth), s.p(um, yt + rise, depth), shade(col, 0.96));
  c.withFlags(FL_SNOW, () => {
    c.qa(s.p(um, yt + rise, depth + 0.3), s.p(u1, yt, depth + 0.3), s.p(u1, yt, -0.2), s.p(um, yt + rise, -0.2), roof);
    c.qa(s.p(u0, yt, depth + 0.3), s.p(um, yt + rise, depth + 0.3), s.p(um, yt + rise, -0.2), s.p(u0, yt, -0.2), roof);
  });
}

/** Broad flight of steps along a side (civic entrances), `n` steps of 0.17 m rising to `top`. */
export function steps(c: Ctx, s: Side, u0: number, u1: number, top: number, depth: number, col: RGB, n = 3): void {
  for (let i = 0; i < n; i++) {
    const y1 = (top * (n - i)) / n;
    c.sideBox(s, u0, u1, 0, y1, 0, depth * ((i + 1) / n), col, shade(col, 1.04));
  }
}

// ------------------------------------------------------------------------------------------- open ground

export interface ParkingOpts {
  /** Stall rows run along X; cars point along ±Z. Fill 0..1 of stalls occupied (art §3.16). */
  fill: number;
  stallW?: number;
  stallD?: number;
  aisle?: number;
  /** Lamp poles (props) at the aisle ends with light pools. */
  lamps?: boolean;
  /** Maximum number of stalls per row (shorter rows are centred). */
  maxPerRow?: number;
  /** x ranges kept free of stalls (islands, trolley shelters). */
  skip?: readonly [number, number][];
}

/**
 * Surface car park in the rectangle: asphalt, double-loaded stall rows with white lines, parked cars by `fill`.
 * Layout from the front (+Z) back: row | aisle | row row | aisle | row … Returns the stall count.
 */
export function parkingLot(c: Ctx, x0: number, z0: number, x1: number, z1: number, o: ParkingOpts): number {
  const sw = o.stallW ?? 2.6, sd = o.stallD ?? 5.0, aisle = o.aisle ?? 6.5;
  c.ground(x0, z0, x1, z1, P.road.parking, FL_PAVED | FL_SNOW);
  if (c.lod === 1) return 0;
  const rows: { z: number; dir: 1 | -1 }[] = [];
  // z = the stall row's aisle-side edge; dir = direction from the aisle into the stall
  let z = z1 - 0.5;
  let pair = 0;
  while (z - sd >= z0 - 1e-6) {
    if (pair % 2 === 0) {
      rows.push({ z: z - sd, dir: 1 }); // stalls in [z−sd, z], entered from the aisle below
      z -= sd + aisle;
    } else {
      rows.push({ z, dir: -1 }); // stalls in [z−sd, z], entered from the aisle above
      z -= sd;
    }
    pair++;
  }
  let stalls = 0;
  const per = Math.min(o.maxPerRow ?? 999, Math.floor((x1 - x0 - 1) / sw));
  const span = per * sw, sx0 = (x0 + x1) / 2 - span / 2;
  const r = c.propRng;
  for (const row of rows) {
    const za = row.dir === 1 ? row.z : row.z - sd, zb = za + sd;
    for (let i = 0; i <= per; i++) {
      const lx = sx0 + i * sw;
      if (o.skip?.some(([a, b]) => lx > a && lx < b)) continue;
      c.line(lx, za + 0.2, lx, zb - 0.2, 0.12, P.road.marking, Y_PAINT);
    }
    for (let i = 0; i < per; i++) {
      const cx = sx0 + (i + 0.5) * sw;
      if (o.skip?.some(([a, b]) => cx > a && cx < b)) continue;
      stalls++;
      const occupied = r.f() < o.fill;
      const noseIn = r.f() >= 0.2; // most drivers park nose-in, a few reverse in
      // dir 1: the aisle is on the −Z side, so a nose-in car points +Z (yaw 0)
      const yaw = (row.dir === 1) === noseIn ? 0 : Math.PI;
      if (occupied && !c.closed) c.car(cx + r.range(-0.15, 0.15), (za + zb) / 2 + r.range(-0.2, 0.2), yaw);
    }
  }
  if (o.lamps) {
    const lz = rows.length ? rows[0].z - aisle / 2 : (z0 + z1) / 2;
    for (const lx of [x0 + 1.2, x1 - 1.2]) {
      c.prop('lamp.street', lx, lz, lx < (x0 + x1) / 2 ? Math.PI / 2 : -Math.PI / 2, 1.1);
      c.pool(lx + (lx < (x0 + x1) / 2 ? 2 : -2), lz, 7);
    }
  }
  return stalls;
}

/** Paved path strip between two points (parks, campuses). */
export function path(c: Ctx, x0: number, z0: number, x1: number, z1: number, w: number, col: RGB = P.road.plaza): void {
  c.withFlags(FL_PAVED | FL_SNOW, () => c.line(x0, z0, x1, z1, w, col, Y_GROUND + 0.01));
}

/** Pond: water disc with a stone rim (n-gon), radius rx × rz. */
export function pond(c: Ctx, x: number, z: number, rx: number, rz: number, n = 10): void {
  const ring: XZ[] = [], inner: XZ[] = [];
  for (let i = 0; i < n; i++) {
    const a = -(i / n) * Math.PI * 2;
    const k = 1 + 0.08 * Math.sin(i * 2.3);
    ring.push([x + Math.cos(a) * rx * k, z + Math.sin(a) * rz * k]);
    inner.push([x + Math.cos(a) * (rx * k - 0.6), z + Math.sin(a) * (rz * k - 0.6)]);
  }
  c.groundFan(x, z, ring, P.wall.stone, FL_SNOW, Y_GROUND + 0.02);
  c.groundFan(x, z, inner, P.water.shallow, 0, Y_GROUND + 0.04);
}

// ------------------------------------------------------------------------------------------- struts and dishes

/** Thin double-sided strip from P to Q facing ±n (lattice members, guy wires, feed arms). */
export function strut(c: Ctx, P: V3, Q: V3, n: readonly number[], width: number, col: RGB, em = 0): void {
  const dx = Q[0] - P[0], dy = Q[1] - P[1], dz = Q[2] - P[2];
  // w = n × d, scaled to half the width
  let wx = n[1] * dz - n[2] * dy, wy = n[2] * dx - n[0] * dz, wz = n[0] * dy - n[1] * dx;
  const wl = Math.hypot(wx, wy, wz);
  if (wl < 1e-9) return;
  wx *= width / 2 / wl;
  wy *= width / 2 / wl;
  wz *= width / 2 / wl;
  const a: V3 = [P[0] - wx, P[1] - wy, P[2] - wz], b: V3 = [P[0] + wx, P[1] + wy, P[2] + wz];
  const cc: V3 = [Q[0] + wx, Q[1] + wy, Q[2] + wz], d: V3 = [Q[0] - wx, Q[1] - wy, Q[2] - wz];
  const front = n as number[];
  const back = [-n[0], -n[1], -n[2]];
  // pick the winding whose geometric normal agrees with n for the front face
  const gx = (b[1] - a[1]) * (cc[2] - a[2]) - (b[2] - a[2]) * (cc[1] - a[1]);
  const gy = (b[2] - a[2]) * (cc[0] - a[0]) - (b[0] - a[0]) * (cc[2] - a[2]);
  const gz = (b[0] - a[0]) * (cc[1] - a[1]) - (b[1] - a[1]) * (cc[0] - a[0]);
  if (gx * n[0] + gy * n[1] + gz * n[2] >= 0) {
    c.q(a, b, cc, d, front, col, null, null, em);
    c.q(d, cc, b, a, back, col, null, null, em);
  } else {
    c.q(d, cc, b, a, front, col, null, null, em);
    c.q(a, b, cc, d, back, col, null, null, em);
  }
}

/**
 * Parabolic-looking dish of radius R centred at (x, y, z) whose axis points at elevation `elev` (radians above the
 * horizon) towards yaw `yaw` (0 = +Z). Concave face, back face, feed arm; `pole` adds a stand down to the ground.
 */
export function dish(c: Ctx, x: number, y: number, z: number, R: number, elev: number, yaw: number, col: RGB, pole = true, segs = 8): void {
  const n: V3 = [Math.cos(elev) * Math.sin(yaw), Math.sin(elev), Math.cos(elev) * Math.cos(yaw)];
  // basis (u, v) spanning the rim plane
  let ux = n[2], uy = 0, uz = -n[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uz /= ul;
  const vx = n[1] * uz - n[2] * uy, vy = n[2] * ux - n[0] * uz, vz = n[0] * uy - n[1] * ux;
  const depth = R * 0.28;
  const D: V3 = [x - n[0] * depth, y - n[1] * depth, z - n[2] * depth];
  const rim: V3[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    rim.push([x + R * (Math.cos(a) * ux + Math.sin(a) * vx), y + R * (Math.cos(a) * uy + Math.sin(a) * vy), z + R * (Math.cos(a) * uz + Math.sin(a) * vz)]);
  }
  const behind: V3 = [x - n[0] * R * 2, y - n[1] * R * 2, z - n[2] * R * 2];
  const ahead: V3 = [x + n[0] * R * 2, y + n[1] * R * 2, z + n[2] * R * 2];
  const backCol: RGB = [Math.round(col[0] * 0.8), Math.round(col[1] * 0.8), Math.round(col[2] * 0.8)];
  for (let i = 0; i < segs; i++) {
    const p = rim[i], q = rim[(i + 1) % segs];
    triAway(c, D, p, q, behind, col);
    triAway(c, [D[0] - n[0] * 0.08, D[1] - n[1] * 0.08, D[2] - n[2] * 0.08], q, p, ahead, backCol);
  }
  // feed arm from the lowest rim point to the focus
  const low = rim.reduce((m, p) => (p[1] < m[1] ? p : m), rim[0]);
  strut(c, low, [x + n[0] * R * 0.55, y + n[1] * R * 0.55, z + n[2] * R * 0.55], [ux, uy, uz], 0.12, X.lampPole);
  if (pole) c.cyl(D[0], D[2], Math.max(0.12, R * 0.06), 0, D[1], 4, X.lampPole, X.lampPole, false);
}

/** Triangle whose normal faces away from `away`. */
function triAway(c: Ctx, a: V3, b: V3, cc: V3, away: V3, col: RGB): void {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const mx = (a[0] + b[0] + cc[0]) / 3 - away[0], my = (a[1] + b[1] + cc[1]) / 3 - away[1], mz = (a[2] + b[2] + cc[2]) / 3 - away[2];
  if (nx * mx + ny * my + nz * mz >= 0) c.ta(a, b, cc, col);
  else c.ta(a, cc, b, col);
}

// ------------------------------------------------------------------------------------------- outlines and rings

/** Flat annulus facing up (helipad circles, centre circles, fountain rims): `segs` quads between r0 and r1. */
export function ring(c: Ctx, cx: number, cz: number, r0: number, r1: number, y: number, segs: number, col: RGB, em = 0): void {
  for (let i = 0; i < segs; i++) {
    // decreasing angle = counter-clockwise seen from above (see ngonPts), so the faces point up
    const a0 = -(i / segs) * Math.PI * 2, a1 = -((i + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    c.q([cx + c0 * r1, y, cz + s0 * r1], [cx + c1 * r1, y, cz + s1 * r1], [cx + c1 * r0, y, cz + s1 * r0], [cx + c0 * r0, y, cz + s0 * r0], [0, 1, 0], col, null, null, em);
  }
}

/**
 * Running-track outline (two straights joined by semicircles) with half extents a × b (a ≥ b, straights along X),
 * counter-clockwise from above. Outlines built with the same `a − b` and `segsPerEnd` pair up point by point, so
 * `bandBetween` can join an outer and an inner lane edge.
 */
export function trackPts(cx: number, cz: number, a: number, b: number, segsPerEnd = 8): XZ[] {
  const L = Math.max(0, a - b), pts: XZ[] = [];
  for (let i = 0; i <= segsPerEnd; i++) {
    const t = Math.PI / 2 - (i / segsPerEnd) * Math.PI; // right end: +90° → −90°
    pts.push([cx + L + Math.cos(t) * b, cz + Math.sin(t) * b]);
  }
  for (let i = 0; i <= segsPerEnd; i++) {
    const t = -Math.PI / 2 - (i / segsPerEnd) * Math.PI; // left end: −90° → −270°
    pts.push([cx - L + Math.cos(t) * b, cz + Math.sin(t) * b]);
  }
  return pts;
}

/** Superellipse |x/a|^n + |z/b|^n = 1 (n = 2 ellipse, n → ∞ rectangle), `segs` points counter-clockwise from above. */
export function superPts(cx: number, cz: number, a: number, b: number, n: number, segs: number, rot = 0): XZ[] {
  const e = 2 / n, pts: XZ[] = [];
  for (let i = 0; i < segs; i++) {
    const t = rot - (i / segs) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    pts.push([cx + a * Math.sign(ct) * Math.abs(ct) ** e, cz + b * Math.sign(st) * Math.abs(st) ** e]);
  }
  return pts;
}

/** Flat band facing up between two matching closed outlines (outer and inner, same point count). */
export function bandBetween(c: Ctx, outer: readonly XZ[], inner: readonly XZ[], y: number, col: RGB, flags = 0, em = 0): void {
  const n = Math.min(outer.length, inner.length);
  c.withFlags(flags, () => {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      c.q([outer[i][0], y, outer[i][1]], [outer[j][0], y, outer[j][1]], [inner[j][0], y, inner[j][1]], [inner[i][0], y, inner[i][1]], [0, 1, 0], col, null, null, em);
    }
  });
}

// ------------------------------------------------------------------------------------------- prop rows and furniture

/**
 * Props of one family every `spacing` metres along the segment (x0, z0) → (x1, z1), centred on it. `yawOffset` is
 * added to the segment direction (props authored along local +X, such as hedges and fences, use 0).
 */
export function propLine(c: Ctx, id: PropId, x0: number, z0: number, x1: number, z1: number, spacing: number, yawOffset = 0, scale = 1): void {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  if (len < spacing * 0.5) return;
  const n = Math.max(1, Math.round(len / spacing));
  const yaw = Math.atan2(-dz, dx) + yawOffset; // local +X along the segment (rotation about +Y)
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    c.prop(id, x0 + dx * t, z0 + dz * t, yaw, scale);
  }
}

/**
 * Round fountain: stone basin (radius r, water surface), a smaller upper bowl on a pedestal and a white jet.
 * About 55 triangles at the default segment count; `segs` 8 for small plazas.
 */
export function fountain(c: Ctx, x: number, z: number, r: number, stone: RGB, segs = 12): void {
  c.cyl(x, z, r, 0, 0.6, segs, stone, P.water.shallow);
  c.cyl(x, z, r * 0.12 + 0.15, 0.6, 1.5, 6, stone, stone, false);
  c.cyl(x, z, r * 0.38, 1.5, 1.85, segs > 8 ? 8 : 6, stone, P.water.mid);
  c.cone(x, z, 0.22, 0.04, 1.85, 3.2, 5, P.water.foam);
}

/** Statue on a plinth (a bronze figure blob on a stone block) facing +Z by default. */
export function statue(c: Ctx, x: number, z: number, stone: RGB, h = 2.2, metal: RGB = X.bronze): void {
  c.boxc(x, z, 1.6, 1.6, 0, h, stone, shade(stone, 1.05));
  c.cyl(x, z, 0.32, h, h + 1.4, 5, metal, metal, false);
  c.blob(x, h + 1.75, z, 0.28, 0.32, 0.28, 3, 5, metal);
}
