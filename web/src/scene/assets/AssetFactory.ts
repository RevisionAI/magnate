// Reference implementation from docs/overhaul/research/art-rendering.md Appendix A (assets/AssetFactory.ts).
// Verified to type-check against three 0.186 / postprocessing 6.39.5 / camera-controls 3.1.2.
// Contract every asset family implements. Pure + deterministic: same (seed, lot, params) => identical arrays.
//
// W4 additions (all optional, backward compatible): AssetParams.month/companyId/activity/heightHint/targetTypeId,
// extra AnimatedPart kinds + active/scale/extent, Emitter.tone/size, SignQuad.style/text, LightPool.tone,
// AssetFactory.family, and the pure helpers at the end (stageForProgress, monthOf, seasonOfMonth, lotFrame).
//
// Conventions (art bible §3.2, §4.1):
// - Lot frame: origin at the lot centre, +X along the street (right when facing the street), +Z = street-facing front,
//   +Y up, metres. widthM/depthM are the lot extents IN THAT FRAME (x and z), i.e. after the footprint rotation.
// - GeoBuilder.place(lot.cx, lot.cz, lot.quarterTurns) maps the lot frame to world (facing S=0, E=1, N=2, W=3).
// - Every position in AssetOutput (pickBox, props, animated, emitters, signs, lightPools) is in WORLD metres, and
//   every rotY is a world yaw in the three.js rotation.y convention.
import type { GeoBuilder } from './GeoBuilder';
import type { PropInstance } from './Instancing';

export type Facing = 'N' | 'E' | 'S' | 'W';
export type Stage = 'foundation' | 'structure' | 'finishing' | 'complete' | 'closed';
export interface LotFrame { cx: number; cz: number; widthM: number; depthM: number; facing: Facing; quarterTurns: 0 | 1 | 2 | 3; }
export interface AssetParams {
  seed: number; variant: number; level: 1 | 2 | 3; stage: Stage;
  /** Overall construction progress p in 0..1 (bridge `construction.progress`); stage boundaries in stageForProgress. */
  progress: number;
  owner: number /* 0..7 | 255 */; utilization: number; lod: 0 | 1; season: 0 | 1 | 2 | 3;
  /** Distinct slot products (bridge `BuildingVisualDto.products`). Absent → a seeded default look (galleries);
   *  an empty array → nothing configured (idle factory, fallow farm). */
  productIds?: string[];
  /** Game month 1..12 (crop growth, harvest props). Absent → derived from `season` (see monthOf). */
  month?: number;
  /** Company id for SignQuad.companyId (sign-atlas slot). Absent → `owner:<owner>`. */
  companyId?: string;
  /** This month's activity (bridge CityActivityDto columns); drives docks, trailers, ships and parked cars. */
  activity?: AssetActivity;
  /** Generic construction factory only: final height (m) of the building being built. */
  heightHint?: number;
  /** Generic construction factory only: content type id of the building being built (selects type overrides). */
  targetTypeId?: string;
}
/** Optional per-month activity (bridge CityActivityDto). Factories fall back to `utilization` when absent. */
export interface AssetActivity { transfersIn?: number; transfersOut?: number; unitsSold?: number; exportUnits?: number; shipAtBerth?: boolean; }
export type AnimatedPartKind =
  | 'pumpjackBeam' | 'craneJib' | 'sheaveWheel' | 'gantryTrolley' | 'windowCleaner' | 'fan' | 'flag'
  | 'pumpjackCrank' | 'excavatorArm' | 'irrigationArm';
export interface AnimatedPart {
  kind: AnimatedPartKind;
  /** Pivot in world metres. */
  x: number; y: number; z: number;
  /** World yaw of the part frame (three.js rotation.y). */
  rotY: number;
  /** Cycle offset 0..1. */
  phase: number;
  /** Owner index painted on the part's owner faces (instance colour), 255 = neutral. */
  owner: number;
  /** Motion runs only when true (complete, operating, utilization > 0). Absent = true. Inactive parts still render. */
  active?: boolean;
  /** Uniform scale of the part geometry (absent = 1). */
  scale?: number;
  /** Kind-specific size: gantry trolley half travel (m), irrigation arm length (m), crane jib reach (m). */
  extent?: number;
}
export interface Emitter {
  kind: 'smoke' | 'steam' | 'dust' | 'flare'; x: number; y: number; z: number;
  /** Puffs per second (smoke = 1.5 × utilization, art §3.16); 0 = paused. */
  rate: number;
  /** Puffs per second at utilization 1. Utilization is not part of visualRev, so particle systems should rescale
   *  with the live value (rate = rateAtFull × utilization) instead of waiting for a chunk rebuild. */
  rateAtFull?: number;
  /** Smoke shade by product family (light = food, dark = metal); absent = normal grey. */
  tone?: 'light' | 'dark';
  /** Plume scale (large factories and 2× props use 1.5–2); absent = 1. */
  size?: number;
}
/** Sign atlas slot style: owner wordmark (default), inverted (owner text on white), emblem only, grey closed board, or
 *  a literal text slot (SignQuad.text). */
export type SignStyle = 'wordmark' | 'inverted' | 'emblem' | 'closed' | 'text';
export interface SignQuad {
  companyId: string;
  /** Four world corners: bottom-left, bottom-right, top-right, top-left as seen by the reader (atlas u0v0, u1v0, u1v1, u0v1). */
  corners: [number, number, number][];
  style?: SignStyle;
  text?: string;
}
export interface LightPool { x: number; z: number; radius: number; tone?: 'warm' | 'cool'; }
export interface AssetOutput {
  pickBox: [number, number, number, number, number, number];   // world AABB for Picking
  props: Record<string, PropInstance[]>;                       // family id -> instances (trees, lamps, parkedCars, containers...)
  animated: AnimatedPart[]; emitters: Emitter[]; signs: SignQuad[];
  lightPools: LightPool[];
}
export interface AssetFactory {
  readonly id: string;                                          // building type id or ambient archetype id
  readonly footprints: ReadonlyArray<readonly [number, number]>;
  readonly triBudget: { lod0: number; lod1: number };
  /** Gallery / tooling group, e.g. 'industrial', 'extraction', 'logistics', 'construction' (optional). */
  readonly family?: string;
  build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput;
}

// ---- Pure helpers shared by every family (W4) ----

/** Stage boundaries of art §4.1 on the overall progress p: foundation [0, 0.25), structure [0.25, 0.85),
 *  finishing [0.85, 1), complete at 1. */
export const STAGE_RANGES: Readonly<Record<'foundation' | 'structure' | 'finishing', readonly [number, number]>> = {
  foundation: [0, 0.25],
  structure: [0.25, 0.85],
  finishing: [0.85, 1],
};

/** Construction stage for overall progress p (NaN or ≥ 1 → complete). */
export function stageForProgress(p: number): Stage {
  if (!(p < 1)) return 'complete';
  if (p < STAGE_RANGES.foundation[1]) return 'foundation';
  if (p < STAGE_RANGES.structure[1]) return 'structure';
  return 'finishing';
}

/** Overall progress clamped into the range of `stage` (callers may pass a stage with an inconsistent progress). */
export function progressInStage(stage: Stage, p: number): number {
  if (stage === 'complete' || stage === 'closed') return 1;
  const [a, b] = STAGE_RANGES[stage];
  const v = Number.isFinite(p) ? p : a;
  return Math.min(b - 1e-6, Math.max(a, v));
}

/** Month 1..12 for the params: `month` when valid, else the middle month of `season` (Apr, Jul, Oct, Jan). */
export function monthOf(p: Pick<AssetParams, 'month' | 'season'>): number {
  const m = p.month;
  if (m !== undefined && Number.isFinite(m)) return ((((Math.round(m) - 1) % 12) + 12) % 12) + 1;
  return [4, 7, 10, 1][p.season & 3];
}

/** Season index for a month (art §3.14): Mar–May spring 0, Jun–Aug summer 1, Sep–Nov autumn 2, Dec–Feb winter 3. */
export function seasonOfMonth(month: number): 0 | 1 | 2 | 3 {
  const m = ((((Math.round(month) - 1) % 12) + 12) % 12) + 1;
  return m >= 3 && m <= 5 ? 0 : m >= 6 && m <= 8 ? 1 : m >= 9 && m <= 11 ? 2 : 3;
}

const TURNS: Readonly<Record<Facing, 0 | 1 | 2 | 3>> = { S: 0, E: 1, N: 2, W: 3 };

/** Lot frame for a footprint of fw × fh plots (content footprint) facing `facing`; plot size in metres. A 90° facing
 *  swaps the world extents, but widthM/depthM stay in the lot frame (widthM runs along the street). */
export function lotFrame(cx: number, cz: number, fw: number, fh: number, facing: Facing = 'S', plotSize = 24): LotFrame {
  return { cx, cz, widthM: fw * plotSize, depthM: fh * plotSize, facing, quarterTurns: TURNS[facing] };
}
