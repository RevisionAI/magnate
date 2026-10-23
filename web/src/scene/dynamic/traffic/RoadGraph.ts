// Road graph for the living city (art §5.16), built once per layout from the per-plot road classes.
//
// Nodes sit at road plots that are not plain straight runs: junctions (3–4 arms), corners, dead ends, map-edge exits
// (a run that continues off the map) and class changes. Edges are the straight runs between nodes. Every edge carries
// one lane per direction on streets and two on arterials and highways (right-hand traffic), offset from the centre
// line by the art §3.2 cross-sections: streets ±1.75 m; arterials ±2.625 / ±5.875 m (3.25 m lanes either side of a
// 2 m median); highways ±2.75 / ±6.25 m. Lanes stop at the node's carriageway box; inside the box, connectors join
// every in-lane to the out-lanes allowed for its turn (right turns from the outer lane, left turns and U-turns from
// the inner lane, straight from any lane), drawn as quadratic Bézier turns, straight lines or U-turn loops.
//
// Segments (lanes and connectors) are polylines with cumulative lengths so the traffic model moves agents by arc
// length only. Pure data: no three.js objects, deterministic for a given grid.
import { PLOT_SIZE } from '../../units';

export const RC_NONE = 0;
export const RC_STREET = 1;
export const RC_ARTERIAL = 2;
export const RC_HIGHWAY = 3;
export type RoadClass = 0 | 1 | 2 | 3;

/** Directions: 0 = N (−Z), 1 = E (+X), 2 = S (+Z), 3 = W (−X). */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [0, 1, 0, -1] as const;
export const DZ = [-1, 0, 1, 0] as const;
export const opposite = (d: number): Dir => ((d + 2) & 3) as Dir;
/** Heading after a right turn (right-hand traffic: the right side of heading d points along d + 1). */
export const rightOf = (d: number): Dir => ((d + 1) & 3) as Dir;
export const leftOf = (d: number): Dir => ((d + 3) & 3) as Dir;

/** Lane centre offsets from the road centre line, inner lane first (art §3.2, §5.16). */
export const LANE_OFFSETS: Readonly<Record<RoadClass, readonly number[]>> = {
  0: [],
  1: [1.75],
  2: [2.625, 5.875],
  3: [2.75, 6.25],
};
/** Carriageway half widths (m): the node box and where lanes start and end. */
export const CARRIAGE_HALF: Readonly<Record<RoadClass, number>> = { 0: 0, 1: 6, 2: 7.5, 3: 8 };
/** Free-flow speed limits (m/s): 50 km/h streets, 60 km/h arterials, 80 km/h highways. */
export const SPEED_LIMIT: Readonly<Record<RoadClass, number>> = { 0: 8, 1: 13.9, 2: 16.7, 3: 22.2 };

/** Input: the city's road plots. */
export interface RoadGrid {
  gridW: number;
  gridH: number;
  /** Row-major road class per plot (RC_*). */
  road: Uint8Array;
  /** Optional road surface height per plot in metres (bridge decks, terrain). Absent = 0. */
  surfaceY?: Float32Array | null;
}

export type NodeKind = 'junction' | 'corner' | 'deadEnd' | 'exit' | 'through';
export type NodeControl = 'signal' | 'stop' | 'free';
export type Turn = 'straight' | 'right' | 'left' | 'uturn';

export interface RoadNode {
  id: number;
  px: number;
  pz: number;
  x: number;
  y: number;
  z: number;
  kind: NodeKind;
  control: NodeControl;
  /** Edge id per arm direction (−1 = no arm). */
  arms: [number, number, number, number];
  /** Direction of the virtual off-map arm of an exit node (−1 otherwise). */
  exitDir: number;
  /** Half size of the carriageway box (m). */
  half: number;
  /** Highest road class through the node. */
  cls: RoadClass;
  /** Signal phase offset in seconds (green waves along arterials). */
  signalOffset: number;
  /** Connectors by in-arm (the arm a vehicle arrives from). */
  connectorsByArm: Segment[][];
}

export interface RoadEdge {
  id: number;
  /** End nodes; dirA is the direction from a towards b. */
  a: number;
  b: number;
  dirA: Dir;
  cls: RoadClass;
  /** Intermediate plot indices (row-major), in order from a to b. */
  plots: number[];
  /** Lanes heading a → b and b → a, inner lane first. */
  lanesAB: Segment[];
  lanesBA: Segment[];
  /** Lane length between the two node boxes (m). */
  length: number;
}

export type SegmentKind = 'lane' | 'connector';

/** A drivable polyline (lane or connector), measured by arc length. */
export class Segment {
  readonly id: number;
  readonly kind: SegmentKind;
  /** Lane: its edge; connector: −1. */
  readonly edge: number;
  /** Lane: start and end nodes in driving direction; connector: both = its node. */
  readonly fromNode: number;
  readonly toNode: number;
  /** Driving heading of a lane, or the out-heading of a connector. */
  readonly dir: Dir;
  /** Lane index (0 = inner) for lanes and the out-lane index for connectors. */
  readonly laneIndex: number;
  readonly cls: RoadClass;
  readonly speedLimit: number;
  /** Connector: in-lane and out-lane, arrival arm and turn. */
  inLane: Segment | null = null;
  outLane: Segment | null = null;
  inArm = -1;
  turn: Turn = 'straight';
  /** Lane: connectors leaving its end (filled by the graph builder). */
  readonly out: Segment[] = [];
  readonly pts: Float32Array;
  readonly cum: Float32Array;
  readonly length: number;

  constructor(id: number, kind: SegmentKind, edge: number, fromNode: number, toNode: number, dir: Dir, laneIndex: number, cls: RoadClass, pts: number[]) {
    this.id = id;
    this.kind = kind;
    this.edge = edge;
    this.fromNode = fromNode;
    this.toNode = toNode;
    this.dir = dir;
    this.laneIndex = laneIndex;
    this.cls = cls;
    this.speedLimit = kind === 'connector' ? Math.min(SPEED_LIMIT[cls], 9) : SPEED_LIMIT[cls];
    this.pts = Float32Array.from(pts);
    const n = pts.length / 3;
    this.cum = new Float32Array(n);
    let acc = 0;
    for (let i = 1; i < n; i++) {
      const dx = pts[i * 3] - pts[i * 3 - 3], dy = pts[i * 3 + 1] - pts[i * 3 - 2], dz = pts[i * 3 + 2] - pts[i * 3 - 1];
      acc += Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.cum[i] = acc;
    }
    this.length = Math.max(acc, 0.01);
  }

  /** World position and yaw (three.js rotation.y of a +Z-forward model) at arc length s (clamped). */
  sample(s: number, out: Pose): Pose {
    const cum = this.cum, p = this.pts, n = cum.length;
    const t = Math.min(Math.max(s, 0), this.length);
    let i = 1;
    while (i < n - 1 && cum[i] < t) i++;
    const s0 = cum[i - 1], s1 = cum[i];
    const f = s1 > s0 ? (t - s0) / (s1 - s0) : 0;
    const ax = p[i * 3 - 3], ay = p[i * 3 - 2], az = p[i * 3 - 1], bx = p[i * 3], by = p[i * 3 + 1], bz = p[i * 3 + 2];
    out.x = ax + (bx - ax) * f;
    out.y = ay + (by - ay) * f;
    out.z = az + (bz - az) * f;
    out.yaw = Math.atan2(bx - ax, bz - az);
    return out;
  }
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface RoadGraph {
  readonly gridW: number;
  readonly gridH: number;
  readonly nodes: RoadNode[];
  readonly edges: RoadEdge[];
  /** Every segment by id (lanes first, then connectors). */
  readonly segments: Segment[];
  readonly lanes: Segment[];
  /** Plot index → edge id for plots inside an edge, or −(nodeId + 2) for node plots, −1 otherwise. */
  readonly plotRef: Int32Array;
  /** Road class per plot (copy of the input). */
  readonly road: Uint8Array;
}

const popcount4 = (m: number): number => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

/** Build the graph. Isolated road plots (no road neighbour, no exit) are ignored. */
export function buildRoadGraph(grid: RoadGrid): RoadGraph {
  const { gridW: W, gridH: H, road } = grid;
  const surf = grid.surfaceY ?? null;
  const idx = (px: number, pz: number): number => pz * W + px;
  const isRoad = (px: number, pz: number): boolean => px >= 0 && pz >= 0 && px < W && pz < H && road[idx(px, pz)] > 0;
  const clsAt = (i: number): RoadClass => Math.min(3, road[i]) as RoadClass;
  const yAt = (i: number): number => (surf ? surf[i] : 0);
  const centre = (px: number, pz: number): [number, number] => [(px + 0.5 - W / 2) * PLOT_SIZE, (pz + 0.5 - H / 2) * PLOT_SIZE];

  // ---- classify plots -------------------------------------------------------------------------------------------
  const mask = new Uint8Array(W * H);
  const exitDir = new Int8Array(W * H).fill(-1);
  const nodeAt = new Int32Array(W * H).fill(-1);
  const nodes: RoadNode[] = [];
  for (let pz = 0; pz < H; pz++) {
    for (let px = 0; px < W; px++) {
      const i = idx(px, pz);
      if (!road[i]) continue;
      let m = 0;
      for (let d = 0; d < 4; d++) if (isRoad(px + DX[d], pz + DZ[d])) m |= 1 << d;
      mask[i] = m;
      // A run that reaches the map edge continues off the map: a virtual arm (spawn and despawn point).
      for (let d = 0; d < 4; d++) {
        const nx = px + DX[d], nz = pz + DZ[d];
        const offMap = nx < 0 || nz < 0 || nx >= W || nz >= H;
        if (offMap && m & (1 << opposite(d))) exitDir[i] = d;
      }
    }
  }
  for (let pz = 0; pz < H; pz++) {
    for (let px = 0; px < W; px++) {
      const i = idx(px, pz);
      if (!road[i]) continue;
      const m = mask[i];
      const n = popcount4(m);
      if (n === 0 && exitDir[i] < 0) continue;
      const straight = m === 5 || m === 10;
      let kind: NodeKind | null = null;
      if (exitDir[i] >= 0) kind = 'exit';
      else if (n >= 3) kind = 'junction';
      else if (n === 1) kind = 'deadEnd';
      else if (n === 2 && !straight) kind = 'corner';
      else if (straight) {
        // class change along a straight run → pass-through node (lane counts differ on either side)
        // (only against straight neighbours: junction plots carry the highest class through them)
        const [d0, d1] = m === 5 ? [0, 2] : [1, 3];
        const c = clsAt(i);
        const straightAt = (j: number) => mask[j] === 5 || mask[j] === 10;
        const n0 = idx(px + DX[d0], pz + DZ[d0]), n1 = idx(px + DX[d1], pz + DZ[d1]);
        if ((straightAt(n0) && clsAt(n0) !== c) || (straightAt(n1) && clsAt(n1) !== c)) kind = 'through';
      }
      if (!kind) continue;
      const [x, z] = centre(px, pz);
      const node: RoadNode = {
        id: nodes.length, px, pz, x, y: yAt(i), z, kind, control: 'free', arms: [-1, -1, -1, -1], exitDir: exitDir[i], half: 0,
        cls: clsAt(i), signalOffset: 0, connectorsByArm: [[], [], [], []],
      };
      nodeAt[i] = node.id;
      nodes.push(node);
    }
  }

  // ---- trace edges between nodes ---------------------------------------------------------------------------------
  const plotRef = new Int32Array(W * H).fill(-1);
  for (const n of nodes) plotRef[idx(n.px, n.pz)] = -(n.id + 2);
  const edges: RoadEdge[] = [];
  for (const n of nodes) {
    const m = mask[idx(n.px, n.pz)];
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      if (!(m & (1 << d)) || n.arms[d] >= 0) continue;
      const plots: number[] = [];
      let px = n.px + DX[d], pz = n.pz + DZ[d];
      while (nodeAt[idx(px, pz)] < 0) {
        plots.push(idx(px, pz));
        px += DX[d];
        pz += DZ[d];
      }
      const other = nodes[nodeAt[idx(px, pz)]];
      const cls = plots.length ? clsAt(plots[0]) : (Math.min(n.cls, other.cls) as RoadClass);
      const edge: RoadEdge = { id: edges.length, a: n.id, b: other.id, dirA: d, cls, plots, lanesAB: [], lanesBA: [], length: 0 };
      n.arms[d] = edge.id;
      other.arms[opposite(d)] = edge.id;
      for (const p of plots) plotRef[p] = edge.id;
      edges.push(edge);
    }
  }

  // ---- node boxes and control ------------------------------------------------------------------------------------
  for (const n of nodes) {
    let half = CARRIAGE_HALF[n.cls] || 6;
    let arterialX = false, arterialZ = false, arms = 0;
    for (let d = 0; d < 4; d++) {
      const e = n.arms[d];
      if (e < 0) continue;
      arms++;
      const c = edges[e].cls;
      half = Math.max(half, CARRIAGE_HALF[c]);
      if (c >= RC_ARTERIAL) {
        if (d === 1 || d === 3) arterialX = true;
        else arterialZ = true;
      }
    }
    n.half = half;
    if (arms >= 3) {
      n.control = arterialX || arterialZ || n.cls >= RC_ARTERIAL ? 'signal' : 'stop';
      // green wave along the arterial axis: offset = distance / 13.9 m/s (art §5.16)
      const along = arterialX && !arterialZ ? n.x : !arterialX && arterialZ ? n.z : n.x + n.z;
      n.signalOffset = (((along + 100000) / 13.9) % SIGNAL_CYCLE + SIGNAL_CYCLE) % SIGNAL_CYCLE;
    }
  }

  // ---- lanes ---------------------------------------------------------------------------------------------------
  const segments: Segment[] = [];
  const lanes: Segment[] = [];
  const laneFor = (e: RoadEdge, from: RoadNode, to: RoadNode, dir: Dir, k: number): Segment => {
    const off = LANE_OFFSETS[e.cls][k];
    const rx = DX[rightOf(dir)] * off, rz = DZ[rightOf(dir)] * off;
    const pts: number[] = [];
    pts.push(from.x + DX[dir] * from.half + rx, from.y, from.z + DZ[dir] * from.half + rz);
    const plots = from.id === e.a ? e.plots : [...e.plots].reverse();
    for (const p of plots) {
      const [cx, cz] = centre(p % W, Math.floor(p / W));
      pts.push(cx + rx, yAt(p), cz + rz);
    }
    pts.push(to.x - DX[dir] * to.half + rx, to.y, to.z - DZ[dir] * to.half + rz);
    const seg = new Segment(segments.length, 'lane', e.id, from.id, to.id, dir, k, e.cls, pts);
    segments.push(seg);
    lanes.push(seg);
    return seg;
  };
  for (const e of edges) {
    const a = nodes[e.a], b = nodes[e.b];
    const nl = LANE_OFFSETS[e.cls].length;
    for (let k = 0; k < nl; k++) e.lanesAB.push(laneFor(e, a, b, e.dirA, k));
    for (let k = 0; k < nl; k++) e.lanesBA.push(laneFor(e, b, a, opposite(e.dirA), k));
    e.length = e.lanesAB[0]?.length ?? 0;
  }

  // ---- connectors ------------------------------------------------------------------------------------------------
  for (const n of nodes) {
    for (let inArm = 0; inArm < 4; inArm++) {
      const ein = n.arms[inArm];
      if (ein < 0) continue;
      const inLanes = lanesInto(edges[ein], n.id);
      const hin = opposite(inArm);
      const realArms = n.arms.filter((x) => x >= 0).length;
      for (let outArm = 0; outArm < 4; outArm++) {
        const eout = n.arms[outArm];
        if (eout < 0) continue;
        const turn: Turn = outArm === hin ? 'straight' : outArm === rightOf(hin) ? 'right' : outArm === leftOf(hin) ? 'left' : 'uturn';
        // U-turns only where nothing else is possible (dead ends) — exits despawn instead.
        if (turn === 'uturn' && realArms > 1) continue;
        const outLanes = lanesOutOf(edges[eout], n.id);
        const allowedIn = turn === 'straight' ? inLanes.map((_, k) => k) : turn === 'right' ? [inLanes.length - 1] : [0];
        for (const i of allowedIn) {
          for (let j = 0; j < outLanes.length; j++) {
            const L = inLanes[i], O = outLanes[j];
            const pts = connectorPoints(L, O, turn, n.y);
            const c = new Segment(segments.length, 'connector', -1, n.id, n.id, outArm as Dir, j, Math.max(L.cls, O.cls) as RoadClass, pts);
            c.inLane = L;
            c.outLane = O;
            c.inArm = inArm;
            c.turn = turn;
            segments.push(c);
            L.out.push(c);
            n.connectorsByArm[inArm].push(c);
          }
        }
      }
    }
  }

  return { gridW: W, gridH: H, nodes, edges, segments, lanes, plotRef, road: road.slice() };
}

/** Lanes of edge e that end at node n (driving into it). */
export function lanesInto(e: RoadEdge, n: number): Segment[] {
  return e.b === n ? e.lanesAB : e.lanesBA;
}

/** Lanes of edge e that start at node n. */
export function lanesOutOf(e: RoadEdge, n: number): Segment[] {
  return e.a === n ? e.lanesAB : e.lanesBA;
}

/** The node at the far end of edge e seen from node n. */
export function otherEnd(e: RoadEdge, n: number): number {
  return e.a === n ? e.b : e.a;
}

/** Turn type when arriving from arm `inArm` and leaving by arm `outArm`. */
export function turnOf(inArm: number, outArm: number): Turn {
  const hin = opposite(inArm);
  return outArm === hin ? 'straight' : outArm === rightOf(hin) ? 'right' : outArm === leftOf(hin) ? 'left' : 'uturn';
}

/** Lane index to approach a node in for a given turn (lanes = lane count of the approach). */
export function laneForTurn(turn: Turn | 'exit', lanes: number, pick: number): number {
  if (lanes <= 1) return 0;
  if (turn === 'right') return lanes - 1;
  if (turn === 'left' || turn === 'uturn') return 0;
  return Math.min(lanes - 1, Math.floor(pick * lanes));
}

function connectorPoints(L: Segment, O: Segment, turn: Turn, y: number): number[] {
  const n = L.pts.length;
  const p0x = L.pts[n - 3], p0z = L.pts[n - 1];
  const p1x = O.pts[0], p1z = O.pts[2];
  const h0x = DX[L.dir], h0z = DZ[L.dir], h1x = DX[O.dir], h1z = DZ[O.dir];
  const out: number[] = [];
  const STEPS = 8;
  if (turn === 'straight') {
    const len = Math.hypot(p1x - p0x, p1z - p0z);
    const c1x = p0x + h0x * len / 3, c1z = p0z + h0z * len / 3, c2x = p1x - h1x * len / 3, c2z = p1z - h1z * len / 3;
    const steps = Math.abs((p1x - p0x) * h0z - (p1z - p0z) * h0x) < 0.05 ? 1 : STEPS;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      out.push(cubic(p0x, c1x, c2x, p1x, t), y, cubic(p0z, c1z, c2z, p1z, t));
    }
  } else if (turn === 'uturn') {
    const r = Math.max(3, Math.hypot(p1x - p0x, p1z - p0z) * 0.8);
    const c1x = p0x + h0x * r, c1z = p0z + h0z * r, c2x = p1x - h1x * r, c2z = p1z - h1z * r;
    for (let k = 0; k <= STEPS; k++) {
      const t = k / STEPS;
      out.push(cubic(p0x, c1x, c2x, p1x, t), y, cubic(p0z, c1z, c2z, p1z, t));
    }
  } else {
    // control point = intersection of the in-line and the out-line (perpendicular headings)
    const proj = (p1x - p0x) * h0x + (p1z - p0z) * h0z;
    const cx = p0x + h0x * proj, cz = p0z + h0z * proj;
    for (let k = 0; k <= STEPS; k++) {
      const t = k / STEPS, u = 1 - t;
      out.push(u * u * p0x + 2 * u * t * cx + t * t * p1x, y, u * u * p0z + 2 * u * t * cz + t * t * p1z);
    }
  }
  return out;
}

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

// ---- signals (art §5.16: 22 s green, 3 s amber, 1 s all-red per axis) ------------------------------------------------

export const SIGNAL_GREEN = 22;
export const SIGNAL_AMBER = 3;
export const SIGNAL_ALL_RED = 1;
export const SIGNAL_CYCLE = 2 * (SIGNAL_GREEN + SIGNAL_AMBER + SIGNAL_ALL_RED);

export type SignalAspect = 'green' | 'amber' | 'red';

/** Aspect shown to traffic arriving from arm `inArm` (E/W arms = the X axis, first in the cycle). */
export function signalAspect(node: Pick<RoadNode, 'signalOffset'>, inArm: number, t: number): SignalAspect {
  const half = SIGNAL_GREEN + SIGNAL_AMBER + SIGNAL_ALL_RED;
  let c = (t + node.signalOffset) % SIGNAL_CYCLE;
  if (c < 0) c += SIGNAL_CYCLE;
  const xAxis = inArm === 1 || inArm === 3;
  const local = xAxis ? c : (c + half) % SIGNAL_CYCLE;
  if (local < SIGNAL_GREEN) return 'green';
  if (local < SIGNAL_GREEN + SIGNAL_AMBER) return 'amber';
  return 'red';
}

/** Lane-level directed graph search (A*) between nodes; returns the arms to take at each node, or null. */
export function findRoute(g: RoadGraph, fromNode: number, toNode: number, firstArmBan = -1): number[] | null {
  if (fromNode === toNode) return [];
  const N = g.nodes.length;
  const dist = new Float64Array(N).fill(Infinity);
  const prevNode = new Int32Array(N).fill(-1);
  const prevArm = new Int8Array(N).fill(-1);
  const target = g.nodes[toNode];
  const h = (i: number) => (Math.abs(g.nodes[i].x - target.x) + Math.abs(g.nodes[i].z - target.z)) / SPEED_LIMIT[RC_HIGHWAY];
  const open = new MinHeap();
  dist[fromNode] = 0;
  open.push(fromNode, h(fromNode));
  const closed = new Uint8Array(N);
  while (open.size) {
    const u = open.pop();
    if (closed[u]) continue;
    closed[u] = 1;
    if (u === toNode) break;
    const nu = g.nodes[u];
    for (let d = 0; d < 4; d++) {
      const e = nu.arms[d];
      if (e < 0) continue;
      if (u === fromNode && d === firstArmBan) continue;
      const edge = g.edges[e];
      const v = otherEnd(edge, u);
      // travel time + a small turn penalty (prefers straight runs) + node delay for controlled junctions
      let cost = (edge.length + 2 * nu.half) / SPEED_LIMIT[edge.cls];
      if (prevArm[u] >= 0 && turnOf(opposite(prevArm[u]), d) !== 'straight') cost += 4;
      if (g.nodes[v].control !== 'free') cost += 6;
      const nd = dist[u] + cost;
      if (nd < dist[v]) {
        dist[v] = nd;
        prevNode[v] = u;
        prevArm[v] = d;
        open.push(v, nd + h(v));
      }
    }
  }
  if (!Number.isFinite(dist[toNode])) return null;
  const arms: number[] = [];
  for (let v = toNode; v !== fromNode; v = prevNode[v]) arms.push(prevArm[v]);
  return arms.reverse();
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lastKey;
        if (l < n && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < n && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m];
        keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

/** Where a building meets the road: the lane position (edge, offset) nearest to a frontage plot. */
export interface RoadAccess {
  edge: number;
  /** Arc-length position along the a → b lanes. */
  s: number;
  /** Node to start from when the access is a node plot (edge = −1). */
  node: number;
}

/** Road access for plot (px, pz) (a road plot next to a building's front). Falls back to the nearest road plot. */
export function roadAccess(g: RoadGraph, px: number, pz: number): RoadAccess | null {
  const { gridW: W, gridH: H } = g;
  let best = -1, bestD = Infinity;
  for (let r = 0; r <= 6 && best < 0; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = px + dx, z = pz + dz;
        if (x < 0 || z < 0 || x >= W || z >= H) continue;
        const ref = g.plotRef[z * W + x];
        if (ref === -1) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = z * W + x; }
      }
    }
  }
  if (best < 0) return null;
  const ref = g.plotRef[best];
  if (ref <= -2) return { edge: -1, s: 0, node: -ref - 2 };
  const e = g.edges[ref];
  const k = e.plots.indexOf(best);
  const a = g.nodes[e.a];
  // distance from a's box edge to the plot centre
  const s = Math.max(1, Math.min(e.length - 1, (k + 1) * PLOT_SIZE - a.half));
  return { edge: e.id, s, node: -1 };
}
