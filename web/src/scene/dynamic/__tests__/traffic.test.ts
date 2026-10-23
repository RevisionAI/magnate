import { describe, expect, it } from 'vitest';
import {
  buildRoadGraph, findRoute, laneForTurn, opposite, otherEnd, roadAccess, signalAspect, turnOf,
  RC_ARTERIAL, RC_STREET, SIGNAL_CYCLE, type RoadGraph,
} from '../traffic/RoadGraph';
import { TrafficSim, idmFor, type VehicleSpawn } from '../traffic/TrafficSim';
import { idmAccel, CAR } from '../traffic/TrafficIdm';
import { layoutSyntheticCity } from '../../modules/synthetic/Layout';

function gridFrom(rows: string[]): { gridW: number; gridH: number; road: Uint8Array } {
  const gridH = rows.length, gridW = rows[0].length;
  const road = new Uint8Array(gridW * gridH);
  rows.forEach((r, z) => [...r].forEach((ch, x) => { road[z * gridW + x] = ch === 'A' ? RC_ARTERIAL : ch === 's' ? RC_STREET : 0; }));
  return { gridW, gridH, road };
}

const CROSS = gridFrom([
  '...s...',
  '...s...',
  '...s...',
  'AAAAAAA',
  '...s...',
  '...s...',
  '...s...',
]);

const car = (): VehicleSpawn => ({ model: 'sedan', role: 'ambient', length: 4.5, idm: idmFor('car'), color: [200, 200, 200], owner: 255 });

function syntheticGraph(size = 40, seed = 7): RoadGraph {
  const layout = layoutSyntheticCity({ gridW: size, gridH: size, seed, coastal: true, river: true, reserveShare: 0.12 });
  const road = new Uint8Array(layout.road.length);
  for (let i = 0; i < road.length; i++) road[i] = layout.road[i];
  return buildRoadGraph({ gridW: size, gridH: size, road });
}

describe('RoadGraph', () => {
  it('finds the junction, the four exits and the edges of a cross', () => {
    const g = buildRoadGraph(CROSS);
    const kinds = g.nodes.map((n) => n.kind).sort();
    expect(kinds).toEqual(['exit', 'exit', 'exit', 'exit', 'junction']);
    expect(g.edges).toHaveLength(4);
    const j = g.nodes.find((n) => n.kind === 'junction')!;
    expect(j.control).toBe('signal');            // an arterial is involved
    expect(j.half).toBe(7.5);
    // arterial edges carry 2 lanes per direction, street edges 1
    for (const e of g.edges) expect(e.lanesAB.length).toBe(e.cls === RC_ARTERIAL ? 2 : 1);
  });

  it('offsets lanes to the right of the heading (right-hand traffic)', () => {
    const g = buildRoadGraph(CROSS);
    for (const lane of g.lanes) {
      const x0 = lane.pts[0], z0 = lane.pts[2];
      const [ox, oz] = [x0 - (g.nodes[lane.fromNode].x), z0 - g.nodes[lane.fromNode].z];
      // right of heading d is d + 1: E heading → +Z offset, N heading → +X offset …
      const right = [[1, 0], [0, 1], [-1, 0], [0, -1]][lane.dir];
      const lateral = ox * right[0] + oz * right[1];
      expect(lateral).toBeGreaterThan(1);
    }
  });

  it('builds connectors for every allowed turn and keeps them inside the junction box', () => {
    const g = buildRoadGraph(CROSS);
    const j = g.nodes.find((n) => n.kind === 'junction')!;
    const conns = j.connectorsByArm.flat();
    const turns = new Set(conns.map((c) => c.turn));
    expect(turns).toEqual(new Set(['straight', 'right', 'left']));
    for (const c of conns) {
      for (let i = 0; i < c.pts.length; i += 3) {
        expect(Math.abs(c.pts[i] - j.x)).toBeLessThanOrEqual(j.half + 0.01);
        expect(Math.abs(c.pts[i + 2] - j.z)).toBeLessThanOrEqual(j.half + 0.01);
      }
      // right turns leave from the outer lane, left turns from the inner lane
      if (c.turn === 'right') expect(c.inLane!.laneIndex).toBe(lanesCount(g, c.inLane!.edge) - 1);
      if (c.turn === 'left') expect(c.inLane!.laneIndex).toBe(0);
      // continuity: connector starts where its in-lane ends and ends where its out-lane starts
      const L = c.inLane!, O = c.outLane!;
      expect(Math.hypot(c.pts[0] - L.pts[L.pts.length - 3], c.pts[2] - L.pts[L.pts.length - 1])).toBeLessThan(1e-3);
      expect(Math.hypot(c.pts[c.pts.length - 3] - O.pts[0], c.pts[c.pts.length - 1] - O.pts[2])).toBeLessThan(1e-3);
    }
  });

  it('classifies turns and lanes per turn', () => {
    expect(turnOf(3, 1)).toBe('straight');     // from W heading E, leave by E
    expect(turnOf(3, 2)).toBe('right');        // heading E, turn S
    expect(turnOf(3, 0)).toBe('left');
    expect(turnOf(3, 3)).toBe('uturn');
    expect(laneForTurn('right', 2, 0)).toBe(1);
    expect(laneForTurn('left', 2, 0.9)).toBe(0);
    expect(opposite(0)).toBe(2);
  });

  it('cycles signals: one axis at a time with amber and all-red', () => {
    const node = { signalOffset: 0 };
    let bothGreen = 0, xGreen = 0, zGreen = 0;
    for (let t = 0; t < SIGNAL_CYCLE; t += 0.5) {
      const x = signalAspect(node, 1, t), z = signalAspect(node, 0, t);
      if (x === 'green' && z === 'green') bothGreen++;
      if (x === 'green') xGreen++;
      if (z === 'green') zGreen++;
    }
    expect(bothGreen).toBe(0);
    expect(xGreen).toBe(44);
    expect(zGreen).toBe(44);
  });

  it('builds a connected graph for the synthetic city and routes across it', () => {
    const g = syntheticGraph(40);
    expect(g.nodes.length).toBeGreaterThan(20);
    expect(g.nodes.some((n) => n.kind === 'exit')).toBe(true);
    const junctions = g.nodes.filter((n) => n.kind === 'junction');
    const a = junctions[0], b = junctions[junctions.length - 1];
    const route = findRoute(g, a.id, b.id)!;
    expect(route).not.toBeNull();
    let n = a.id;
    for (const arm of route) n = otherEnd(g.edges[g.nodes[n].arms[arm]], n);
    expect(n).toBe(b.id);
  });

  it('is deterministic', () => {
    const a = syntheticGraph(40, 3), b = syntheticGraph(40, 3);
    expect(a.segments.length).toBe(b.segments.length);
    expect(Array.from(a.segments[a.segments.length - 1].pts)).toEqual(Array.from(b.segments[b.segments.length - 1].pts));
  });
});

function lanesCount(g: RoadGraph, edge: number): number {
  return g.edges[edge].lanesAB.length;
}

describe('IDM', () => {
  it('accelerates on a free road and brakes behind a standing leader', () => {
    expect(idmAccel(CAR, 5, 1e6, 0)).toBeGreaterThan(1);
    expect(idmAccel(CAR, 13, 10, 13)).toBeLessThan(-5);
    expect(Math.abs(idmAccel(CAR, CAR.v0, 1e6, 0))).toBeLessThan(0.01);
  });
});

/** Minimum bumper gap between consecutive vehicles on every segment (negative = overlap). */
function minGap(sim: TrafficSim): number {
  let min = Infinity;
  const bySeg = new Map<number, { s: number; len: number }[]>();
  for (const v of sim.vehicles) {
    if (v.removeMe || v.state !== 'driving') continue;
    const l = bySeg.get(v.seg.id) ?? [];
    l.push({ s: v.s, len: v.spec.length });
    bySeg.set(v.seg.id, l);
  }
  for (const list of bySeg.values()) {
    list.sort((p, q) => p.s - q.s);
    for (let i = 1; i < list.length; i++) min = Math.min(min, list[i].s - list[i].len - list[i - 1].s);
  }
  return min;
}

describe('TrafficSim', () => {
  it('keeps traffic flowing without collisions on a synthetic city', () => {
    const g = syntheticGraph(40);
    const sim = new TrafficSim(g, 42);
    for (let i = 0; i < 260; i++) sim.spawnRandom(car(), i % 5 === 0);
    const spawned = sim.count;
    expect(spawned).toBeGreaterThan(200);
    let worst = Infinity, moving = 0;
    for (let k = 0; k < 20 * 120; k++) {
      sim.step(1 / 20);
      if (k % 20 === 0) worst = Math.min(worst, minGap(sim));
      if (sim.count < 200) sim.spawnRandom(car(), true);
    }
    for (const v of sim.vehicles) if (v.v > 1) moving++;
    expect(worst).toBeGreaterThan(-0.5);
    expect(moving / sim.count).toBeGreaterThan(0.3);
    // gridlock watchdog fires rarely
    expect(sim.stats.removedStuck).toBeLessThan(sim.stats.spawned * 0.1);
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const sim = new TrafficSim(syntheticGraph(30), 9);
      for (let i = 0; i < 80; i++) sim.spawnRandom(car());
      for (let k = 0; k < 400; k++) sim.step(1 / 20);
      return sim.vehicles.map((v) => `${v.id}:${v.seg.id}:${v.s.toFixed(3)}`).join('|');
    };
    expect(run()).toBe(run());
  });

  it('stops at red lights', () => {
    const g = buildRoadGraph(CROSS);
    const sim = new TrafficSim(g, 1);
    // spawn on the north street heading south towards the junction while the X axis is green
    const j = g.nodes.find((n) => n.kind === 'junction')!;
    const north = g.edges[j.arms[0]];
    const lane = north.b === j.id ? north.lanesAB[0] : north.lanesBA[0];
    j.signalOffset = 0;                           // t ∈ [0, 22): X axis green → north arm red
    const v = sim.spawnOnLane(car(), lane, 2, 10)!;
    expect(v).not.toBeNull();
    for (let k = 0; k < 20 * 15; k++) {
      sim.step(1 / 20);
      if (v.seg !== lane) break;
    }
    expect(v.seg).toBe(lane);                      // still waiting at the stop line
    expect(lane.length - v.s).toBeLessThan(3);
    expect(v.v).toBeLessThan(0.2);
  });

  it('routes a truck from one road access to another and stops there', () => {
    const g = syntheticGraph(40);
    const sim = new TrafficSim(g, 5);
    const from = roadAccess(g, 3, 3)!, to = roadAccess(g, 30, 28)!;
    expect(from && to).toBeTruthy();
    const truck: VehicleSpawn = { model: 'boxTruck', role: 'truck', length: 8.2, idm: idmFor('truck'), color: [47, 125, 225], owner: 0 };
    const v = sim.spawnRouted(truck, from, to)!;
    expect(v).not.toBeNull();
    let arrived = false;
    sim.onRemoved = (veh, why) => { if (veh === v && why === 'arrived') arrived = true; };
    for (let k = 0; k < 20 * 400 && !arrived; k++) sim.step(1 / 20);
    expect(arrived).toBe(true);
  });
});
