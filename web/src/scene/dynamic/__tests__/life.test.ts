import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AnimatedPart, Emitter } from '../../assets/AssetFactory';
import { WATER_NONE, WATER_SEA } from '../../env/World';
import { PLOT_SIZE } from '../../units';
import { partMatrix } from '../AnimatedParts';
import { DELIVERIES_PER_MONTH, deliverySchedule, workersFor } from '../ConstructionSites';
import { PUFFS_PER_EMITTER, enabledPuffs, puffEnabled } from '../Particles';
import { liveEmitterRate } from '../ParticlesModule';
import { buildSidewalks, pedestrianDayFactor, shoppersFor } from '../Pedestrians';
import { LANE_OFFSHORE, SHIPS_PER_LANE, anchoragePoses, anchoredFor, shippingLanes, transitPoses } from '../Ships';
import { MAX_TRIPS_PER_LINK, TripScheduler, planTrips, truckModelFor } from '../Trucks';
import { EconomyFeed, activityMap } from '../source/EconomyFeed';
import { buildRoadGraph, RC_ARTERIAL, RC_STREET } from '../traffic/RoadGraph';
import { ambientVehicleTarget, trafficDayFactor } from '../traffic/TrafficModule';
import { PrecipitationLayer, precipCount } from '../../env/WeatherParticles';
import { isRetail } from '../source/types';
import type { CityViewDto, FlowDto } from '@/bridge/protocol';

function gridFrom(rows: string[]): { gridW: number; gridH: number; road: Uint8Array } {
  const gridH = rows.length, gridW = rows[0].length;
  const road = new Uint8Array(gridW * gridH);
  rows.forEach((r, z) => [...r].forEach((ch, x) => { road[z * gridW + x] = ch === 'A' ? RC_ARTERIAL : ch === 's' ? RC_STREET : 0; }));
  return { gridW, gridH, road };
}

const BLOCKS = gridFrom([
  '..s...s..',
  '..s...s..',
  'AAAAAAAAA',
  '..s...s..',
  '..s...s..',
  'sssssssss',
  '..s...s..',
]);

describe('traffic density (art §5.16)', () => {
  it('scales ambient vehicles with the square root of population and clamps 120…900', () => {
    expect(ambientVehicleTarget(500_000)).toBe(778);
    expect(ambientVehicleTarget(250_000)).toBe(550);
    expect(ambientVehicleTarget(1000)).toBe(120);
    expect(ambientVehicleTarget(5_000_000)).toBe(900);
  });

  it('follows the day curve keys and wraps at midnight', () => {
    expect(trafficDayFactor(3)).toBeCloseTo(0.25);
    expect(trafficDayFactor(8)).toBeCloseTo(1);
    expect(trafficDayFactor(13)).toBeCloseTo(0.7);
    expect(trafficDayFactor(18)).toBeCloseTo(1);
    expect(trafficDayFactor(22)).toBeCloseTo(0.35);
    expect(trafficDayFactor(0.5)).toBeGreaterThan(0.25);
    expect(trafficDayFactor(0.5)).toBeLessThan(0.35);
    expect(trafficDayFactor(24 + 8)).toBeCloseTo(1);
  });
});

describe('company trucks (art §3.16)', () => {
  const inCity = (id: number) => id < 100;
  const retail = (id: number) => id === 3;
  const flow = (f: Partial<FlowDto>): FlowDto => ({ kind: 'transfer', productId: 'wheat', ...f });

  it('makes clamp(ceil(qty / payload), 1, 6) trips per link spread over the month', () => {
    const trips = planTrips([flow({ fromBuildingId: 1, toBuildingId: 2, quantity: 900 })], 'm', inCity, retail, 5);
    expect(trips).toHaveLength(3);
    for (const t of trips) {
      expect(t.at).toBeGreaterThanOrEqual(0);
      expect(t.at).toBeLessThan(1);
      expect(t.from).toBe(1);
      expect(t.to).toBe(2);
    }
    expect(trips.map((t) => t.at)).toEqual([...trips.map((t) => t.at)].sort((a, b) => a - b));
    const many = planTrips([flow({ fromBuildingId: 1, toBuildingId: 2, quantity: 1e6 })], 'm', inCity, retail, 5);
    expect(many).toHaveLength(MAX_TRIPS_PER_LINK);
    expect(planTrips([flow({ fromBuildingId: 1, toBuildingId: 2 })], 'm', inCity, retail, 5)).toHaveLength(1);
  });

  it('skips retail flows and flows outside the city; off-city ends become null', () => {
    const trips = planTrips([
      flow({ kind: 'retail', fromBuildingId: 3, quantity: 500 }),
      flow({ fromBuildingId: 500, toBuildingId: 600, quantity: 500 }),
      flow({ kind: 'import', toBuildingId: 2 }),
      flow({ fromBuildingId: 1, toBuildingId: 2, toCityId: 'other', quantity: 10 }),
    ], 'm', inCity, retail, 1);
    expect(trips.map((t) => `${t.kind}:${t.from}>${t.to}`).sort()).toEqual(['import:null>2', 'transfer:1>null']);
  });

  it('uses box trucks for store deliveries and product trailers otherwise', () => {
    expect(truckModelFor('soft_drink', true)).toBe('boxTruck');
    expect(truckModelFor('crude_oil', false)).toBe('truckTanker');
    expect(truckModelFor('iron_ore', false)).toBe('truckHopper');
  });

  it('is deterministic for a month seed and varies between months', () => {
    const f = [flow({ fromBuildingId: 1, toBuildingId: 2, quantity: 2000 })];
    expect(planTrips(f, 'm', inCity, retail, 7)).toEqual(planTrips(f, 'm', inCity, retail, 7));
    expect(planTrips(f, 'm', inCity, retail, 7).map((t) => t.at)).not.toEqual(planTrips(f, 'm', inCity, retail, 8).map((t) => t.at));
  });

  it('releases trips as the visual month advances, skips stale ones and repeats after a roll-over', () => {
    const trips = planTrips([flow({ fromBuildingId: 1, toBuildingId: 2, quantity: 2400 })], 'm', inCity, retail, 3);
    const s = new TripScheduler();
    s.reset(trips, 0.5);
    const late = trips.filter((t) => t.at < 0.35).length;
    expect(s.pending).toBe(trips.length - late);
    const first = s.due(0.75);
    expect(first.every((t) => t.at <= 0.75)).toBe(true);
    const rest = s.due(0.999);
    expect(first.length + rest.length).toBe(trips.length - late);
    // new visual month: the same flows run again from the start
    expect(s.due(0.2).length).toBe(trips.filter((t) => t.at <= 0.2).length);
  });
});

describe('economy feed', () => {
  it('maps the columnar activity by building id', () => {
    const m = activityMap({ month: { year: 2026, month: 3 }, ids: [4, 9], revenue: [1, 2], unitsSold: [10, 20], exportUnits: [0, 0], netIncome: [5, -5], utilization: [0.5, null], transfersIn: [1, 0], transfersOut: [0, 3] });
    expect(m.get(4)).toEqual({ utilization: 0.5, unitsSold: 10, transfersIn: 1, transfersOut: 0, revenue: 1, netIncome: 5 });
    expect(m.get(9)?.utilization).toBeNull();
    expect(activityMap(undefined).size).toBe(0);
  });

  it('applies full and delta city views and fetches flows through the engine', async () => {
    const view = (full: boolean, ids: number[], removed: number[] = []): CityViewDto => ({
      cityId: 'm', revision: full ? 1 : 2, full, removedIds: removed,
      buildings: ids.map((id) => ({ id } as unknown as CityViewDto['buildings'][number])),
      activity: { month: { year: 2026, month: 2 }, ids, revenue: ids.map(() => 0), unitsSold: ids.map(() => 7), exportUnits: ids.map(() => 0), netIncome: ids.map(() => 0), utilization: ids.map(() => 1), transfersIn: ids.map(() => 0), transfersOut: ids.map(() => 0) },
    });
    const calls: Array<{ method: string; args: unknown }> = [];
    let n = 0;
    const engine = {
      call: async (method: string, args: unknown) => {
        calls.push({ method, args });
        if (method === 'cityView') return n++ === 0 ? view(true, [1, 2]) : view(false, [3], [1]);
        return { month: { year: 2026, month: 2 }, flows: [{ kind: 'transfer', productId: 'x', fromBuildingId: 2, toBuildingId: 3, quantity: 10 }] };
      },
    };
    const feed = new EconomyFeed(() => engine as never);
    let emitted = 0;
    feed.onChange(() => emitted++);
    feed.setCity('m');
    await new Promise((r) => setTimeout(r, 0));
    await feed.refresh();
    const snap = feed.snapshot;
    expect([...snap.visuals.keys()].sort()).toEqual([2, 3]);
    expect(snap.flows).toHaveLength(1);
    expect(snap.monthIndex).toBe(2026 * 12 + 1);
    expect(calls.filter((c) => c.method === 'cityView').map((c) => c.args)).toEqual([{ cityId: 'm' }, { cityId: 'm', since: 1 }]);
    expect(emitted).toBeGreaterThanOrEqual(3);
    feed.dispose();
  });
});

describe('particles (art §5.19)', () => {
  const smoke: Emitter = { kind: 'smoke', x: 0, y: 30, z: 0, rate: 1.2, rateAtFull: 1.5 };

  it('switches on min(pool, round(rate × life)) puffs, evenly spread over the cycle', () => {
    expect(enabledPuffs('smoke', 0)).toBe(0);
    expect(enabledPuffs('smoke', 0.01)).toBe(1);
    expect(enabledPuffs('smoke', 1.5)).toBe(14);      // 1.5 puffs/s × 9 s life
    expect(enabledPuffs('smoke', 3)).toBe(PUFFS_PER_EMITTER);
    for (const on of [0, 1, 5, 8, 13, 16]) {
      const flags = Array.from({ length: PUFFS_PER_EMITTER }, (_, i) => puffEnabled(i, on));
      expect(flags.filter(Boolean)).toHaveLength(on);
      if (on > 1 && on < PUFFS_PER_EMITTER) {
        // no two enabled runs longer than ceil(pool / on) apart
        const idx = flags.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
        for (let k = 1; k < idx.length; k++) expect(idx[k] - idx[k - 1]).toBeLessThanOrEqual(Math.ceil(PUFFS_PER_EMITTER / on));
      }
    }
  });

  it('rates building smoke by live utilization and stops it when idle or closed', () => {
    const base = { working: true, utilization: 0.4, progress: undefined, status: 'operating' as const };
    expect(liveEmitterRate(smoke, base)).toBeCloseTo(0.6);
    expect(liveEmitterRate(smoke, { ...base, utilization: null })).toBeCloseTo(1.2);
    expect(liveEmitterRate(smoke, { ...base, working: false })).toBe(0);
    expect(liveEmitterRate(smoke, { ...base, status: 'closed' })).toBe(0);
    // construction dust runs while the site is active
    expect(liveEmitterRate({ kind: 'dust', x: 0, y: 0, z: 0, rate: 0.8 }, { ...base, working: false, progress: 0.3, status: 'underConstruction' })).toBe(0.8);
  });

  it('scales precipitation with intensity under the tier budget', () => {
    expect(precipCount('rain', 0, 4000)).toBe(0);
    expect(precipCount('rain', 1, 4000)).toBe(4000);
    expect(precipCount('rain', 0.5, 8000)).toBe(4000);
    expect(precipCount('rain', 2, 20000)).toBe(8000);
    expect(precipCount('snow', 1, 8000)).toBe(3000);
  });

  it('draws streaks from both sides and never spends drops above the camera', () => {
    const rain = new PrecipitationLayer('rain', 3);
    const mat = rain.mesh.material as THREE.ShaderMaterial;
    // streak quads are oriented along the fall direction in view space, which flips their winding
    expect(mat.side).toBe(THREE.DoubleSide);
    const target = new THREE.Vector3(10, 0, -20);
    rain.update(1, 0.7, target, 150, 0.4, 8000, 1, 90);
    expect((rain.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(5600);
    expect((mat.uniforms.uSize.value as THREE.Vector3).y).toBeCloseTo(99);       // 1.1 × camera height above target
    rain.update(1, 0.7, target, 150, 0.4, 8000, 1, 900);
    expect((mat.uniforms.uSize.value as THREE.Vector3).y).toBe(200);              // street-zoom volume cap
    rain.update(1, 0, target, 150, 0.4, 8000, 1, 90);
    expect(rain.mesh.visible).toBe(false);
    rain.dispose();
  });
});

describe('retail categories', () => {
  it('treats the content store categories as retail (the bridge never sends a group name)', () => {
    for (const category of ['supermarket', 'convenience_store', 'department_store', 'retail']) expect(isRetail({ category })).toBe(true);
    for (const category of ['factory', 'warehouse', 'seaport', 'farm', 'media', 'rd_center', 'office']) expect(isRetail({ category })).toBe(false);
    expect(isRetail(undefined)).toBe(false);
  });
});

describe('pedestrians (art §5.17)', () => {
  it('sizes shoppers by units sold: min(40, round(6·log10(1 + units)))', () => {
    expect(shoppersFor(0)).toBe(0);
    expect(shoppersFor(9)).toBe(6);
    expect(shoppersFor(999)).toBe(18);
    expect(shoppersFor(1e9)).toBe(40);
    expect(shoppersFor(-5)).toBe(0);
  });

  it('keeps the street quiet at night and busy by day', () => {
    expect(pedestrianDayFactor(3)).toBeLessThan(0.15);
    expect(pedestrianDayFactor(13)).toBe(1);
    for (let h = 0; h < 24; h += 0.25) {
      const f = pedestrianDayFactor(h);
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('links sidewalk corners symmetrically along streets and across junctions', () => {
    const g = buildRoadGraph(BLOCKS);
    const sw = buildSidewalks(g);
    expect(sw.count).toBe(g.nodes.length * 4);
    let links = 0, crossings = 0;
    for (let c = 0; c < sw.count; c++) {
      for (let d = 0; d < 4; d++) {
        const nb = sw.links[c * 4 + d];
        if (nb < 0) continue;
        links++;
        if (sw.crossing[c * 4 + d]) crossings++;
        // the reverse link exists
        expect(sw.links[nb * 4 + ((d + 2) & 3)]).toBe(c);
        // corners stay off the carriageway (at least the node's half-width + 3 m from the node centre on both axes)
        const node = g.nodes[c >> 2];
        expect(Math.abs(sw.x[c] - node.x)).toBeCloseTo(node.half + 3);
      }
    }
    expect(links).toBeGreaterThan(g.edges.length * 4);
    expect(crossings).toBeGreaterThan(0);
  });
});

describe('animated parts (art §5.20)', () => {
  it('places a part at its pivot with its yaw and motion', () => {
    const part: AnimatedPart = { kind: 'pumpjackBeam', x: 10, y: 4, z: -3, rotY: Math.PI / 2, phase: 0, owner: 0 };
    const m = partMatrix(part, { axis: 'x', angle: 0, offset: 0 }, new THREE.Matrix4());
    const p = new THREE.Vector3(0, 0, 1).applyMatrix4(m);
    expect(p.x).toBeCloseTo(11);
    expect(p.y).toBeCloseTo(4);
    expect(p.z).toBeCloseTo(-3);
    const tilted = partMatrix(part, { axis: 'x', angle: 0.3, offset: 0 }, new THREE.Matrix4());
    expect(new THREE.Vector3(0, 0, 1).applyMatrix4(tilted).y).not.toBeCloseTo(4);
    const slid = partMatrix({ ...part, rotY: 0 }, { axis: 'z', angle: 0, offset: 5 }, new THREE.Matrix4());
    expect(new THREE.Vector3().applyMatrix4(slid).z).toBeCloseTo(2);
  });
});

describe('ships', () => {
  const W = 20, H = 16;
  const water = new Uint8Array(W * H).fill(WATER_NONE);
  for (let z = 0; z < 3; z++) for (let x = 0; x < W; x++) water[z * W + x] = WATER_SEA;      // north coast
  const layout = { gridW: W, gridH: H, water };

  it('lays one shipping lane offshore of each sea edge', () => {
    const lanes = shippingLanes(layout);
    expect(lanes.map((l) => l.edge)).toEqual(['N']);
    expect(lanes[0].az).toBeCloseTo(-(H * PLOT_SIZE) / 2 - LANE_OFFSHORE);
    expect(shippingLanes({ gridW: W, gridH: H, water: null })).toEqual([]);
  });

  it('moves transit ships deterministically along the lane, out at sea', () => {
    const lanes = shippingLanes(layout);
    const a = transitPoses(lanes, 42, 100), b = transitPoses(lanes, 42, 100);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(SHIPS_PER_LANE);
    const coast = -(H * PLOT_SIZE) / 2;
    let seen = 0;
    for (let t = 0; t < 4000; t += 50) {
      for (const p of transitPoses(lanes, 42, t)) {
        seen++;
        expect(p.z).toBeLessThan(coast - LANE_OFFSHORE + 1);
        expect(Math.abs(Math.sin(p.yaw))).toBeCloseTo(1);     // heading along the east-west lane
      }
    }
    expect(seen).toBeGreaterThan(20);
    const later = transitPoses(lanes, 42, 110);
    if (a.length && later.length) expect(later[0]).not.toEqual(a[0]);
  });

  it('anchors ships off a working seaport only when it trades', () => {
    const lanes = shippingLanes(layout);
    expect(anchoredFor({ working: false, transfersIn: 10, transfersOut: 10 }, true)).toBe(0);
    expect(anchoredFor({ working: true, transfersIn: 0, transfersOut: 0 }, false)).toBe(0);
    expect(anchoredFor({ working: true, transfersIn: 0, transfersOut: 0 }, true)).toBe(1);
    expect(anchoredFor({ working: true, transfersIn: 3000, transfersOut: 10 }, true)).toBe(2);
    const out = anchoragePoses(lanes, 0, -150, 2, 0, []);
    expect(out).toHaveLength(2);
    for (const p of out) {
      expect(p.speed).toBe(0);
      expect(p.z).toBeLessThan(-(H * PLOT_SIZE) / 2);
    }
  });
});

describe('construction sites', () => {
  it('staffs sites by footprint and schedules deliveries inside the month', () => {
    expect(workersFor(1, 1)).toBe(3);
    expect(workersFor(3, 3)).toBe(8);
    expect(workersFor(5, 5)).toBe(10);
    const s = deliverySchedule(7, 2);
    expect(s).toHaveLength(DELIVERIES_PER_MONTH);
    for (let k = 0; k < s.length; k++) {
      expect(s[k]).toBeGreaterThanOrEqual(0);
      expect(s[k]).toBeLessThan(1);
      if (k) expect(s[k]).toBeGreaterThan(s[k - 1]);
    }
    expect(deliverySchedule(7, 2)).toEqual(s);
  });
});
