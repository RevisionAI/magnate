// Kit — the build context every W4 factory uses. It wraps a GeoBuilder for one lot and
//   * places the builder in the lot frame and restores the builder state afterwards (chunk builders share one
//     GeoBuilder across many buildings, so owner/ownerRoof/flags/placement must not leak);
//   * mirrors the layout along X for odd variants (the second "shape variant" of company types, art §4.1) while
//     keeping every face outward and every sign readable;
//   * collects props, animated parts, emitters, signs and light pools in WORLD coordinates (AssetFactory contract);
//   * derives the pick box from the geometry actually written, clamped to the lot rectangle.
// Factories author in the lot frame (origin = lot centre, +Z = street front, metres). Pure and deterministic: the only
// randomness is `rnd`, a mulberry32 stream seeded from AssetParams.seed.
import type { AnimatedPart, AnimatedPartKind, AssetOutput, AssetParams, Emitter, LightPool, LotFrame, SignQuad, SignStyle, Stage } from '../../AssetFactory';
import { monthOf, progressInStage } from '../../AssetFactory';
import { FACE_NX, FACE_PX, type FacadeParams, type GeoBuilder, type GeoState, type RGB } from '../../GeoBuilder';
import type { PropInstance } from '../../Instancing';
import { ownerHex, ownerRgb } from '../../palette';
import * as S from '../../shapes';

export type P3 = readonly [number, number, number];

export interface KitOptions {
  /** Mirror the layout along X (odd variants of company types). */
  mirror?: boolean;
}

export interface PartOptions { phase?: number; active?: boolean; scale?: number; extent?: number; owner?: number; }
export interface EmitOptions { tone?: 'light' | 'dark'; size?: number; }
export interface PropOptions { y?: number; scale?: number; color?: string; }
export interface SignOptions {
  /** Reading "up" direction in the lot frame (default +Y for wall signs, −Z (towards the back) for roof signs). */
  up?: P3;
  style?: SignStyle;
  text?: string;
  /** Distance in front of the surface (default 0.06 m). */
  offset?: number;
  /** Keep the sign in the LOD1 build (giant roof logos read at city zoom). */
  lod1?: boolean;
}

/** Emission rates (puffs per second at utilization 1) — art §3.16 (smoke 1.5 × utilization). */
export const RATE_PER_UTIL = { smoke: 1.5, steam: 1.5, dust: 1.2, flare: 1 } as const;

export class Kit {
  readonly b: GeoBuilder;
  readonly lot: LotFrame;
  readonly p: AssetParams;
  readonly owner: number;
  readonly ownerRgb: RGB;
  readonly ownerHex: string;
  readonly companyId: string;
  /** Seeded uniform [0, 1) stream; call order is part of the determinism contract. */
  readonly rnd: () => number;
  /** +1, or −1 when the layout is mirrored along X. */
  readonly mx: 1 | -1;
  /** Half lot extents (lot frame). */
  readonly hw: number;
  readonly hd: number;
  readonly lod: 0 | 1;
  readonly stage: Stage;
  readonly closed: boolean;
  /** Stage is 'complete' (built and not closed). */
  readonly complete: boolean;
  /** Utilization 0..1 while complete, 0 otherwise. */
  readonly util: number;
  /** Complete and utilization > 0 (animated parts move, emitters puff). */
  readonly running: boolean;
  /** Products configured (productIds absent counts as configured: galleries and defaults). */
  readonly configured: boolean;
  /** Windows and roof glazing lit at night (complete and configured; art §3.6). Stable across utilization changes,
   *  which are not part of visualRev, so a chunk never needs a rebuild for it. */
  readonly lit: boolean;
  readonly month: number;
  readonly level: 1 | 2 | 3;
  /** Overall construction progress clamped into the stage range (1 when complete or closed). */
  readonly progress: number;

  private readonly start: number;
  private readonly saved: GeoState;
  private readonly props: Record<string, PropInstance[]> = {};
  private readonly animated: AnimatedPart[] = [];
  private readonly emitters: Emitter[] = [];
  private readonly signs: SignQuad[] = [];
  private readonly pools: LightPool[] = [];

  constructor(b: GeoBuilder, lot: LotFrame, p: AssetParams, opts: KitOptions = {}) {
    this.b = b;
    this.lot = lot;
    this.p = p;
    this.saved = b.saveState();
    this.start = b.vertexCount;
    b.place(lot.cx, lot.cz, lot.quarterTurns);
    b.clearLocal();
    this.owner = Number.isInteger(p.owner) && p.owner >= 0 && p.owner <= 7 ? p.owner : 255;
    b.owner = this.owner;
    b.ownerRoof = false;
    b.ownerRoofMinNy = 0.9;
    b.flags = 0;
    b.tint = 0;
    this.ownerRgb = ownerRgb(this.owner);
    this.ownerHex = ownerHex(this.owner);
    this.companyId = p.companyId ?? `owner:${this.owner}`;
    this.rnd = S.mulberry32(p.seed ^ 0x5bd1e995);
    this.mx = opts.mirror ? -1 : 1;
    this.hw = lot.widthM / 2;
    this.hd = lot.depthM / 2;
    this.lod = p.lod === 1 ? 1 : 0;
    this.stage = p.stage;
    this.closed = p.stage === 'closed';
    this.complete = p.stage === 'complete';
    const u = Number.isFinite(p.utilization) ? Math.min(1, Math.max(0, p.utilization)) : 0;
    this.util = this.complete ? u : 0;
    this.running = this.util > 0;
    this.configured = p.productIds === undefined || p.productIds.length > 0;
    this.lit = this.complete && this.configured;
    this.month = monthOf(p);
    this.level = p.level === 2 || p.level === 3 ? p.level : 1;
    this.progress = progressInStage(p.stage, p.progress);
  }

  get lod0(): boolean { return this.lod === 0; }

  // ---- layout helpers -------------------------------------------------------------------------------------------

  /** Mirrored x. */
  X(x: number): number { return this.mx * x; }

  /** Mirrored and ordered x-range. */
  xr(x0: number, x1: number): [number, number] {
    const a = this.mx * x0, c = this.mx * x1;
    return a <= c ? [a, c] : [c, a];
  }

  /** Mirrored point. */
  m(p: P3): number[] { return [this.mx * p[0], p[1], p[2]]; }

  /** Yaw in the (unmirrored) authoring frame → yaw in the mirrored lot frame. */
  yaw(a: number): number { return this.mx < 0 ? -a : a; }

  /** Deterministic integer in [lo, hi]. */
  int(lo: number, hi: number): number { return lo + Math.floor(this.rnd() * (hi - lo + 1)); }

  /** Deterministic pick from a list. */
  pick<T>(list: readonly T[]): T { return list[Math.floor(this.rnd() * list.length) % list.length]; }

  // ---- geometry (all mirror-aware; coordinates in the authoring frame) -------------------------------------------

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wall: RGB, roof: RGB = wall, fac: FacadeParams | null = null, top = true): void {
    const [a, c] = this.xr(x0, x1);
    this.b.box(a, Math.min(y0, y1), Math.min(z0, z1), c, Math.max(y0, y1), Math.max(z0, z1), wall, roof, fac, top);
  }

  /** Box by centre and size. */
  boxAt(cx: number, cz: number, w: number, d: number, y0: number, h: number, wall: RGB, roof: RGB = wall, fac: FacadeParams | null = null, top = true): void {
    this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, wall, roof, fac, top);
  }

  /** Box with only some faces (FACE_* bits in the authoring frame; ±X faces swap when mirrored). */
  boxFaces(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces: number, wall: RGB, roof: RGB = wall, fac: FacadeParams | null = null, em = 0): void {
    const [a, c] = this.xr(x0, x1);
    let f = faces;
    if (this.mx < 0) {
      const px = f & FACE_PX, nx = f & FACE_NX;
      f = (f & ~(FACE_PX | FACE_NX)) | (px ? FACE_NX : 0) | (nx ? FACE_PX : 0);
    }
    this.b.boxFaces(a, Math.min(y0, y1), Math.min(z0, z1), c, Math.max(y0, y1), Math.max(z0, z1), f, wall, roof, fac, em);
  }

  /** Write the main-mass roof: faces pitched up to 60° get FLAG_OWNER_ROOF (owner tint at city zoom, art §3.4) — gable
   *  barns and sheds included, walls never. */
  roof(fn: () => void): void {
    const prev = this.b.ownerRoof, prevNy = this.b.ownerRoofMinNy;
    this.b.ownerRoof = this.owner !== 255;
    this.b.ownerRoofMinNy = 0.5;
    try { fn(); } finally { this.b.ownerRoof = prev; this.b.ownerRoofMinNy = prevNy; }
  }

  /** Run fn with extra vertex flags (FLAG_VEGETATION | FLAG_PAVED | FLAG_SNOWABLE). */
  flagged(flags: number, fn: () => void): void {
    const prev = this.b.flags;
    this.b.flags = prev | flags;
    try { fn(); } finally { this.b.flags = prev; }
  }

  slab(x0: number, z0: number, x1: number, z1: number, y: number, rgb: RGB, em = 0): void {
    const [a, c] = this.xr(x0, x1);
    const za = Math.min(z0, z1), zb = Math.max(z0, z1);
    this.b.quad([a, y, zb], [c, y, zb], [c, y, za], [a, y, za], [0, 1, 0], rgb, null, null, em);
  }

  cyl(cx: number, cz: number, r: number, y0: number, y1: number, segs: number, side: RGB, top: RGB = side, cap = true, em = 0): void {
    S.cylinder(this.b, this.X(cx), cz, r, y0, y1, segs, side, top, cap, em);
  }

  cone(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, segs: number, rgb: RGB, em = 0): void {
    S.cone(this.b, this.X(cx), cz, r0, r1, y0, y1, segs, rgb, em);
  }

  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, rings: number, segs: number, rgb: RGB, em = 0): void {
    S.blob(this.b, this.X(cx), cy, cz, rx, ry, rz, rings, segs, rgb, em);
  }

  mound(cx: number, cz: number, rx: number, rz: number, h: number, segs: number, rgb: RGB, y0 = 0): void {
    S.mound(this.b, this.X(cx), cz, rx, rz, h, segs, rgb, y0);
  }

  disc(cx: number, cz: number, r: number, y: number, segs: number, rgb: RGB, em = 0): void {
    S.disc(this.b, this.X(cx), cz, r, y, segs, rgb, em);
  }

  beam(p0: P3, p1: P3, w: number, h: number, rgb: RGB, sides: 3 | 4 = 4, caps = false, em = 0): void {
    S.beam(this.b, this.m(p0), this.m(p1), w, h, rgb, sides, caps, em);
  }

  cylAlong(p0: P3, p1: P3, r: number, segs: number, side: RGB, cap: RGB | null = side, em = 0, r1 = r): void {
    S.cylinderAlong(this.b, this.m(p0), this.m(p1), r, segs, side, cap, em, r1);
  }

  prism(pts: ReadonlyArray<readonly [number, number]>, y0: number, y1: number, wall: RGB, top: RGB = wall, fac: FacadeParams | null = null, capTop = true, em = 0): void {
    S.prism(this.b, pts.map(([x, z]) => [this.mx * x, z] as const), y0, y1, wall, top, fac, capTop, em);
  }

  strip(x0: number, z0: number, x1: number, z1: number, width: number, y: number, rgb: RGB, em = 0): void {
    S.strip(this.b, this.X(x0), z0, this.X(x1), z1, width, y, rgb, em);
  }

  lattice(cx: number, cz: number, size0: number, size1: number, y0: number, y1: number, panels: number, legW: number, braceW: number, rgb: RGB, faces: number = S.LATTICE_ALL): void {
    let f = faces;
    if (this.mx < 0) {
      const px = f & S.LATTICE_PX, nx = f & S.LATTICE_NX;
      f = (f & ~(S.LATTICE_PX | S.LATTICE_NX)) | (px ? S.LATTICE_NX : 0) | (nx ? S.LATTICE_PX : 0);
    }
    S.latticeTower(this.b, this.X(cx), cz, size0, size1, y0, y1, panels, legW, braceW, rgb, f);
  }

  truss(p0: P3, p1: P3, width: number, depth: number, panels: number, chordW: number, braceW: number, rgb: RGB, laceTop = false): void {
    S.trussBeam(this.b, this.m(p0), this.m(p1), width, depth, panels, chordW, braceW, rgb, laceTop);
  }

  gable(x0: number, z0: number, x1: number, z1: number, y: number, h: number, roofRgb: RGB, gableRgb: RGB, alongX = true, overhang = 0.4): void {
    const [a, c] = this.xr(x0, x1);
    S.gableRoof(this.b, a, Math.min(z0, z1), c, Math.max(z0, z1), y, h, roofRgb, gableRgb, alongX, overhang);
  }

  sawtooth(x0: number, z0: number, x1: number, z1: number, y: number, h: number, teeth: number, roofRgb: RGB, glass: RGB, glassEm = 0): void {
    const [a, c] = this.xr(x0, x1);
    S.sawtoothRoof(this.b, a, Math.min(z0, z1), c, Math.max(z0, z1), y, h, teeth, roofRgb, glass, glassEm);
  }

  quad(a: P3, bb: P3, c: P3, d: P3, outward: P3, rgb: RGB, em = 0): void {
    S.quadOut(this.b, this.m(a), this.m(bb), this.m(c), this.m(d), this.m(outward), rgb, null, null, em);
  }

  tri(a: P3, bb: P3, c: P3, outward: P3, rgb: RGB, em = 0): void {
    S.triOut(this.b, this.m(a), this.m(bb), this.m(c), this.m(outward), rgb, em);
  }

  // ---- outputs (authoring frame in, world out) --------------------------------------------------------------------

  /** World position of an authoring-frame point. */
  world(x: number, y: number, z: number): [number, number, number] {
    return this.b.toWorld(this.mx * x, y, z);
  }

  /** Instanced prop (LOD0 only). `yaw` is the prop's yaw in the authoring frame (+Z forward). */
  prop(family: string, x: number, z: number, yaw = 0, o: PropOptions = {}): void {
    if (this.lod !== 0) return;
    const [wx, wy, wz] = this.world(x, o.y ?? 0, z);
    const inst: PropInstance = { x: wx, z: wz, rotY: this.b.worldYaw(this.yaw(yaw)), scale: o.scale ?? 1 };
    if (wy !== 0) inst.y = wy;
    if (o.color !== undefined) inst.color = o.color;
    (this.props[family] ??= []).push(inst);
  }

  /** Animated part pivot (LOD0 only). Rest-pose parts of a closed or idle building are still emitted (inactive). */
  part(kind: AnimatedPartKind, x: number, y: number, z: number, yaw = 0, o: PartOptions = {}): void {
    if (this.lod !== 0) return;
    const [wx, wy, wz] = this.world(x, y, z);
    const part: AnimatedPart = {
      kind, x: wx, y: wy, z: wz, rotY: this.b.worldYaw(this.yaw(yaw)),
      phase: o.phase ?? this.rnd(), owner: o.owner ?? this.owner,
      active: o.active ?? this.running,
    };
    if (o.scale !== undefined) part.scale = o.scale;
    if (o.extent !== undefined) part.extent = o.extent;
    this.animated.push(part);
  }

  /** Particle emitter (both LODs: smoke reads at city zoom). `rateAtFull` is puffs/s at utilization 1. */
  emit(kind: Emitter['kind'], x: number, y: number, z: number, rateAtFull: number = RATE_PER_UTIL[kind], o: EmitOptions = {}): void {
    if (this.closed) return;
    const [wx, wy, wz] = this.world(x, y, z);
    const util = this.complete ? this.util : 1; // construction dust etc. runs at full rate
    const e: Emitter = { kind, x: wx, y: wy, z: wz, rate: round3(rateAtFull * util), rateAtFull: round3(rateAtFull) };
    if (o.tone) e.tone = o.tone;
    if (o.size !== undefined && o.size !== 1) e.size = o.size;
    this.emitters.push(e);
  }

  /** Light pool on the ground (LOD0 only). */
  pool(x: number, z: number, radius: number, tone: 'warm' | 'cool' = 'warm'): void {
    if (this.lod !== 0) return;
    const [wx, , wz] = this.world(x, 0, z);
    this.pools.push(tone === 'warm' ? { x: wx, z: wz, radius } : { x: wx, z: wz, radius, tone });
  }

  /** Sign quad centred at c on a surface with outward normal n (authoring frame), w × h metres. Closed buildings
   *  get the grey atlas slot automatically. */
  sign(c: P3, n: P3, w: number, h: number, o: SignOptions = {}): void {
    if (this.lod !== 0 && !o.lod1) return;
    const nn = unitV(this.m(n));
    const up = unitV(this.m(o.up ?? (Math.abs(n[1]) > 0.9 ? [0, 0, -1] : [0, 1, 0])));
    const r = unitV(crossV(up, nn));
    const off = o.offset ?? 0.06;
    const base = this.m(c).map((v, i) => v + nn[i] * off);
    const at = (sr: number, su: number) => {
      const lp = [0, 1, 2].map((i) => base[i] + r[i] * sr * (w / 2) + up[i] * su * (h / 2));
      return this.b.toWorld(lp[0], lp[1], lp[2]);
    };
    const q: SignQuad = { companyId: this.companyId, corners: [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)] };
    const style: SignStyle | undefined = this.closed ? 'closed' : o.style;
    if (style && style !== 'wordmark') q.style = style;
    if (o.text !== undefined && style === 'text') q.text = o.text;
    this.signs.push(q);
  }

  /** Close the build: pick box from the written geometry (clamped to the lot), builder state restored. */
  finish(): AssetOutput {
    const b = this.b;
    b.clearLocal();
    const lotBox = this.lotRect();
    const bb = b.bounds(this.start);
    let pickBox: [number, number, number, number, number, number];
    if (!bb) {
      pickBox = [lotBox[0], 0, lotBox[1], lotBox[2], 1, lotBox[3]];
    } else {
      let x0 = Math.max(bb[0], lotBox[0]), x1 = Math.min(bb[3], lotBox[2]);
      let z0 = Math.max(bb[2], lotBox[1]), z1 = Math.min(bb[5], lotBox[3]);
      if (x0 > x1) { x0 = lotBox[0]; x1 = lotBox[2]; }
      if (z0 > z1) { z0 = lotBox[1]; z1 = lotBox[3]; }
      pickBox = [x0, Math.min(0, bb[1]), z0, x1, Math.max(0.5, bb[4]), z1];
    }
    b.restoreState(this.saved);
    return { pickBox, props: this.props, animated: this.animated, emitters: this.emitters, signs: this.signs, lightPools: this.pools };
  }

  /** World AABB of the lot rectangle in XZ: [x0, z0, x1, z1]. */
  lotRect(): [number, number, number, number] {
    const pts = [this.b.toWorld(-this.hw, 0, -this.hd), this.b.toWorld(this.hw, 0, this.hd)];
    return [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][2], pts[1][2]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][2], pts[1][2])];
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function unitV(a: ArrayLike<number>): number[] {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

function crossV(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
