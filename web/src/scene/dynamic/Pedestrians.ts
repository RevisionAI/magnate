// Pedestrians and shoppers (art §5.17, UX §8 #13). People walk the sidewalks of the road graph: every road node has
// four sidewalk corners, linked along each edge (same side of the street) and around the node (zebra crossings where an
// arm exists, plain pavement where it does not). Walkers wander that corner graph at 1.3 ± 0.2 m/s; their number
// follows the land use around the camera target, the time of day and the tier cap (600 LOW / 1,500 MED / 3,000 HIGH),
// they only exist within 600 m of the target and are drawn within the 420 m street band. Shoppers walk between each
// busy store's door and the sidewalk: min(40, round(6·log10(1 + unitsSold))) per store. Reduced motion freezes them.
import * as THREE from 'three';
import type { FrameInfo, SceneContext, SceneModule } from '../SceneContext';
import { GeoBuilder, toBufferGeometry, type RGB } from '../assets/GeoBuilder';
import { hexRgb } from '../assets/palette';
import { makeCityMaterial } from '../materials/CityMaterial';
import { mulberry32 } from '../env/rng';
import { PLOT_SIZE } from '../units';
import type { LivingCity, LiveBuilding } from './LivingCity';
import { USE_CBD, USE_COMMERCIAL, USE_INDUSTRIAL, USE_PARK, USE_RESIDENTIAL, isRetail } from './source/types';
import { DX, DZ, type RoadGraph } from './traffic/RoadGraph';
import { linearRgb } from './traffic/VehicleRenderer';

/** Shoppers per store (UX §6.5). */
export function shoppersFor(unitsSold: number): number {
  return Math.min(40, Math.round(6 * Math.log10(1 + Math.max(0, unitsSold))));
}

/** Pedestrian density 0..1 by hour (people are about from 7 to 22, peaking at lunch and after work). */
export function pedestrianDayFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5) return 0.08;
  if (h < 8) return 0.08 + ((h - 5) / 3) * 0.72;
  if (h < 12) return 0.8;
  if (h < 14) return 1;
  if (h < 17) return 0.85;
  if (h < 19) return 1;
  if (h < 23) return 1 - ((h - 19) / 4) * 0.8;
  return 0.2 - (h - 23) * 0.12;
}

export const PED_VISIBLE_BAND = 420;
export const PED_SIM_RADIUS = 600;

/** Sidewalk corner graph over the road graph. Corner id = node * 4 + quadrant (0 NW, 1 NE, 2 SE, 3 SW). */
export interface SidewalkGraph {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Neighbour corner ids per corner (−1 = none): along the 4 directions N, E, S, W. */
  links: Int32Array;
  /** 1 when the link crosses a carriageway (zebra). */
  crossing: Uint8Array;
  count: number;
}

const QUAD_SIGNS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const quadOf = (sx: number, sz: number): number => (sz < 0 ? (sx < 0 ? 0 : 1) : sx > 0 ? 2 : 3);

export function buildSidewalks(g: RoadGraph): SidewalkGraph {
  const n = g.nodes.length * 4;
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  const links = new Int32Array(n * 4).fill(-1);
  const crossing = new Uint8Array(n * 4);
  for (const node of g.nodes) {
    const o = node.half + 3;
    for (let q = 0; q < 4; q++) {
      const [sx, sz] = QUAD_SIGNS[q];
      const c = node.id * 4 + q;
      x[c] = node.x + sx * o;
      z[c] = node.z + sz * o;
      y[c] = node.y + 0.15;
      // around the node: the neighbour corner across x (direction E or W) and across z (N or S)
      const acrossX = node.id * 4 + quadOf(-sx, sz);
      const dirX = sx > 0 ? 3 : 1;            // walking from an east corner towards the west one
      links[c * 4 + dirX] = acrossX;
      crossing[c * 4 + dirX] = node.arms[sz < 0 ? 0 : 2] >= 0 ? 1 : 0;   // crosses the N or S arm
      const acrossZ = node.id * 4 + quadOf(sx, -sz);
      const dirZ = sz > 0 ? 0 : 2;
      links[c * 4 + dirZ] = acrossZ;
      crossing[c * 4 + dirZ] = node.arms[sx > 0 ? 1 : 3] >= 0 ? 1 : 0;   // crosses the E or W arm
    }
  }
  // along edges: from node a's corners on either side of the arm to node b's matching corners
  for (const e of g.edges) {
    const a = g.nodes[e.a], b = g.nodes[e.b];
    const d = e.dirA, rx = DX[(d + 1) & 3], rz = DZ[(d + 1) & 3];
    for (const side of [-1, 1]) {
      const ca = a.id * 4 + quadOf(Math.sign(DX[d] + rx * side), Math.sign(DZ[d] + rz * side));
      const cb = b.id * 4 + quadOf(Math.sign(-DX[d] + rx * side), Math.sign(-DZ[d] + rz * side));
      links[ca * 4 + d] = cb;
      links[cb * 4 + ((d + 2) & 3)] = ca;
    }
  }
  return { x, y, z, links, crossing, count: n };
}

const CLOTHES: readonly RGB[] = [
  '#2F3D55', '#8A3B33', '#3E6B4A', '#C9B27C', '#5B5F66', '#E8E2D4', '#B8642F', '#46607A', '#7A4F7E', '#2A2C30', '#9AA6B1', '#C24D5A',
].map(hexRgb);
const SKIN: readonly RGB[] = ['#E6C2A0', '#C9966D', '#8D5B3E', '#F1D3B6'].map(hexRgb);
const LEGS: RGB = hexRgb('#2C3038');

/** 20-triangle person, 1.75 m: legs, torso (instance colour), head. */
export function personGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.tint = 0;
  b.box(-0.17, 0, -0.1, 0.17, 0.85, 0.1, LEGS, LEGS, null, false);
  b.tint = 255;
  b.box(-0.23, 0.85, -0.13, 0.23, 1.45, 0.13, [255, 255, 255], [255, 255, 255]);
  b.tint = 0;
  b.box(-0.11, 1.48, -0.11, 0.11, 1.74, 0.11, SKIN[0], hexRgb('#3A2E26'), null, true);
  return toBufferGeometry(b.finish());
}

type WalkerMode = 'wander' | 'toDoor' | 'fromDoor';

interface Walker {
  mode: WalkerMode;
  /** Current straight leg from (ax, az) to (bx, bz). */
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  len: number;
  s: number;
  speed: number;
  /** Corner graph: corner we walk towards (wander) and the one we came from. */
  to: number;
  from: number;
  /** Remaining life in seconds (wanderers recycle). */
  life: number;
  fade: number;
  dying: boolean;
  color: [number, number, number];
  phase: number;
  /** Store this shopper belongs to (−1 = none). */
  store: number;
  /** Shoppers: after reaching the sidewalk, stroll this far along it. */
  stroll: number;
}

export class PedestriansModule implements SceneModule {
  readonly name = 'living-city-pedestrians';
  private ctx!: SceneContext;
  private readonly material = makeCityMaterial();
  private readonly geometry = personGeometry();
  private mesh: THREE.InstancedMesh;
  private walkers: Walker[] = [];
  private sidewalks: SidewalkGraph | null = null;
  private readonly rnd = mulberry32(0x9ed1);
  private readonly offs: Array<() => void> = [];
  private readonly shopperCount = new Map<number, number>();
  /** Target wanderer count this frame (diagnostics). */
  target = 0;

  constructor(private readonly hub: LivingCity) {
    this.mesh = this.makeMesh(256);
  }

  init(ctx: SceneContext): void {
    this.ctx = ctx;
    ctx.scene.add(this.mesh);
    this.offs.push(this.hub.on('layout', () => this.rebuild()));
    this.rebuild();
  }

  private makeMesh(cap: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.name = 'living-city-pedestrians';
    return mesh;
  }

  private rebuild(): void {
    this.walkers = [];
    this.shopperCount.clear();
    this.sidewalks = this.hub.graph ? buildSidewalks(this.hub.graph) : null;
  }

  get count(): number {
    return this.walkers.length;
  }

  update(frame: FrameInfo): void {
    const sw = this.sidewalks, layout = this.hub.layout;
    if (!sw || !layout || sw.count === 0) {
      this.mesh.count = 0;
      return;
    }
    const active = frame.cameraDistance <= PED_SIM_RADIUS;
    if (!active) {
      if (this.walkers.length) {
        this.walkers = [];
        this.shopperCount.clear();
      }
      this.mesh.count = 0;
      return;
    }
    const q = this.ctx.quality;
    const density = localDensity(layout.use ?? null, layout.gridW, layout.gridH, frame.target);
    const cap = Math.round(q.settings.caps.pedestrians * q.knobs.agentDensity);
    const shoppers = this.wantedShoppers(frame);
    this.target = Math.max(0, Math.min(cap - shoppers, Math.round(cap * 0.55 * density * pedestrianDayFactor(frame.timeOfDay))));
    const frozen = this.hub.frozen;
    this.populate(frame, sw, frozen);
    if (!frozen) this.step(frame.dt, sw, frame);
    this.draw(frame);
  }

  /** Total shoppers wanted around the target (stores within the sim radius). */
  private wantedShoppers(frame: FrameInfo): number {
    let total = 0;
    for (const b of this.hub.buildings.values()) {
      if (!isRetail(b) || !b.working) continue;
      const c = this.doorOf(b);
      if ((c.x - frame.target.x) ** 2 + (c.z - frame.target.z) ** 2 > PED_SIM_RADIUS * PED_SIM_RADIUS) continue;
      total += shoppersFor(b.unitsSold);
    }
    return total;
  }

  private populate(frame: FrameInfo, sw: SidewalkGraph, frozen: boolean): void {
    const t = frame.target;
    const r2 = PED_SIM_RADIUS * PED_SIM_RADIUS;
    // wanderers
    let wander = 0;
    for (const w of this.walkers) if (w.mode === 'wander' && !w.dying) wander++;
    if (wander < this.target) {
      const near: number[] = [];
      for (let c = 0; c < sw.count; c++) if ((sw.x[c] - t.x) ** 2 + (sw.z[c] - t.z) ** 2 < r2) near.push(c);
      const burst = wander < this.target * 0.5 ? 60 : 6;
      for (let i = 0; i < burst && wander < this.target && near.length; i++, wander++) {
        const c = near[Math.floor(this.rnd() * near.length)];
        const w = this.newWalker('wander', -1);
        if (!this.pickNext(w, c, -1, sw)) continue;
        w.s = this.rnd() * w.len;
        if (frozen) w.fade = 1;
        this.walkers.push(w);
      }
    } else if (wander > this.target * 1.1 + 4) {
      let n = Math.ceil((wander - this.target) * 0.05) + 1;
      for (const w of this.walkers) {
        if (n <= 0) break;
        if (w.mode === 'wander' && !w.dying) { w.dying = true; n--; }
      }
    }
    // shoppers: keep each nearby busy store at its count
    for (const b of this.hub.buildings.values()) {
      if (!isRetail(b)) continue;
      const want = b.working ? shoppersFor(b.unitsSold) : 0;
      const have = this.shopperCount.get(b.id) ?? 0;
      const door = this.doorOf(b);
      if ((door.x - t.x) ** 2 + (door.z - t.z) ** 2 > r2) continue;
      for (let k = have; k < want; k++) {
        const w = this.newWalker(this.rnd() < 0.5 ? 'toDoor' : 'fromDoor', b.id);
        this.shopperLeg(w, b);
        w.s = this.rnd() * w.len;
        if (frozen) w.fade = 1;
        this.walkers.push(w);
        this.shopperCount.set(b.id, (this.shopperCount.get(b.id) ?? 0) + 1);
      }
    }
  }

  private newWalker(mode: WalkerMode, store: number): Walker {
    const c = CLOTHES[Math.floor(this.rnd() * CLOTHES.length)];
    return {
      mode, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, len: 1, s: 0, speed: 1.1 + this.rnd() * 0.4, to: -1, from: -1,
      life: 40 + this.rnd() * 80, fade: 0, dying: false, color: linearRgb(c), phase: this.rnd() * 10, store, stroll: 0,
    };
  }

  /**
   * Door (front-edge middle of the lot, 1.5 m inside it) and the sidewalk point in front of it: 2.5 m beyond the lot
   * edge, i.e. on the 4–6 m sidewalk between the lot and the kerb (art §3.2 cross-sections), never on the carriageway.
   */
  private doorOf(b: LiveBuilding): { x: number; z: number; sx: number; sz: number; y: number } {
    const layout = this.hub.layout!;
    const cx = (b.px + b.w / 2 - layout.gridW / 2) * PLOT_SIZE, cz = (b.pz + b.h / 2 - layout.gridH / 2) * PLOT_SIZE;
    const f = [[0, 1], [1, 0], [0, -1], [-1, 0]][b.facing];
    const half = (b.facing % 2 === 0 ? b.h : b.w) * PLOT_SIZE * 0.5;
    const x = cx + f[0] * (half - 1.5), z = cz + f[1] * (half - 1.5);
    return { x, z, sx: x + f[0] * 4, sz: z + f[1] * 4, y: 0.15 };
  }

  /**
   * A shopper's leg between the store's frontage (anywhere along the lot front, so a busy store reads as a stream of
   * people rather than a queue) and the sidewalk, then a stroll along the sidewalk.
   */
  private shopperLeg(w: Walker, b: LiveBuilding): void {
    const d = this.doorOf(b);
    const front = (b.facing % 2 === 0 ? b.w : b.h) * PLOT_SIZE;
    const lot = (this.rnd() - 0.5) * Math.max(4, front * 0.7);
    const walk = lot + (this.rnd() - 0.5) * 10;
    const ax = b.facing % 2 === 0 ? 1 : 0, az = 1 - ax;
    const inX = d.x + ax * lot, inZ = d.z + az * lot, outX = d.sx + ax * walk, outZ = d.sz + az * walk;
    if (w.mode === 'toDoor') this.leg(w, outX, d.y, outZ, inX, d.y, inZ);
    else this.leg(w, inX, d.y, inZ, outX, d.y, outZ);
    w.stroll = 20 + this.rnd() * 40;
  }

  private leg(w: Walker, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    w.ax = ax; w.ay = ay; w.az = az; w.bx = bx; w.by = by; w.bz = bz;
    w.len = Math.max(0.1, Math.hypot(bx - ax, bz - az));
    w.s = 0;
  }

  /** Wanderer at corner c (coming from `from`): pick the next corner and set the leg. */
  private pickNext(w: Walker, c: number, from: number, sw: SidewalkGraph): boolean {
    const opts: number[] = [];
    const weights: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nb = sw.links[c * 4 + d];
      if (nb < 0 || nb === from) continue;
      opts.push(nb);
      weights.push(sw.crossing[c * 4 + d] ? 0.35 : 1);
    }
    if (!opts.length && from >= 0) { opts.push(from); weights.push(1); }
    if (!opts.length) return false;
    let r = this.rnd() * weights.reduce((a, b) => a + b, 0), next = opts[opts.length - 1];
    for (let i = 0; i < opts.length; i++) { r -= weights[i]; if (r <= 0) { next = opts[i]; break; } }
    w.from = c;
    w.to = next;
    // walk a little off the corner point so crowds do not share one line
    const off = (this.rnd() - 0.5) * 1.6;
    this.leg(w, sw.x[c] + off, sw.y[c], sw.z[c] + off, sw.x[next] + off, sw.y[next], sw.z[next] + off);
    return true;
  }

  private step(dt: number, sw: SidewalkGraph, frame: FrameInfo): void {
    const t = frame.target;
    const r2 = (PED_SIM_RADIUS + 80) ** 2;
    let w2 = 0;
    for (const w of this.walkers) {
      w.fade = w.dying ? Math.max(0, w.fade - dt / 0.6) : Math.min(1, w.fade + dt / 0.6);
      w.phase += dt * w.speed * 5.2;
      w.s += w.speed * dt;
      if (w.mode === 'wander') {
        w.life -= dt;
        if (w.life <= 0) w.dying = true;
        if (w.s >= w.len && !this.pickNext(w, w.to, w.from, sw)) w.dying = true;
      } else if (w.s >= w.len) {
        if (w.mode === 'toDoor') w.dying = true;            // entered the store
        else if (w.stroll > 0) {
          // stroll along the sidewalk, then fade out (or wander on)
          const dx = (w.bx - w.ax) / w.len, dz = (w.bz - w.az) / w.len;
          const side = this.rnd() < 0.5 ? 1 : -1;
          this.leg(w, w.bx, w.by, w.bz, w.bx + -dz * side * w.stroll, w.by, w.bz + dx * side * w.stroll);
          w.stroll = 0;
        } else w.dying = true;
      }
      const far = (w.ax - t.x) ** 2 + (w.az - t.z) ** 2 > r2;
      if ((w.dying && w.fade <= 0) || far) {
        if (w.store >= 0) {
          const n = (this.shopperCount.get(w.store) ?? 1) - 1;
          if (n > 0) this.shopperCount.set(w.store, n);
          else this.shopperCount.delete(w.store);
        }
        continue;
      }
      this.walkers[w2++] = w;
    }
    this.walkers.length = w2;
  }

  private draw(frame: FrameInfo): void {
    const n = this.walkers.length;
    if (this.mesh.instanceMatrix.count < n) {
      const cap = 1 << Math.ceil(Math.log2(n * 1.25));
      this.mesh.removeFromParent();
      this.mesh.dispose();
      this.mesh = this.makeMesh(cap);
      this.ctx.scene.add(this.mesh);
    }
    if (frame.cameraDistance > PED_VISIBLE_BAND) {
      this.mesh.count = 0;
      return;
    }
    const M = this.mesh.instanceMatrix.array as Float32Array, C = this.mesh.instanceColor!.array as Float32Array;
    let k = 0;
    for (const w of this.walkers) {
      const f = Math.min(1, w.s / w.len);
      const x = w.ax + (w.bx - w.ax) * f, z = w.az + (w.bz - w.az) * f, y = w.ay + (w.by - w.ay) * f;
      const yaw = Math.atan2(w.bx - w.ax, w.bz - w.az);
      const sc = w.fade * w.fade * (3 - 2 * w.fade);
      const bob = Math.abs(Math.sin(w.phase)) * 0.05;
      const sway = Math.sin(w.phase) * 0.05;
      const c = Math.cos(yaw + sway) * sc, s = Math.sin(yaw + sway) * sc, o = k * 16;
      M[o] = c; M[o + 1] = 0; M[o + 2] = -s; M[o + 3] = 0;
      M[o + 4] = 0; M[o + 5] = sc; M[o + 6] = 0; M[o + 7] = 0;
      M[o + 8] = s; M[o + 9] = 0; M[o + 10] = c; M[o + 11] = 0;
      M[o + 12] = x; M[o + 13] = y + bob; M[o + 14] = z; M[o + 15] = 1;
      C[k * 3] = w.color[0];
      C[k * 3 + 1] = w.color[1];
      C[k * 3 + 2] = w.color[2];
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, k * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.clearUpdateRanges();
    this.mesh.instanceColor!.addUpdateRange(0, k * 3);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** 0.25..1 activity of the land around a point (CBD and commercial busiest, industry quiet). */
function localDensity(use: Uint8Array | null, W: number, H: number, target: THREE.Vector3): number {
  if (!use) return 0.7;
  const cx = Math.floor(target.x / PLOT_SIZE + W / 2), cz = Math.floor(target.z / PLOT_SIZE + H / 2);
  let sum = 0, n = 0;
  for (let dz = -8; dz <= 8; dz += 2) {
    for (let dx = -8; dx <= 8; dx += 2) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= W || z >= H) continue;
      const u = use[z * W + x];
      sum += u === USE_CBD ? 1 : u === USE_COMMERCIAL ? 0.85 : u === USE_RESIDENTIAL ? 0.45 : u === USE_PARK ? 0.4 : u === USE_INDUSTRIAL ? 0.15 : 0.05;
      n++;
    }
  }
  return n ? Math.max(0.15, Math.min(1, sum / n * 1.3)) : 0.5;
}
