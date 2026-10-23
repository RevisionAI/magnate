// Construction sites (art bible §4.1 "Construction stages"), usable for ANY company building type:
//   A · foundation (p 0–0.25): owner-colour hoarding with wordmarks every 12 m, excavation growing from the street,
//       rebar mats, an excavator (animated arm), a dump truck, two site cabins, dust.
//   B · structure (0.25–0.85): concrete frame rising to H·smoothstep(0.25, 0.85, p) with floor slabs, scaffold 0.8 m
//       outside the walls up to h + 2 m, a tower crane (animated jib, owner counterweight) when H > 12 m, otherwise a
//       mobile crane.
//   C · finishing (0.85–1): full-height shell; scaffold comes off top-down revealing the finished facade; crane gone
//       at p ≥ 0.95; hoarding removed and landscaping at p ≥ 0.98.
// The frame is real geometry, so a site needs no shader support; when the renderer draws the final building clipped
// at uClipY instead (art §4.1 stage B), pass `frame: false` and keep only the site dressing.
// Type overrides (oil derrick, farm ploughing, port piles, mine headframe) live with their families and reuse the
// building blocks exported here.
import { FLAG_SNOWABLE } from '../../../materials/CityMaterial';
import type { AssetFactory, AssetOutput, AssetParams, LotFrame, Stage } from '../../AssetFactory';
import { progressInStage } from '../../AssetFactory';
import { FACE_NX, FACE_NZ, FACE_PX, FACE_PZ, FACE_SIDES, FACE_TOP, type GeoBuilder, type RGB } from '../../GeoBuilder';
import { ASSET_RGB, WORLD_RGB, hexRgb, shade } from '../../palette';
import { LATTICE_ALL } from '../../shapes';
import { ground, LOT_INSET, tree, yard } from '../common-b/details';
import { Kit } from '../common-b/kit';

/** Building mass in the lot frame (metres). */
export interface SiteRect { x0: number; z0: number; x1: number; z1: number; }

/** Vertical extras that rise with the frame (chimneys, broadcast masts). */
export interface SiteTower { x: number; z: number; r: number; h: number; kind: 'chimney' | 'lattice'; }

export interface SiteSpec {
  rect: SiteRect;
  /** Final height H (m) of the main mass. */
  height: number;
  floorH?: number;
  towers?: readonly SiteTower[];
  /** 'hall': single-storey shed (factory hall, warehouse, big-box store) erected as a steel portal frame bay by bay
   *  with a mobile crane; 'frame' (default): multi-storey concrete frame with floor slabs, scaffold and a tower crane
   *  when H > 12 m (art §4.1). */
  kind?: 'hall' | 'frame';
  /** Final wall colour of a hall (cladding hung in stage C); default galvanized. */
  cladding?: RGB;
}

const CONCRETE = WORLD_RGB.wall.concrete;
const SCAFFOLD_BAR = ASSET_RGB.scaffoldGrey;
const SCAFFOLD_BOARD = ASSET_RGB.derrick;
const CRANE_YELLOW = ASSET_RGB.derrick;
const EXCAVATION = WORLD_RGB.ground.soilDark;

/** Final masses of every content building type (art §4.2). Retail/media/R&D entries are W3 buildings: the rect is the
 *  main block from the art bible; a W3 factory can pass its own footprint to buildConstructionSite instead. */
export const TYPE_SITES: Readonly<Record<string, SiteSpec>> = {
  convenience_store: { rect: { x0: -10, z0: -5, x1: 10, z1: 9 }, height: 4.6 },
  supermarket: { rect: { x0: -30, z0: -33, x1: 30, z1: 1 }, height: 8, kind: 'hall', cladding: WORLD_RGB.wall.warmWhite },
  // Placeholder (Wave 2 merge): the car dealership's showroom block on its 2×2 lot (see retail/carDealership.ts).
  car_dealership: { rect: { x0: -10, z0: -9, x1: 10, z1: 5 }, height: 4.6 },
  department_store: { rect: { x0: -45, z0: -47, x1: 45, z1: 25 }, height: 21.3, floorH: 4.2 },
  factory_small: { rect: { x0: -35, z0: -35, x1: 17, z1: 1 }, height: 10, floorH: 5, kind: 'hall', cladding: WORLD_RGB.wall.brick, towers: [{ x: 24.5, z: -31.5, r: 1.5, h: 32, kind: 'chimney' }] },
  factory_large: { rect: { x0: -59, z0: -59, x1: 31, z1: 19 }, height: 13, floorH: 6.5, kind: 'hall', cladding: WORLD_RGB.industry.silver, towers: [{ x: 40.5, z: -53, r: 2, h: 42, kind: 'chimney' }, { x: 52.5, z: -53, r: 2, h: 42, kind: 'chimney' }] },
  warehouse_small: { rect: { x0: -21, z0: -22, x1: 21, z1: 4 }, height: 8, floorH: 8, kind: 'hall' },
  warehouse_large: { rect: { x0: -45, z0: -47, x1: 45, z1: 13 }, height: 12, floorH: 6, kind: 'hall', cladding: WORLD_RGB.wall.aluminium },
  tv_station: { rect: { x0: -22, z0: -30, x1: 22, z1: -2 }, height: 14, towers: [{ x: 24, z: -24, r: 3, h: 100, kind: 'lattice' }] },
  radio_station: { rect: { x0: -11, z0: -5, x1: 11, z1: 9 }, height: 8, towers: [{ x: 14, z: -14, r: 1, h: 70, kind: 'lattice' }] },
  newspaper_publisher: { rect: { x0: -25, z0: -33, x1: 25, z1: 7 }, height: 16 },
  magazine_publisher: { rect: { x0: -22, z0: -30, x1: 22, z1: 6 }, height: 19 },
  rd_center: { rect: { x0: -25, z0: -30, x1: 25, z1: -12 }, height: 12 },
};

/** smoothstep(e0, e1, x). */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Frame height for overall progress p (art §4.1: h = H · smoothstep(0.25, 0.85, p)). */
export function riseHeight(H: number, p: number): number {
  return H * smoothstep(0.25, 0.85, p);
}

/** Normalised progress inside the stage (0..1). */
export function stageT(stage: Stage, p: number): number {
  if (stage === 'foundation') return Math.min(1, Math.max(0, p / 0.25));
  if (stage === 'structure') return Math.min(1, Math.max(0, (p - 0.25) / 0.6));
  if (stage === 'finishing') return Math.min(1, Math.max(0, (p - 0.85) / 0.15));
  return 1;
}

/** Spec for a type: the table entry, or the lot minus 4 m margins with the height hint (default 10 m). */
export function siteSpecFor(typeId: string | undefined, lot: LotFrame, heightHint?: number): SiteSpec {
  const known = typeId ? TYPE_SITES[typeId] : undefined;
  if (known) return heightHint !== undefined && heightHint > 0 ? { ...known, height: heightHint } : known;
  const hw = lot.widthM / 2, hd = lot.depthM / 2;
  const inset = Math.min(6, Math.max(3, Math.min(hw, hd) * 0.18));
  return { rect: { x0: -hw + inset, z0: -hd + inset, x1: hw - inset, z1: hd - inset - Math.min(8, hd * 0.25) }, height: heightHint && heightHint > 0 ? heightHint : 10 };
}

// ---- building blocks -------------------------------------------------------------------------------------------

/** Owner-colour site hoarding 2.4 m high around [x0,x1]×[z0,z1] with a gate gap on the front (+Z) side, and a
 *  wordmark every 12 m along the front (art §4.1 stage A). ~50 triangles + sign quads. */
export function hoarding(k: Kit, x0: number, z0: number, x1: number, z1: number, gate: readonly [number, number] | null, h = 2.4): void {
  const c: RGB = k.owner === 255 ? WORLD_RGB.wall.greige : k.ownerRgb;
  const t = 0.14;
  if (!k.lod0) {
    // city band: outer faces and tops only (4 triangles a side)
    k.boxFaces(x0, 0, z1 - t, x1, h, z1, FACE_PZ | FACE_TOP, c, c);
    k.boxFaces(x0, 0, z0, x1, h, z0 + t, FACE_NZ | FACE_TOP, c, c);
    k.boxFaces(x0, 0, z0, x0 + t, h, z1, FACE_NX | FACE_TOP, c, c);
    k.boxFaces(x1 - t, 0, z0, x1, h, z1, FACE_PX | FACE_TOP, c, c);
    return;
  }
  const seg = (a: number, b: number) => { if (b - a > 0.2) k.box(a, 0, z1 - t, b, h, z1, c, shade(c, 0.9)); };
  if (gate) { seg(x0, gate[0]); seg(gate[1], x1); } else seg(x0, x1);
  k.box(x0, 0, z0, x1, h, z0 + t, c, shade(c, 0.9));
  k.box(x0, 0, z0, x0 + t, h, z1, c, shade(c, 0.9));
  k.box(x1 - t, 0, z0, x1, h, z1, c, shade(c, 0.9));
  if (!k.lod0) return;
  // wordmarks every 12 m on the front, skipping the gate
  for (let x = x0 + 6; x <= x1 - 4; x += 12) {
    if (gate && x + 3 > gate[0] && x - 3 < gate[1]) continue;
    k.sign([x, h * 0.55, z1], [0, 0, 1], 5.2, 1.3);
  }
  // one on each side, facing out
  const zm = (z0 + z1) / 2;
  k.sign([x0, h * 0.55, zm], [-1, 0, 0], 5.2, 1.3);
  k.sign([x1, h * 0.55, zm], [1, 0, 0], 5.2, 1.3);
}

/** Two site cabins 6 × 2.4 × 2.6 m (#E4E4DE) with dark windows. ~30 triangles. */
export function siteCabins(k: Kit, x: number, z: number, alongX = true): void {
  if (!k.lod0) return;
  const c = ASSET_RGB.siteCabin, win = shade(WORLD_RGB.industry.glass, 0.9);
  for (let i = 0; i < 2; i++) {
    const cx = alongX ? x + i * 6.4 : x, cz = alongX ? z : z + i * 6.4;
    const w = alongX ? 6 : 2.4, d = alongX ? 2.4 : 6;
    k.boxAt(cx, cz, w, d, 0, 2.6, c, shade(c, 0.92));
    if (k.lod0) {
      if (alongX) k.quad([cx - 2, 1.0, cz + d / 2 + 0.02], [cx + 2, 1.0, cz + d / 2 + 0.02], [cx + 2, 2.0, cz + d / 2 + 0.02], [cx - 2, 2.0, cz + d / 2 + 0.02], [0, 0, 1], win);
      else k.quad([cx + w / 2 + 0.02, 1.0, cz + 2], [cx + w / 2 + 0.02, 1.0, cz - 2], [cx + w / 2 + 0.02, 2.0, cz - 2], [cx + w / 2 + 0.02, 2.0, cz + 2], [1, 0, 0], win);
    }
  }
}

/** Excavator (instanced body + animated arm, ±25° over 4 s) at (x, z) facing `yaw`. */
export function excavatorAt(k: Kit, x: number, z: number, yaw: number): void {
  k.prop('excavatorBody', x, z, yaw);
  k.part('excavatorArm', x + Math.sin(yaw) * 1.3, 1.9, z + Math.cos(yaw) * 1.3, yaw, { active: true });
}

/** Excavation over a rect: dark soil growing from the front (t 0..1), a spoil berm and a spoil heap behind the
 *  digging face (kept inside the lot). ~40 triangles. */
export function excavation(k: Kit, r: SiteRect, t: number): void {
  const reach = r.z1 - (r.z1 - r.z0) * Math.min(1, 0.15 + t * 1.15);
  k.flagged(FLAG_SNOWABLE, () => {
    k.slab(r.x0, reach, r.x1, r.z1, 0.06, EXCAVATION);
    // inner shadow band so the pit reads as dug (darker strip along the far edge)
    k.slab(r.x0, reach, r.x1, reach + Math.min(2, (r.z1 - reach) * 0.2), 0.065, shade(EXCAVATION, 0.78));
    const rx = Math.min(4 + 3 * t, k.hw * 0.4), rz = Math.min(3 + 2 * t, k.hd * 0.4);
    const heapX = clampIn(r.x0 + Math.min(6, (r.x1 - r.x0) * 0.15), k.hw - rx - 0.8);
    const heapZ = clampIn(reach - 3.5, k.hd - rz - 0.8);
    if (k.lod0) k.mound(heapX, heapZ, rx, rz, 2 + 2.5 * t, 8, WORLD_RGB.ground.soil);
    else k.cone(heapX, heapZ, Math.min(rx, rz), 0, 0, 2 + 2.5 * t, 4, WORLD_RGB.ground.soil);
  });
}

/** Clamp v into [−lim, lim] (lim ≥ 0). */
function clampIn(v: number, lim: number): number {
  const l = Math.max(0, lim);
  return Math.min(l, Math.max(-l, v));
}

/** Rebar mats on the excavation floor (late stage A): a rust grid of thin strips. 4 triangles per bar. */
export function rebar(k: Kit, r: SiteRect, density = 6): void {
  if (!k.lod0) return;
  const rust = WORLD_RGB.industry.rust;
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const nx = Math.max(3, Math.round(w / density)), nz = Math.max(3, Math.round(d / density));
  for (let i = 0; i <= nx; i++) k.strip(r.x0 + (w * i) / nx, r.z0 + 0.5, r.x0 + (w * i) / nx, r.z1 - 0.5, 0.18, 0.09, rust);
  for (let j = 0; j <= nz; j++) k.strip(r.x0 + 0.5, r.z0 + (d * j) / nz, r.x1 - 0.5, r.z0 + (d * j) / nz, 0.18, 0.09, rust);
}

/** Concrete frame: columns on a ~8 m grid up to h, floor slabs every floorH up to h, plus the ground slab. */
export function concreteFrame(k: Kit, r: SiteRect, h: number, floorH: number): void {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  ground(k, r.x0, r.z0, r.x1, r.z1, shade(CONCRETE, 0.95), 0.08);
  if (h < 0.4) return;
  if (!k.lod0) {
    // city band: darker concrete sides under a lighter deck, so it never reads as a finished block (no tan top: at
    // distance it would pass for an orange owner roof)
    k.box(r.x0, 0, r.z0, r.x1, h, r.z1, shade(CONCRETE, 0.8), shade(CONCRETE, 1.06));
    return;
  }
  const nx = Math.max(1, Math.round(w / 8)), nz = Math.max(1, Math.round(d / 8));
  const col = 0.7;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const inner = i > 0 && i < nx && j > 0 && j < nz;
      if (inner && (i + j) % 2 === 1) continue; // thin the interior grid (it is barely visible) to save triangles
      const x = r.x0 + (w * i) / nx, z = r.z0 + (d * j) / nz;
      k.boxFaces(x - col / 2, 0, z - col / 2, x + col / 2, h, z + col / 2, FACE_SIDES | FACE_TOP, CONCRETE, CONCRETE);
    }
  }
  for (let y = floorH; y <= h + 0.01; y += floorH) {
    k.box(r.x0 - 0.2, y - 0.35, r.z0 - 0.2, r.x1 + 0.2, y, r.z1 + 0.2, shade(CONCRETE, 0.9), CONCRETE);
  }
  // the working deck: plywood formwork with rebar laid out, advancing from the front while the next floor is poured
  const top = Math.floor(h / floorH) * floorH;
  if (h - top > 0.8) {
    const share = (h - top) / floorH;
    const zd = r.z1 - d * share;
    k.box(r.x0 - 0.2, h - 0.3, zd, r.x1 + 0.2, h, r.z1 + 0.2, shade(FORMWORK, 0.85), FORMWORK);
    const bars = Math.max(2, Math.round(w / 6));
    for (let i = 1; i < bars; i++) k.strip(r.x0 + (w * i) / bars, zd + 0.6, r.x0 + (w * i) / bars, r.z1 - 0.4, 0.22, h + 0.03, WORLD_RGB.industry.rust);
  }
}

/** Plywood formwork of the deck being poured. */
const FORMWORK = hexRgb('#C8A774');

const STEEL = hexRgb('#6B7B8C');

/** Steel portal frame of a single-storey hall erected bay by bay from the −X end: `t` (0..1) is the share of column
 *  lines standing. Columns on a ~7.5 m × ≤ 18 m grid, a rafter across the span on every complete line and purlins
 *  (~9 m apart) between complete lines; the line being raised grows. Returns x of the erection front (where the crane
 *  works). LOD0 ≈ 10 per column + 10 per rafter + 6 per purlin; LOD1 = an open steel box (8 triangles). */
export function steelHall(k: Kit, r: SiteRect, H: number, t: number): number {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  ground(k, r.x0, r.z0, r.x1, r.z1, shade(CONCRETE, 0.95), 0.08); // floor slab
  const nx = Math.max(2, Math.round(w / 7.5)), nz = Math.max(1, Math.round(d / 18));
  const lines = nx + 1;
  const standing = Math.min(lines, Math.max(0, t) * lines);
  const full = Math.floor(standing);
  const xAt = (i: number) => r.x0 + (w * i) / nx;
  const front = xAt(Math.min(nx, full));
  if (!k.lod0) {
    if (full >= 2) k.boxFaces(r.x0, 0, r.z0, xAt(full - 1), H, r.z1, FACE_SIDES, STEEL, STEEL);
    return front;
  }
  const np = Math.max(2, Math.round(d / 9));
  for (let i = 0; i < lines; i++) {
    const h = i < full ? H : i === full ? H * (standing - full) : 0;
    if (h < 0.3) break;
    const x = xAt(i);
    for (let j = 0; j <= nz; j++) {
      const z = r.z0 + (d * j) / nz;
      k.boxFaces(x - 0.25, 0, z - 0.25, x + 0.25, h, z + 0.25, FACE_SIDES | FACE_TOP, STEEL, STEEL);
    }
    if (i >= full) continue;
    k.box(x - 0.2, H, r.z0 - 0.15, x + 0.2, H + 0.75, r.z1 + 0.15, STEEL, shade(STEEL, 1.08)); // rafter across the span
    if (i === 0) continue;
    for (let q = 0; q <= np; q++) {
      const z = r.z0 + (d * q) / np;
      k.boxFaces(xAt(i - 1), H + 0.75, z - 0.1, x, H + 0.95, z + 0.1, FACE_TOP | FACE_PZ | FACE_NZ, shade(STEEL, 1.12), shade(STEEL, 1.12));
    }
  }
  return front;
}

/** Hall shell in stage C: cladding on every wall except an opening in the front that closes with `t`, the roof on.
 *  ~16 triangles. */
export function hallShell(k: Kit, r: SiteRect, H: number, t: number, cladding: RGB): void {
  k.boxFaces(r.x0, 0, r.z0, r.x1, H, r.z1, FACE_NZ | FACE_PX | FACE_NX, cladding, cladding);
  const w = r.x1 - r.x0;
  const closed = Math.min(1, 0.45 + 0.55 * t);
  k.boxFaces(r.x0, 0, r.z1 - 0.2, r.x0 + w * closed, H, r.z1, FACE_PZ | FACE_PX, cladding, cladding);
  if (closed < 1) k.quad([r.x0 + w * closed, 0.1, r.z1 - 0.25], [r.x1, 0.1, r.z1 - 0.25], [r.x1, H, r.z1 - 0.25], [r.x0 + w * closed, H, r.z1 - 0.25], [0, 0, 1], shade(STEEL, 0.5)); // dark interior through the opening
  k.roof(() => k.flagged(FLAG_SNOWABLE, () => k.slab(r.x0, r.z0, r.x1, r.z1, H, WORLD_RGB.roof.membrane)));
}

/** Scaffold shell 0.8 m outside the walls from 0 to `top`: standards every ~5 m and walk boards every 2 m. Against
 *  a lot edge the shell is pulled in so the boards (0.35 m overhang) stay inside the lot. */
export function scaffold(k: Kit, r: SiteRect, top: number, off = 0.8): void {
  if (top < 1 || !k.lod0) return;
  const lx = k.hw - LOT_INSET - 0.35, lz = k.hd - LOT_INSET - 0.35;
  const X0 = Math.max(-lx, r.x0 - off), X1 = Math.min(lx, r.x1 + off), Z0 = Math.max(-lz, r.z0 - off), Z1 = Math.min(lz, r.z1 + off);
  const sides: [number, number, number, number][] = [[X0, Z1, X1, Z1], [X1, Z0, X1, Z1], [X0, Z0, X1, Z0], [X0, Z0, X0, Z1]];
  for (const [ax, az, bx, bz] of sides) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 5));
    for (let i = 0; i <= n; i++) {
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
      k.beam([x, 0, z], [x, top, z], 0.14, 0.14, SCAFFOLD_BAR, 3);
    }
  }
  for (let y = 2; y <= top + 0.01; y += 2) {
    k.box(X0 - 0.35, y - 0.06, Z1 - 0.35, X1 + 0.35, y, Z1 + 0.35, SCAFFOLD_BOARD, SCAFFOLD_BOARD);
    k.box(X0 - 0.35, y - 0.06, Z0 - 0.35, X1 + 0.35, y, Z0 + 0.35, SCAFFOLD_BOARD, SCAFFOLD_BOARD);
    k.box(X0 - 0.35, y - 0.06, Z0 + 0.35, X0 + 0.35, y, Z1 - 0.35, SCAFFOLD_BOARD, SCAFFOLD_BOARD);
    k.box(X1 - 0.35, y - 0.06, Z0 + 0.35, X1 + 0.35, y, Z1 - 0.35, SCAFFOLD_BOARD, SCAFFOLD_BOARD);
  }
}

/** Tower crane: lattice mast 1.6 m square to mastTop on a concrete pad, slewing jib as an animated part. */
export function towerCrane(k: Kit, x: number, z: number, mastTop: number, jib: number, yaw: number): void {
  k.boxAt(x, z, 4.5, 4.5, 0, 0.6, CONCRETE);
  if (!k.lod0) {
    k.boxAt(x, z, 1.6, 1.6, 0.6, mastTop - 0.6, CRANE_YELLOW);
    return;
  }
  const panels = Math.max(4, Math.round(mastTop / 4));
  k.lattice(x, z, 1.6, 1.6, 0.6, mastTop, panels, 0.2, 0.09, CRANE_YELLOW, LATTICE_ALL);
  k.part('craneJib', x, mastTop, z, yaw, { active: true, extent: jib });
}

/** A chimney or lattice mast rising with the frame (clipped at h). */
function risingTower(k: Kit, t: SiteTower, share: number): void {
  const h = t.h * share;
  if (h < 0.5) return;
  if (t.kind === 'chimney') {
    k.cone(t.x, t.z, t.r, t.r * (1 - 0.18 * share), 0, h, k.lod0 ? 10 : 4, WORLD_RGB.industry.chimneyBrick);
    if (k.lod0 && share < 1) scaffold(k, { x0: t.x - t.r, z0: t.z - t.r, x1: t.x + t.r, z1: t.z + t.r }, h + 1.5, 0.6);
  } else if (k.lod0) {
    k.lattice(t.x, t.z, t.r * 2, Math.max(0.6, t.r * 0.5), 0, h, Math.max(4, Math.round(h / 8)), 0.25, 0.12, WORLD_RGB.industry.galvanized);
  } else {
    k.boxAt(t.x, t.z, t.r, t.r, 0, h, WORLD_RGB.industry.galvanized);
  }
}

/** Generic stage geometry for a site spec, in the kit's authoring frame. */
export function genericSite(k: Kit, spec: SiteSpec, opts: { frame?: boolean } = {}): void {
  const p = k.progress;
  const stage = k.stage;
  const r = spec.rect;
  const H = Math.max(2, spec.height);
  const floorH = spec.floorH ?? (H > 12 ? 4 : Math.max(3, H / 2));
  const hw = k.hw, hd = k.hd;
  const gate: [number, number] = [hw - 14, hw - 5];
  const landscaped = stage === 'finishing' && p >= 0.98;

  // site ground: compacted gravel inside the hoarding
  ground(k, -hw + 0.6, -hd + 0.6, hw - 0.6, hd - 0.6, shade(WORLD_RGB.ground.gravel, 0.96), 0.03);
  if (!landscaped) hoarding(k, -hw + 0.5, -hd + 0.5, hw - 0.5, hd - 0.5, gate);
  else {
    ground(k, -hw + 1, r.z1 + 2, hw - 1, hd - 1, WORLD_RGB.ground.grass, 0.05);
    for (let i = 0; i < 3; i++) tree(k, -hw + 6 + i * ((2 * hw - 12) / 2), hd - 4, 0.8);
  }
  // cabins near the gate, inside the lot
  const cabX = Math.max(-hw + 4, gate[0] - 15), cabZ = Math.min(hd - 4.5, Math.max(r.z1 + 3, hd - 6));
  if (r.z1 + 2.5 < hd - 3) siteCabins(k, cabX, cabZ);

  if (stage === 'foundation') {
    const t = stageT('foundation', p);
    excavation(k, r, t);
    if (t > 0.55) {
      const reach = r.z1 - (r.z1 - r.z0) * Math.min(1, (t - 0.55) / 0.45);
      const mat = { x0: r.x0 + 1, z0: reach, x1: r.x1 - 1, z1: r.z1 - 1 };
      if (mat.z1 - mat.z0 > 2) {
        ground(k, mat.x0, mat.z0, mat.x1, mat.z1, shade(CONCRETE, 0.8), 0.075);
        rebar(k, mat);
      }
    }
    const ex = (r.x0 + r.x1) / 2 + (r.x1 - r.x0) * 0.2, ez = r.z1 - Math.min(10, (r.z1 - r.z0) * 0.3) - 2;
    excavatorAt(k, ex, ez, Math.PI * 0.85);
    k.prop('dumpTruck', ex + 7, Math.min(hd - 6, r.z1 + 3), Math.PI * 0.5);
    k.emit('dust', ex, 1.5, ez, 0.5);
    return;
  }

  const hall = spec.kind === 'hall';
  const H_now = stage === 'structure' ? Math.max(0.5, riseHeight(H, p)) : H;
  let craneX = r.x1;
  if (hall) {
    // halls: steel portal frame bay by bay (B), then cladding and roof (C); no scaffold, a mobile crane follows the
    // erection front
    if (opts.frame !== false) {
      if (stage === 'structure') craneX = steelHall(k, r, H, stageT('structure', p));
      else hallShell(k, r, H, stageT('finishing', p), spec.cladding ?? WORLD_RGB.industry.galvanized);
    }
    if (stage === 'finishing' && landscaped) yard(k, r.x0, r.z1 + 1, r.x1, Math.min(hd - 1, r.z1 + 9), WORLD_RGB.road.parking, 0.06);
  } else if (stage === 'structure') {
    if (opts.frame !== false) concreteFrame(k, r, H_now, floorH);
    scaffold(k, r, Math.min(H + 1.5, H_now + 2));
  } else {
    // finishing: shell to full height; scaffold removed top-down reveals the finished facade
    const tC = stageT('finishing', p);
    const sTop = H * (1 - tC);
    if (opts.frame !== false) {
      k.box(r.x0, 0, r.z0, r.x1, Math.max(0.1, sTop), r.z1, CONCRETE, CONCRETE, null, false);
      if (sTop < H) k.box(r.x0, sTop, r.z0, r.x1, H, r.z1, WORLD_RGB.wall.warmWhite, WORLD_RGB.roof.membrane, null, false);
      k.roof(() => k.flagged(FLAG_SNOWABLE, () => k.slab(r.x0, r.z0, r.x1, r.z1, H, WORLD_RGB.roof.membrane)));
    }
    if (sTop > 1) scaffold(k, r, sTop + 1);
    if (landscaped) {
      yard(k, r.x0, r.z1 + 1, r.x1, Math.min(hd - 1, r.z1 + 9), WORLD_RGB.road.parking, 0.06);
    }
  }
  for (const tw of spec.towers ?? []) risingTower(k, tw, stage === 'structure' ? smoothstep(0.25, 0.85, p) : 1);
  // material laydown by the gate: steel or rebar bundles and pallets of blocks (stage B only)
  if (stage === 'structure' && r.z1 + 7 < hd - 1.5) {
    const lx = Math.min(hw - 6, gate[1] - 1), lz = Math.min(hd - 3, r.z1 + 5);
    for (let i = 0; i < 6; i++) k.prop('palletStack', lx - (i % 3) * 1.6, lz - Math.floor(i / 3) * 1.4, 0, { color: i % 2 ? '#9A9488' : '#B07A52' });
  }

  // cranes: a mobile crane at the erection front of a hall, a tower crane over tall frames, a mobile crane beside low
  // ones; gone at p ≥ 0.95
  if (p < 0.95) {
    if (hall) {
      const cx = Math.max(-hw + 4, Math.min(hw - 4, craneX));
      k.prop('mobileCrane', cx, Math.min(hd - 7, r.z1 + 7), Math.PI);
    } else if (H > 12) {
      const outside = r.x1 + 5.5 < hw - 2.5;
      const cx = outside ? r.x1 + 4 : r.x1 - Math.min(6, (r.x1 - r.x0) * 0.2);
      const cz = r.z0 + Math.min(8, (r.z1 - r.z0) * 0.3);
      const jib = Math.max(18, Math.min(40, Math.hypot(r.x1 - r.x0, r.z1 - r.z0) * 0.75));
      towerCrane(k, cx, cz, H + 12, jib, -Math.PI * 0.75);
    } else {
      k.prop('mobileCrane', Math.min(hw - 4, r.x1 + 3.5), (r.z0 + r.z1) / 2, Math.PI);
    }
    k.emit('dust', (r.x0 + r.x1) / 2, H_now + 1, r.z1 - 2, 0.25);
  }
}

// ---- entry points -----------------------------------------------------------------------------------------------

export interface SiteOptions {
  seed?: number;
  variant?: number;
  lod?: 0 | 1;
  owner?: number;
  companyId?: string;
  /** Draw the rising frame (default true); false when the renderer shows the clipped final mesh instead. */
  frame?: boolean;
  /** Mirror the layout along X (match the odd variant of a W4 type). */
  mirror?: boolean;
  /** Single-storey hall (steel frame, mobile crane) or multi-storey frame (default; see SiteSpec.kind). */
  kind?: 'hall' | 'frame';
}

/** Construction site for ANY company building. `footprint` is either the content footprint in plots ([w, h]; the main
 *  mass is then the lot minus margins) or the building mass in the lot frame. The owner colour comes from
 *  `opts.owner`, else from `b.owner` (chunk builders set it per building). Returns the AssetFactory output. */
export function buildConstructionSite(b: GeoBuilder, lot: LotFrame, footprint: readonly [number, number] | SiteRect, stage: Stage, progress: number, finalHeightHint: number, opts: SiteOptions = {}): AssetOutput {
  const base: SiteSpec = Array.isArray(footprint)
    ? siteSpecFor(undefined, lot, finalHeightHint)
    : { rect: footprint as SiteRect, height: finalHeightHint > 0 ? finalHeightHint : 10 };
  const spec: SiteSpec = opts.kind ? { ...base, kind: opts.kind } : base;
  const params: AssetParams = {
    seed: opts.seed ?? (Math.round(lot.cx * 7 + lot.cz * 13) >>> 0), variant: opts.variant ?? 0, level: 1,
    stage, progress, owner: opts.owner ?? b.owner, utilization: 0, lod: opts.lod ?? 0, season: 1,
  };
  if (opts.companyId !== undefined) params.companyId = opts.companyId;
  const k = new Kit(b, lot, params, { mirror: opts.mirror ?? false });
  if (stage === 'complete' || stage === 'closed') return k.finish();
  genericSite(k, spec, { frame: opts.frame });
  return k.finish();
}

// ---- level upgrades (art §4.1: "a 1-month mini-stage B on the extension footprint only") -----------------------

/** Masses each content level adds, in the lot frame of the even (unmirrored) variant. Odd variants mirror along X:
 *  pass `mirror: true` (buildUpgradeSite does it from the variant). */
export const LEVEL_EXTENSIONS: Readonly<Record<string, Readonly<Partial<Record<2 | 3, readonly SiteRect[]>>>>> = {
  factory_small: { 2: [{ x0: -17, z0: 19, x1: 27, z1: 35 }], 3: [{ x0: 29.7, z0: -33.3, x1: 32.7, z1: -29.7 }, { x0: -14.1, z0: 1.5, x1: -11.9, z1: 18.5 }] },
  factory_large: { 2: [{ x0: -59, z0: 23, x1: 31, z1: 41 }], 3: [{ x0: 35, z0: 32, x1: 54, z1: 51 }, { x0: -26, z0: 44, x1: -4, z1: 58 }] },
  small_farm: { 2: [{ x0: -22.5, z0: -25.5, x1: -11.5, z1: -14.5 }], 3: [{ x0: -9, z0: -35, x1: 11, z1: -23 }] },
  oil_well: { 2: [{ x0: -13, z0: -22, x1: -9, z1: -7 }], 3: [{ x0: -1.5, z0: -4.5, x1: 2.5, z1: 10.5 }, { x0: 11, z0: -1.5, x1: 17, z1: 4.5 }] },
};

/** Final heights of the level extensions (m), parallel to LEVEL_EXTENSIONS. */
const EXTENSION_HEIGHT: Readonly<Record<string, number>> = { factory_small: 8, factory_large: 10, small_farm: 12, oil_well: 6.5 };

/** Overlay for a building being upgraded to `level` (draw it on top of the existing building's previous level):
 *  barrier fencing in the owner colour around each extension mass, the mass rising as a steel frame (large) or a
 *  concrete frame (small), and a mobile crane at the largest one. `progress` is the upgrade's 0..1. Types without
 *  extensions return an empty output. */
export function buildUpgradeSite(b: GeoBuilder, lot: LotFrame, typeId: string, level: 2 | 3, progress: number, p: Pick<AssetParams, 'seed' | 'variant' | 'owner' | 'lod'> & { companyId?: string }): AssetOutput {
  const params: AssetParams = { seed: p.seed, variant: p.variant, level, stage: 'structure', progress: 0.25 + 0.6 * Math.min(1, Math.max(0, progress)), owner: p.owner, utilization: 0, lod: p.lod, season: 1 };
  if (p.companyId !== undefined) params.companyId = p.companyId;
  const k = new Kit(b, lot, params, { mirror: (p.variant & 1) === 1 });
  const rects = LEVEL_EXTENSIONS[typeId]?.[level] ?? [];
  const H = EXTENSION_HEIGHT[typeId] ?? 8;
  const t = Math.min(1, Math.max(0, progress));
  let biggest: SiteRect | null = null;
  for (const r of rects) {
    const area = (r.x1 - r.x0) * (r.z1 - r.z0);
    if (!biggest || area > (biggest.x1 - biggest.x0) * (biggest.z1 - biggest.z0)) biggest = r;
    // owner-colour barrier fencing 1.2 m outside the mass (clamped to the lot)
    const lx = k.hw - LOT_INSET - 0.2, lz = k.hd - LOT_INSET - 0.2;
    const f = { x0: Math.max(-lx, r.x0 - 1.2), z0: Math.max(-lz, r.z0 - 1.2), x1: Math.min(lx, r.x1 + 1.2), z1: Math.min(lz, r.z1 + 1.2) };
    const c: RGB = k.owner === 255 ? WORLD_RGB.wall.greige : k.ownerRgb;
    k.boxFaces(f.x0, 0, f.z1 - 0.1, f.x1, 1.2, f.z1, FACE_PZ | FACE_TOP, c, c);
    k.boxFaces(f.x0, 0, f.z0, f.x1, 1.2, f.z0 + 0.1, FACE_NZ | FACE_TOP, c, c);
    k.boxFaces(f.x0, 0, f.z0, f.x0 + 0.1, 1.2, f.z1, FACE_NX | FACE_TOP, c, c);
    k.boxFaces(f.x1 - 0.1, 0, f.z0, f.x1, 1.2, f.z1, FACE_PX | FACE_TOP, c, c);
    if (area >= 300) steelHall(k, r, H, t);
    else concreteFrame(k, r, Math.max(0.5, H * t), Math.max(3, H / 2));
  }
  if (biggest && t < 0.95) {
    const cx = Math.max(-k.hw + 4, Math.min(k.hw - 4, (biggest.x0 + biggest.x1) / 2));
    const cz = Math.max(-k.hd + 7, Math.min(k.hd - 7, biggest.z1 + 7));
    k.prop('mobileCrane', cx, cz, Math.PI);
    k.emit('dust', cx, 1.5, biggest.z1, 0.3);
  }
  return k.finish();
}

/** Construction stages of a known content type (used by W4 factories for their non-override types). */
export function buildSiteForType(typeId: string, b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
  const k = new Kit(b, lot, p, { mirror: (p.variant & 1) === 1 });
  genericSite(k, siteSpecFor(typeId, lot, p.heightHint));
  return k.finish();
}

/** The generic 'construction' factory: builds the site for `p.targetTypeId` (any content type) at `p.stage` and
 *  `p.progress`; W4 types with their own construction look (farms, oil, mine, port) are delegated to their factory. */
export function makeConstructionFactory(delegates: Readonly<Record<string, AssetFactory>>): AssetFactory {
  return {
    id: 'construction',
    family: 'construction',
    footprints: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [5, 3]],
    triBudget: { lod0: 3200, lod1: 150 },
    build(b: GeoBuilder, lot: LotFrame, p: AssetParams): AssetOutput {
      const stage: Stage = p.stage === 'complete' || p.stage === 'closed' ? 'structure' : p.stage;
      const params: AssetParams = { ...p, stage, progress: progressInStage(stage, p.progress) };
      const typeId = p.targetTypeId;
      const delegate = typeId ? delegates[typeId] : undefined;
      if (delegate) return delegate.build(b, lot, params);
      const k = new Kit(b, lot, params);
      genericSite(k, siteSpecFor(typeId, lot, p.heightHint));
      return k.finish();
    },
  };
}
