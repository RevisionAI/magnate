// Ships at sea (coastal cities): container ships steaming along shipping lanes offshore of every sea edge, and ships
// waiting at the anchorage off a working seaport while the city has import or export flows. The ship AT BERTH is part of
// the seaport asset itself (W4 draws the feeder ship along the quay while the port runs), so this module never puts a
// ship at the quay; it supplies the traffic around it.
//
// Positions are a pure function of the living city's animation clock (`shipPoses`), so ships stop with the game, are
// identical for the same seed and need no per-ship state. Rendering: one InstancedMesh per LOD (container ship model of
// the vehicles family, 140 × 22 m) plus a flat translucent wake behind moving hulls.
import * as THREE from 'three';
import type { FrameInfo, SceneContext, SceneModule } from '../SceneContext';
import { VEHICLE_MODELS } from '../assets/families/vehicles';
import { GeoBuilder, toBufferGeometry } from '../assets/GeoBuilder';
import { makeCityMaterial } from '../materials/CityMaterial';
import { WATER_LEVEL } from '../env/Terrain';
import { seaEdges, type Edge } from '../env/World';
import { hash3 } from '../env/rng';
import { PLOT_SIZE } from '../units';
import type { LivingCity, LiveBuilding } from './LivingCity';
import type { DynamicLayout } from './source/types';

/** Distance of the first shipping lane beyond the city edge (m). */
export const LANE_OFFSHORE = 420;
/** How far lanes extend beyond the city corners (m). */
export const LANE_OVERRUN = 2600;
/** Cruising speed in the harbour approaches (m/s, ~14 kn). */
export const SHIP_SPEED = 7;
/** Transit ships per sea edge. */
export const SHIPS_PER_LANE = 2;
/** Instance capacity: 2 per lane × 4 sea edges + 2 per port is far below it. */
const MAX_SHIPS = 24;
/** Ship LOD switch (camera-to-ship distance, m). */
const SHIP_LOD1 = 1600;
/** Ships farther than this from the camera are not drawn. */
const SHIP_MAX = 9000;

export interface ShipLane {
  edge: Edge;
  /** Start and end of the lane (world metres) and its length. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  length: number;
  /** Unit vector pointing out to sea. */
  ox: number;
  oz: number;
}

export interface ShipPose {
  x: number;
  z: number;
  yaw: number;
  /** Speed (m/s) for the wake. */
  speed: number;
}

/** Shipping lanes: one per sea edge, parallel to it, LANE_OFFSHORE beyond the city edge. Pure. */
export function shippingLanes(layout: Pick<DynamicLayout, 'gridW' | 'gridH' | 'water'>): ShipLane[] {
  const hw = (layout.gridW * PLOT_SIZE) / 2, hh = (layout.gridH * PLOT_SIZE) / 2;
  const out: ShipLane[] = [];
  for (const edge of seaEdges(layout)) {
    const o = LANE_OFFSHORE, r = LANE_OVERRUN;
    let lane: Omit<ShipLane, 'length'>;
    switch (edge) {
      case 'N': lane = { edge, ax: -hw - r, az: -hh - o, bx: hw + r, bz: -hh - o, ox: 0, oz: -1 }; break;
      case 'S': lane = { edge, ax: -hw - r, az: hh + o, bx: hw + r, bz: hh + o, ox: 0, oz: 1 }; break;
      case 'W': lane = { edge, ax: -hw - o, az: -hh - r, bx: -hw - o, bz: hh + r, ox: -1, oz: 0 }; break;
      default: lane = { edge, ax: hw + o, az: -hh - r, bx: hw + o, bz: hh + r, ox: 1, oz: 0 }; break;
    }
    out.push({ ...lane, length: Math.hypot(lane.bx - lane.ax, lane.bz - lane.az) });
  }
  return out;
}

/** Yaw (three.js rotation.y) of a model whose forward is +Z when heading along (dx, dz). */
function yawOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/**
 * Transit ships at time t (s) on the lanes: SHIPS_PER_LANE per lane, alternating directions, each in its own track
 * (0, 160 or 320 m further out). A ship runs the lane, disappears over the horizon and comes back after a gap.
 */
export function transitPoses(lanes: readonly ShipLane[], seed: number, t: number, out: ShipPose[] = []): ShipPose[] {
  out.length = 0;
  lanes.forEach((lane, li) => {
    for (let k = 0; k < SHIPS_PER_LANE; k++) {
      const h = hash3(seed, li, k, 7331);
      const dir = (k + li) % 2 === 0 ? 1 : -1;
      const track = (k % 3) * 160 + 40 * h;
      const speed = SHIP_SPEED * (0.8 + 0.4 * hash3(seed, li, k, 17));
      const period = lane.length + 1800 + 2400 * hash3(seed, li, k, 29);   // lane + a gap beyond the horizon
      const s = (h * period + speed * t) % period;
      if (s > lane.length) continue;
      const u = dir > 0 ? s / lane.length : 1 - s / lane.length;
      const dx = (lane.bx - lane.ax) / lane.length, dz = (lane.bz - lane.az) / lane.length;
      out.push({
        x: lane.ax + (lane.bx - lane.ax) * u + lane.ox * track,
        z: lane.az + (lane.bz - lane.az) * u + lane.oz * track,
        yaw: yawOf(dx * dir, dz * dir),
        speed,
      });
    }
  });
  return out;
}

/**
 * Ships at the anchorage off a seaport: the point of the nearest lane closest to the port, 220 m either side along
 * the lane, swinging slowly on their anchors. `count` 0..2.
 */
export function anchoragePoses(lanes: readonly ShipLane[], portX: number, portZ: number, count: number, t: number, out: ShipPose[]): ShipPose[] {
  if (!lanes.length || count <= 0) return out;
  let best = lanes[0], bestD = Infinity, bestU = 0.5;
  for (const lane of lanes) {
    const lx = lane.bx - lane.ax, lz = lane.bz - lane.az;
    const u = Math.max(0, Math.min(1, ((portX - lane.ax) * lx + (portZ - lane.az) * lz) / (lane.length * lane.length)));
    const d = Math.hypot(lane.ax + lx * u - portX, lane.az + lz * u - portZ);
    if (d < bestD) { bestD = d; best = lane; bestU = u; }
  }
  const dx = (best.bx - best.ax) / best.length, dz = (best.bz - best.az) / best.length;
  const cx = best.ax + (best.bx - best.ax) * bestU - best.ox * 140, cz = best.az + (best.bz - best.az) * bestU - best.oz * 140;
  for (let k = 0; k < Math.min(2, count); k++) {
    const side = k === 0 ? -1 : 1;
    const swing = 0.22 * Math.sin(t / 47 + k * 2.1);
    out.push({ x: cx + dx * 230 * side, z: cz + dz * 230 * side, yaw: yawOf(dx, dz) + (k ? Math.PI : 0) + swing, speed: 0 });
  }
  return out;
}

/** Ships waiting for a seaport this month: one for any import/export flow, two when the port is busy. */
export function anchoredFor(port: Pick<LiveBuilding, 'working' | 'transfersIn' | 'transfersOut'>, hasTrade: boolean): number {
  if (!port.working) return 0;
  const moves = port.transfersIn + port.transfersOut;
  if (!hasTrade && moves <= 0) return 0;
  return moves > 2000 ? 2 : 1;
}

export class ShipsModule implements SceneModule {
  readonly name = 'living-city-ships';
  private ctx!: SceneContext;
  private readonly group = new THREE.Group();
  private readonly material = makeCityMaterial();
  private readonly lod0: THREE.InstancedMesh;
  private readonly lod1: THREE.InstancedMesh;
  private readonly wake: THREE.InstancedMesh;
  private readonly geos: THREE.BufferGeometry[] = [];
  private lanes: ShipLane[] = [];
  private readonly poses: ShipPose[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly offs: Array<() => void> = [];
  private ports: Array<{ x: number; z: number; count: number }> = [];
  private seed = 1;
  /** Ships drawn last frame (diagnostics). */
  drawn = 0;

  constructor(private readonly hub: LivingCity) {
    const ship = VEHICLE_MODELS.containerShip;
    const g0 = geometryOf((b) => ship.build(b, 0));
    const g1 = geometryOf((b) => ship.build(b, 1));
    const wakeGeo = new THREE.BufferGeometry();
    // a flat V of foam from the stern (z = −70) spreading 160 m back; alpha fades to the tail via vertex colours
    wakeGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -9, 0, -66, 9, 0, -66, 46, 0, -230, -46, 0, -230,
    ], 3));
    wakeGeo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0], 3));
    wakeGeo.setIndex([0, 2, 1, 0, 3, 2]);
    this.geos.push(g0, g1, wakeGeo);
    this.lod0 = this.instanced(g0, this.material, 'ships:lod0');
    this.lod1 = this.instanced(g1, this.material, 'ships:lod1');
    const wakeMat = new THREE.MeshBasicMaterial({ color: '#F4F8FA', transparent: true, opacity: 0.32, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending });
    this.wake = this.instanced(wakeGeo, wakeMat, 'ships:wake');
    this.wake.renderOrder = 3;
    this.wake.receiveShadow = false;
    this.group.add(this.wake, this.lod0, this.lod1);
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_SHIPS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.name = name;
    return mesh;
  }

  init(ctx: SceneContext): void {
    this.ctx = ctx;
    this.group.name = 'living-city-ships';
    ctx.scene.add(this.group);
    this.offs.push(this.hub.on('layout', () => this.rebuild()));
    this.offs.push(this.hub.on('buildings', () => this.syncPorts()));
    this.offs.push(this.hub.on('economy', () => this.syncPorts()));
    this.rebuild();
  }

  private rebuild(): void {
    const layout = this.hub.layout;
    this.lanes = layout && layout.coastal !== false ? shippingLanes(layout) : [];
    this.seed = layout?.seed ?? 1;
    this.syncPorts();
  }

  private syncPorts(): void {
    const layout = this.hub.layout;
    this.ports = [];
    if (!layout || !this.lanes.length) return;
    const trade = this.hub.economy.cityId === layout.cityId && this.hub.economy.flows.some((f) => f.kind === 'import' || f.kind === 'export');
    for (const b of this.hub.buildings.values()) {
      if (b.typeId !== 'seaport') continue;
      const count = anchoredFor(b, trade);
      if (!count) continue;
      this.ports.push({ x: (b.px + b.w / 2 - layout.gridW / 2) * PLOT_SIZE, z: (b.pz + b.h / 2 - layout.gridH / 2) * PLOT_SIZE, count });
    }
  }

  get count(): number {
    return this.poses.length;
  }

  update(frame: FrameInfo): void {
    if (!this.lanes.length) {
      this.lod0.count = this.lod1.count = this.wake.count = 0;
      this.drawn = 0;
      return;
    }
    const t = this.hub.animTime;
    transitPoses(this.lanes, this.seed, t, this.poses);
    for (const p of this.ports) anchoragePoses(this.lanes, p.x, p.z, p.count, t, this.poses);
    const cam = this.ctx.camera.position;
    let n0 = 0, n1 = 0, nw = 0;
    for (const p of this.poses) {
      if (n0 + n1 >= MAX_SHIPS) break;
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (d > SHIP_MAX) continue;
      this.m.makeRotationY(p.yaw).setPosition(p.x, WATER_LEVEL, p.z);
      if (d < SHIP_LOD1) this.lod0.setMatrixAt(n0++, this.m);
      else this.lod1.setMatrixAt(n1++, this.m);
      if (p.speed > 0.5 && d < SHIP_LOD1 * 2) {
        this.m.makeRotationY(p.yaw).setPosition(p.x, WATER_LEVEL + 0.12, p.z);
        this.wake.setMatrixAt(nw++, this.m);
      }
    }
    for (const [mesh, n] of [[this.lod0, n0], [this.lod1, n1], [this.wake, nw]] as const) {
      mesh.count = n;
      mesh.visible = n > 0;
      if (n) mesh.instanceMatrix.needsUpdate = true;
    }
    this.drawn = n0 + n1;
    void frame;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const mesh of [this.lod0, this.lod1, this.wake]) mesh.dispose();
    for (const g of this.geos) g.dispose();
    this.material.dispose();
    (this.wake.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}

function geometryOf(fn: (b: GeoBuilder) => void): THREE.BufferGeometry {
  const b = new GeoBuilder();
  fn(b);
  return toBufferGeometry(b.finish());
}
