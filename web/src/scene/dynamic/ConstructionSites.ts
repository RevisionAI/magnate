// Construction-site activity (art §4.1 construction stages, §3.16 "Construction"): every company building under
// construction gets site workers in hi-vis vests walking between work spots inside the hoarding and pausing to work,
// and site deliveries (a tipper or box truck from the nearest highway exit to the site gate, `DELIVERIES_PER_MONTH`
// spread over the visual month). The static site itself (hoarding, scaffolds, tower crane, excavator, dust emitters) is
// the building's construction-stage asset; its crane jib and excavator arm animate in AnimatedParts and its dust in
// Particles. Workers are simulated within the pedestrian sim radius and drawn in the street band only; reduced motion
// or a paused game freezes them.
import * as THREE from 'three';
import type { FrameInfo, SceneContext, SceneModule } from '../SceneContext';
import { makeCityMaterial } from '../materials/CityMaterial';
import { hexRgb } from '../assets/palette';
import { hash3, mulberry32 } from '../env/rng';
import { PLOT_SIZE } from '../units';
import type { LivingCity, LiveBuilding } from './LivingCity';
import { PED_SIM_RADIUS, PED_VISIBLE_BAND, personGeometry } from './Pedestrians';
import type { TrafficModule } from './traffic/TrafficModule';
import { linearRgb } from './traffic/VehicleRenderer';

/** Site deliveries per visual month and site. */
export const DELIVERIES_PER_MONTH = 3;

/** Workers on a site of w × h plots: 3 … 10. */
export function workersFor(w: number, h: number): number {
  return Math.max(3, Math.min(10, Math.round(2 + (w * h) / 1.6)));
}

/** Departure times (0..1 of the visual month) of a site's deliveries; deterministic per site and month. */
export function deliverySchedule(siteId: number, monthSeed: number, n = DELIVERIES_PER_MONTH): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(Math.min(0.98, (k + 0.2 + 0.6 * hash3(siteId, k, monthSeed, 4049)) / n));
  return out;
}

const VESTS = ['#F28C28', '#E9D23C', '#F0742A'].map((h) => linearRgb(hexRgb(h)));

interface Worker {
  site: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** Seconds left working at the spot (0 = walking). */
  work: number;
  speed: number;
  phase: number;
  color: [number, number, number];
}

interface Site {
  id: number;
  /** Walkable rect inside the hoarding (world m). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  workers: number;
}

export class ConstructionSitesModule implements SceneModule {
  readonly name = 'living-city-sites';
  private readonly material = makeCityMaterial();
  private readonly geometry = personGeometry();
  private readonly mesh: THREE.InstancedMesh;
  private sites: Site[] = [];
  private workers: Worker[] = [];
  private readonly rnd = mulberry32(0x5173);
  private readonly offs: Array<() => void> = [];
  private delivered = new Set<string>();
  private lastProgress = 0;
  private monthSeed = 0;
  /** Deliveries dispatched (diagnostics). */
  deliveries = 0;

  constructor(private readonly hub: LivingCity, private readonly traffic: TrafficModule | null) {
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, 256);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(256 * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.name = 'living-city-site-workers';
  }

  init(ctx: SceneContext): void {
    ctx.scene.add(this.mesh);
    const sync = () => this.sync();
    this.offs.push(this.hub.on('buildings', sync), this.hub.on('layout', sync));
    this.sync();
  }

  private sync(): void {
    const layout = this.hub.layout;
    const next: Site[] = [];
    if (layout) {
      for (const b of this.hub.buildings.values()) {
        if (b.progress === undefined || b.status === 'closed') continue;
        next.push(siteRect(b, layout.gridW, layout.gridH));
      }
    }
    next.sort((a, b) => a.id - b.id);
    const keep = new Set(next.map((s) => s.id));
    this.workers = this.workers.filter((w) => keep.has(w.site));
    this.sites = next;
  }

  /** Sites currently active (diagnostics, tests). */
  get siteCount(): number {
    return this.sites.length;
  }

  get workerCount(): number {
    return this.workers.length;
  }

  update(frame: FrameInfo): void {
    if (!this.sites.length) {
      this.mesh.count = 0;
      return;
    }
    if (!this.hub.frozen) this.dispatch(frame.monthProgress);
    const t = frame.target, r2 = PED_SIM_RADIUS * PED_SIM_RADIUS;
    const near = frame.cameraDistance <= PED_SIM_RADIUS;
    // spawn / retire workers by site and distance
    const have = new Map<number, number>();
    for (const w of this.workers) have.set(w.site, (have.get(w.site) ?? 0) + 1);
    const live: Worker[] = [];
    for (const site of this.sites) {
      const cx = (site.x0 + site.x1) / 2, cz = (site.z0 + site.z1) / 2;
      const inRange = near && (cx - t.x) ** 2 + (cz - t.z) ** 2 <= r2;
      if (!inRange) continue;
      for (let k = have.get(site.id) ?? 0; k < site.workers; k++) this.workers.push(this.newWorker(site));
    }
    for (const w of this.workers) {
      const site = this.sites.find((s) => s.id === w.site);
      if (!site || !near || ((site.x0 + site.x1) / 2 - t.x) ** 2 + ((site.z0 + site.z1) / 2 - t.z) ** 2 > r2) continue;
      if (!this.hub.frozen) this.stepWorker(w, site, frame.dt);
      live.push(w);
    }
    this.workers = live;
    this.draw(frame);
  }

  private newWorker(site: Site): Worker {
    const x = site.x0 + this.rnd() * (site.x1 - site.x0), z = site.z0 + this.rnd() * (site.z1 - site.z0);
    return {
      site: site.id, x, z, tx: x, tz: z, work: 1 + this.rnd() * 5, speed: 0.9 + this.rnd() * 0.4, phase: this.rnd() * 10,
      color: VESTS[Math.floor(this.rnd() * VESTS.length)],
    };
  }

  private stepWorker(w: Worker, site: Site, dt: number): void {
    if (w.work > 0) {
      w.work -= dt;
      if (w.work <= 0) {
        // next work spot: mostly a short hop, sometimes across the site
        const far = this.rnd() < 0.3;
        const r = far ? Math.max(site.x1 - site.x0, site.z1 - site.z0) : 12;
        w.tx = Math.min(site.x1, Math.max(site.x0, w.x + (this.rnd() - 0.5) * 2 * r));
        w.tz = Math.min(site.z1, Math.max(site.z0, w.z + (this.rnd() - 0.5) * 2 * r));
      }
      w.phase += dt * 2;          // working: a slow bob (hammering, shovelling)
      return;
    }
    const dx = w.tx - w.x, dz = w.tz - w.z, d = Math.hypot(dx, dz);
    const step = w.speed * dt;
    w.phase += dt * w.speed * 5.2;
    if (d <= step) {
      w.x = w.tx;
      w.z = w.tz;
      w.work = 3 + this.rnd() * 9;
    } else {
      w.x += (dx / d) * step;
      w.z += (dz / d) * step;
    }
  }

  private draw(frame: FrameInfo): void {
    if (frame.cameraDistance > PED_VISIBLE_BAND || !this.workers.length) {
      this.mesh.count = 0;
      return;
    }
    const cap = this.mesh.instanceMatrix.count;
    const M = this.mesh.instanceMatrix.array as Float32Array, C = this.mesh.instanceColor!.array as Float32Array;
    let k = 0;
    for (const w of this.workers) {
      if (k >= cap) break;
      const walking = w.work <= 0;
      const yaw = walking ? Math.atan2(w.tx - w.x, w.tz - w.z) : w.phase * 0.05;
      const bob = walking ? Math.abs(Math.sin(w.phase)) * 0.05 : Math.max(0, Math.sin(w.phase * 3)) * 0.12;
      const c = Math.cos(yaw), s = Math.sin(yaw), o = k * 16;
      // working figures lean forward a little (scale y down) to read as bending over the job
      const sy = walking ? 1 : 0.94;
      M[o] = c; M[o + 1] = 0; M[o + 2] = -s; M[o + 3] = 0;
      M[o + 4] = 0; M[o + 5] = sy; M[o + 6] = 0; M[o + 7] = 0;
      M[o + 8] = s; M[o + 9] = 0; M[o + 10] = c; M[o + 11] = 0;
      M[o + 12] = w.x; M[o + 13] = 0.12 + bob; M[o + 14] = w.z; M[o + 15] = 1;
      C[k * 3] = w.color[0];
      C[k * 3 + 1] = w.color[1];
      C[k * 3 + 2] = w.color[2];
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** Release the site deliveries due by `monthProgress` (a new visual month restarts the schedule). */
  private dispatch(monthProgress: number): void {
    if (!this.traffic) return;
    if (monthProgress < this.lastProgress - 0.5) {
      this.delivered.clear();
      this.monthSeed++;
    }
    this.lastProgress = monthProgress;
    for (const site of this.sites) {
      deliverySchedule(site.id, this.monthSeed).forEach((at, k) => {
        const key = `${site.id}:${k}`;
        if (at > monthProgress || this.delivered.has(key)) return;
        this.delivered.add(key);
        const b = this.hub.buildings.get(site.id);
        if (!b) return;
        const model = k % 2 === 0 ? 'truckHopper' : 'boxTruck';
        if (this.traffic!.dispatchService(b, model, k % 2 === 0 ? [214, 206, 188] : [236, 236, 232])) this.deliveries++;
      });
    }
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

/** Walkable rectangle of a site: the footprint inset by 5 m (inside the hoarding). */
function siteRect(b: LiveBuilding, gridW: number, gridH: number): Site {
  const x0 = (b.px - gridW / 2) * PLOT_SIZE + 5, z0 = (b.pz - gridH / 2) * PLOT_SIZE + 5;
  const x1 = (b.px + b.w - gridW / 2) * PLOT_SIZE - 5, z1 = (b.pz + b.h - gridH / 2) * PLOT_SIZE - 5;
  return { id: b.id, x0, z0, x1: Math.max(x0 + 1, x1), z1: Math.max(z0 + 1, z1), workers: workersFor(b.w, b.h) };
}
