// Reusable building details for the W4 families, written through a Kit (authoring frame, mirror-aware).
// Each helper documents its triangle cost so factories can stay inside the art-bible budgets.
import { FLAG_PAVED, FLAG_SNOWABLE } from '../../../materials/CityMaterial';
import { Facade, FACE_ALL, FACE_NX, FACE_NZ, FACE_PX, FACE_PZ, FACE_TOP, type FacadeParams, type RGB } from '../../GeoBuilder';
import { ASSET_RGB, WORLD_RGB, hexRgb, mixRgb, shade, tintHex, vehicleBodyHex } from '../../palette';
import { TREE_BASE } from './props';
import type { Kit, P3 } from './kit';

export type Face = 'pz' | 'nz' | 'px' | 'nx';

const OUT: Readonly<Record<Face, P3>> = { pz: [0, 0, 1], nz: [0, 0, -1], px: [1, 0, 0], nx: [-1, 0, 0] };
const POLE = hexRgb('#5D646C');
const MAST = hexRgb('#6A727B');
const ALL_BUT: Readonly<Record<Face, number>> = {
  pz: FACE_PZ | FACE_PX | FACE_NX | FACE_TOP, nz: FACE_NZ | FACE_PX | FACE_NX | FACE_TOP,
  px: FACE_PX | FACE_PZ | FACE_NZ | FACE_TOP, nx: FACE_NX | FACE_PZ | FACE_NZ | FACE_TOP,
};

/** Unit outward vector of a wall face. */
export function faceOut(f: Face): P3 { return OUT[f]; }

/** Thin slab standing proud of a wall: wall plane at `plane` (z for pz/nz, x for px/nx), spanning a0..a1 along the
 *  wall and y0..y1. Owner bands, stripes, fascia boards, sign backs. 8 triangles (the face against the wall is
 *  skipped). */
export function wallStrip(k: Kit, f: Face, plane: number, a0: number, a1: number, y0: number, y1: number, rgb: RGB, depth = 0.12, em = 0, fac: FacadeParams | null = null): void {
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  const faces = ALL_BUT[f];
  if (f === 'pz') k.boxFaces(lo, y0, plane, hi, y1, plane + depth, faces, rgb, rgb, fac, em);
  else if (f === 'nz') k.boxFaces(lo, y0, plane - depth, hi, y1, plane, faces, rgb, rgb, fac, em);
  else if (f === 'px') k.boxFaces(plane, y0, lo, plane + depth, y1, hi, faces, rgb, rgb, fac, em);
  else k.boxFaces(plane - depth, y0, lo, plane, y1, hi, faces, rgb, rgb, fac, em);
}

/** Flat quad on a wall face, `off` metres in front of it (doors, glass bands, windows of closed buildings). 2 tris. */
export function wallQuad(k: Kit, f: Face, plane: number, a0: number, a1: number, y0: number, y1: number, rgb: RGB, off = 0.03, em = 0): void {
  const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  const o = OUT[f];
  if (f === 'pz' || f === 'nz') {
    const z = plane + o[2] * off;
    k.quad([lo, y0, z], [hi, y0, z], [hi, y1, z], [lo, y1, z], o, rgb, em);
  } else {
    const x = plane + o[0] * off;
    k.quad([x, y0, lo], [x, y0, hi], [x, y1, hi], [x, y1, lo], o, rgb, em);
  }
}

/** Owner colour band (eaves band, parapet band). Faint night glow so every company building has an emissive owner
 *  element (art §4.1 Night). 8 triangles. */
export function ownerBand(k: Kit, f: Face, plane: number, a0: number, a1: number, y0: number, y1: number): void {
  wallStrip(k, f, plane, a0, a1, y0, y1, k.closed ? ASSET_RGB.closedGrey : k.ownerRgb, 0.14, k.lit ? 34 : 0);
}

/** Loading dock door with a black dock shelter (art §4.2.6): ~14 triangles. `center` runs along the wall. */
export function dockDoor(k: Kit, f: Face, plane: number, center: number, w: number, h: number, door: RGB = WORLD_RGB.industry.dockDoors): void {
  const shelter = ASSET_RGB.dockShelter;
  wallStrip(k, f, plane, center - w / 2 - 0.45, center + w / 2 + 0.45, 0.2, h + 0.55, shelter, 0.5);
  const o = OUT[f];
  const p = plane + (o[0] + o[2]) * 0.52;
  wallQuad(k, f, p, center - w / 2, center + w / 2, 0.25, h, k.closed ? ASSET_RGB.boarded : door, 0.0);
  // dock bumper / leveller lip
  wallStrip(k, f, p, center - w / 2, center + w / 2, 0.0, 0.25, shade(door, 0.6), 0.6);
}

/** Roll-up door at ground level without a shelter (warehouse yard side, workshop). 2–10 triangles. */
export function rollerDoor(k: Kit, f: Face, plane: number, center: number, w: number, h: number): void {
  wallStrip(k, f, plane, center - w / 2 - 0.2, center + w / 2 + 0.2, 0, h + 0.3, WORLD_RGB.wall.concreteDark, 0.08);
  const o = OUT[f];
  wallQuad(k, f, plane + (o[0] + o[2]) * 0.1, center - w / 2, center + w / 2, 0.02, h, k.closed ? ASSET_RGB.boarded : WORLD_RGB.industry.dockDoors, 0.0);
}

/** Facade param for INDUSTRIAL walls (clerestory band at 70–88 % of the wall), or null when the building is not lit
 *  (closed / idle): callers then add `clerestoryGlass` so the glazing still reads by day but stays dark at night. */
export function industrialFacade(k: Kit, wallH: number, bayM = 5): FacadeParams | null {
  return k.lit ? [Facade.INDUSTRIAL, k.p.seed & 255, Math.min(255, Math.round(wallH * 10)), Math.round(bayM * 10)] : null;
}

/** Facade param for OFFICE ribbon windows, or null when not lit (use `ribbonGlass`). */
export function officeFacade(k: Kit, floorH = 3.7): FacadeParams | null {
  return k.lit ? [Facade.OFFICE, (k.p.seed >>> 4) & 255, Math.round(floorH * 10), 30] : null;
}

/** Unlit clerestory band (70–88 % of the wall) on the given faces of a box — the day look of an INDUSTRIAL facade for
 *  closed or idle buildings. 2 triangles per face. */
export function clerestoryGlass(k: Kit, x0: number, z0: number, x1: number, z1: number, wallH: number, faces: readonly Face[]): void {
  const g = shade(WORLD_RGB.industry.glass2, 0.82);
  for (const f of faces) {
    const [plane, a0, a1] = f === 'pz' ? [z1, x0, x1] : f === 'nz' ? [z0, x0, x1] : f === 'px' ? [x1, z0, z1] : [x0, z0, z1];
    wallQuad(k, f, plane, a0 + 0.4, a1 - 0.4, wallH * 0.7, wallH * 0.88, g, 0.02);
  }
}

/** Unlit ribbon windows (OFFICE style) per floor on the given faces. 2 triangles per face per floor. */
export function ribbonGlass(k: Kit, x0: number, z0: number, x1: number, z1: number, floors: number, floorH: number, faces: readonly Face[]): void {
  const g = shade(WORLD_RGB.industry.glass, 0.9);
  for (const f of faces) {
    const [plane, a0, a1] = f === 'pz' ? [z1, x0, x1] : f === 'nz' ? [z0, x0, x1] : f === 'px' ? [x1, z0, z1] : [x0, z0, z1];
    for (let i = 0; i < floors; i++) wallQuad(k, f, plane, a0 + 0.3, a1 - 0.3, i * floorH + floorH * 0.34, i * floorH + floorH * 0.86, g, 0.02);
  }
}

/** Brick (or steel) chimney with an owner band 1.2 m below the top (art §4.2.4). Returns the emitter point (top).
 *  ~64 triangles with 10 segments. */
export function chimney(k: Kit, cx: number, cz: number, r: number, h: number, rgb: RGB = WORLD_RGB.industry.chimneyBrick, segs = 10): P3 {
  if (!k.lod0) {
    // city band: a tapered 4-sided stack (8 triangles); the band is too small to read there
    k.cone(cx, cz, r * 1.1, r * 0.9, 0, h, 4, rgb);
    return [cx, h + 0.5, cz];
  }
  k.cone(cx, cz, r, r * 0.82, 0, h, segs, rgb);
  const band = k.closed ? ASSET_RGB.closedGrey : k.ownerRgb;
  const rb = r * 0.82 + (r - r * 0.82) * (2.4 / h) + 0.06;
  k.cyl(cx, cz, rb, h - 2.4, h - 1.2, segs, band, band, false, k.lit ? 30 : 0);
  k.cyl(cx, cz, r * 0.86, h - 0.5, h, segs, shade(rgb, 0.62), shade(ASSET_RGB.dockShelter, 1), true);
  return [cx, h + 0.5, cz];
}

/** Grain / feed silo with a cone cap and a hatch (art §4.2.4 food, §4.2.9). ~40 triangles at 12 segments. */
export function silo(k: Kit, cx: number, cz: number, r: number, h: number, rgb: RGB = WORLD_RGB.industry.galvanized, segs = 12): void {
  k.cyl(cx, cz, r, 0, h, segs, rgb, rgb, false);
  k.flagged(FLAG_SNOWABLE, () => k.cone(cx, cz, r * 1.04, 0.35, h, h + r * 0.55, segs, shade(rgb, 1.1)));
  k.boxAt(cx, cz, 0.7, 0.7, h + r * 0.5, 0.4, shade(rgb, 0.8));
}

/** Vertical tank with a shallow cone roof and an optional owner band (oil tanks, stainless process tanks). */
export function tank(k: Kit, cx: number, cz: number, r: number, h: number, rgb: RGB, band: RGB | null = null, segs = 12): void {
  k.cyl(cx, cz, r, 0, h, segs, rgb, rgb, false);
  k.flagged(FLAG_SNOWABLE, () => k.cone(cx, cz, r, 0, h, h + r * 0.22, segs, shade(rgb, 1.04)));
  if (band) k.cyl(cx, cz, r + 0.05, h * 0.62, h * 0.62 + Math.min(1.4, h * 0.16), segs, band, band, false, k.lit ? 30 : 0);
}

/** Horizontal (bullet) tank on two saddles along the given axis. ~52 triangles at 8 segments. */
export function hTank(k: Kit, p0: P3, p1: P3, r: number, rgb: RGB, segs = 8): void {
  const y = p0[1];
  k.cylAlong(p0, p1, r, segs, rgb, shade(rgb, 0.92));
  const t = [0.2, 0.8];
  for (const f of t) {
    const x = p0[0] + (p1[0] - p0[0]) * f, z = p0[2] + (p1[2] - p0[2]) * f;
    const alongX = Math.abs(p1[0] - p0[0]) > Math.abs(p1[2] - p0[2]);
    k.boxAt(x, z, alongX ? 0.6 : r * 1.6, alongX ? r * 1.6 : 0.6, 0, y - r * 0.55, WORLD_RGB.wall.concrete);
  }
}

/** Pipe rack: posts every ~6 m with two pipes along a straight run at height y. */
export function pipeRack(k: Kit, x0: number, z0: number, x1: number, z1: number, y: number, rgb: RGB = WORLD_RGB.industry.galvanized): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 6));
  const dx = (x1 - x0) / len, dz = (z1 - z0) / len, px = -dz, pz = dx;
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * (i / n), z = z0 + (z1 - z0) * (i / n);
    k.beam([x, 0, z], [x, y + 0.2, z], 0.3, 0.3, shade(rgb, 0.8), 3);
    k.beam([x - px * 0.9, y, z - pz * 0.9], [x + px * 0.9, y, z + pz * 0.9], 0.2, 0.2, shade(rgb, 0.8), 3);
  }
  for (const o of [-0.5, 0.5]) k.cylAlong([x0 + px * o, y + 0.35, z0 + pz * o], [x1 + px * o, y + 0.35, z1 + pz * o], 0.22, 5, rgb, null);
}

/** Enclosed conveyor gallery from p0 to p1 (2 m wide) with support legs (art §4.2.12, §4.2.4 L3 conveyor bridge). */
export function conveyor(k: Kit, p0: P3, p1: P3, w = 2, h = 1.8, rgb: RGB = WORLD_RGB.industry.galvanized, legs = 2): void {
  k.beam(p0, p1, w, h, rgb, 4, true);
  for (let i = 1; i <= legs; i++) {
    const t = i / (legs + 1);
    const x = p0[0] + (p1[0] - p0[0]) * t, y = p0[1] + (p1[1] - p0[1]) * t, z = p0[2] + (p1[2] - p0[2]) * t;
    if (y - h / 2 > 0.5) k.beam([x, 0, z], [x, y - h / 2, z], 0.4, 0.4, shade(rgb, 0.75), 3);
  }
}

/** Perimeter chain-link fence (2 m, LOD0 only) around [x0,x1]×[z0,z1] with a gate gap in the front (+Z) side.
 *  Drawn as see-through: the mesh is ONE outward-facing quad per run (back-face culling hides the far runs, so the
 *  yard stays visible), plus a top rail and posts at the corners, the gate and every `postEvery` metres (0 = corners
 *  and gate only). ~8 triangles per run + 6 per post. */
export function fence(k: Kit, x0: number, z0: number, x1: number, z1: number, h = 2, gate: readonly [number, number] | null = null, postEvery = 15): void {
  if (!k.lod0) return;
  const mesh = mixRgb(WORLD_RGB.industry.galvanized, WORLD_RGB.wall.warmWhite, 0.3);
  const steel = shade(WORLD_RGB.industry.galvanized, 0.8);
  const runs: [number, number, number, number, P3][] = [[x0, z0, x1, z0, [0, 0, -1]], [x0, z0, x0, z1, [-1, 0, 0]], [x1, z0, x1, z1, [1, 0, 0]]];
  if (gate) {
    const [g0, g1] = gate[0] < gate[1] ? gate : [gate[1], gate[0]];
    if (g0 - x0 > 0.3) runs.push([x0, z1, g0, z1, [0, 0, 1]]);
    if (x1 - g1 > 0.3) runs.push([g1, z1, x1, z1, [0, 0, 1]]);
  } else {
    runs.push([x0, z1, x1, z1, [0, 0, 1]]);
  }
  const posts: [number, number][] = [];
  for (const [ax, az, bx, bz, out] of runs) {
    k.quad([ax, 0.05, az], [bx, 0.05, bz], [bx, h - 0.08, bz], [ax, h - 0.08, az], out, mesh);
    k.beam([ax, h, az], [bx, h, bz], 0.07, 0.07, steel, 3);
    const len = Math.hypot(bx - ax, bz - az);
    const n = postEvery > 0 ? Math.max(1, Math.round(len / postEvery)) : 1;
    for (let i = 0; i <= n; i++) posts.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
  }
  const seen = new Set<string>();
  for (const [x, z] of posts) {
    const key = `${x.toFixed(2)},${z.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    k.beam([x, 0, z], [x, h + 0.05, z], 0.1, 0.1, steel, 3);
  }
}

/** Yard / car-park lamp: pole, arm and an emissive head, plus a ground light pool (art §3.13). ~22 triangles. */
export function yardLamp(k: Kit, x: number, z: number, h = 9, armYaw = 0, tone: 'warm' | 'cool' = 'warm'): void {
  if (!k.lod0) return;
  k.beam([x, 0, z], [x, h, z], 0.22, 0.22, POLE, 3);
  const hx = x + Math.sin(armYaw) * 1.6, hz = z + Math.cos(armYaw) * 1.6;
  k.beam([x, h - 0.1, z], [hx, h - 0.1, hz], 0.12, 0.12, POLE, 3);
  const head = tone === 'warm' ? ASSET_RGB.lampHead : ASSET_RGB.floodHead;
  k.boxFaces(hx - 0.28, h - 0.4, hz - 0.38, hx + 0.28, h - 0.12, hz + 0.38, FACE_ALL, head, head, null, k.closed ? 0 : 255);
  if (!k.closed) k.pool(hx, hz, 14, tone);
}

/** Flood mast (port / yard), cool-white lamp bank and a 30 m light pool (art §4.2.8). ~36 triangles. */
export function floodMast(k: Kit, x: number, z: number, h = 30, faceYaw = 0): void {
  if (!k.lod0) return;
  const pole = MAST;
  k.beam([x, 0, z], [x, h, z], 0.7, 0.7, pole, 4);
  const c = ASSET_RGB.floodHead;
  const s = Math.sin(faceYaw), co = Math.cos(faceYaw);
  k.beam([x - co * 1.8, h, z + s * 1.8], [x + co * 1.8, h, z - s * 1.8], 0.5, 1.2, k.closed ? pole : c, 4, true, k.closed ? 0 : 255);
  if (!k.closed) k.pool(x + s * 6, z + co * 6, 30, 'cool');
}

/** Flag pole with the animated owner flag on top (art §4.2.4 "flag 12 m"). 6 triangles static. */
export function flagpole(k: Kit, x: number, z: number, h = 12): void {
  if (!k.lod0) return;
  k.beam([x, 0, z], [x, h, z], 0.16, 0.16, WORLD_RGB.wall.aluminium, 3);
  k.part('flag', x, h - 0.1, z, Math.PI * 0.15, { active: !k.closed });
}

/** Row of parking bays with white lines on an existing surface; returns bay centres (nose towards `noseZ` sign).
 *  2 triangles per line. */
export function parkingRow(k: Kit, x0: number, zFront: number, count: number, depth = 5, bayW = 2.6, noseDir: 1 | -1 = -1): { x: number; z: number }[] {
  const line = WORLD_RGB.road.marking;
  const z1 = zFront + noseDir * depth;
  const out: { x: number; z: number }[] = [];
  if (k.lod0) {
    for (let i = 0; i <= count; i++) k.strip(x0 + i * bayW, zFront, x0 + i * bayW, z1, 0.12, 0.07, line);
  }
  for (let i = 0; i < count; i++) out.push({ x: x0 + (i + 0.5) * bayW, z: (zFront + z1) / 2 });
  return out;
}

/** Fill some bays with parked cars (neutral colours, §3.3 distribution). `fill` is the occupied share. */
export function parkCars(k: Kit, bays: readonly { x: number; z: number }[], fill: number, yaw = 0): void {
  for (const bay of bays) {
    if (k.rnd() < fill) k.prop('parkedCars', bay.x, bay.z, yaw + (k.rnd() < 0.5 ? 0 : Math.PI), { color: vehicleBodyHex(k.rnd()) });
  }
}

const LEAVES = [WORLD_RGB.vegetation.leaf1, WORLD_RGB.vegetation.leaf2, WORLD_RGB.vegetation.leaf3] as const;
const AUTUMN = [WORLD_RGB.vegetation.autumn1, WORLD_RGB.vegetation.autumn2] as const;
const BARE = hexRgb('#8A7F70');
const BLOSSOM = hexRgb('#F2C6D0');

/** Instance colour for a 'shadeTree' prop this month (art §3.14): summer greens, 8 % blossom in spring, 40 % autumn
 *  ochre / rust in Sep–Nov, bare grey-brown in Dec–Feb; evergreen trees stay green. Consumes the kit's random stream. */
export function treeTint(k: Kit, evergreen = false): string {
  const u = k.rnd(), leaf = LEAVES[Math.floor(k.rnd() * LEAVES.length) % LEAVES.length];
  const m = k.month;
  let target: RGB = leaf;
  if (!evergreen) {
    if (m >= 3 && m <= 5 && u < 0.08) target = BLOSSOM;
    else if (m >= 9 && m <= 11 && u < 0.4) target = AUTUMN[u < 0.2 ? 0 : 1];
    else if (m === 12 || m <= 2) target = BARE;
  }
  return tintHex(TREE_BASE, target);
}

/** Seasonal shade tree (instanced 'shadeTree') at (x, z) with a random yaw. */
export function tree(k: Kit, x: number, z: number, scale: number, o: { y?: number; evergreen?: boolean } = {}): void {
  if (!k.lod0) return;
  k.prop('shadeTree', x, z, k.rnd() * 6, { scale, color: treeTint(k, o.evergreen), ...(o.y !== undefined ? { y: o.y } : {}) });
}

/** Darker contact apron around a building footprint baked into the yard (art §3.5): up to 4 slabs, 8 triangles.
 *  Clipped to the lot (minus `LOT_INSET`) so a building against the lot edge never paints the neighbour. */
export function apron(k: Kit, x0: number, z0: number, x1: number, z1: number, base: RGB, w = 1.5, y = 0.05): void {
  const c = shade(base, 0.82);
  const lx = k.hw - LOT_INSET, lz = k.hd - LOT_INSET;
  const X0 = Math.max(-lx, x0 - w), X1 = Math.min(lx, x1 + w), Z0 = Math.max(-lz, z0 - w), Z1 = Math.min(lz, z1 + w);
  if (Z1 - z1 > 0.05) k.slab(X0, z1, X1, Z1, y, c);
  if (z0 - Z0 > 0.05) k.slab(X0, Z0, X1, z0, y, c);
  if (x0 - X0 > 0.05) k.slab(X0, z0, x0, z1, y, c);
  if (X1 - x1 > 0.05) k.slab(x1, z0, X1, z1, y, c);
}

/** Distance kept between lot dressing (aprons, weeds, scaffolds) and the lot edge, metres. */
export const LOT_INSET = 0.25;

/** Paved yard slab (rain wetness flag). */
export function yard(k: Kit, x0: number, z0: number, x1: number, z1: number, rgb: RGB = WORLD_RGB.road.parking, y = 0.04): void {
  k.flagged(FLAG_PAVED, () => k.slab(x0, z0, x1, z1, y, rgb));
}

/** Natural ground slab (snowable): gravel pads, fields, farmyards. */
export function ground(k: Kit, x0: number, z0: number, x1: number, z1: number, rgb: RGB, y = 0.035): void {
  k.flagged(FLAG_SNOWABLE, () => k.slab(x0, z0, x1, z1, y, rgb));
}

/** Weed patches on a closed lot (art §4.1: 3 patches of #C4BE82), LOD0 only. Irregular quads, 2 triangles each.
 *  Patches stay inside `zone` (default: the lot minus 3 m) and always inside the lot. */
export function weeds(k: Kit, count = 3, zone?: readonly [number, number, number, number]): void {
  if (!k.closed || !k.lod0) return; // too small to read in the city band
  const [zx0, zz0, zx1, zz1] = zone ?? [-k.hw + 3, -k.hd + 3, k.hw - 3, k.hd - 3];
  const lx = k.hw - LOT_INSET, lz = k.hd - LOT_INSET;
  const x0 = Math.max(-lx, Math.min(zx0, zx1)), x1 = Math.min(lx, Math.max(zx0, zx1));
  const z0 = Math.max(-lz, Math.min(zz0, zz1)), z1 = Math.min(lz, Math.max(zz0, zz1));
  for (let i = 0; i < count; i++) {
    // radius first, then a centre that keeps the whole patch inside the zone
    const r = Math.min(3 + 4 * k.rnd(), (x1 - x0) / 2, (z1 - z0) / 2);
    const cx = x0 + r + (x1 - x0 - 2 * r) * k.rnd(), cz = z0 + r + (z1 - z0 - 2 * r) * k.rnd();
    const a = k.rnd() * Math.PI;
    const pt = (t: number, rr: number): P3 => [cx + Math.cos(a + t) * rr, 0.09, cz + Math.sin(a + t) * rr];
    k.quad(pt(0, r), pt(Math.PI * 0.55, r * 0.7), pt(Math.PI, r * 0.9), pt(Math.PI * 1.45, r * 0.65), [0, 1, 0], ASSET_RGB.weeds);
  }
}

/** Rooftop HVAC unit: box with a dark grille. 12 triangles. */
export function hvac(k: Kit, x: number, z: number, y: number, w = 3, d = 2, h = 1.5): void {
  k.boxAt(x, z, w, d, y, h, WORLD_RGB.industry.silver, shade(WORLD_RGB.industry.silver, 0.9));
  k.slab(x - w * 0.35, z - d * 0.3, x + w * 0.35, z + d * 0.3, y + h + 0.02, ASSET_RGB.dockShelter);
}

/** Rooftop wordmark board on two legs (owner board + SignQuad facing `f`). ~28 triangles. */
export function roofBoard(k: Kit, cx: number, cz: number, y: number, w: number, h: number, f: Face = 'pz', lift = 0.6): void {
  const back = k.closed ? ASSET_RGB.closedGrey : k.ownerRgb;
  const o = OUT[f];
  const along: P3 = f === 'pz' || f === 'nz' ? [1, 0, 0] : [0, 0, 1];
  const legs = [-w * 0.35, w * 0.35];
  for (const a of legs) {
    const lx = cx + along[0] * a, lz = cz + along[2] * a;
    k.beam([lx - o[0] * 0.3, y, lz - o[2] * 0.3], [lx - o[0] * 0.3, y + lift + 0.2, lz - o[2] * 0.3], 0.18, 0.18, WORLD_RGB.industry.dockDoors, 3);
  }
  const t = 0.25;
  if (f === 'pz' || f === 'nz') k.box(cx - w / 2, y + lift, cz - t / 2, cx + w / 2, y + lift + h, cz + t / 2, back, back);
  else k.box(cx - t / 2, y + lift, cz - w / 2, cx + t / 2, y + lift + h, cz + w / 2, back, back);
  k.sign([cx + o[0] * (t / 2), y + lift + h / 2, cz + o[2] * (t / 2)], o, w * 0.96, h * 0.9);
}

/** Wall-mounted wordmark (fascia sign) on a face; board in owner colour + SignQuad. 10 triangles. */
export function wallSign(k: Kit, f: Face, plane: number, center: number, y: number, w: number, h: number): void {
  const back = k.closed ? ASSET_RGB.closedGrey : k.ownerRgb;
  wallStrip(k, f, plane, center - w / 2, center + w / 2, y - h / 2, y + h / 2, back, 0.18);
  const o = OUT[f];
  const c: P3 = f === 'pz' || f === 'nz' ? [center, y, plane + o[2] * 0.18] : [plane + o[0] * 0.18, y, center];
  k.sign(c, o, w * 0.94, h * 0.86);
}

/** Small gatehouse / guard booth with a barrier arm across the entrance lane (`armDir` +1 = towards +X, −1 = −X;
 *  `armLen` metres). ~30 triangles. */
export function guardhouse(k: Kit, x: number, z: number, armDir: 1 | -1 = 1, armLen = 5.7): void {
  k.boxAt(x, z, 3, 3, 0, 2.8, WORLD_RGB.wall.warmWhite, WORLD_RGB.roof.membrane);
  k.boxAt(x, z, 3.6, 3.6, 2.8, 0.25, WORLD_RGB.roof.flat);
  if (k.lod0) k.beam([x + armDir * 1.8, 1.0, z + 1.6], [x + armDir * (1.8 + armLen), 1.0, z + 1.6], 0.12, 0.12, ASSET_RGB.valveRed, 3);
}
