// Microscopic traffic on the road graph (art §5.16): Intelligent Driver Model car following at a fixed 20 Hz, signal
// controlled junctions where an arterial is involved (50 s-class cycle with green waves), all-way stops on street ×
// street crossings, a box rule that keeps conflicting movements out of a junction at the same time, left turns that
// yield to oncoming traffic, "don't block the box" spill-back control, and a watchdog that removes vehicles stuck for
// 40 s so the network can never lock up for good.
//
// Agents move by arc length along a short planned path of segments (lane → connector → lane …), extended two nodes
// ahead so lane choice matches the next turn. Ambient vehicles choose turns at random (60 % straight, 25 % right,
// 15 % left, weighted by road class); routed vehicles (company trucks) follow an A* arm list to a stop position.
// Pure simulation: no three.js; deterministic for a given seed and call sequence.
import { CAR, BUS, TRUCK, idmAccel, type IdmParams } from './TrafficIdm';
import {
  DX, DZ, RC_ARTERIAL, findRoute, laneForTurn, lanesInto, lanesOutOf, opposite, otherEnd, signalAspect, turnOf,
  type Pose, type RoadAccess, type RoadGraph, type RoadNode, type Segment, type Turn,
} from './RoadGraph';
import { mulberry32 } from '../../env/rng';

export const SIM_DT = 1 / 20;
/** Arm sentinel: leave the map at an exit node. */
export const ARM_EXIT = -2;
/** Arm sentinel: the current lane holds the destination (stop at destS). */
export const ARM_DEST = -3;

export type VehicleRole = 'ambient' | 'bus' | 'taxi' | 'truck' | 'service';
export type VehicleState = 'driving' | 'dwell' | 'leaving';

export interface VehicleSpawn {
  /** Render model id (vehicle family or W4 semi prop id). */
  model: string;
  role: VehicleRole;
  length: number;
  idm: IdmParams;
  /** Body / livery colour as sRGB bytes (instance colour). */
  color: readonly [number, number, number];
  /** Owner colour index (company trucks) or 255. */
  owner: number;
  /** Free-form tag (e.g. the flow a truck serves) for picking and debugging. */
  tag?: string;
}

export class Vehicle {
  readonly id: number;
  readonly spec: VehicleSpawn;
  path: Segment[] = [];
  s = 0;
  v = 0;
  acc = 0;
  pendingArm = -1;
  route: number[] | null = null;
  routePos = 0;
  destS = -1;
  committed = false;
  stopWait = 0;
  arrivalT = -1;
  stuck = 0;
  state: VehicleState = 'driving';
  dwell = 0;
  /** 0..1 appear/disappear scale. */
  alpha = 0;
  removeMe = false;
  /** Index in its segment's occupant list (maintained by the sim). */
  segIdx = -1;
  /** The segment driven before the current one (the body still overlaps it right after a transition). */
  prevSeg: Segment | null = null;
  /** Junction reservation: the connector this vehicle committed to (held until it leaves the connector). */
  resConn: Segment | null = null;
  /** Interpolation poses (previous and current sim step). */
  readonly prev: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  readonly cur: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  constructor(id: number, spec: VehicleSpawn) {
    this.id = id;
    this.spec = spec;
  }
  get seg(): Segment {
    return this.path[0];
  }
}

export interface TrafficStats {
  vehicles: number;
  ambient: number;
  trucks: number;
  spawned: number;
  removedStuck: number;
  arrived: number;
  stepMs: number;
}

const BRAKE_COMFORT = 3;

export class TrafficSim {
  readonly graph: RoadGraph;
  readonly vehicles: Vehicle[] = [];
  readonly stats: TrafficStats = { vehicles: 0, ambient: 0, trucks: 0, spawned: 0, removedStuck: 0, arrived: 0, stepMs: 0 };
  /** Simulation time (s). */
  time = 0;
  private readonly rnd: () => number;
  private nextId = 1;
  private readonly segOcc: Vehicle[][];
  private readonly segStamp: Uint32Array;
  private sortStamp = 0;
  private readonly nodeOcc: Vehicle[][];
  private readonly laneCum: Float64Array;
  private readonly laneWeights: Float64Array;
  private readonly exitLanes: Segment[];
  private accum = 0;
  /** Called when a routed vehicle reaches its destination or any vehicle is removed. */
  onRemoved: ((v: Vehicle, reason: 'arrived' | 'exit' | 'stuck' | 'culled') => void) | null = null;

  constructor(graph: RoadGraph, seed = 1, laneWeight?: (lane: Segment) => number) {
    this.graph = graph;
    this.rnd = mulberry32(seed);
    this.segOcc = graph.segments.map(() => [] as Vehicle[]);
    this.segStamp = new Uint32Array(graph.segments.length);
    this.nodeOcc = graph.nodes.map(() => [] as Vehicle[]);
    this.laneWeights = new Float64Array(graph.lanes.length);
    this.laneCum = new Float64Array(graph.lanes.length);
    let acc = 0;
    graph.lanes.forEach((lane, i) => {
      const w = Math.max(0, lane.length - 8) * (laneWeight ? laneWeight(lane) : 1);
      this.laneWeights[i] = w;
      acc += w;
      this.laneCum[i] = acc;
    });
    this.exitLanes = graph.lanes.filter((l) => graph.nodes[l.fromNode].kind === 'exit' && l.length > 10);
  }

  get count(): number {
    return this.vehicles.length;
  }

  /** Advance by real seconds dt (fixed 20 Hz substeps; at most 4 per call). Returns the interpolation alpha. */
  advance(dt: number): number {
    this.accum = Math.min(this.accum + dt, SIM_DT * 4);
    while (this.accum >= SIM_DT) {
      this.step(SIM_DT);
      this.accum -= SIM_DT;
    }
    return this.accum / SIM_DT;
  }

  /** One fixed simulation step. */
  step(dt: number): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.time += dt;
    const vs = this.vehicles;
    for (const v of vs) {
      v.prev.x = v.cur.x;
      v.prev.y = v.cur.y;
      v.prev.z = v.cur.z;
      v.prev.yaw = v.cur.yaw;
    }
    for (const v of vs) v.acc = this.accelerationOf(v, dt);
    for (const v of vs) this.integrate(v, dt);
    // lifecycle: fades, dwell, removal
    let w = 0;
    for (const v of vs) {
      if (v.state === 'leaving' || v.removeMe) v.alpha = Math.max(0, v.alpha - dt / 0.5);
      else v.alpha = Math.min(1, v.alpha + dt / 0.6);
      if (v.state === 'dwell') {
        v.dwell -= dt;
        if (v.dwell <= 0) v.state = 'leaving';
      }
      if ((v.state === 'leaving' || v.removeMe) && v.alpha <= 0) {
        this.detach(v);
        continue;
      }
      vs[w++] = v;
    }
    vs.length = w;
    // re-sort only the occupied segments (a few hundred of several thousand)
    const stamp = ++this.sortStamp;
    for (const v of vs) {
      const id = v.seg.id;
      if (this.segStamp[id] === stamp) continue;
      this.segStamp[id] = stamp;
      const list = this.segOcc[id];
      if (list.length > 1) sortByS(list);
      for (let i = 0; i < list.length; i++) list[i].segIdx = i;
    }
    for (const v of vs) this.pose(v, v.cur);
    let ambient = 0, trucks = 0;
    for (const v of vs) {
      if (v.spec.role === 'truck') trucks++;
      else ambient++;
    }
    this.stats.vehicles = vs.length;
    this.stats.ambient = ambient;
    this.stats.trucks = trucks;
    if (t0) this.stats.stepMs = performance.now() - t0;
  }

  // ---- spawning ---------------------------------------------------------------------------------------------------

  /** Spawn an ambient-routed vehicle on a random lane (weighted) or, with `fromExit`, at a map-edge exit. */
  spawnRandom(spec: VehicleSpawn, fromExit = false): Vehicle | null {
    const lanes = this.graph.lanes;
    if (!lanes.length) return null;
    for (let attempt = 0; attempt < 6; attempt++) {
      let lane: Segment, s: number;
      if (fromExit && this.exitLanes.length) {
        lane = this.exitLanes[Math.floor(this.rnd() * this.exitLanes.length)];
        s = 1;
      } else {
        const total = this.laneCum[this.laneCum.length - 1];
        if (!(total > 0)) return null;
        lane = lanes[lowerBound(this.laneCum, this.rnd() * total)];
        s = 4 + this.rnd() * Math.max(0, lane.length - 8);
      }
      if (!this.clear(lane, s, spec.length + 6)) continue;
      const v = new Vehicle(this.nextId++, spec);
      v.path = [lane];
      v.s = s;
      v.v = lane.speedLimit * (0.4 + 0.4 * this.rnd());
      v.pendingArm = this.chooseArm(v, lane, true);
      this.attach(v);
      return v;
    }
    return null;
  }

  /** Spawn an ambient-routed vehicle at a given lane position (tests, scripted traffic). */
  spawnOnLane(spec: VehicleSpawn, lane: Segment, s: number, speed = 0): Vehicle | null {
    if (lane.kind !== 'lane' || !this.clear(lane, s, spec.length + 2)) return null;
    const v = new Vehicle(this.nextId++, spec);
    v.path = [lane];
    v.s = Math.min(Math.max(s, 0), lane.length);
    v.v = speed;
    v.pendingArm = this.chooseArm(v, lane, true);
    this.attach(v);
    return v;
  }

  /**
   * Spawn a routed vehicle (company truck) from road access A to road access B. Returns null when there is no route
   * or the start position is blocked.
   */
  spawnRouted(spec: VehicleSpawn, from: RoadAccess, to: RoadAccess): Vehicle | null {
    const plan = this.planRoute(from, to);
    if (!plan) return null;
    const { lane, s, arms, destS } = plan;
    if (!this.clear(lane, s, spec.length + 3)) return null;
    const v = new Vehicle(this.nextId++, spec);
    v.path = [lane];
    v.s = s;
    v.v = 0;
    v.route = arms;
    v.routePos = 0;
    v.destS = destS;
    v.pendingArm = arms.length ? arms[v.routePos++] : ARM_DEST;
    this.attach(v);
    return v;
  }

  /** Fade a vehicle out and remove it (density control). */
  retire(v: Vehicle): void {
    v.removeMe = true;
  }

  /** Remove everything at once (city switch). */
  clearAll(): void {
    for (const v of [...this.vehicles]) this.detach(v);
    this.vehicles.length = 0;
  }

  /** Signal aspect for traffic arriving at node n from arm `inArm` (for rendering signal heads). */
  aspect(n: RoadNode, inArm: number): 'green' | 'amber' | 'red' {
    return signalAspect(n, inArm, this.time);
  }

  /** Interpolated render pose of a vehicle. */
  renderPose(v: Vehicle, alpha: number, out: Pose): Pose {
    const a = v.prev, b = v.cur;
    const jump = Math.abs(b.x - a.x) + Math.abs(b.z - a.z) > 8;
    if (jump) {
      out.x = b.x;
      out.y = b.y;
      out.z = b.z;
      out.yaw = b.yaw;
      return out;
    }
    out.x = a.x + (b.x - a.x) * alpha;
    out.y = a.y + (b.y - a.y) * alpha;
    out.z = a.z + (b.z - a.z) * alpha;
    let dy = b.yaw - a.yaw;
    if (dy > Math.PI) dy -= Math.PI * 2;
    else if (dy < -Math.PI) dy += Math.PI * 2;
    out.yaw = a.yaw + dy * alpha;
    return out;
  }

  // ---- planning -----------------------------------------------------------------------------------------------------

  /** Route plan from road access A to B: start lane and position, the arms to take at each node, the stop position. */
  planRoute(from: RoadAccess, to: RoadAccess): { lane: Segment; s: number; arms: number[]; destS: number; cost: number } | null {
    const g = this.graph;
    const a = normAccess(g, from), b = normAccess(g, to);
    if (!a || !b) return null;
    const ea = g.edges[a.edge], eb = g.edges[b.edge];
    let best: { lane: Segment; s: number; arms: number[]; destS: number; cost: number } | null = null;
    // Same edge with the destination ahead in one direction: drive straight there.
    if (ea.id === eb.id) {
      if (b.s > a.s + 4) return { lane: outer(ea.lanesAB), s: a.s, arms: [], destS: b.s, cost: b.s - a.s };
      if (b.s < a.s - 4) return { lane: outer(ea.lanesBA), s: ea.length - a.s, arms: [], destS: ea.length - b.s, cost: a.s - b.s };
    }
    for (const startTowardsB of [true, false]) {
      const lanes = startTowardsB ? ea.lanesAB : ea.lanesBA;
      const s0 = startTowardsB ? a.s : ea.length - a.s;
      const startNode = startTowardsB ? ea.b : ea.a;
      const inArm = opposite(lanes[0].dir);
      const deadEnd = g.nodes[startNode].arms.filter((x) => x >= 0).length === 1;
      for (const enterAtA of [true, false]) {
        const T = enterAtA ? eb.a : eb.b;
        const armInto = enterAtA ? eb.dirA : opposite(eb.dirA);
        const arms = findRoute(g, startNode, T, deadEnd ? -1 : inArm);
        if (!arms) continue;
        const full = [...arms, armInto];
        if (!validArms(g, startNode, inArm, full)) continue;
        const destS = enterAtA ? b.s : eb.length - b.s;
        const lane = lanes[laneForTurn(turnOf(inArm, full[0]), lanes.length, 0.99)];
        const cost = (lane.length - s0) + routeLength(g, startNode, full) + destS;
        if (!best || cost < best.cost) best = { lane, s: s0, arms: full, destS, cost };
      }
    }
    return best;
  }

  /** Decide the arm to take at the node at the end of `lane` for vehicle v. */
  private chooseArm(v: Vehicle, lane: Segment, compatibleWithLane: boolean): number {
    if (v.route) {
      return v.routePos < v.route.length ? v.route[v.routePos++] : ARM_DEST;
    }
    const g = this.graph;
    const n = g.nodes[lane.toNode];
    const inArm = opposite(lane.dir);
    const nLanes = lanesInto(g.edges[lane.edge], n.id).length;
    let total = 0;
    const cand: number[] = [], weight: number[] = [];
    const bus = v.spec.role === 'bus';
    for (let d = 0; d < 4; d++) {
      const e = n.arms[d];
      if (e < 0 || d === inArm) continue;
      const turn = turnOf(inArm, d);
      if (compatibleWithLane && nLanes > 1 && laneIndexAllows(lane.laneIndex, nLanes, turn) === false) continue;
      let w = turn === 'straight' ? 0.6 : turn === 'right' ? 0.25 : 0.15;
      const cls = g.edges[e].cls;
      w *= cls >= RC_ARTERIAL ? (bus ? 3 : 1.4) : 1;
      cand.push(d);
      weight.push(w);
      total += w;
    }
    if (n.kind === 'exit' && n.exitDir >= 0 && !bus) {
      const turn = turnOf(inArm, n.exitDir);
      if (!(compatibleWithLane && nLanes > 1 && laneIndexAllows(lane.laneIndex, nLanes, turn) === false)) {
        const w = turn === 'straight' ? 0.6 : 0.2;
        cand.push(ARM_EXIT);
        weight.push(w);
        total += w;
      }
    }
    if (!cand.length) {
      // dead end (or only an incompatible choice): U-turn when possible, else any arm
      if (n.arms[inArm] >= 0 && n.arms.filter((x) => x >= 0).length === 1) return inArm;
      for (let d = 0; d < 4; d++) if (n.arms[d] >= 0 && d !== inArm) return d;
      return n.kind === 'exit' ? ARM_EXIT : inArm;
    }
    let r = this.rnd() * total;
    for (let i = 0; i < cand.length; i++) {
      r -= weight[i];
      if (r <= 0) return cand[i];
    }
    return cand[cand.length - 1];
  }

  /** Extend v.path to hold at least three segments (or up to a terminal: exit or destination). */
  private extend(v: Vehicle): void {
    const g = this.graph;
    for (let guard = 0; v.path.length < 3 && guard < 4; guard++) {
      const last = v.path[v.path.length - 1];
      if (last.kind === 'connector') {
        v.path.push(last.outLane!);
        continue;
      }
      const arm = v.pendingArm;
      if (arm === ARM_EXIT || arm === ARM_DEST) return;
      const n = g.nodes[last.toNode];
      const e = n.arms[arm];
      if (e < 0) {
        v.pendingArm = n.kind === 'exit' ? ARM_EXIT : opposite(last.dir);
        if (v.pendingArm === ARM_EXIT) return;
        continue;
      }
      const edge = g.edges[e];
      const outLanes = lanesOutOf(edge, n.id);
      const m = otherEnd(edge, n.id);
      // decide the arm at the following node now, so the lane on the next edge suits that turn
      const nextLaneProbe = outLanes[0];
      const armNext = this.chooseArmAt(v, nextLaneProbe);
      let j: number;
      if (armNext === ARM_DEST || (v.route && v.routePos >= v.route.length && armNext !== ARM_EXIT)) j = outLanes.length - 1;
      else if (armNext === ARM_EXIT) j = laneForTurn(turnOf(opposite(arm), g.nodes[m].exitDir), outLanes.length, this.rnd());
      else j = laneForTurn(turnOf(opposite(arm), armNext), outLanes.length, this.rnd());
      let c = last.out.find((x) => x.outLane === outLanes[j]);
      if (!c) c = last.out.find((x) => x.outLane!.edge === e);
      if (!c) {
        // incompatible plan (should not happen): take any connector and replan from there
        c = last.out[Math.floor(this.rnd() * last.out.length)];
        if (!c) {
          v.pendingArm = n.kind === 'exit' ? ARM_EXIT : ARM_DEST;
          if (v.route) v.destS = last.length - 1;
          return;
        }
        v.path.push(c);
        v.pendingArm = this.chooseArm(v, c.outLane!, true);
        continue;
      }
      v.path.push(c);
      v.pendingArm = armNext;
    }
  }

  /** Arm decision at the node at the end of `lane` (lane may not be the exact lane the vehicle will use). */
  private chooseArmAt(v: Vehicle, lane: Segment): number {
    return this.chooseArm(v, lane, false);
  }

  // ---- dynamics -----------------------------------------------------------------------------------------------------

  private accelerationOf(v: Vehicle, dt: number): number {
    const p = v.spec.idm;
    if (v.state !== 'driving') return -9;
    const seg = v.seg;
    let acc = idmAccel(p, v.v, 1e6, 0, seg.speedLimit);
    // leader on the same segment
    const list = this.segOcc[seg.id];
    const k = v.segIdx;
    let dist = seg.length - v.s;
    let found = false;
    if (k >= 0 && k + 1 < list.length) {
      const l = list[k + 1];
      acc = Math.min(acc, idmAccel(p, v.v, l.s - l.spec.length - v.s, v.v - l.v, seg.speedLimit));
      found = true;
    }
    // stop line or destination on the current segment
    acc = Math.min(acc, this.constraintAhead(v, 0, v.s, dt));
    // look ahead along the planned path
    for (let i = 1; i < v.path.length && dist < 160; i++) {
      const sg = v.path[i];
      // slow down before tight turns / slower segments
      if (sg.speedLimit < v.v) {
        const need = (v.v * v.v - sg.speedLimit * sg.speedLimit) / (2 * Math.max(dist, 0.5));
        if (need > 0.8) acc = Math.min(acc, -need);
      }
      if (!found) {
        const l = this.segOcc[sg.id];
        if (l.length) {
          const leader = l[0];
          acc = Math.min(acc, idmAccel(p, v.v, dist + leader.s - leader.spec.length, v.v - leader.v, seg.speedLimit));
          found = true;
        }
      }
      const c = this.constraintAhead(v, i, -dist, dt);
      if (c < acc) acc = c;
      dist += sg.length;
    }
    return Math.max(-9, acc);
  }

  /**
   * Constraint from the end of path[i] (stop line, destination or path end): returns the IDM acceleration towards a
   * standing obstacle there, or +Infinity when there is none. `sOff` is the vehicle position relative to path[i]'s
   * start (negative when path[i] is ahead).
   */
  private constraintAhead(v: Vehicle, i: number, sOff: number, dt: number): number {
    const seg = v.path[i];
    const p = v.spec.idm;
    const last = i === v.path.length - 1;
    if (seg.kind !== 'lane') return Infinity;
    // destination stop
    if (last && v.pendingArm === ARM_DEST) {
      const gap = v.destS - sOff;
      return idmAccel(p, v.v, Math.max(gap, 0.05) + p.s0, v.v, seg.speedLimit);
    }
    if (last && v.pendingArm === ARM_EXIT) return Infinity;
    const next = v.path[i + 1];
    if (!next || next.kind !== 'connector') {
      // path not extended yet (should be rare): stop at the lane end
      if (last) return idmAccel(p, v.v, Math.max(seg.length - sOff, 0.05) + p.s0, v.v, seg.speedLimit);
      return Infinity;
    }
    const node = this.graph.nodes[seg.toNode];
    const distToLine = seg.length - sOff;
    if (i === 0) {
      if (v.committed) return Infinity;
      if (distToLine > 90) return Infinity;
      // signals and stop signs are checked at any distance; box, merge and spill-back rules only once the vehicle
      // is close enough that it must decide (then it reserves the junction)
      if (this.staticAllow(v, node, next, distToLine, dt)) {
        if (distToLine > (v.v * v.v) / (2 * BRAKE_COMFORT) + 8) return Infinity;
        if (this.dynamicAllow(v, node, next)) {
          v.committed = true;
          this.reserve(v, next);
          return Infinity;
        }
      }
      return idmAccel(p, v.v, Math.max(distToLine, 0.05) + p.s0 - 0.5, v.v, seg.speedLimit);
    }
    // a later stop line: red lights and stop signs are obstacles; box rules are checked once we get there
    if (node.control === 'free') return Infinity;
    if (node.control === 'signal') {
      const asp = signalAspect(node, next.inArm, this.time + distToLine / Math.max(v.v, 3));
      if (asp === 'green') return Infinity;
    }
    return idmAccel(p, v.v, Math.max(distToLine, 0.05) + p.s0 - 0.5, v.v, seg.speedLimit);
  }

  /** Signal aspect and stop-sign rules (independent of other vehicles inside the junction). */
  private staticAllow(v: Vehicle, node: RoadNode, c: Segment, distToLine: number, dt: number): boolean {
    if (node.control === 'signal') {
      const asp = signalAspect(node, c.inArm, this.time);
      if (asp === 'red') return false;
      if (asp === 'amber' && distToLine > (v.v * v.v) / (2 * BRAKE_COMFORT) + 1) return false;
    } else if (node.control === 'stop') {
      if (distToLine < 4 && v.v < 0.4) {
        if (v.arrivalT < 0) v.arrivalT = this.time;
        v.stopWait += dt;
      }
      if (v.stopWait < 1) return false;
      if (!this.firstToGo(v, node, c)) return false;
    }
    return true;
  }

  /** Conflict-free entry: no crossing movement reserved, no merge onto the same out-lane, room after the junction. */
  private dynamicAllow(v: Vehicle, node: RoadNode, c: Segment): boolean {
    for (const o of this.nodeOcc[node.id]) {
      const oc = o.resConn;
      if (!oc || oc === c) continue;
      if (oc.outLane === c.outLane) return false;                      // merge onto the same lane
      if (oc.inArm === c.inArm) continue;                              // side by side from the same arm
      if (oc.inArm === opposite(c.inArm)) {
        if ((oc.turn === 'left') !== (c.turn === 'left')) return false; // left turn across oncoming traffic
        continue;
      }
      return false;                                                    // crossing traffic
    }
    if (c.turn === 'left' && this.oncoming(node, c)) return false;
    return this.exitSpace(v, c);
  }

  private reserve(v: Vehicle, c: Segment): void {
    if (v.resConn) this.release(v);
    v.resConn = c;
    this.nodeOcc[c.fromNode].push(v);
  }

  private release(v: Vehicle): void {
    const c = v.resConn;
    if (!c) return;
    const occ = this.nodeOcc[c.fromNode];
    const j = occ.indexOf(v);
    if (j >= 0) occ.splice(j, 1);
    v.resConn = null;
  }

  /** An oncoming vehicle close to the junction (left turners yield). */
  private oncoming(node: RoadNode, c: Segment): boolean {
    const oppArm = opposite(c.inArm);
    const e = node.arms[oppArm];
    if (e < 0) return false;
    for (const lane of lanesInto(this.graph.edges[e], node.id)) {
      const list = this.segOcc[lane.id];
      for (let k = list.length - 1; k >= 0 && k >= list.length - 2; k--) {
        const o = list[k];
        const d = lane.length - o.s;
        if (d > 30) break;
        const oc = o.path[1];
        if (oc && oc.kind === 'connector' && oc.turn === 'left') continue;
        if (o.v > 1 || o.committed) return true;
      }
    }
    return false;
  }

  /** All-way stop priority: the earliest arrival among stopped vehicles from conflicting arms goes first. */
  private firstToGo(v: Vehicle, node: RoadNode, c: Segment): boolean {
    for (let arm = 0; arm < 4; arm++) {
      if (arm === c.inArm) continue;
      const e = node.arms[arm];
      if (e < 0) continue;
      for (const lane of lanesInto(this.graph.edges[e], node.id)) {
        const list = this.segOcc[lane.id];
        const head = list[list.length - 1];
        if (!head || head.arrivalT < 0 || head.committed) continue;
        if (lane.length - head.s > 4) continue;
        if (arm === opposite(c.inArm) && c.turn !== 'left') {
          const hc = head.path[1];
          if (!hc || hc.kind !== 'connector' || hc.turn !== 'left') continue;
        }
        if (head.arrivalT < v.arrivalT || (head.arrivalT === v.arrivalT && head.id < v.id)) return false;
      }
    }
    return true;
  }

  /** Room on the out-lane for this vehicle ("don't block the box"). */
  private exitSpace(v: Vehicle, c: Segment): boolean {
    const O = c.outLane!;
    const list = this.segOcc[O.id];
    let free = O.length;
    if (list.length) free = list[0].s - list[0].spec.length;
    for (const o of this.nodeOcc[c.fromNode]) if (o.resConn && o.resConn.outLane === O) free -= o.spec.length + 2;
    return free >= Math.min(v.spec.length + 2, O.length - 1);
  }

  private integrate(v: Vehicle, dt: number): void {
    if (v.state !== 'driving') {
      v.v = 0;
      return;
    }
    const nv = Math.max(0, v.v + v.acc * dt);
    let ds = Math.max(0, (v.v + nv) * 0.5 * dt);
    v.v = nv;
    // never run a stop line we may not pass
    const seg = v.seg;
    if (seg.kind === 'lane' && !v.committed && v.path[1]?.kind === 'connector' && v.s + ds > seg.length) {
      ds = Math.max(0, seg.length - v.s);
      v.v = 0;
    }
    if (v.pendingArm === ARM_DEST && v.path.length === 1 && v.destS >= 0) {
      if (v.s + ds >= v.destS) {
        ds = Math.max(0, v.destS - v.s);
        v.v = 0;
      }
      if (v.destS - (v.s + ds) < 1.2 && v.v < 0.6) {
        v.state = 'dwell';
        v.dwell = 2.5;
        this.stats.arrived++;
        this.onRemoved?.(v, 'arrived');
      }
    }
    v.s += ds;
    // stuck watchdog (not while dwelling or waiting at a red light with room ahead)
    if (v.v < 0.1) v.stuck += dt;
    else v.stuck = 0;
    if (v.stuck > 40 && !v.removeMe) {
      v.removeMe = true;
      this.stats.removedStuck++;
      this.onRemoved?.(v, 'stuck');
    }
    // segment transitions
    while (v.s >= v.seg.length) {
      const cur = v.seg;
      if (v.path.length === 1) {
        if (v.pendingArm === ARM_EXIT) {
          if (!v.removeMe) this.onRemoved?.(v, 'exit');
          v.removeMe = true;
          v.alpha = 0;
          v.s = cur.length;
          return;
        }
        v.s = cur.length;
        return;
      }
      v.s -= cur.length;
      this.leaveSegment(v, cur);
      v.prevSeg = cur;
      v.path.shift();
      this.enterSegment(v, v.seg);
      if (v.seg.kind === 'lane') {
        v.committed = false;
        v.stopWait = 0;
        v.arrivalT = -1;
      }
      this.extend(v);
    }
  }

  // ---- bookkeeping --------------------------------------------------------------------------------------------------

  private attach(v: Vehicle): void {
    this.vehicles.push(v);
    this.enterSegment(v, v.seg);
    this.extend(v);
    this.pose(v, v.cur);
    v.prev.x = v.cur.x;
    v.prev.y = v.cur.y;
    v.prev.z = v.cur.z;
    v.prev.yaw = v.cur.yaw;
    this.stats.spawned++;
  }

  private detach(v: Vehicle): void {
    if (v.path.length) this.leaveSegment(v, v.seg);
    this.release(v);
    v.path.length = 0;
  }

  private enterSegment(v: Vehicle, seg: Segment): void {
    const list = this.segOcc[seg.id];
    // insert keeping ascending s
    let i = list.length;
    while (i > 0 && list[i - 1].s > v.s) i--;
    list.splice(i, 0, v);
    for (let k = i; k < list.length; k++) list[k].segIdx = k;
    if (seg.kind === 'connector' && v.resConn !== seg) this.reserve(v, seg);
  }

  private leaveSegment(v: Vehicle, seg: Segment): void {
    const list = this.segOcc[seg.id];
    const i = list.indexOf(v);
    if (i >= 0) {
      list.splice(i, 1);
      for (let k = i; k < list.length; k++) list[k].segIdx = k;
    }
    if (seg.kind === 'connector' && v.resConn === seg) this.release(v);
  }

  private clear(seg: Segment, s: number, room: number): boolean {
    for (const o of this.segOcc[seg.id]) if (Math.abs(o.s - s) < room) return false;
    return true;
  }

  private pose(v: Vehicle, out: Pose): void {
    // sample the vehicle centre (s is the front bumper); right after a transition the centre is still on the
    // previous segment
    const centre = v.s - v.spec.length * 0.5;
    if (centre >= 0 || !v.prevSeg) v.seg.sample(Math.max(centre, 0), out);
    else v.prevSeg.sample(v.prevSeg.length + centre, out);
  }
}

/** IDM parameter set for a vehicle class. */
export function idmFor(cls: 'car' | 'truck' | 'bus' | 'ship'): IdmParams {
  return cls === 'bus' ? BUS : cls === 'truck' ? TRUCK : CAR;
}

/** A lane index can serve a turn: right turns use the outer lane, left turns the inner lane; straight any lane. */
function laneIndexAllows(index: number, lanes: number, turn: Turn): boolean {
  if (lanes <= 1) return true;
  if (turn === 'right') return index === lanes - 1;
  if (turn === 'left' || turn === 'uturn') return index === 0;
  return true;
}

function outer(lanes: Segment[]): Segment {
  return lanes[lanes.length - 1];
}

function sortByS(list: Vehicle[]): void {
  for (let i = 1; i < list.length; i++) {
    const x = list[i];
    let j = i - 1;
    while (j >= 0 && list[j].s > x.s) {
      list[j + 1] = list[j];
      j--;
    }
    list[j + 1] = x;
  }
}

function lowerBound(cum: Float64Array, x: number): number {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Turn node accesses into an edge position. */
function normAccess(g: RoadGraph, a: RoadAccess): { edge: number; s: number } | null {
  if (a.edge >= 0) return { edge: a.edge, s: a.s };
  const n = g.nodes[a.node];
  if (!n) return null;
  for (let d = 0; d < 4; d++) {
    const e = n.arms[d];
    if (e < 0) continue;
    const edge = g.edges[e];
    if (edge.length < 4) continue;
    return { edge: e, s: edge.a === n.id ? Math.min(3, edge.length - 1) : Math.max(1, edge.length - 3) };
  }
  return null;
}

/** No U-turns except at dead ends, and every arm exists. */
function validArms(g: RoadGraph, start: number, inArm: number, arms: number[]): boolean {
  let n = start, from = inArm;
  for (const arm of arms) {
    const node = g.nodes[n];
    const e = node.arms[arm];
    if (e < 0) return false;
    if (arm === from && node.arms.filter((x) => x >= 0).length > 1) return false;
    n = otherEnd(g.edges[e], n);
    from = opposite(arm);
  }
  return true;
}

function routeLength(g: RoadGraph, start: number, arms: number[]): number {
  let n = start, len = 0;
  for (let i = 0; i < arms.length - 1; i++) {
    const e = g.nodes[n].arms[arms[i]];
    if (e < 0) return Infinity;
    const edge = g.edges[e];
    len += edge.length + 2 * g.nodes[n].half;
    n = otherEnd(edge, n);
  }
  return len;
}

/** World direction vector of an arm (unit, xz). */
export function armVector(d: number): [number, number] {
  return [DX[d], DZ[d]];
}
