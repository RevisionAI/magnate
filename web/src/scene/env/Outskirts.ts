// Terrain around and beyond the city so it never floats in a void (art §1.6 finding 6, §3.12): a flat-shaded
// heightfield with a hole exactly over the city rectangle, field patchwork, meadows at the urban fringe, forests
// (instanced trees), rock on steep slopes, beaches along the coast, river valleys and highway corridors.
//
// Grid: rectilinear ticks that start at the city edges (so the hole is seamless), 48 m cells within 1.7 km of the
// city and 192 m cells beyond, out to ±7 km. ~45k triangles for Metropolis. Colours follow the season (fields are
// recoloured in place, no rebuild). Uses CityMaterial: fog, season tint, snow and the overlay "clay" mode apply.
import * as THREE from 'three';
import { GeoBuilder, toBufferGeometry, type RGB } from '../assets/GeoBuilder';
import { FLAG_PAVED, FLAG_SNOWABLE, FLAG_VEGETATION } from '../materials/CityMaterial';
import type { QualityKnobs } from '../core/Quality';
import { LAYER_OCCLUDER } from '../core/PostPipeline';
import type { FieldStage, SeasonState } from './Seasons';
import { TerrainModel, WATER_LEVEL } from './Terrain';
import { SPECIES_CONIFER, SPECIES_DECIDUOUS, TreeField, type TreeInstance } from './Trees';
import { hash3, mulberry32 } from './rng';

const FINE = 48;
const COARSE = 192;
const INNER_MARGIN = 1700;

const hex = (h: string): RGB => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const C = {
  meadow: hex('#A2B878'), grass2: hex('#8EAD65'), park: hex('#86AE5E'), forestFloor: hex('#7C9A5A'), dryGrass: hex('#C4BE82'),
  soil: hex('#9C7A56'), soilDark: hex('#7C5E43'), sand: hex('#E6D6A8'), rock: hex('#9C968C'), wheat: hex('#D9BE62'),
  wheatGrowing: hex('#A9B85A'), green: hex('#8FAE6A'), stubble: hex('#B8A27A'), sown: hex('#A0946A'), seabed: hex('#B7A880'),
  asphalt: hex('#50545B'), bank: hex('#8A9A62'),
};

/** Biome codes kept per cell for seasonal recolouring. */
const enum Biome { Meadow, Field, Forest, Rock, Sand, Bank, Seabed }

/** Field crop types (row × field hash): cereal, pasture, row crop, fallow. */
function fieldColor(crop: number, stage: FieldStage): RGB {
  switch (crop) {
    case 0: // cereal
      return stage === 'ripe' ? C.wheat : stage === 'growing' ? C.wheatGrowing : stage === 'stubble' ? C.stubble : stage === 'sown' ? C.sown : C.soil;
    case 1: // pasture (season tint handles the rest)
      return C.meadow;
    case 2: // row crops / rapeseed
      return stage === 'ripe' ? C.green : stage === 'growing' ? C.wheatGrowing : stage === 'stubble' ? C.soil : stage === 'sown' ? C.sown : C.soilDark;
    default: // fallow / hay meadow
      return stage === 'ripe' || stage === 'stubble' ? C.dryGrass : C.grass2;
  }
}

/** Grid ticks along one axis: fine cells from the city edges outward to the inner margin, coarse beyond. */
function axisTicks(min: number, max: number, extent: number): number[] {
  const west: number[] = [];
  for (let x = min; x > -extent;) { x -= min - x < INNER_MARGIN ? FINE : COARSE; west.push(Math.max(x, -extent)); }
  const inner: number[] = [];
  for (let x = min; x < max - 1; x += FINE) inner.push(x);
  inner.push(max);
  const east: number[] = [];
  for (let x = max; x < extent;) { x += x - max < INNER_MARGIN ? FINE : COARSE; east.push(Math.min(x, extent)); }
  return [...west.reverse(), ...inner, ...east];
}

interface CellRecord { biome: Biome; crop: number; jitter: number; vertex: number }

export class Outskirts {
  readonly group = new THREE.Group();
  readonly terrain: TerrainModel;
  readonly trees: TreeField;
  readonly triangles: number;
  private readonly mesh: THREE.Mesh;
  private readonly cells: CellRecord[] = [];
  private stage: FieldStage | null = null;

  constructor(terrain: TerrainModel, material: THREE.Material) {
    this.terrain = terrain;
    this.group.name = 'outskirts';
    const r = terrain.rect;
    const xs = axisTicks(r.minX, r.maxX, terrain.extent);
    const zs = axisTicks(r.minZ, r.maxZ, terrain.extent);
    const H = new Float32Array(xs.length * zs.length);
    for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++) H[j * xs.length + i] = terrain.heightAt(xs[i], zs[j]);
    const h = (i: number, j: number) => H[j * xs.length + i];

    const b = new GeoBuilder();
    const seed = terrain.world.seed;
    for (let j = 0; j + 1 < zs.length; j++) {
      for (let i = 0; i + 1 < xs.length; i++) {
        const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        if (cx > r.minX && cx < r.maxX && cz > r.minZ && cz < r.maxZ) continue;      // the city hole
        const h00 = h(i, j), h10 = h(i + 1, j), h11 = h(i + 1, j + 1), h01 = h(i, j + 1);
        if (Math.max(h00, h10, h11, h01) < WATER_LEVEL - 0.3) continue;              // under the water plane
        // Face normal from the diagonals (upward).
        const ax = x1 - x0, az = z1 - z0;
        const nx = -(h10 - h01 + h11 - h00) * az / 2, ny = ax * az, nz = -(h01 - h10 + h11 - h00) * ax / 2;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const n = [nx / nl, ny / nl, nz / nl];
        const slope = (Math.acos(Math.min(1, n[1])) * 180) / Math.PI;
        const hc = (h00 + h10 + h11 + h01) / 4;
        const d = terrain.distToCity(cx, cz);
        // --- biome
        let biome: Biome, crop = 0;
        const sea = terrain.seaAt(cx, cz);
        if (hc < WATER_LEVEL + 0.05) biome = Biome.Seabed;
        else if (sea > 0.002 && hc < 2.2) biome = Biome.Sand;
        else if (hc < 0.6 && terrain.heightAt(cx, cz) < 0.6 && d > 30 && this.nearWater(cx, cz)) biome = Biome.Bank;
        else if (slope > 25) biome = Biome.Rock;
        else if (terrain.forestAt(cx, cz) > 0.5) biome = Biome.Forest;
        else if (d < 260) biome = Biome.Meadow;
        else {
          biome = Biome.Field;
          // Field patchwork: rows of 192–384 m, fields of 144–384 m (48 m aligned, jittered per row).
          const superRow = Math.floor(cz / 384);
          const split = hash3(superRow, 3, seed) < 0.5 ? 192 : 384;
          const row = superRow * 2 + (cz - superRow * 384 >= split ? 1 : 0);
          let k = Math.floor(cx / 240);
          const edge = (kk: number) => kk * 240 + (Math.floor(hash3(row, kk, seed) * 5) - 2) * FINE;
          if (cx < edge(k)) k -= 1; else if (cx >= edge(k + 1)) k += 1;
          crop = Math.floor(hash3(row, k, seed + 11) * 4);
        }
        const flags = biome === Biome.Rock || biome === Biome.Sand || biome === Biome.Seabed ? FLAG_SNOWABLE : FLAG_VEGETATION | FLAG_SNOWABLE;
        b.flags = flags;
        b.tint = 0;
        const jitter = hash3(i, j, seed + 5);
        // One quad (4 vertices, 2 triangles) per cell, so the first vertex of this cell is 2 × triangles so far.
        const record: CellRecord = { biome, crop, jitter, vertex: 2 * b.triangleCount };
        b.quad([x0, h01, z1], [x1, h11, z1], [x1, h10, z0], [x0, h00, z0], n, this.colorFor(record, 'growing'));
        this.cells.push(record);
      }
    }
    this.buildHighways(b);
    const arrays = b.finish();
    this.triangles = arrays.triangleCount;
    const geometry = toBufferGeometry(arrays);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'outskirts-terrain';
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.enable(LAYER_OCCLUDER);        // depth pre-pass: hides the water plane under the hills
    this.group.add(this.mesh);

    this.trees = new TreeField(this.placeTrees(), material, 800, seed);
    this.group.add(this.trees.group);
  }

  /** Highways continue the city's exits to the horizon: a 14 m carriageway draped on the graded corridor. */
  private buildHighways(b: GeoBuilder): void {
    const t = this.terrain;
    b.flags = FLAG_PAVED | FLAG_SNOWABLE;
    b.tint = 0;
    const half = 7, step = 48;
    for (const hw of t.highwayPaths()) {
      const [dx, dz] = hw.edge === 'N' ? [0, -1] : hw.edge === 'S' ? [0, 1] : hw.edge === 'W' ? [-1, 0] : [1, 0];
      const [px, pz] = [-dz, dx];                    // perpendicular (left of the direction)
      let prev = t.edgePoint(hw.edge, 0, hw.center);
      let prevY = Math.max(0.06, t.heightAt(prev[0] + dx * 0.5, prev[1] + dz * 0.5) + 0.08);
      for (let out = step; out <= t.extent; out += step) {
        const cur = t.edgePoint(hw.edge, out, hw.center);
        const curY = Math.max(0.06, t.heightAt(cur[0], cur[1]) + 0.08);
        if (curY < WATER_LEVEL + 0.2 && prevY < WATER_LEVEL + 0.2) break;      // ran into the sea
        const a = [prev[0] - px * half, prevY, prev[1] - pz * half], bb = [prev[0] + px * half, prevY, prev[1] + pz * half];
        const c = [cur[0] + px * half, curY, cur[1] + pz * half], d = [cur[0] - px * half, curY, cur[1] - pz * half];
        // Counter-clockwise seen from above regardless of direction.
        const cross = (bb[0] - a[0]) * (c[2] - a[2]) - (bb[2] - a[2]) * (c[0] - a[0]);
        if (cross < 0) b.quad(a, bb, c, d, [0, 1, 0], C.asphalt);
        else b.quad(a, d, c, bb, [0, 1, 0], C.asphalt);
        prev = cur;
        prevY = curY;
      }
    }
  }

  private nearWater(x: number, z: number): boolean {
    const t = this.terrain;
    return !t.isLand(x + 40, z) || !t.isLand(x - 40, z) || !t.isLand(x, z + 40) || !t.isLand(x, z - 40);
  }

  private colorFor(c: CellRecord, stage: FieldStage): RGB {
    let base: RGB;
    switch (c.biome) {
      case Biome.Field: base = fieldColor(c.crop, stage); break;
      case Biome.Forest: base = C.forestFloor; break;
      case Biome.Rock: base = C.rock; break;
      case Biome.Sand: base = C.sand; break;
      case Biome.Bank: base = C.bank; break;
      case Biome.Seabed: base = C.seabed; break;
      default: base = c.jitter < 0.5 ? C.meadow : C.grass2; break;
    }
    const k = 0.96 + 0.08 * c.jitter;                // ±4 % per cell so large areas are not flat paint
    return [Math.min(255, Math.round(base[0] * k)), Math.min(255, Math.round(base[1] * k)), Math.min(255, Math.round(base[2] * k))];
  }

  /** Forest clumps on a jittered 90 m grid, plus scattered lone trees; deterministic per city. */
  private placeTrees(): TreeInstance[] {
    const t = this.terrain;
    const rnd = mulberry32(t.world.seed ^ 0x2f6b9a1d);
    const out: TreeInstance[] = [];
    const reach = 3600;                              // trees beyond this are sub-pixel and fogged
    const r = t.rect;
    const cap = Math.round(Math.min(1500, Math.max(600, (r.maxX - r.minX) * 0.75)));
    const step = 90;
    for (let z = r.minZ - reach; z < r.maxZ + reach && out.length < cap * 3; z += step) {
      for (let x = r.minX - reach; x < r.maxX + reach; x += step) {
        const px = x + (rnd() - 0.5) * step, pz = z + (rnd() - 0.5) * step;
        const d = t.distToCity(px, pz);
        if (d < 120 || d > reach) continue;
        const f = t.forestAt(px, pz);
        const lone = f < 0.05 && rnd() < 0.035;
        if (f < 0.05 && !lone) continue;
        if (!lone && rnd() > f) continue;
        const n = lone ? 1 + Math.floor(rnd() * 3) : 6 + Math.floor(rnd() * 18 * f);
        const radius = lone ? 10 : 28 + 30 * rnd();
        const conifers = t.relief > 60 ? 0.75 : 0.4;
        for (let k = 0; k < n; k++) {
          const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * radius;
          const tx = px + Math.cos(a) * rr, tz = pz + Math.sin(a) * rr;
          if (t.insideCity(tx, tz) || !t.isLand(tx, tz) || t.highwayAt(tx, tz) > 0.2) continue;
          const y = t.heightAt(tx, tz);
          if (y < WATER_LEVEL + 0.6) continue;
          out.push({ x: tx, y, z: tz, rotY: rnd() * Math.PI * 2, scale: 0.8 + 0.5 * rnd(), species: rnd() < conifers ? SPECIES_CONIFER : SPECIES_DECIDUOUS });
        }
      }
    }
    // Keep the nearest `cap` trees (deterministic: sort by distance, then index).
    return out
      .map((tree, i) => ({ tree, i, d: t.distToCity(tree.x, tree.z) }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .slice(0, cap)
      .map((e) => e.tree);
  }

  /** Recolour fields and trees for a season (fields only when the crop stage changes). */
  applySeason(season: SeasonState): void {
    this.trees.applySeason(season);
    if (season.fieldStage === this.stage) return;
    this.stage = season.fieldStage;
    const attr = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = attr.array as Uint8Array;
    for (const c of this.cells) {
      if (c.biome !== Biome.Field) continue;
      const rgb = this.colorFor(c, season.fieldStage);
      for (let v = 0; v < 4; v++) {
        const o = (c.vertex + v) * 4;
        arr[o] = rgb[0]; arr[o + 1] = rgb[1]; arr[o + 2] = rgb[2];
      }
    }
    attr.needsUpdate = true;
  }

  /** Per frame: tree LOD and shadow casters. Returns true when the shadow casters changed. */
  update(cameraPos: THREE.Vector3, target: THREE.Vector3, knobs: QualityKnobs): boolean {
    return this.trees.update(cameraPos, target, knobs);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.trees.dispose();
    this.group.removeFromParent();
  }
}
