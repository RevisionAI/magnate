// Natural ground model around the city (art §3.12): rolling relief flattened near the city, distant ridges, the sea
// beyond coastal edges, river channels continuing from the city's river mouths, highway corridors. Pure functions of
// (world, x, z) — the Outskirts mesh, forests and the water shore field all sample the same model.
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { PLOT_SIZE } from '../units';
import type { GroundRect } from './ShadowFit';
import {
  WATER_NONE, WATER_SEA, cityRect, riverMouths, seaEdges, waterAt, waterDepthFromEdge,
  type Edge, type RiverMouth, type SceneWorld,
} from './World';
import { mulberry32 } from './rng';
import { smoothstep } from './DayNight';

/** Height of every water surface (sea, rivers, lakes) in metres. */
export const WATER_LEVEL = -0.35;
/** Height of the ground under in-city water plots (only used by the shore field / land tests). */
const RIVERBED = -4;

const SEA_KINDS = new Set([WATER_SEA]);

interface Coast { edge: Edge; inset: Float32Array /* per edge plot, metres */; medianInset: number }
interface River { edge: Edge; center: number /* world coord along the edge */; halfWidth: number; amp: number; wave: number; phase: number }
interface Highway { edge: Edge; center: number }

export class TerrainModel {
  readonly rect: GroundRect;
  /** Half-size of the modelled square around the origin (m). */
  readonly extent: number;
  readonly relief: number;
  private readonly noise: SimplexNoise;
  private readonly coasts: Coast[] = [];
  private readonly rivers: River[] = [];
  private readonly highways: Highway[] = [];

  constructor(readonly world: SceneWorld, extent = 7000) {
    this.rect = cityRect(world);
    this.extent = extent;
    this.relief = world.reliefM;
    const rnd = mulberry32(world.seed ^ 0x51ed270b);
    this.noise = new SimplexNoise({ random: rnd });
    for (const edge of seaEdges(world)) {
      const len = edge === 'N' || edge === 'S' ? world.gridW : world.gridH;
      const inset = new Float32Array(len);
      for (let i = 0; i < len; i++) inset[i] = waterDepthFromEdge(world, edge, i, SEA_KINDS) * PLOT_SIZE;
      const sorted = Array.from(inset).sort((a, b) => a - b);
      this.coasts.push({ edge, inset, medianInset: sorted[Math.floor(sorted.length / 2)] ?? 0 });
    }
    for (const m of riverMouths(world)) this.rivers.push(this.riverFromMouth(m, rnd));
    for (const h of world.highways) {
      const along = (h.at + 0.5) * PLOT_SIZE - ((h.edge === 'N' || h.edge === 'S' ? world.gridW : world.gridH) * PLOT_SIZE) / 2;
      this.highways.push({ edge: h.edge, center: along });
    }
  }

  private riverFromMouth(m: RiverMouth, rnd: () => number): River {
    const len = m.edge === 'N' || m.edge === 'S' ? this.world.gridW : this.world.gridH;
    const center = ((m.from + m.to + 1) / 2) * PLOT_SIZE - (len * PLOT_SIZE) / 2;
    return { edge: m.edge, center, halfWidth: ((m.to - m.from + 1) * PLOT_SIZE) / 2, amp: 120 + 160 * rnd(), wave: 650 + 350 * rnd(), phase: rnd() * Math.PI * 2 };
  }

  /** Distance (m) from the city rectangle (0 inside). */
  distToCity(x: number, z: number): number {
    const r = this.rect;
    const dx = Math.max(r.minX - x, 0, x - r.maxX), dz = Math.max(r.minZ - z, 0, z - r.maxZ);
    return Math.hypot(dx, dz);
  }

  insideCity(x: number, z: number): boolean {
    const r = this.rect;
    return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
  }

  /** (outward distance from the edge line, coordinate along the edge) for a point, relative to `edge`. */
  private edgeFrame(edge: Edge, x: number, z: number): [number, number] {
    const r = this.rect;
    switch (edge) {
      case 'N': return [r.minZ - z, x];
      case 'S': return [z - r.maxZ, x];
      case 'W': return [r.minX - x, z];
      default: return [x - r.maxX, z];
    }
  }

  /** 0..1 "sea-ness" of a point outside the city (1 = open sea). */
  seaAt(x: number, z: number): number {
    let s = 0;
    for (const c of this.coasts) {
      const [out, along] = this.edgeFrame(c.edge, x, z);
      const len = c.inset.length;
      const half = (len * PLOT_SIZE) / 2;
      const i = Math.floor((along + half) / PLOT_SIZE);
      const lateral = Math.max(-half - along, 0, along - half);
      const nearInset = c.inset[Math.min(len - 1, Math.max(0, i))];
      const inset = nearInset + (c.medianInset - nearInset) * smoothstep(0, 500, lateral);
      const wobble = this.noise.noise(along / 900, 31.7 + c.edge.charCodeAt(0)) * 140 * smoothstep(100, 900, lateral);
      // Coastline sits `inset` metres inside the city edge (continuing the city's own shore), then wanders.
      const seaward = out + inset + wobble;
      s = Math.max(s, smoothstep(-20, 45, seaward));
    }
    return s;
  }

  /** 0..1 river channel weight, plus the valley factor (0 on the floodplain … 1 away from the river). */
  private riverAt(x: number, z: number): [number, number] {
    let channel = 0, valley = 1;
    for (const r of this.rivers) {
      const [out, along] = this.edgeFrame(r.edge, x, z);
      if (out < 0) continue;                       // only beyond the edge the river leaves through
      const t = out;
      const ramp = smoothstep(0, 600, t);
      const c = r.center + (r.amp * Math.sin(t / r.wave + r.phase) + 70 * this.noise.noise(t / 700, 11.3 + r.phase)) * ramp;
      const d = Math.abs(along - c);
      channel = Math.max(channel, 1 - smoothstep(r.halfWidth - 3, r.halfWidth + 9, d));
      valley = Math.min(valley, 0.2 + 0.8 * smoothstep(r.halfWidth + 30, r.halfWidth + 650, d));
    }
    return [channel, valley];
  }

  /** Highway centrelines: the edge they leave through and their coordinate along it (world metres). */
  highwayPaths(): ReadonlyArray<{ edge: Edge; center: number }> {
    return this.highways;
  }

  /** World position at `out` metres beyond `edge` and `along` metres along it. */
  edgePoint(edge: Edge, out: number, along: number): [number, number] {
    const r = this.rect;
    switch (edge) {
      case 'N': return [along, r.minZ - out];
      case 'S': return [along, r.maxZ + out];
      case 'W': return [r.minX - out, along];
      default: return [r.maxX + out, along];
    }
  }

  /** 0..1 weight of a highway corridor at the point (1 on the carriageway). */
  highwayAt(x: number, z: number): number {
    let w = 0;
    for (const h of this.highways) {
      const [out, along] = this.edgeFrame(h.edge, x, z);
      if (out < 0) continue;
      w = Math.max(w, 1 - smoothstep(14, 70, Math.abs(along - h.center)));
    }
    return w;
  }

  /** Raw rolling relief before water/corridors (≥ 0). */
  private reliefAt(x: number, z: number, d: number): number {
    if (this.relief <= 0) return 0;
    const n = this.noise;
    const n1 = n.noise(x / 1400, z / 1400) * 0.5 + 0.5;
    const n2 = n.noise(x / 420 + 17.1, z / 420 - 9.3) * 0.5 + 0.5;
    const ridge = 1 - Math.abs(n.noise(x / 2600 - 40.2, z / 2600 + 23.9));
    const flat = smoothstep(150, 900, d);
    return this.relief * flat * (0.5 * n1 + 0.25 * n2 + 0.9 * ridge * ridge * smoothstep(1500, 4500, d));
  }

  /** Ground height (m). Inside the city: 0 on land plots, the riverbed under water plots. */
  heightAt(x: number, z: number): number {
    if (this.insideCity(x, z)) {
      const px = Math.floor((x - this.rect.minX) / PLOT_SIZE), pz = Math.floor((z - this.rect.minZ) / PLOT_SIZE);
      return waterAt(this.world, Math.min(this.world.gridW - 1, px), Math.min(this.world.gridH - 1, pz)) === WATER_NONE ? 0 : RIVERBED;
    }
    const d = this.distToCity(x, z);
    let h = this.reliefAt(x, z, d);
    const [channel, valley] = this.riverAt(x, z);
    h = h * valley;
    // Keep the floodplain just above the water, then cut the channel.
    h = h + (RIVERBED - h) * channel;
    const hw = this.highwayAt(x, z);
    if (hw > 0) h *= 1 - hw;                     // corridor graded to ~0 m (cuttings/embankments)
    const sea = this.seaAt(x, z);
    if (sea > 0) h = h + (-10 - h) * sea;
    return h;
  }

  /**
   * True when the point is dry ground (water shore field, forest placement). Fast path: outside the city, water only
   * exists where a coast or river channel is near (relief itself is never negative).
   */
  isLand(x: number, z: number): boolean {
    if (!this.insideCity(x, z) && this.seaAt(x, z) < 0.01 && this.riverAt(x, z)[0] < 0.01) return true;
    return this.heightAt(x, z) > WATER_LEVEL + 0.05;
  }

  /** 0..1 forest density (low-frequency noise); forests also avoid the city fringe. */
  forestAt(x: number, z: number): number {
    const f = this.noise.noise(x / 900 + 100.3, z / 900 - 50.7) * 0.5 + 0.5;
    const g = this.noise.noise(x / 260 - 7.7, z / 260 + 3.1) * 0.5 + 0.5;
    return smoothstep(0.58, 0.75, f * 0.8 + g * 0.2) * smoothstep(250, 450, this.distToCity(x, z));
  }

  /** Slope in degrees from central differences (step `e` metres). */
  slopeDeg(x: number, z: number, e = 24): number {
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
  }
}
