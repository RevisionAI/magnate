// Scene module for road traffic: ambient cars, vans, taxis and buses at a density driven by the city population,
// the traffic field, the time of day and the graphics setting, plus the company trucks of the real supply flows.
// Owns the TrafficSim (rebuilt with the road graph) and the VehicleRenderer.
import type * as THREE from 'three';
import type { FrameInfo, SceneContext, SceneModule } from '../../SceneContext';
import { VEHICLE_MODELS, LIVERY, SEMI_LENGTH, ambientBodyRgb, type VehicleModelId } from '../../assets/families/vehicles';
import { ownerRgb } from '../../assets/palette';
import { mulberry32 } from '../../env/rng';
import { PLOT_SIZE } from '../../units';
import type { LivingCity, LiveBuilding } from '../LivingCity';
import { frontPlot } from '../source/buildingFx';
import { USE_CBD, USE_COMMERCIAL, USE_INDUSTRIAL, USE_RESIDENTIAL, isRetail } from '../source/types';
import { TripScheduler, planTrips, type TruckTrip } from '../Trucks';
import { RC_ARTERIAL, RC_HIGHWAY, roadAccess, type RoadAccess, type Segment } from './RoadGraph';
import { TrafficSim, idmFor, type Vehicle, type VehicleSpawn } from './TrafficSim';
import { VehicleRenderer, linearRgb, type VehicleDraw } from './VehicleRenderer';

/** Ambient vehicle count for a population (art §5.16): clamp(round(1.1·√population), 120, 900). */
export function ambientVehicleTarget(population: number): number {
  return Math.min(900, Math.max(120, Math.round(1.1 * Math.sqrt(Math.max(0, population)))));
}

/** Day curve (art §5.16): hours 3, 8, 13, 18, 22 → 0.25, 1.0, 0.7, 1.0, 0.35, piecewise linear and wrapping. */
export function trafficDayFactor(hour: number): number {
  const keys: ReadonlyArray<readonly [number, number]> = [[3, 0.25], [8, 1], [13, 0.7], [18, 1], [22, 0.35], [27, 0.25]];
  let h = ((hour % 24) + 24) % 24;
  if (h < 3) h += 24;
  for (let i = 0; i + 1 < keys.length; i++) {
    const [h0, v0] = keys[i], [h1, v1] = keys[i + 1];
    if (h >= h0 && h <= h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0);
  }
  return 0.25;
}

/** Most company trucks on the road at once (art §5.16). */
export const MAX_TRUCKS = 60;

export class TrafficModule implements SceneModule {
  readonly name = 'living-city-traffic';
  sim: TrafficSim | null = null;
  private ctx!: SceneContext;
  private renderer!: VehicleRenderer;
  private readonly rnd = mulberry32(0x7aff1c);
  private readonly scheduler = new TripScheduler();
  private readonly access = new Map<number, RoadAccess | null>();
  private readonly offs: Array<() => void> = [];
  private readonly draws: VehicleDraw[] = [];
  private readonly retry: Array<{ trip: TruckTrip; tries: number }> = [];
  private alpha = 0;
  private trucks = 0;
  private plannedRev = -1;
  /** Ambient vehicle target this frame (diagnostics). */
  target = 0;

  constructor(private readonly hub: LivingCity) {}

  init(ctx: SceneContext): void {
    this.ctx = ctx;
    this.renderer = new VehicleRenderer();
    ctx.scene.add(this.renderer.group);
    this.offs.push(this.hub.on('layout', () => this.rebuild()));
    this.offs.push(this.hub.on('buildings', () => this.access.clear()));
    this.offs.push(this.hub.on('economy', () => this.replan()));
    this.rebuild();
  }

  private rebuild(): void {
    this.sim?.clearAll();
    this.sim = null;
    this.access.clear();
    this.retry.length = 0;
    this.trucks = 0;
    const g = this.hub.graph, layout = this.hub.layout;
    if (!g || !layout || !g.lanes.length) return;
    const W = layout.gridW;
    const use = layout.use, traffic = layout.traffic;
    // spawn weight per lane: traffic field (or land use) × road class
    const laneWeight = (lane: Segment): number => {
      let w = lane.cls >= RC_HIGHWAY ? 1.3 : lane.cls >= RC_ARTERIAL ? 1.6 : 1;
      const mid = Math.floor(lane.pts.length / 6) * 3;
      const px = Math.floor(lane.pts[mid] / PLOT_SIZE + layout.gridW / 2), pz = Math.floor(lane.pts[mid + 2] / PLOT_SIZE + layout.gridH / 2);
      if (px >= 0 && pz >= 0 && px < W && pz < layout.gridH) {
        if (traffic) w *= 0.3 + 1.7 * traffic[pz * W + px];
        else if (use) w *= densityNear(use, W, layout.gridH, px, pz);
      }
      return w;
    };
    this.sim = new TrafficSim(g, layout.seed ^ 0x51ed, laneWeight);
    this.replan(true);
  }

  private replan(force = false): void {
    const eco = this.hub.economy, layout = this.hub.layout;
    if (!this.sim || !layout) return;
    if (!force && eco.rev === this.plannedRev) return;
    this.plannedRev = eco.rev;
    if (eco.cityId !== layout.cityId) {
      this.scheduler.reset([], 0);
      return;
    }
    const b = this.hub.buildings;
    const trips = planTrips(eco.flows, layout.cityId, (id) => b.has(id), (id) => isRetail(b.get(id)), eco.monthIndex);
    this.scheduler.reset(trips, this.hub.frame?.monthProgress ?? 0);
  }

  update(frame: FrameInfo): void {
    const sim = this.sim;
    if (!sim) {
      this.renderer.render([], this.ctx.camera, frame.cameraDistance);
      return;
    }
    // company trucks on the road, including ones dwelling at their destination until they actually leave
    let trucks = 0;
    for (const v of sim.vehicles) if (v.spec.role === 'truck') trucks++;
    this.trucks = trucks;
    // a paused city still shows its traffic (spawned in place), it just does not move
    this.controlDensity(frame, this.hub.frozen);
    if (!this.hub.frozen) {
      this.dispatchTrucks(frame.monthProgress);
      this.alpha = sim.advance(frame.dt);
    }
    this.draw(frame);
  }

  private controlDensity(frame: FrameInfo, frozen: boolean): void {
    const sim = this.sim!, layout = this.hub.layout!;
    const q = this.ctx.quality;
    const cap = Math.max(0, q.settings.caps.vehicles - this.trucks);
    const target = Math.min(cap, Math.round(ambientVehicleTarget(layout.population) * trafficDayFactor(frame.timeOfDay) * q.knobs.agentDensity));
    this.target = target;
    const ambient = sim.count - this.trucks;
    if (ambient < target) {
      const burst = ambient < target * 0.5 ? 40 : Math.max(1, Math.ceil(frame.dt * 25));
      for (let i = 0; i < burst && sim.count - this.trucks < target; i++) {
        const v = sim.spawnRandom(this.ambientSpec(), !frozen && this.rnd() < 0.3);
        if (!v) break;
        if (frozen) v.alpha = 1;
      }
    } else if (ambient > target * 1.08 + 2 && !frozen) {
      // retire the ambient vehicles farthest from the camera target
      const t = frame.target;
      let n = Math.max(1, Math.ceil(frame.dt * 12));
      const cands = sim.vehicles.filter((v) => v.spec.role !== 'truck' && !v.removeMe)
        .map((v) => [v, (v.cur.x - t.x) ** 2 + (v.cur.z - t.z) ** 2] as const)
        .sort((a, b) => b[1] - a[1]);
      for (const [v] of cands) {
        if (n-- <= 0) break;
        sim.retire(v);
      }
    }
  }

  private ambientSpec(): VehicleSpawn {
    const u = this.rnd(), c = this.rnd();
    let model: VehicleModelId, role: VehicleSpawn['role'] = 'ambient';
    let color: readonly [number, number, number];
    if (u < 0.03) { model = 'bus'; role = 'bus'; color = LIVERY.bus; }
    else if (u < 0.08) { model = 'taxi'; role = 'taxi'; color = LIVERY.taxi; }
    else if (u < 0.15) { model = 'van'; role = 'service'; color = c < 0.65 ? [236, 236, 232] : ambientBodyRgb(c); }
    else if (u < 0.19) { model = 'boxTruck'; role = 'service'; color = c < 0.7 ? [236, 236, 232] : [214, 206, 188]; }
    else if (u < 0.37) { model = 'suv'; color = ambientBodyRgb(c); }
    else if (u < 0.62) { model = 'hatchback'; color = ambientBodyRgb(c); }
    else { model = 'sedan'; color = ambientBodyRgb(c); }
    const m = VEHICLE_MODELS[model];
    return { model, role, length: m.length, idm: idmFor(m.cls), color, owner: 255 };
  }

  private dispatchTrucks(monthProgress: number): void {
    const due = this.scheduler.due(monthProgress);
    for (const trip of due) this.retry.push({ trip, tries: 0 });
    for (let i = 0; i < this.retry.length && i < 8; ) {
      const item = this.retry[i];
      if (this.trucks >= MAX_TRUCKS) {
        this.retry.length = 0;
        return;
      }
      if (this.spawnTruck(item.trip)) {
        this.retry.splice(i, 1);
        continue;
      }
      if (++item.tries > 40) this.retry.splice(i, 1);
      else i++;
    }
  }

  private spawnTruck(trip: TruckTrip): boolean {
    const sim = this.sim!;
    const fromB = trip.from !== null ? this.hub.buildings.get(trip.from) : undefined;
    const toB = trip.to !== null ? this.hub.buildings.get(trip.to) : undefined;
    const from = fromB ? this.accessOf(fromB) : this.offCityAccess(trip, toB);
    const to = toB ? this.accessOf(toB) : this.offCityAccess(trip, fromB);
    if (!from || !to) return true;                       // unreachable: drop the trip
    const company = trip.kind === 'transfer';
    const ownerB = fromB ?? toB;
    const owner = company && ownerB ? ownerB.owner : 255;
    const color = company ? ownerRgb(owner) : LIVERY.neutral;
    const length = trip.model === 'boxTruck' ? VEHICLE_MODELS.boxTruck.length : SEMI_LENGTH;
    const spec: VehicleSpawn = { model: trip.model, role: 'truck', length, idm: idmFor('truck'), color, owner, tag: `${trip.kind}:${trip.productId}:${trip.from ?? 'x'}>${trip.to ?? 'x'}` };
    const v = sim.spawnRouted(spec, from, to);
    if (!v) {
      // no route at all: drop; blocked start: retry later
      return sim.planRoute(from, to) === null;
    }
    this.trucks++;
    return true;
  }

  /**
   * Send a service vehicle (site delivery, `model` = a vehicle-family or semi model id) from the nearest highway exit
   * to a building's gate; it dwells there and drives off. Returns false when no route exists or the road is blocked.
   */
  dispatchService(b: LiveBuilding, model: string, color: readonly [number, number, number]): boolean {
    const sim = this.sim;
    if (!sim || this.hub.frozen) return false;
    const to = this.accessOf(b);
    const from = this.offCityAccess({ kind: 'transfer' } as TruckTrip, b);
    if (!to || !from) return false;
    const length = model in VEHICLE_MODELS ? VEHICLE_MODELS[model as VehicleModelId].length : SEMI_LENGTH;
    const spec: VehicleSpawn = { model, role: 'service', length, idm: idmFor('truck'), color, owner: 255, tag: `site:${b.id}` };
    return sim.spawnRouted(spec, from, to) !== null;
  }

  private accessOf(b: LiveBuilding): RoadAccess | null {
    let a = this.access.get(b.id);
    if (a === undefined) {
      const f = frontPlot(b.px, b.pz, b.w, b.h, b.facing);
      a = roadAccess(this.hub.graph!, f.px, f.pz);
      this.access.set(b.id, a);
    }
    return a;
  }

  /** The port quay (a seaport in the city, for imports and exports) or the nearest map-edge exit. */
  private offCityAccess(trip: TruckTrip, near: LiveBuilding | undefined): RoadAccess | null {
    const g = this.hub.graph!;
    if (trip.kind !== 'transfer') {
      for (const b of this.hub.buildings.values()) if (b.typeId === 'seaport' && b !== near) return this.accessOf(b);
    }
    const px = near ? near.px : g.gridW / 2, pz = near ? near.pz : g.gridH / 2;
    let best = -1, bestD = Infinity;
    for (const n of g.nodes) {
      if (n.kind !== 'exit') continue;
      const d = Math.abs(n.px - px) + Math.abs(n.pz - pz);
      if (d < bestD) { bestD = d; best = n.id; }
    }
    return best >= 0 ? { edge: -1, s: 0, node: best } : null;
  }

  private draw(frame: FrameInfo): void {
    const sim = this.sim!;
    const draws = this.draws;
    let n = 0;
    for (const v of sim.vehicles) {
      let d = draws[n];
      if (!d) {
        d = { model: '', pose: { x: 0, y: 0, z: 0, yaw: 0 }, scale: 1, r: 1, g: 1, b: 1, radius: 5, dot: false };
        draws[n] = d;
      }
      sim.renderPose(v, this.alpha, d.pose);
      d.model = v.spec.model;
      d.scale = easeScale(v);
      const [r, g, b] = linearRgb(v.spec.color);
      d.r = r;
      d.g = g;
      d.b = b;
      d.radius = v.spec.length * 0.6 + 1;
      // company trucks stay readable from the city band as owner-coloured dots; neutral import/export trucks do not
      d.dot = v.spec.role === 'truck' && v.spec.owner !== 255;
      n++;
    }
    draws.length = n;
    this.renderer.render(draws, this.ctx.camera, frame.cameraDistance);
  }

  /** Vehicles drawn last frame (diagnostics). */
  get drawn(): number {
    return this.renderer.drawn;
  }

  get truckCount(): number {
    return this.trucks;
  }

  /** The company truck nearest to a world ray within `radius` metres of it (for picking), or null. */
  pickTruck(ray: THREE.Ray, radius = 6): Vehicle | null {
    const sim = this.sim;
    if (!sim) return null;
    let best: Vehicle | null = null, bestD = radius * radius;
    for (const v of sim.vehicles) {
      if (v.spec.role !== 'truck') continue;
      const p = v.cur;
      const ox = p.x - ray.origin.x, oy = p.y + 2 - ray.origin.y, oz = p.z - ray.origin.z;
      const t = ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z;
      if (t < 0) continue;
      const qx = ox - ray.direction.x * t, qy = oy - ray.direction.y * t, qz = oz - ray.direction.z * t;
      const d = qx * qx + qy * qy + qz * qz;
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.sim?.clearAll();
    this.renderer.dispose();
  }
}

function easeScale(v: Vehicle): number {
  const a = Math.min(1, Math.max(0, v.alpha));
  return a * a * (3 - 2 * a);
}

/** Density weight around a plot from land use (CBD 3, commercial 2, residential 1, industrial 0.8, else 0.5). */
function densityNear(use: Uint8Array, W: number, H: number, px: number, pz: number): number {
  let sum = 0, n = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = px + dx, z = pz + dz;
      if (x < 0 || z < 0 || x >= W || z >= H) continue;
      const u = use[z * W + x];
      sum += u === USE_CBD ? 3 : u === USE_COMMERCIAL ? 2 : u === USE_RESIDENTIAL ? 1 : u === USE_INDUSTRIAL ? 0.8 : 0.5;
      n++;
    }
  }
  return n ? sum / n : 1;
}

