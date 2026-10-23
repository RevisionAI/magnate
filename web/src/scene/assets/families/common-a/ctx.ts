// Ctx — the build context every W3 factory works through.
//
// It wraps the caller's GeoBuilder for one lot and
//  * places geometry in the lot frame (origin = lot centre, +Z = street front, metres; art §3.2),
//  * tracks the local bounds of everything emitted, so `finish()` can return an exact world-space pick box,
//  * converts props, signs, light pools, emitters and animated parts from the lot frame to world space,
//  * owns the builder state (owner index, owner-roof flag, flags, tint) for the duration of one build and
//    restores the caller's values afterwards (the chunk worker reuses one builder for many buildings),
//  * hands out independent seeded random streams (shape, colour, props) so factories stay deterministic.
//
// Conventions used by every helper:
//  * Wall segments run from A to B with the outside on the left as seen from above with +Z pointing down the
//    screen, i.e. footprints are listed counter-clockwise seen from above: (x0,z1) → (x1,z1) → (x1,z0) → (x0,z0).
//  * Facade UVs: u runs along the wall and is stretched to a whole number of bays (no window slivers at corners);
//    v is the height above `vBase` (0 = ground, so the shader's wall-base AO darkens the bottom 3.5 m).
import type { AnimatedPart, AssetOutput, AssetParams, Emitter, LotFrame, SignQuad } from '../../AssetFactory';
import type { FacadeParams, GeoBuilder, RGB } from '../../GeoBuilder';
import type { PropInstance } from '../../Instancing';
import { blob as shBlob, cone as shCone, cylinder as shCylinder, gableRoof as shGable, hipRoof as shHip, rgb, sawtoothRoof as shSawtooth } from '../../shapes';
import { WORLD } from '@/theme/tokens';
import { EM, FAC, FL_SNOW, OWNER_NONE, Y_GROUND, Y_PAINT } from './constants';
import { X, mixRgb, ownerHex } from './palette';
import type { PropId } from './propIds';
import { Rng, mixSeed } from './rng';
import { treeLook, type TreeSpecies } from './vegetation';

export type V3 = [number, number, number];
export type XZ = readonly [number, number];

/** Facade description: shader style id (art §3.5), floor height and bay width in metres. */
export interface Fac {
  readonly style: number;
  readonly floor: number;
  readonly bay: number;
}

/** Standard facades (art §3.5 table; CIVIC uses HOUSE windows at civic proportions until style 8 exists). */
export const FACADE = {
  house: { style: FAC.HOUSE, floor: 3.0, bay: 3.0 },
  apartment: { style: FAC.APARTMENT, floor: 3.0, bay: 3.3 },
  curtain: { style: FAC.CURTAIN, floor: 3.7, bay: 1.6 },
  shop: { style: FAC.SHOP, floor: 3.0, bay: 4.5 },
  office: { style: FAC.OFFICE, floor: 3.7, bay: 3.0 },
  civic: { style: FAC.HOUSE, floor: 5.0, bay: 3.6 },
  school: { style: FAC.APARTMENT, floor: 3.6, bay: 3.3 },
  retailUpper: { style: FAC.HOUSE, floor: 4.2, bay: 4.0 },
} as const satisfies Record<string, Fac>;

/**
 * Parameters W3 factories understand on top of `AssetParams` (all optional, so plain AssetParams work):
 *  - `floors`: storeys from `AmbientDto.floors` (apartments 4–15, offices 10–60, mixed use 3–9) or the HQ height
 *    tier; when absent the factory picks a value from the seed (gallery).
 *  - `companyId`: written into every `SignQuad` this building emits. When absent, company signs carry
 *    `companyId: ''`, which the caller replaces with the building's owner id.
 */
export interface FamilyParams extends AssetParams {
  floors?: number;
  companyId?: string;
}

/** Number of storeys requested through `FamilyParams.floors`, clamped to [min, max], or undefined. */
export function requestedFloors(p: AssetParams, min: number, max: number): number | undefined {
  const f = (p as FamilyParams).floors;
  if (typeof f !== 'number' || !Number.isFinite(f) || f <= 0) return undefined;
  return Math.max(min, Math.min(max, Math.round(f)));
}

/** A wall line in the lot frame with its outward normal; `p(u, y, out)` addresses points on or in front of it. */
export class Side {
  readonly len: number;
  readonly tx: number;
  readonly tz: number;
  readonly nx: number;
  readonly nz: number;
  constructor(readonly ax: number, readonly az: number, readonly bx: number, readonly bz: number) {
    const dx = bx - ax, dz = bz - az;
    this.len = Math.hypot(dx, dz) || 1;
    this.tx = dx / this.len;
    this.tz = dz / this.len;
    this.nx = -this.tz;
    this.nz = this.tx;
  }
  x(u: number, out = 0): number {
    return this.ax + this.tx * u + this.nx * out;
  }
  z(u: number, out = 0): number {
    return this.az + this.tz * u + this.nz * out;
  }
  p(u: number, y: number, out = 0): V3 {
    return [this.x(u, out), y, this.z(u, out)];
  }
  /** Facing of the outward normal as a yaw about +Y (0 = +Z/street front). */
  get yaw(): number {
    return Math.atan2(this.nx, this.nz);
  }
}

/** The four sides of an axis-aligned rectangle, each running left → right as seen from outside. */
export function rectSides(x0: number, z0: number, x1: number, z1: number): { front: Side; right: Side; back: Side; left: Side } {
  return {
    front: new Side(x0, z1, x1, z1),
    right: new Side(x1, z1, x1, z0),
    back: new Side(x1, z0, x0, z0),
    left: new Side(x0, z0, x0, z1),
  };
}

/** Footprint of an axis-aligned rectangle in the winding every helper expects. */
export function rectPts(x0: number, z0: number, x1: number, z1: number): XZ[] {
  return [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
}

/** Regular polygon footprint (CCW seen from above), first vertex at angle `rot` (radians, 0 = +X). */
export function ngonPts(cx: number, cz: number, rx: number, rz: number, n: number, rot = 0): XZ[] {
  const pts: XZ[] = [];
  for (let i = 0; i < n; i++) {
    // Decreasing angle in (x, z) is counter-clockwise when +Z points down the screen.
    const a = rot - (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return pts;
}

const dm = (m: number): number => Math.max(0, Math.min(255, Math.round(m * 10)));

export interface MassOpts {
  /** Facade v origin: wall v = y − vBase. Default 0 (ground). */
  vBase?: number;
  /** Paint the top as the company's main roof (FLAG_OWNER_ROOF at city zoom). */
  ownerRoof?: boolean;
  /** Bit mask of walls to emit: 1 front, 2 right, 4 back, 8 left (default all). */
  sides?: number;
  /** Per-side facade overrides (null = blank wall). */
  facs?: Partial<Record<'front' | 'right' | 'back' | 'left', Fac | null>>;
  /** Emissive byte for the walls (rare: glowing kiosks). */
  em?: number;
}

export class Ctx {
  readonly b: GeoBuilder;
  readonly lot: LotFrame;
  readonly p: FamilyParams;
  /** Lot extents in the lot frame: W along the street front (x), D front-to-back (z). */
  readonly W: number;
  readonly D: number;
  readonly hw: number;
  readonly hd: number;
  readonly lod: 0 | 1;
  readonly company: boolean;
  readonly closed: boolean;
  readonly season: number;
  /** Company owner index 0..7, or 255 (ambient, or a company building without an owner). */
  readonly owner: number;
  /** Shape decisions (forms, counts, positions of masses). */
  readonly shape: Rng;
  /** Colour decisions. */
  readonly color: Rng;
  /** Prop placement and prop colours (trees, cars, lamps). */
  readonly propRng: Rng;
  /** Facade seed byte: varies which windows are lit between buildings. */
  readonly facSeed: number;
  /** Owner paint colour for company paint slots (faded towards grey when closed). */
  readonly own: RGB;
  /** Sign board colour: owner colour, grey `#9A9A9A` when closed (art §4.1). */
  readonly signC: RGB;
  /** Emissive byte for signs and owner bands: glowing when open, dark when closed. */
  readonly signEm: number;
  /** Owner colour as hex (neutral civic grey for 255) — for owner-livery props such as vans. */
  readonly ownerColor: string;

  private readonly c: number;
  private readonly s: number;
  private bx0 = Infinity;
  private by0 = Infinity;
  private bz0 = Infinity;
  private bx1 = -Infinity;
  private by1 = -Infinity;
  private bz1 = -Infinity;
  private readonly saved: { owner: number; ownerRoof: boolean; flags: number; tint: number };
  private readonly props: Record<string, PropInstance[]> = {};
  private readonly signs: SignQuad[] = [];
  private readonly pools: { x: number; z: number; radius: number }[] = [];
  private readonly emitters: Emitter[] = [];
  private readonly animated: AnimatedPart[] = [];

  constructor(b: GeoBuilder, lot: LotFrame, p: AssetParams, kind: 'company' | 'ambient', salt: number) {
    this.b = b;
    this.lot = lot;
    this.p = p as FamilyParams;
    this.W = lot.widthM;
    this.D = lot.depthM;
    this.hw = lot.widthM / 2;
    this.hd = lot.depthM / 2;
    this.lod = p.lod;
    this.company = kind === 'company';
    this.closed = p.stage === 'closed';
    this.season = p.season & 3;
    this.owner = this.company && p.owner >= 0 && p.owner <= 7 ? p.owner | 0 : OWNER_NONE;
    const base = mixSeed(p.seed >>> 0, salt);
    this.shape = new Rng(mixSeed(base, 0x51a9e));
    this.color = new Rng(mixSeed(base, 0xc0102));
    this.propRng = new Rng(mixSeed(base, 0x9409));
    this.facSeed = mixSeed(base, 0xfacade) & 255;
    this.ownerColor = ownerHex(this.owner);
    const ownRgb = rgb(ownerHex(this.owner));
    this.own = this.closed ? mixRgb(ownRgb, X.signGrey, 0.7) : ownRgb;
    this.signC = this.closed ? X.signGrey : ownRgb;
    this.signEm = this.closed ? 0 : EM.sign;
    const qt = lot.quarterTurns & 3;
    this.c = [1, 0, -1, 0][qt];
    this.s = [0, 1, 0, -1][qt];
    this.saved = { owner: b.owner, ownerRoof: b.ownerRoof, flags: b.flags, tint: b.tint };
    b.owner = this.owner;
    b.ownerRoof = false;
    b.flags = 0;
    b.tint = 255;
    b.place(lot.cx, lot.cz, qt, 0);
  }

  // ---------------------------------------------------------------- frame and bounds

  /** World X of a lot-frame point. */
  wx(x: number, z: number): number {
    return this.lot.cx + x * this.c + z * this.s;
  }
  /** World Z of a lot-frame point. */
  wz(x: number, z: number): number {
    return this.lot.cz - x * this.s + z * this.c;
  }
  /** World yaw of a lot-frame yaw. */
  wyaw(yaw: number): number {
    return yaw + (this.lot.quarterTurns & 3) * (Math.PI / 2);
  }

  private track(x: number, y: number, z: number): void {
    if (x < this.bx0) this.bx0 = x;
    if (x > this.bx1) this.bx1 = x;
    if (y < this.by0) this.by0 = y;
    if (y > this.by1) this.by1 = y;
    if (z < this.bz0) this.bz0 = z;
    if (z > this.bz1) this.bz1 = z;
  }
  private trackBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.track(x0, y0, z0);
    this.track(x1, y1, z1);
  }

  /** Extra builder flags (FL_*) OR-ed into everything emitted while `fn` runs. */
  withFlags<T>(flags: number, fn: () => T): T {
    const prev = this.b.flags;
    this.b.flags = prev | flags;
    try {
      return fn();
    } finally {
      this.b.flags = prev;
    }
  }

  /** Instance-tint weight for geometry emitted while `fn` runs (props: 255 body, 0 glass/lights). */
  withTint<T>(tint: number, fn: () => T): T {
    const prev = this.b.tint;
    this.b.tint = tint;
    try {
      return fn();
    } finally {
      this.b.tint = prev;
    }
  }

  /** Mark up-facing faces emitted in `fn` as the company's main roof (only for company buildings, art §4.1). */
  ownerRoof<T>(fn: () => T): T {
    const prev = this.b.ownerRoof;
    this.b.ownerRoof = this.company;
    try {
      return fn();
    } finally {
      this.b.ownerRoof = prev;
    }
  }

  // ---------------------------------------------------------------- raw primitives (tracked)

  q(a: V3, b: V3, c: V3, d: V3, n: number[], col: RGB, fac: FacadeParams | null = null, uv: number[][] | null = null, em = 0): void {
    this.track(a[0], a[1], a[2]);
    this.track(b[0], b[1], b[2]);
    this.track(c[0], c[1], c[2]);
    this.track(d[0], d[1], d[2]);
    this.b.quad(a, b, c, d, n, col, fac, uv, em);
  }

  /** Quad with its normal from the corners (a-b-c-d counter-clockwise seen from the front). */
  qa(a: V3, b: V3, c: V3, d: V3, col: RGB, em = 0): void {
    this.q(a, b, c, d, normalOf(a, b, c), col, null, null, em);
  }

  t(a: V3, b: V3, c: V3, n: number[], col: RGB, em = 0): void {
    this.track(a[0], a[1], a[2]);
    this.track(b[0], b[1], b[2]);
    this.track(c[0], c[1], c[2]);
    this.b.tri(a, b, c, n, col, em);
  }

  ta(a: V3, b: V3, c: V3, col: RGB, em = 0): void {
    this.t(a, b, c, normalOf(a, b, c), col, em);
  }

  /** Axis-aligned box without facade (details). `top = false` drops the lid. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wall: RGB, roof: RGB = wall, top = true, em = 0): void {
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
    this.q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], wall, null, null, em);
    this.q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], wall, null, null, em);
    this.q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], wall, null, null, em);
    this.q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], wall, null, null, em);
    if (top) this.q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], roof, null, null, em);
  }

  /** Centred box: (cx, cz) centre, w along x, d along z, from y0 up by h. */
  boxc(cx: number, cz: number, w: number, d: number, y0: number, h: number, wall: RGB, roof: RGB = wall, em = 0): void {
    this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, wall, roof, true, em);
  }

  // ---------------------------------------------------------------- facades and masses

  /**
   * One wall from A to B (outside on the left, see header), y0..y1, with a facade fitted to whole bays.
   * Walls shorter than 60% of a bay are left blank rather than showing a squeezed window.
   */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, col: RGB, fac: Fac | null, vBase = 0, em = 0): void {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6 || y1 <= y0) return;
    let fp: FacadeParams | null = null;
    let uLen = len;
    if (fac && fac.style !== FAC.NONE) {
      // The SHOP ground band uses a fixed 4.5 m cell in the shader; every other style uses the bay attribute.
      const cell = fac.style === FAC.SHOP ? 4.5 : dm(fac.bay) / 10;
      if (cell > 0 && len >= cell * 0.6) {
        uLen = Math.max(1, Math.round(len / cell)) * cell;
        const fz = fac.style === FAC.INDUSTRIAL ? dm(y1 - vBase) : dm(fac.floor);
        fp = [fac.style, this.facSeed, fz, dm(fac.style === FAC.SHOP ? 4.5 : fac.bay)];
      }
    }
    const v0 = y0 - vBase, v1 = y1 - vBase;
    const uv = fp ? [[0, v0], [uLen, v0], [uLen, v1], [0, v1]] : null;
    this.q([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [-dz / len, 0, dx / len], col, fp, uv, em);
  }

  /** Flat top over a convex footprint (fan from the first vertex). */
  top(pts: readonly XZ[], y: number, col: RGB, em = 0): void {
    for (let i = 1; i + 1 < pts.length; i++) {
      this.t([pts[0][0], y, pts[0][1]], [pts[i][0], y, pts[i][1]], [pts[i + 1][0], y, pts[i + 1][1]], [0, 1, 0], col, em);
    }
  }

  /** Vertical prism over a convex footprint: fitted facade walls plus an optional flat top (snowable). */
  prism(pts: readonly XZ[], y0: number, y1: number, wall: RGB, fac: Fac | null, roof: RGB | null, opts: MassOpts = {}): void {
    const vBase = opts.vBase ?? 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], bb = pts[(i + 1) % pts.length];
      this.wall(a[0], a[1], bb[0], bb[1], y0, y1, wall, fac, vBase, opts.em ?? 0);
    }
    if (roof) this.roofTop(pts, y1, roof, opts.ownerRoof === true);
  }

  /** Flat roof face (snowable; owner-roof flagged for a company's main mass when `ownerRoof`). */
  roofTop(pts: readonly XZ[], y: number, col: RGB, ownerRoof = false): void {
    const draw = () => this.withFlags(FL_SNOW, () => this.top(pts, y, col));
    if (ownerRoof) this.ownerRoof(draw);
    else draw();
  }

  /** Axis-aligned building mass with per-side fitted facades and an optional flat roof. */
  mass(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, wall: RGB, fac: Fac | null, roof: RGB | null, opts: MassOpts = {}): void {
    if (x1 <= x0 || z1 <= z0 || y1 <= y0) return;
    const sides = opts.sides ?? 15;
    const vBase = opts.vBase ?? 0;
    const em = opts.em ?? 0;
    const f = (k: 'front' | 'right' | 'back' | 'left'): Fac | null => (opts.facs && k in opts.facs ? opts.facs[k] ?? null : fac);
    if (sides & 1) this.wall(x0, z1, x1, z1, y0, y1, wall, f('front'), vBase, em);
    if (sides & 2) this.wall(x1, z1, x1, z0, y0, y1, wall, f('right'), vBase, em);
    if (sides & 4) this.wall(x1, z0, x0, z0, y0, y1, wall, f('back'), vBase, em);
    if (sides & 8) this.wall(x0, z0, x0, z1, y0, y1, wall, f('left'), vBase, em);
    if (roof) this.roofTop(rectPts(x0, z0, x1, z1), y1, roof, opts.ownerRoof === true);
  }

  /**
   * Parapet ring on a flat roof: outer band (blank), inner faces and a coping, h high and t thick.
   * `front` optionally paints the street-facing outer band (owner accent band, art §3.4).
   */
  parapet(x0: number, z0: number, x1: number, z1: number, y: number, col: RGB, h = 0.7, t = 0.3, front: RGB | null = null, frontEm = 0): void {
    const y1 = y + h;
    const ix0 = x0 + t, iz0 = z0 + t, ix1 = x1 - t, iz1 = z1 - t;
    this.wall(x0, z1, x1, z1, y, y1, front ?? col, null, 0, front ? frontEm : 0);
    this.wall(x1, z1, x1, z0, y, y1, col, null);
    this.wall(x1, z0, x0, z0, y, y1, col, null);
    this.wall(x0, z0, x0, z1, y, y1, col, null);
    // inner faces look inwards: walk the inner rectangle clockwise
    this.wall(ix1, iz1, ix0, iz1, y, y1, col, null);
    this.wall(ix0, iz1, ix0, iz0, y, y1, col, null);
    this.wall(ix0, iz0, ix1, iz0, y, y1, col, null);
    this.wall(ix1, iz0, ix1, iz1, y, y1, col, null);
    const cap = shadeLight(col);
    this.withFlags(FL_SNOW, () => {
      this.q([x0, y1, z1], [x1, y1, z1], [ix1, y1, iz1], [ix0, y1, iz1], [0, 1, 0], cap);
      this.q([x1, y1, z1], [x1, y1, z0], [ix1, y1, iz0], [ix1, y1, iz1], [0, 1, 0], cap);
      this.q([x1, y1, z0], [x0, y1, z0], [ix0, y1, iz0], [ix1, y1, iz0], [0, 1, 0], cap);
      this.q([x0, y1, z0], [x0, y1, z1], [ix0, y1, iz1], [ix0, y1, iz0], [0, 1, 0], cap);
    });
  }

  /** Projecting band (cornice, string course) around a rectangle: outer faces + top ledge. */
  cornice(x0: number, z0: number, x1: number, z1: number, y: number, col: RGB, h = 0.6, out = 0.4): void {
    const ox0 = x0 - out, oz0 = z0 - out, ox1 = x1 + out, oz1 = z1 + out, y1 = y + h;
    this.wall(ox0, oz1, ox1, oz1, y, y1, col, null);
    this.wall(ox1, oz1, ox1, oz0, y, y1, col, null);
    this.wall(ox1, oz0, ox0, oz0, y, y1, col, null);
    this.wall(ox0, oz0, ox0, oz1, y, y1, col, null);
    this.withFlags(FL_SNOW, () => {
      this.q([ox0, y1, oz1], [ox1, y1, oz1], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], col);
      this.q([ox1, y1, oz1], [ox1, y1, oz0], [x1, y1, z0], [x1, y1, z1], [0, 1, 0], col);
      this.q([ox1, y1, oz0], [ox0, y1, oz0], [x0, y1, z0], [x1, y1, z0], [0, 1, 0], col);
      this.q([ox0, y1, oz0], [ox0, y1, oz1], [x0, y1, z1], [x0, y1, z0], [0, 1, 0], col);
    });
  }

  // ---------------------------------------------------------------- side-relative details

  /** Flat panel parallel to a side, `out` metres in front of it (doors, boarded windows, banners, stripes). */
  panel(s: Side, u0: number, u1: number, y0: number, y1: number, out: number, col: RGB, em = 0, fac: Fac | null = null, vBase = 0): void {
    if (u1 < u0) [u0, u1] = [u1, u0];
    this.wall(s.x(u0, out), s.z(u0, out), s.x(u1, out), s.z(u1, out), y0, y1, col, fac, vBase, em);
  }

  /** Box attached to a side between `out0` and `out1` metres from it (canopies, boards, fins, balconies). */
  sideBox(s: Side, u0: number, u1: number, y0: number, y1: number, out0: number, out1: number, col: RGB, topCol: RGB = col, em = 0, topEm = em): void {
    if (u1 < u0) [u0, u1] = [u1, u0];
    if (out1 < out0) [out0, out1] = [out1, out0];
    const p00 = [s.x(u0, out0), s.z(u0, out0)] as const, p10 = [s.x(u1, out0), s.z(u1, out0)] as const;
    const p11 = [s.x(u1, out1), s.z(u1, out1)] as const, p01 = [s.x(u0, out1), s.z(u0, out1)] as const;
    this.wall(p01[0], p01[1], p11[0], p11[1], y0, y1, col, null, 0, em); // outer face
    this.wall(p11[0], p11[1], p10[0], p10[1], y0, y1, col, null, 0, em); // end at u1
    this.wall(p00[0], p00[1], p01[0], p01[1], y0, y1, col, null, 0, em); // end at u0
    this.withFlags(FL_SNOW, () =>
      this.q([p01[0], y1, p01[1]], [p11[0], y1, p11[1]], [p10[0], y1, p10[1]], [p00[0], y1, p00[1]], [0, 1, 0], topCol, null, null, topEm),
    );
  }

  /**
   * Company sign: a board standing `out0..out1` off a side (owner colour, glowing at night; grey when closed)
   * plus a SignQuad 2 cm in front of it for the wordmark atlas (open buildings, LOD0 only).
   */
  signBoard(s: Side, u0: number, u1: number, y0: number, y1: number, out0 = 0, depth = 0.25): void {
    this.sideBox(s, u0, u1, y0, y1, out0, out0 + depth, this.signC, this.signC, this.signEm, 0);
    if (!this.closed) this.sign(s, u0 + 0.15, u1 - 0.15, y0 + 0.1, y1 - 0.1, out0 + depth + 0.02);
  }

  // ---------------------------------------------------------------- ground and paint

  /** Ground patch on the lot (paved, lawn…), `flags` = FL_* (e.g. FL_PAVED | FL_SNOW). */
  ground(x0: number, z0: number, x1: number, z1: number, col: RGB, flags: number, y = Y_GROUND): void {
    if (x1 <= x0 || z1 <= z0) return;
    this.withFlags(flags, () => this.q([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], col));
  }

  /** Convex ground patch. */
  groundPoly(pts: readonly XZ[], col: RGB, flags: number, y = Y_GROUND): void {
    this.withFlags(flags, () => this.top(pts, y, col));
  }

  /** Ground patch fanned from an interior point (safe for slightly non-convex outlines such as ponds). */
  groundFan(cx: number, cz: number, pts: readonly XZ[], col: RGB, flags: number, y = Y_GROUND): void {
    this.withFlags(flags, () => {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        this.t([cx, y, cz], [a[0], y, a[1]], [b[0], y, b[1]], [0, 1, 0], col);
      }
    });
  }

  /** Painted line of width w from (x0, z0) to (x1, z1). */
  line(x0: number, z0: number, x1: number, z1: number, w: number, col: RGB, y = Y_PAINT): void {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (w / 2), nz = (dx / len) * (w / 2);
    // counter-clockwise seen from above, so the face points up
    this.q([x0 + nx, y, z0 + nz], [x1 + nx, y, z1 + nz], [x1 - nx, y, z1 - nz], [x0 - nx, y, z0 - nz], [0, 1, 0], col);
  }

  /** Flat disc (n-gon) facing up. */
  disc(cx: number, cz: number, r: number, y: number, segs: number, col: RGB, em = 0): void {
    const pts = ngonPts(cx, cz, r, r, segs);
    for (let i = 0; i < segs; i++) {
      const a = pts[i], b = pts[(i + 1) % segs];
      this.t([cx, y, cz], [a[0], y, a[1]], [b[0], y, b[1]], [0, 1, 0], col, em);
    }
  }

  // ---------------------------------------------------------------- shapes.ts wrappers (tracked)

  cyl(cx: number, cz: number, r: number, y0: number, y1: number, segs: number, side: RGB, top: RGB = side, cap = true, em = 0): void {
    this.trackBox(cx - r, y0, cz - r, cx + r, y1, cz + r);
    if (cap) this.withFlags(FL_SNOW, () => shCylinder(this.b, cx, cz, r, y0, y1, segs, side, top, cap, em));
    else shCylinder(this.b, cx, cz, r, y0, y1, segs, side, top, cap, em);
  }

  cone(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, segs: number, col: RGB, em = 0): void {
    const r = Math.max(r0, r1);
    this.trackBox(cx - r, Math.min(y0, y1), cz - r, cx + r, Math.max(y0, y1), cz + r);
    shCone(this.b, cx, cz, r0, r1, y0, y1, segs, col, em);
  }

  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, rings: number, segs: number, col: RGB, em = 0): void {
    this.trackBox(cx - rx, cy - ry, cz - rz, cx + rx, cy + ry, cz + rz);
    shBlob(this.b, cx, cy, cz, rx, ry, rz, rings, segs, col, em);
  }

  /** Gable roof (snowable). Ridge along X when `alongX`. */
  gable(x0: number, z0: number, x1: number, z1: number, y: number, h: number, roof: RGB, gableCol: RGB, alongX: boolean, overhang = 0.35): void {
    this.trackBox(x0 - overhang, y, z0 - overhang, x1 + overhang, y + h, z1 + overhang);
    this.withFlags(FL_SNOW, () => shGable(this.b, x0, z0, x1, z1, y, h, roof, gableCol, alongX, overhang));
  }

  /** Hip roof (snowable). */
  hip(x0: number, z0: number, x1: number, z1: number, y: number, h: number, roof: RGB, overhang = 0.35): void {
    this.trackBox(x0 - overhang, y, z0 - overhang, x1 + overhang, y + h, z1 + overhang);
    this.withFlags(FL_SNOW, () => shHip(this.b, x0, z0, x1, z1, y, h, roof, overhang));
  }

  /** Sawtooth (north-light) roof along X over [x0,x1]×[z0,z1]: `teeth` ridges of rise h, glazing towards −Z. */
  sawtooth(x0: number, z0: number, x1: number, z1: number, y: number, h: number, teeth: number, roof: RGB, glass: RGB): void {
    this.trackBox(x0, y, z0, x1, y + h, z1);
    this.withFlags(FL_SNOW, () => shSawtooth(this.b, x0, z0, x1, z1, y, h, teeth, roof, glass));
  }

  /** Hemispherical dome (rings from the crown to the springing line at cy), radius r, rise h. */
  dome(cx: number, cy: number, cz: number, r: number, h: number, rings: number, segs: number, col: RGB, em = 0): void {
    this.trackBox(cx - r, cy, cz - r, cx + r, cy + h, cz + r);
    const pt = (ring: number, i: number): V3 => {
      const th = (ring / rings) * (Math.PI / 2); // 0 = crown
      const a = -(i / segs) * Math.PI * 2;
      return [cx + Math.cos(a) * Math.sin(th) * r, cy + Math.cos(th) * h, cz + Math.sin(a) * Math.sin(th) * r];
    };
    this.withFlags(FL_SNOW, () => {
      for (let j = 0; j < rings; j++) {
        for (let i = 0; i < segs; i++) {
          if (j === 0) this.ta(pt(0, 0), pt(1, i), pt(1, i + 1), col, em);
          else this.qa(pt(j, i), pt(j + 1, i), pt(j + 1, i + 1), pt(j, i + 1), col, em);
        }
      }
    });
  }

  /** Pyramid (spire) over a regular n-gon base of radius r at y0, apex at y1. */
  spire(cx: number, cz: number, r: number, y0: number, y1: number, n: number, col: RGB, rot = Math.PI / 4): void {
    const pts = ngonPts(cx, cz, r, r, n, rot);
    this.withFlags(FL_SNOW, () => {
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        this.ta([a[0], y0, a[1]], [b[0], y0, b[1]], [cx, y1, cz], col);
      }
    });
  }

  // ---------------------------------------------------------------- outputs (lot frame → world)

  /** Instanced prop (skipped at LOD1: "no props" in the city band, art §4.1). */
  prop(id: PropId, x: number, z: number, rotY = 0, scale = 1, color?: string): void {
    if (this.lod === 1) return;
    const inst: PropInstance = { x: this.wx(x, z), z: this.wz(x, z), rotY: this.wyaw(rotY), scale };
    if (color !== undefined) inst.color = color;
    (this.props[id] ??= []).push(inst);
  }

  /** A tree of the given species with a seasonal colour, random yaw and scale 0.8–1.25 × `scale`. */
  tree(x: number, z: number, species: TreeSpecies = 'deciduous', scale = 1): void {
    const r = this.propRng;
    const yaw = r.range(0, Math.PI * 2), s = r.range(0.8, 1.25) * scale;
    const look = treeLook(species, this.season, r.f(), r.f(), r.f());
    this.prop(look.family, x, z, yaw, s, look.color);
  }

  /** Parked car with a body colour from the art §3.3 distribution; rotY = yaw of the car's nose. */
  car(x: number, z: number, rotY: number): void {
    const r = this.propRng;
    const color = r.weighted(WORLD.vehicles.bodies);
    const s = r.range(0.94, 1.06);
    this.prop('car.parked', x, z, rotY, s, color);
  }

  /**
   * Sign quad for the wordmark atlas on a side, `out` metres in front of it. LOD0 only, never on closed buildings.
   * `companyId` defaults to the building's company; non-company signs use the ids listed in the status doc
   * ('local:<icon>', 'civic:<kind>', 'ticker').
   */
  sign(s: Side, u0: number, u1: number, y0: number, y1: number, out: number, companyId?: string): void {
    if (this.lod === 1 || this.closed) return;
    const id = companyId ?? (this.p.companyId ?? '');
    const pt = (u: number, y: number): [number, number, number] => {
      const x = s.x(u, out), z = s.z(u, out);
      this.track(x, y, z);
      return [this.wx(x, z), y, this.wz(x, z)];
    };
    // bottom-left, bottom-right, top-right, top-left as seen from the front (text reads left → right)
    this.signs.push({ companyId: id, corners: [pt(u0, y0), pt(u1, y0), pt(u1, y1), pt(u0, y1)] });
  }

  /** Additive light pool on the ground (night), radius in metres. LOD0 only; never on closed buildings. */
  pool(x: number, z: number, radius: number): void {
    if (this.lod === 1 || this.closed) return;
    this.pools.push({ x: this.wx(x, z), z: this.wz(x, z), radius });
  }

  /** Particle emitter (rate in puffs per second at full activity). Never on closed buildings. */
  emit(kind: Emitter['kind'], x: number, y: number, z: number, rate: number): void {
    if (this.closed || rate <= 0) return;
    this.emitters.push({ kind, x: this.wx(x, z), y, z: this.wz(x, z), rate });
  }

  /** Animated part (LOD0 only, never on closed buildings). */
  anim(kind: AnimatedPart['kind'], x: number, y: number, z: number, rotY: number, phase: number): void {
    if (this.lod === 1 || this.closed) return;
    this.animated.push({ kind, x: this.wx(x, z), y, z: this.wz(x, z), rotY: this.wyaw(rotY), phase, owner: this.owner });
  }

  /**
   * Restore the caller's builder state (owner, owner-roof, flags, tint), reset the placement to the world frame
   * (identity; GeoBuilder exposes no getter to restore a caller's own placement) and return the outputs with a
   * world-space pick box.
   */
  finish(): AssetOutput {
    const b = this.b;
    b.owner = this.saved.owner;
    b.ownerRoof = this.saved.ownerRoof;
    b.flags = this.saved.flags;
    b.tint = this.saved.tint;
    b.place(0, 0, 0, 0);
    if (!(this.bx1 >= this.bx0)) this.trackBox(-0.5, 0, -0.5, 0.5, 1, 0.5);
    const xs = [this.wx(this.bx0, this.bz0), this.wx(this.bx1, this.bz0), this.wx(this.bx0, this.bz1), this.wx(this.bx1, this.bz1)];
    const zs = [this.wz(this.bx0, this.bz0), this.wz(this.bx1, this.bz0), this.wz(this.bx0, this.bz1), this.wz(this.bx1, this.bz1)];
    const pickBox: AssetOutput['pickBox'] = [Math.min(...xs), Math.max(0, this.by0), Math.min(...zs), Math.max(...xs), this.by1, Math.max(...zs)];
    return { pickBox, props: this.props, animated: this.animated, emitters: this.emitters, signs: this.signs, lightPools: this.pools };
  }
}

/** Unit face normal of triangle a-b-c (counter-clockwise front). */
export function normalOf(a: V3, b: V3, c: V3): number[] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Slightly lighter shade for copings and caps (reads as a crisp edge under the sun). */
function shadeLight(c: RGB): RGB {
  return [Math.min(255, Math.round(c[0] * 1.06 + 6)), Math.min(255, Math.round(c[1] * 1.06 + 6)), Math.min(255, Math.round(c[2] * 1.06 + 6))];
}
