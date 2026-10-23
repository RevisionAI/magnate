// W4 asset families (factories, farms, plantation, mine, oil well, warehouses, seaport, construction sites) against the
// AssetFactory contract and the art bible (docs/overhaul/research/art-rendering.md §4.1, §4.2, §3.16, §5.24):
//   * ids and footprints match content/data/buildings,
//   * determinism (byte-identical arrays and outputs; no Math.random / Date / performance.now inside factories),
//   * triangle budgets per LOD, no NaN, consistent winding, geometry inside the lot (seaport: booms over the water),
//   * pick boxes inside the lot; animated parts, emitters, signs, props and light pools inside it too,
//   * owner paint ≤ 15 % of the surface, closed / idle / running behaviour, the living-economy rules,
//   * builder state never leaks between buildings (chunk builders share one GeoBuilder).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetFactory, AssetOutput, AssetParams, Facing, LotFrame, Stage } from '../AssetFactory';
import { lotFrame } from '../AssetFactory';
import { cropLook } from '../families/common-b/crops';
import { FACTORY_FAMILIES, FAMILY_SAMPLE_PRODUCT } from '../families/common-b/products';
import { buildConstructionSite, buildUpgradeSite, FAMILIES_B, LEVEL_EXTENSIONS, PART_SPECS, partPose, PROPS_B, TYPE_SITES } from '../familiesB';
import { GeoBuilder, type BuiltArrays } from '../GeoBuilder';
import { ASSET_RGB, OWNER_RGB, WORLD_RGB } from '../palette';
import { allFactories, factoryFor, propFamilyFor } from '../registry';

const PLOT = 24;
const CONTENT_DIR = fileURLToPath(new URL('../../../../../content/data/buildings/', import.meta.url));

interface ContentBuilding { id: string; footprint: { width: number; height: number }; levels?: unknown[] }

function contentBuildings(): Map<string, ContentBuilding> {
  const out = new Map<string, ContentBuilding>();
  for (const file of readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const json = JSON.parse(readFileSync(CONTENT_DIR + file, 'utf8')) as ContentBuilding[] | { buildings: ContentBuilding[] };
    for (const b of Array.isArray(json) ? json : json.buildings) out.set(b.id, b);
  }
  return out;
}

const CONTENT = contentBuildings();
const TYPES = FAMILIES_B.filter((f) => f.id !== 'construction');
const CONSTRUCTION = FAMILIES_B.find((f) => f.id === 'construction')!;
const STAGES_BUILDING: readonly Stage[] = ['foundation', 'structure', 'finishing'];
const PROGRESS: Readonly<Record<'foundation' | 'structure' | 'finishing', readonly number[]>> = {
  foundation: [0, 0.13, 0.249], structure: [0.25, 0.55, 0.849], finishing: [0.85, 0.96, 0.99],
};

function params(over: Partial<AssetParams> = {}): AssetParams {
  return { seed: 0x9e3779b9, variant: 0, level: 1, stage: 'complete', progress: 1, owner: 1, utilization: 0.8, lod: 0, season: 1, month: 7, ...over };
}

function lotOf(f: AssetFactory, facing: Facing = 'S', cx = 300, cz = -180, fp = f.footprints[0]): LotFrame {
  return lotFrame(cx, cz, fp[0], fp[1], facing, PLOT);
}

interface Built { arrays: BuiltArrays; out: AssetOutput; b: GeoBuilder }

function run(f: AssetFactory, p: AssetParams, lot: LotFrame = lotOf(f)): Built {
  const b = new GeoBuilder();
  const out = f.build(b, lot, p);
  return { arrays: b.finish(), out, b };
}

/** World → lot frame (inverse of GeoBuilder.place). */
function toLot(lot: LotFrame, x: number, z: number): [number, number] {
  const a = (lot.quarterTurns & 3) * Math.PI / 2;
  const c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
  const dx = x - lot.cx, dz = z - lot.cz;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Lot rectangle in world XZ [x0, z0, x1, z1]. */
function lotRect(lot: LotFrame): [number, number, number, number] {
  const swap = (lot.quarterTurns & 1) === 1;
  const hx = (swap ? lot.depthM : lot.widthM) / 2, hz = (swap ? lot.widthM : lot.depthM) / 2;
  return [lot.cx - hx, lot.cz - hz, lot.cx + hx, lot.cz + hz];
}

/** Extra reach allowed beyond the lot front (+Z in the lot frame): the seaport's crane booms hang over the water
 *  (art §4.2.8: 45 m outreach). Everything else stays inside the lot (art §3.2). */
function frontAllowance(id: string): number { return id === 'seaport' ? 50 : 0; }

const TOL = 0.06;

function checkInsideLot(id: string, lot: LotFrame, a: BuiltArrays): void {
  const hw = lot.widthM / 2, hd = lot.depthM / 2, front = frontAllowance(id);
  let worst = 0;
  for (let i = 0; i < a.vertexCount; i++) {
    const [x, z] = toLot(lot, a.position[i * 3], a.position[i * 3 + 2]);
    worst = Math.max(worst, Math.abs(x) - hw, -z - hd, z - hd - front);
  }
  expect(worst, `${id}: geometry crosses the lot boundary by ${worst.toFixed(2)} m`).toBeLessThanOrEqual(TOL);
}

function checkFinite(id: string, a: BuiltArrays, out: AssetOutput): void {
  for (const arr of [a.position, a.fuv]) for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) throw new Error(`${id}: non-finite vertex data`);
  const nums = [...out.pickBox];
  for (const p of out.animated) nums.push(p.x, p.y, p.z, p.rotY, p.phase, p.scale ?? 1, p.extent ?? 0);
  for (const e of out.emitters) nums.push(e.x, e.y, e.z, e.rate, e.rateAtFull ?? 0, e.size ?? 1);
  for (const s of out.signs) for (const c of s.corners) nums.push(...c);
  for (const l of out.lightPools) nums.push(l.x, l.z, l.radius);
  for (const list of Object.values(out.props)) for (const it of list) nums.push(it.x, it.z, it.rotY, it.scale, it.y ?? 0);
  expect(nums.every(Number.isFinite), `${id}: non-finite output`).toBe(true);
}

function checkWinding(id: string, a: BuiltArrays): void {
  let bad = 0;
  for (let t = 0; t < a.index.length; t += 3) {
    const i0 = a.index[t] * 3, i1 = a.index[t + 1] * 3, i2 = a.index[t + 2] * 3;
    const P = a.position;
    const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2];
    const vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const g = Math.hypot(gx, gy, gz);
    if (g < 1e-6) continue;
    const n = a.index[t] * 4;
    const nx = a.normal[n] / 127, ny = a.normal[n + 1] / 127, nz = a.normal[n + 2] / 127;
    if ((gx * nx + gy * ny + gz * nz) / g < 0.85) bad++;
  }
  expect(bad, `${id}: ${bad} triangles whose winding disagrees with their normal (culled as back faces)`).toBe(0);
}

function checkOutputs(f: AssetFactory, lot: LotFrame, built: Built, p: AssetParams): void {
  const { arrays: a, out } = built;
  const id = `${f.id}/${p.stage}/L${p.level}/lod${p.lod}/v${p.variant}/${lot.facing}`;
  checkFinite(id, a, out);
  const [x0, z0, x1, z1] = lotRect(lot);
  const [bx0, by0, bz0, bx1, by1, bz1] = out.pickBox;
  // pick box: inside the lot (it is clamped there), non-empty, above ground
  expect(bx0, id).toBeGreaterThanOrEqual(x0 - TOL);
  expect(bz0, id).toBeGreaterThanOrEqual(z0 - TOL);
  expect(bx1, id).toBeLessThanOrEqual(x1 + TOL);
  expect(bz1, id).toBeLessThanOrEqual(z1 + TOL);
  expect(bx1, id).toBeGreaterThan(bx0);
  expect(bz1, id).toBeGreaterThan(bz0);
  expect(by1, id).toBeGreaterThan(0);
  expect(by0, id).toBeLessThanOrEqual(0);
  const inBoxXZ = (x: number, z: number) => x >= bx0 - TOL && x <= bx1 + TOL && z >= bz0 - TOL && z <= bz1 + TOL;
  // animated parts: pivots inside the pick box (they are what the player clicks on); the seaport's floating crane
  // works from a barge on the water side of the quay
  for (const part of out.animated) {
    expect(PART_SPECS[part.kind], `${id}: unknown part ${part.kind}`).toBeDefined();
    const [plx, plz] = toLot(lot, part.x, part.z);
    const onWater = f.id === 'seaport' && plz > lot.depthM / 2 && plz <= lot.depthM / 2 + frontAllowance(f.id) && Math.abs(plx) <= lot.widthM / 2;
    expect(onWater || inBoxXZ(part.x, part.z), `${id}: ${part.kind} pivot outside the pick box`).toBe(true);
    expect(part.y, `${id}: ${part.kind} pivot height`).toBeGreaterThanOrEqual(by0 - TOL);
    expect(part.y, `${id}: ${part.kind} pivot height`).toBeLessThanOrEqual(by1 + TOL);
    expect(part.phase).toBeGreaterThanOrEqual(0);
    expect(part.phase).toBeLessThan(1.0001);
    expect(part.owner === 255 || (part.owner >= 0 && part.owner <= 7)).toBe(true);
  }
  // emitters: above their stacks, inside the pick box footprint
  for (const e of out.emitters) {
    expect(['smoke', 'steam', 'dust', 'flare']).toContain(e.kind);
    expect(inBoxXZ(e.x, e.z), `${id}: ${e.kind} emitter outside the pick box`).toBe(true);
    expect(e.y).toBeGreaterThanOrEqual(0);
    expect(e.y, `${id}: ${e.kind} emitter above the asset`).toBeLessThanOrEqual(by1 + 2);
    expect(e.rate).toBeGreaterThanOrEqual(0);
    expect(e.rateAtFull ?? e.rate).toBeGreaterThanOrEqual(e.rate);
  }
  // signs: non-degenerate quads inside the lot
  for (const s of out.signs) {
    expect(s.corners).toHaveLength(4);
    expect(s.companyId.length).toBeGreaterThan(0);
    for (const c of s.corners) expect(c[0] >= x0 - TOL && c[0] <= x1 + TOL && c[2] >= z0 - TOL && c[2] <= z1 + TOL, `${id}: sign outside the lot`).toBe(true);
    const [a0, a1, , a3] = s.corners;
    const w = Math.hypot(a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]), h = Math.hypot(a3[0] - a0[0], a3[1] - a0[1], a3[2] - a0[2]);
    expect(w * h, `${id}: degenerate sign`).toBeGreaterThan(0.1);
    if (s.style === 'text') expect(s.text && s.text.length > 0).toBe(true);
  }
  for (const l of out.lightPools) {
    expect(l.radius).toBeGreaterThan(0);
    expect(l.x >= x0 - TOL && l.x <= x1 + TOL && l.z >= z0 - TOL && l.z <= z1 + TOL, `${id}: light pool outside the lot`).toBe(true);
  }
  // props: registered families, inside the lot (the feeder ship lies at the berth, in front of the quay)
  for (const [family, list] of Object.entries(out.props)) {
    expect(propFamilyFor(family), `${id}: prop family '${family}' is not registered`).toBeDefined();
    if (p.lod !== 0) expect(list, `${id}: LOD1 builds emit no props`).toHaveLength(0);
    for (const it of list) {
      expect(it.scale).toBeGreaterThan(0);
      const [lx, lz] = toLot(lot, it.x, it.z);
      if (family === 'feederShip') {
        expect(lz, `${id}: ship must lie on the water side`).toBeGreaterThan(lot.depthM / 2);
        continue;
      }
      expect(Math.abs(lx) <= lot.widthM / 2 + TOL && Math.abs(lz) <= lot.depthM / 2 + TOL, `${id}: '${family}' prop outside the lot`).toBe(true);
    }
  }
  if (p.lod !== 0) expect(out.animated, `${id}: LOD1 builds emit no animated parts`).toHaveLength(0);
}

function budgetOf(f: AssetFactory, lod: 0 | 1): number {
  return lod === 0 ? f.triBudget.lod0 : f.triBudget.lod1;
}

function hashArrays(a: BuiltArrays): string {
  let h = 0x811c9dc5;
  const mix = (arr: ArrayLike<number>, scale = 1) => {
    for (let i = 0; i < arr.length; i++) {
      h ^= Math.round(arr[i] * scale) & 0xffff;
      h = Math.imul(h, 0x01000193);
    }
  };
  mix(a.position, 4096); mix(a.normal); mix(a.color); mix(a.fuv, 4096); mix(a.facade); mix(a.extra); mix(a.index);
  return `${a.vertexCount}:${a.triangleCount}:${(h >>> 0).toString(16)}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('registry and content', () => {
  it('registers every W4 content type plus the generic construction factory', () => {
    const ids = FAMILIES_B.map((f) => f.id).sort();
    expect(ids).toEqual(['construction', 'factory_large', 'factory_small', 'iron_mine', 'large_farm', 'oil_well', 'seaport', 'small_farm', 'small_plantation', 'warehouse_large', 'warehouse_small']);
    for (const f of FAMILIES_B) {
      expect(factoryFor(f.id)).toBe(f);
      expect(['industrial', 'extraction', 'logistics', 'construction']).toContain(f.family);
    }
    expect(allFactories().map((f) => f.id)).toEqual([...allFactories().map((f) => f.id)].sort((a, b) => a.localeCompare(b)));
  });

  it('footprints match content/data/buildings', () => {
    for (const f of TYPES) {
      const c = CONTENT.get(f.id);
      expect(c, `${f.id} missing from content`).toBeDefined();
      expect(f.footprints[0]).toEqual([c!.footprint.width, c!.footprint.height]);
    }
  });

  it('every content building type has a construction site spec or a W4 factory', () => {
    for (const id of CONTENT.keys()) expect(TYPE_SITES[id] !== undefined || factoryFor(id) !== undefined, id).toBe(true);
  });

  it('every prop family and animated part kind builds inside its triangle budget', () => {
    for (const fam of PROPS_B) {
      const b = new GeoBuilder();
      fam.build(b);
      expect(b.triangleCount, fam.id).toBeGreaterThan(0);
      expect(b.triangleCount, fam.id).toBeLessThanOrEqual(fam.triBudget);
      expect(fam.maxDistance).toBeGreaterThan(0);
      checkWinding(`prop ${fam.id}`, b.finish());
    }
    expect(new Set(PROPS_B.map((f) => f.id)).size).toBe(PROPS_B.length);
    for (const spec of Object.values(PART_SPECS)) {
      const b = new GeoBuilder();
      spec.build(b, spec.defaultExtent);
      expect(b.triangleCount, spec.kind).toBeGreaterThan(0);
      expect(b.triangleCount, spec.kind).toBeLessThanOrEqual(spec.triBudget);
      expect(spec.motion.period).toBeGreaterThan(0);
      checkWinding(`part ${spec.kind}`, b.finish());
    }
  });

  it('art bible animation constants: pumpjack ±18° over 7.5 s with the crank in step, crane slew ±60° / 20 s', () => {
    expect(PART_SPECS.pumpjackBeam.motion).toMatchObject({ mode: 'rock', period: 7.5 });
    expect(PART_SPECS.pumpjackBeam.motion.amplitude).toBeCloseTo((18 * Math.PI) / 180, 6);
    expect(PART_SPECS.pumpjackCrank.motion).toMatchObject({ mode: 'spin', period: 7.5 });
    expect(PART_SPECS.craneJib.motion.amplitude).toBeCloseTo((60 * Math.PI) / 180, 6);
    expect(PART_SPECS.craneJib.motion.period).toBe(20);
    expect(PART_SPECS.excavatorArm.motion.amplitude).toBeCloseTo((25 * Math.PI) / 180, 6);
    expect(PART_SPECS.excavatorArm.motion.period).toBe(4);
    expect(PART_SPECS.irrigationArm.motion.period).toBe(120);
    // the trolley shuttles ±30 m at ≈ 0.6 m/s (art §4.2.8)
    const tr = PART_SPECS.gantryTrolley.motion;
    expect(tr.mode).toBe('shuttle');
    expect((4 * (PART_SPECS.gantryTrolley.defaultExtent ?? 0)) / tr.period).toBeCloseTo(0.6, 1);
  });

  it('partPose is pure: inactive parts rest, active parts follow their motion', () => {
    const rest = partPose({ kind: 'pumpjackBeam', phase: 0.3, active: false }, 12.3);
    expect(rest.angle).toBe(0);
    expect(rest.offset).toBe(0);
    const a = partPose({ kind: 'pumpjackBeam', phase: 0, active: true }, 7.5 / 4);
    expect(a.axis).toBe('x');
    expect(a.angle).toBeCloseTo(PART_SPECS.pumpjackBeam.motion.amplitude, 6);
    const t = partPose({ kind: 'gantryTrolley', phase: 0.25, active: true, extent: 20 }, 0);
    expect(t.offset).toBeCloseTo(20, 6);
    expect(partPose({ kind: 'sheaveWheel', phase: 0.1 }, 1.7)).toEqual(partPose({ kind: 'sheaveWheel', phase: 0.1 }, 1.7));
  });
});

describe('every W4 factory × stage × level × LOD × variant × facing', () => {
  for (const f of FAMILIES_B) {
    it(`${f.id}: budgets, bounds, outputs, winding`, { timeout: 60_000 }, () => {
      const footprints = f.id === 'construction' ? f.footprints : [f.footprints[0]];
      for (const fp of footprints) {
        for (const stage of ['complete', 'closed', ...STAGES_BUILDING] as Stage[]) {
          const progresses = stage === 'complete' || stage === 'closed' ? [1] : PROGRESS[stage as 'foundation'];
          for (const progress of progresses) {
            for (const level of [1, 2, 3] as const) {
              if ((stage !== 'complete' || f.id === 'construction') && level !== 1) continue; // sites ignore the level
              for (const lod of [0, 1] as const) {
                for (const variant of [0, 1, 2, 3]) {
                  const facing = (['S', 'E', 'N', 'W'] as const)[(variant + level) % 4];
                  const lot = lotOf(f, facing, 300 + variant * 7, -180, fp);
                  const p = params({ stage, progress, level, lod, variant, owner: (variant * 3 + level) % 9 === 8 ? 255 : (variant * 3 + level) % 8, seed: 1234 + variant * 977 + level * 31 });
                  if (f.id === 'construction') { p.targetTypeId = undefined; p.heightHint = 6 + variant * 9; }
                  const built = run(f, p, lot);
                  const id = `${f.id} ${fp} ${stage}@${progress} L${level} lod${lod} v${variant} ${facing}`;
                  expect(built.arrays.triangleCount, `${id}: triangles`).toBeGreaterThan(0);
                  expect(built.arrays.triangleCount, `${id}: over budget`).toBeLessThanOrEqual(budgetOf(f, lod));
                  checkInsideLot(f.id, lot, built.arrays);
                  checkWinding(id, built.arrays);
                  checkOutputs(f, lot, built, p);
                }
              }
            }
          }
        }
      }
    });
  }

  it('the generic construction factory serves every content type (and W4 types through their own factory)', { timeout: 30_000 }, () => {
    for (const [typeId, c] of CONTENT) {
      for (const stage of STAGES_BUILDING) {
        for (const lod of [0, 1] as const) {
          const lot = lotOf(CONSTRUCTION, 'S', 0, 0, [c.footprint.width, c.footprint.height]);
          const p = params({ stage, progress: PROGRESS[stage as 'foundation'][1], lod, targetTypeId: typeId });
          const built = run(CONSTRUCTION, p, lot);
          const delegate = factoryFor(typeId);
          // W4 types render their own construction stages (their budget applies); every other type
          // (e.g. W3's 1×1 convenience store) is drawn by the generic site, so the construction budget applies.
          const ownStages = delegate !== undefined && delegate.id !== 'construction' && FAMILIES_B.includes(delegate);
          const budget = ownStages ? budgetOf(delegate, lod) : budgetOf(CONSTRUCTION, lod);
          expect(built.arrays.triangleCount, `${typeId} ${stage} lod${lod}`).toBeLessThanOrEqual(budget);
          checkInsideLot(delegate?.id ?? 'construction', lot, built.arrays);
          checkOutputs(delegate ?? CONSTRUCTION, lot, built, p);
        }
      }
    }
  });
});

describe('determinism (art §5.4: byte-identical arrays for the same inputs)', () => {
  it('identical arrays and outputs for identical inputs; different seeds still build', () => {
    for (const f of FAMILIES_B) {
      for (const stage of ['complete', 'structure'] as Stage[]) {
        const p = params({ stage, progress: stage === 'complete' ? 1 : 0.6, variant: 1, level: 3, targetTypeId: f.id === 'construction' ? 'supermarket' : undefined });
        const a = run(f, p), b = run(f, { ...p });
        expect(hashArrays(a.arrays), f.id).toBe(hashArrays(b.arrays));
        expect(Array.from(a.arrays.position)).toEqual(Array.from(b.arrays.position));
        expect(JSON.stringify(a.out)).toBe(JSON.stringify(b.out));
      }
    }
  });

  it('never calls Math.random, Date or performance.now (factories run in a worker and must be pure)', () => {
    // everything below runs synchronously and is restored in `finally`, so the test runner never sees the mocks
    const boom = () => { throw new Error('impure call inside an asset factory'); };
    const RealDate = globalThis.Date;
    vi.spyOn(Math, 'random').mockImplementation(boom);
    vi.spyOn(RealDate, 'now').mockImplementation(boom);
    vi.spyOn(performance, 'now').mockImplementation(boom);
    globalThis.Date = new Proxy(RealDate, { construct: boom, apply: boom }) as DateConstructor;
    try {
      for (const f of FAMILIES_B) {
        for (const stage of ['complete', 'closed', 'foundation', 'structure', 'finishing'] as Stage[]) {
          for (const lod of [0, 1] as const) {
            expect(() => run(f, params({ stage, progress: stage === 'complete' || stage === 'closed' ? 1 : 0.5, lod }))).not.toThrow();
          }
        }
      }
      expect(() => buildConstructionSite(new GeoBuilder(), lotFrame(0, 0, 3, 3), [3, 3], 'structure', 0.5, 20)).not.toThrow();
    } finally {
      globalThis.Date = RealDate;
      vi.restoreAllMocks();
    }
  });

  it('does not leak builder state into the next building of a shared chunk builder', () => {
    const b = new GeoBuilder();
    b.owner = 6; b.tint = 77; b.flags = 4; b.ownerRoof = false;
    b.place(1, 2, 3);
    const before = b.saveState();
    let cursor = 0;
    for (const f of FAMILIES_B) {
      f.build(b, lotOf(f, 'N', cursor, 0), params({ owner: 2, stage: 'complete' }));
      cursor += 200;
      expect(b.saveState(), f.id).toEqual(before);
    }
  });

  it('tolerates out-of-range params from the bridge (NaN utilization/progress, bad level/owner/month/variant/seed)', () => {
    const weird = [
      { utilization: Number.NaN, progress: Number.NaN },
      { level: 9 as unknown as 1, owner: 99, month: 13, variant: -3, seed: -1 },
      { utilization: 7, month: 0, owner: -4, seed: 2 ** 40 },
      { productIds: ['no_such_product', 'wheat'], activity: { transfersIn: -5, transfersOut: Number.NaN } },
    ];
    for (const f of FAMILIES_B) {
      for (const w of weird) {
        for (const stage of ['complete', 'structure', 'closed'] as Stage[]) {
          const lot = lotOf(f);
          const p = params({ stage, progress: 0.5, ...w });
          const built = run(f, p, lot);
          expect(built.arrays.triangleCount, `${f.id} ${JSON.stringify(w)}`).toBeGreaterThan(0);
          checkFinite(f.id, built.arrays, built.out);
          checkInsideLot(f.id, lot, built.arrays);
        }
      }
    }
  });

  it('is independent of the lot position (translation only moves vertices)', () => {
    for (const f of TYPES) {
      const p = params({ variant: 1, level: 2 });
      const a = run(f, p, lotOf(f, 'W', 0, 0)), c = run(f, p, lotOf(f, 'W', 480, -960));
      expect(a.arrays.vertexCount).toBe(c.arrays.vertexCount);
      for (let i = 0; i < a.arrays.vertexCount; i += 17) {
        expect(c.arrays.position[i * 3] - a.arrays.position[i * 3]).toBeCloseTo(480, 2);
        expect(c.arrays.position[i * 3 + 2] - a.arrays.position[i * 3 + 2]).toBeCloseTo(-960, 2);
      }
      expect(Array.from(c.arrays.color)).toEqual(Array.from(a.arrays.color));
    }
  });
});

describe('owner paint, night and closed state (art §3.4, §4.1)', () => {
  /** Area of triangles in an exact colour vs. all triangles; signs (atlas quads, owner-coloured) count as owner. */
  function ownerShare(built: Built, owner: number): number {
    const a = built.arrays;
    const [r, g, bl] = OWNER_RGB[owner];
    let total = 0, paint = 0;
    for (let t = 0; t < a.index.length; t += 3) {
      const i0 = a.index[t], i1 = a.index[t + 1], i2 = a.index[t + 2];
      const P = a.position;
      const ux = P[i1 * 3] - P[i0 * 3], uy = P[i1 * 3 + 1] - P[i0 * 3 + 1], uz = P[i1 * 3 + 2] - P[i0 * 3 + 2];
      const vx = P[i2 * 3] - P[i0 * 3], vy = P[i2 * 3 + 1] - P[i0 * 3 + 1], vz = P[i2 * 3 + 2] - P[i0 * 3 + 2];
      const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      total += area;
      if (a.color[i0 * 4] === r && a.color[i0 * 4 + 1] === g && a.color[i0 * 4 + 2] === bl) paint += area;
    }
    for (const s of built.out.signs) {
      const [c0, c1, , c3] = s.corners;
      paint += Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]) * Math.hypot(c3[0] - c0[0], c3[1] - c0[1], c3[2] - c0[2]);
    }
    return paint / total;
  }

  it('owner colour covers ≤ 15 % of the surface of every complete building', () => {
    for (const f of TYPES) {
      for (const level of [1, 2, 3] as const) {
        for (const variant of [0, 1, 2, 3]) {
          const built = run(f, params({ owner: 0, level, variant }));
          const share = ownerShare(built, 0);
          expect(share, `${f.id} L${level} v${variant}: owner share ${(share * 100).toFixed(1)} %`).toBeLessThanOrEqual(0.15);
          expect(share, `${f.id}: no owner colour at all`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every running company building has an emissive owner element at night (sign, band or pylon)', () => {
    for (const f of TYPES) {
      const built = run(f, params({ owner: 0 }));
      const [r, g, bl] = OWNER_RGB[0];
      const a = built.arrays;
      let glowing = 0;
      for (let i = 0; i < a.vertexCount; i++) if (a.extra[i * 4] > 0 && a.color[i * 4] === r && a.color[i * 4 + 1] === g && a.color[i * 4 + 2] === bl) glowing++;
      expect(built.out.signs.length + glowing, f.id).toBeGreaterThan(0);
    }
  });

  it('every owned complete building flags its main roof for the city-zoom owner tint, at both LODs (art §3.4, §4.1)', () => {
    for (const f of TYPES) {
      for (const lod of [0, 1] as const) {
        const a = run(f, params({ owner: 3, lod })).arrays;
        let roof = 0;
        for (let i = 0; i < a.vertexCount; i++) if (a.extra[i * 4 + 1] & 1) roof++;
        expect(roof, `${f.id} lod${lod}`).toBeGreaterThan(0);
        const none = run(f, params({ owner: 255, lod })).arrays;
        for (let i = 0; i < none.vertexCount; i++) expect(none.extra[i * 4 + 1] & 1, `${f.id}: unowned roofs never tint`).toBe(0);
      }
    }
  });

  it('closed: no emitters, motion stopped, grey signs, weeds on the lot, nothing glowing in owner colour', () => {
    for (const f of TYPES) {
      const built = run(f, params({ stage: 'closed', owner: 0 }));
      expect(built.out.emitters, f.id).toHaveLength(0);
      for (const part of built.out.animated) expect(part.active, `${f.id} ${part.kind}`).toBe(false);
      for (const s of built.out.signs) expect(s.style, f.id).toBe('closed');
      const a = built.arrays;
      const [r, g, bl] = ASSET_RGB.weeds;
      let weeds = 0, ownerGlow = 0;
      const [orr, og, ob] = OWNER_RGB[0];
      for (let i = 0; i < a.vertexCount; i++) {
        if (a.color[i * 4] === r && a.color[i * 4 + 1] === g && a.color[i * 4 + 2] === bl) weeds++;
        if (a.extra[i * 4] > 0 && a.color[i * 4] === orr && a.color[i * 4 + 1] === og && a.color[i * 4 + 2] === ob) ownerGlow++;
      }
      expect(weeds, `${f.id}: weed patches`).toBeGreaterThanOrEqual(12);
      expect(ownerGlow, `${f.id}: closed buildings do not glow`).toBe(0);
      expect(Object.keys(built.out.props).filter((k) => /^truck|^trailer|^forklift|^haulTruck|^straddle|^reach|^feederShip/.test(k)), `${f.id}: vehicles at a closed site`).toEqual([]);
    }
  });

  it('idle (utilization 0): emitters paused, motion stopped, but rates at full load are still reported', () => {
    for (const f of TYPES) {
      const built = run(f, params({ utilization: 0 }));
      for (const e of built.out.emitters) {
        expect(e.rate, `${f.id} ${e.kind}`).toBe(0);
        expect(e.rateAtFull ?? 0, `${f.id} ${e.kind}`).toBeGreaterThan(0);
      }
      for (const part of built.out.animated) if (part.kind !== 'flag') expect(part.active, `${f.id} ${part.kind}`).toBe(false);
    }
  });
});

describe('the living economy (art §3.16)', () => {
  const smallFactory = factoryFor('factory_small')!;
  const warehouse = factoryFor('warehouse_large')!;
  const port = factoryFor('seaport')!;

  it('chimney smoke = 1.5 puffs/s × utilization, shaded by product family', () => {
    for (const util of [0.2, 0.6, 1]) {
      const out = run(smallFactory, params({ utilization: util, productIds: ['steel'] })).out;
      const smoke = out.emitters.filter((e) => e.kind === 'smoke');
      expect(smoke.length).toBeGreaterThan(0);
      expect(smoke[0].rate).toBeCloseTo(1.5 * util, 3);
      expect(smoke[0].tone).toBe('dark');
    }
    const food = run(smallFactory, params({ productIds: ['flour'] })).out.emitters.filter((e) => e.kind === 'smoke');
    expect(food[0].tone).toBe('light');
    const beer = run(smallFactory, params({ productIds: ['beer'] })).out.emitters;
    expect(beer.some((e) => e.kind === 'steam')).toBe(true);
    const tv = run(smallFactory, params({ productIds: ['television'] })).out.emitters;
    expect(tv.filter((e) => e.kind === 'smoke')).toHaveLength(0);
    const plastic = run(smallFactory, params({ productIds: ['plastic'] })).out.emitters;
    expect(plastic.some((e) => e.kind === 'flare')).toBe(true);
  });

  it('every product family builds distinct props, and an unconfigured factory (no products) stays dark', () => {
    const hashes = new Set<string>();
    for (const fam of FACTORY_FAMILIES) {
      const product = FAMILY_SAMPLE_PRODUCT[fam]!;
      hashes.add(hashArrays(run(smallFactory, params({ productIds: [product] })).arrays));
    }
    expect(hashes.size).toBe(FACTORY_FAMILIES.length);
    const idle = run(smallFactory, params({ productIds: [] }));
    expect(idle.out.emitters.filter((e) => e.kind !== 'flare').every((e) => e.rate >= 0)).toBe(true);
    let lit = 0;
    for (let i = 0; i < idle.arrays.vertexCount; i++) if (idle.arrays.facade[i * 4] !== 0) lit++;
    expect(lit, 'no procedural (lit) windows on an unconfigured factory').toBe(0);
  });

  it('trailers at the docks = clamp(round(log10(1 + transfers)), 0, docks)', () => {
    const count = (out: AssetOutput) => (out.props.trailer ?? []).filter((t) => {
      const [, lz] = toLot(lotOf(warehouse), t.x, t.z);
      return lz < 25; // dock trailers, not the trailer-yard row
    }).length;
    expect(count(run(warehouse, params({ activity: { transfersIn: 0, transfersOut: 0 } })).out)).toBe(0);
    expect(count(run(warehouse, params({ activity: { transfersIn: 9 } })).out)).toBe(1);
    expect(count(run(warehouse, params({ activity: { transfersIn: 50, transfersOut: 49 } })).out)).toBe(2);
    expect(count(run(warehouse, params({ activity: { transfersOut: 1e9 } })).out)).toBe(9);
    expect(count(run(warehouse, params({ activity: { transfersOut: 1e30 } })).out)).toBeLessThanOrEqual(16);
  });

  it('seaport: ship at berth and working trolleys with import/export flows; booms raised without', () => {
    const busy = run(port, params({ activity: { shipAtBerth: true } }));
    expect(busy.out.props.feederShip).toHaveLength(1);
    expect(busy.out.animated.filter((p) => p.kind === 'gantryTrolley')).toHaveLength(2);
    const quiet = run(port, params({ activity: { shipAtBerth: false } }));
    expect(quiet.out.props.feederShip ?? []).toHaveLength(0);
    expect(quiet.out.animated.filter((p) => p.kind === 'gantryTrolley')).toHaveLength(0);
    // raised booms reach higher than working booms
    expect(quiet.out.pickBox[4]).toBeGreaterThan(busy.out.pickBox[4]);
    // container yard fill follows utilization
    const few = (run(port, params({ utilization: 0.05 })).out.props.containers ?? []).length;
    const many = (run(port, params({ utilization: 1 })).out.props.containers ?? []).length;
    expect(many).toBeGreaterThan(few);
    expect(many).toBeLessThanOrEqual(1200);
  });

  it('oil well: one pumpjack per level, beam in owner livery, flare only while producing', () => {
    const well = factoryFor('oil_well')!;
    for (const level of [1, 2, 3] as const) {
      const out = run(well, params({ level, owner: 4 })).out;
      const beams = out.animated.filter((p) => p.kind === 'pumpjackBeam');
      expect(beams).toHaveLength(level);
      expect(out.animated.filter((p) => p.kind === 'pumpjackCrank')).toHaveLength(level);
      for (const b of beams) { expect(b.owner).toBe(4); expect(b.active).toBe(true); }
      expect(new Set(beams.map((b) => b.phase.toFixed(4))).size, 'pumpjacks never nod in unison').toBe(level);
    }
    expect(run(well, params({ utilization: 0 })).out.emitters.filter((e) => e.kind === 'flare' && e.rate > 0)).toHaveLength(0);
  });

  it('iron mine: two sheave wheels spinning while operating, dust ∝ utilization', () => {
    const mine = factoryFor('iron_mine')!;
    const out = run(mine, params({ utilization: 0.5 })).out;
    const wheels = out.animated.filter((p) => p.kind === 'sheaveWheel');
    expect(wheels).toHaveLength(2);
    for (const w of wheels) expect(w.active).toBe(true);
    const dust = out.emitters.filter((e) => e.kind === 'dust');
    expect(dust.length).toBeGreaterThan(0);
    for (const d of dust) expect(d.rate).toBeCloseTo((d.rateAtFull ?? 0) * 0.5, 3);
  });

  it('crops follow the month (wheat calendar of art §4.2.9)', () => {
    expect(cropLook('wheat', 3).stage).toBe('furrow');
    expect(cropLook('wheat', 5).stage).toBe('growing');
    expect(cropLook('wheat', 5).height).toBeCloseTo(0.9 * 0.3, 3);
    expect(cropLook('wheat', 7).height).toBeCloseTo(0.9, 3);
    expect(cropLook('wheat', 8).stage).toBe('ripe');
    expect(cropLook('wheat', 9).stage).toBe('ripe');
    expect(cropLook('wheat', 8).top).toEqual(WORLD_RGB.crops.wheat);
    expect(cropLook('wheat', 10).stage).toBe('stubble');
    for (const m of [11, 12, 1, 2]) expect(cropLook('wheat', m).stage).toBe('bare');
    const farm = factoryFor('small_farm')!;
    const months = new Set<string>();
    for (let m = 1; m <= 12; m++) months.add(hashArrays(run(farm, params({ month: m, productIds: ['wheat'] })).arrays));
    expect(months.size, 'distinct field looks across the year').toBeGreaterThanOrEqual(6);
    const ripe = run(farm, params({ month: 8, productIds: ['wheat'] })).arrays;
    let gold = 0;
    for (let i = 0; i < ripe.vertexCount; i++) if (ripe.color[i * 4] === WORLD_RGB.crops.wheat[0] && ripe.color[i * 4 + 1] === WORLD_RGB.crops.wheat[1]) gold++;
    expect(gold, 'ripe wheat rows in August').toBeGreaterThanOrEqual(40);
  });

  it('shade trees follow the season (bare in winter, autumn colours in Sep–Nov); coffee shade trees stay green', () => {
    const farm = factoryFor('large_farm')!;
    const colours = (m: number) => new Set((run(farm, params({ month: m })).out.props.shadeTree ?? []).map((t) => String(t.color)));
    const winter = colours(1), autumn = colours(10), summer = colours(7);
    expect(winter.size).toBe(1); // all bare
    expect([...autumn].some((c) => !summer.has(c))).toBe(true);
    expect([...winter].some((c) => summer.has(c))).toBe(false);
    const plantation = factoryFor('small_plantation')!;
    const coffeeWinter = (run(plantation, params({ month: 1, productIds: ['coffee_beans'] })).out.props.shadeTree ?? []).map((t) => String(t.color));
    expect(coffeeWinter.length).toBeGreaterThan(5);
    const [bare] = [...winter];
    expect(coffeeWinter.includes(bare), 'evergreen shade trees never go bare').toBe(false);
    for (const list of Object.values(run(farm, params({ month: 4 })).out.props)) for (const t of list) if (t.color !== undefined) expect(String(t.color)).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('plantation: coffee cherries Sep–Nov, hop bines by month', () => {
    const plantation = factoryFor('small_plantation')!;
    const coffee = (m: number) => run(plantation, params({ month: m, productIds: ['coffee_beans'] })).out.props;
    expect(coffee(10).coffeeShrubCherry?.length ?? 0).toBeGreaterThan(100);
    expect(coffee(6).coffeeShrubCherry ?? []).toHaveLength(0);
    expect(coffee(6).coffeeShrub?.length ?? 0).toBeGreaterThan(100);
    // bines (vegetation-flagged curtains) stand in summer and are gone in winter
    const vegetation = (m: number) => {
      const a = run(plantation, params({ month: m, productIds: ['hops'] })).arrays;
      let n = 0;
      for (let i = 0; i < a.vertexCount; i++) if (a.extra[i * 4 + 1] & 2) n++;
      return n;
    };
    expect(vegetation(7)).toBeGreaterThan(100);
    expect(vegetation(2)).toBe(0);
  });
});

describe('construction sites (art §4.1 stages)', () => {
  const lot3 = lotFrame(0, 0, 3, 3);

  it('stage A: hoarding, excavator with an animated arm, dump truck, dust', () => {
    const out = buildConstructionSite(new GeoBuilder(), lot3, [3, 3], 'foundation', 0.1, 20, { owner: 2 });
    expect(out.props.excavatorBody).toHaveLength(1);
    expect(out.props.dumpTruck).toHaveLength(1);
    expect(out.animated.map((p) => p.kind)).toContain('excavatorArm');
    expect(out.emitters.some((e) => e.kind === 'dust' && e.rate > 0)).toBe(true);
    expect(out.signs.length).toBeGreaterThan(0);
  });

  it('stage B: a tower crane (owner counterweight) over tall buildings, a mobile crane over low ones', () => {
    const tall = buildConstructionSite(new GeoBuilder(), lot3, [3, 3], 'structure', 0.5, 30, { owner: 2 });
    const jib = tall.animated.find((p) => p.kind === 'craneJib');
    expect(jib).toBeDefined();
    expect(jib!.owner).toBe(2);
    expect(jib!.active).toBe(true);
    const low = buildConstructionSite(new GeoBuilder(), lot3, [3, 3], 'structure', 0.5, 8, { owner: 2 });
    expect(low.animated.find((p) => p.kind === 'craneJib')).toBeUndefined();
    expect(low.props.mobileCrane).toHaveLength(1);
  });

  it('the frame rises with progress through stage B', () => {
    let last = -1;
    for (const p of [0.3, 0.45, 0.6, 0.75, 0.84]) {
      const b = new GeoBuilder();
      buildConstructionSite(b, lot3, [3, 3], 'structure', p, 30, { owner: 1, frame: true });
      const a = b.finish();
      // ignore the crane: measure the highest concrete-coloured vertex
      let top = 0;
      const [r, g, bl] = WORLD_RGB.wall.concrete;
      for (let i = 0; i < a.vertexCount; i++) if (a.color[i * 4] === r && a.color[i * 4 + 1] === g && a.color[i * 4 + 2] === bl) top = Math.max(top, a.position[i * 3 + 1]);
      expect(top).toBeGreaterThan(last);
      last = top;
    }
  });

  it('stage C: crane gone at p ≥ 0.95, hoarding replaced by landscaping at p ≥ 0.98', () => {
    const late = buildConstructionSite(new GeoBuilder(), lot3, [3, 3], 'finishing', 0.96, 30, { owner: 1 });
    expect(late.animated.find((p) => p.kind === 'craneJib')).toBeUndefined();
    expect(late.signs.length).toBeGreaterThan(0);
    const done = buildConstructionSite(new GeoBuilder(), lot3, [3, 3], 'finishing', 0.99, 30, { owner: 1 });
    expect(done.signs).toHaveLength(0);
  });

  it('accepts a footprint in plots or an explicit building rect, any lot size, and returns nothing to draw when complete', () => {
    for (const fp of [[1, 1], [2, 2], [4, 4], [5, 5], [5, 3]] as const) {
      const lot = lotFrame(50, 50, fp[0], fp[1], 'E');
      for (const stage of STAGES_BUILDING) {
        const b = new GeoBuilder();
        const out = buildConstructionSite(b, lot, fp, stage, PROGRESS[stage as 'foundation'][1], 14);
        const a = b.finish();
        expect(a.triangleCount).toBeLessThanOrEqual(CONSTRUCTION.triBudget.lod0);
        checkInsideLot('construction', lot, a);
        checkOutputs(CONSTRUCTION, lot, { arrays: a, out, b }, params({ stage }));
      }
    }
    const rect = buildConstructionSite(new GeoBuilder(), lot3, { x0: -20, z0: -25, x1: 10, z1: 5 }, 'structure', 0.6, 40);
    expect(rect.animated.some((p) => p.kind === 'craneJib')).toBe(true);
    const b = new GeoBuilder();
    const none = buildConstructionSite(b, lot3, [3, 3], 'complete', 1, 20);
    expect(b.triangleCount).toBe(0);
    expect(none.animated).toHaveLength(0);
  });

  it('level upgrades: a mini stage-B overlay on the extension masses only, inside the lot and the budget', () => {
    for (const [typeId, levels] of Object.entries(LEVEL_EXTENSIONS)) {
      const f = factoryFor(typeId)!;
      expect(f, typeId).toBeDefined();
      for (const level of [2, 3] as const) {
        expect(levels[level]?.length ?? 0, `${typeId} L${level}`).toBeGreaterThan(0);
        for (const variant of [0, 1]) {
          for (const progress of [0, 0.5, 0.99]) {
            const lot = lotOf(f, variant ? 'E' : 'S');
            const b = new GeoBuilder();
            const out = buildUpgradeSite(b, lot, typeId, level, progress, { seed: 7, variant, owner: 2, lod: 0 });
            const a = b.finish();
            expect(a.triangleCount, `${typeId} L${level}`).toBeGreaterThan(0);
            expect(a.triangleCount, `${typeId} L${level}`).toBeLessThanOrEqual(f.triBudget.lod0);
            checkInsideLot(typeId, lot, a);
            checkWinding(`${typeId} upgrade`, a);
            checkOutputs(f, lot, { arrays: a, out, b }, params({ stage: 'structure', variant }));
            if (progress < 0.95) expect(out.props.mobileCrane, `${typeId} crane`).toHaveLength(1);
          }
        }
      }
    }
    const none = buildUpgradeSite(new GeoBuilder(), lot3, 'warehouse_small', 2, 0.5, { seed: 1, variant: 0, owner: 0, lod: 0 });
    expect(none.animated).toHaveLength(0);
  });

  it('uses the owner of the shared builder when no owner option is given', () => {
    const b = new GeoBuilder();
    b.owner = 5;
    const out = buildConstructionSite(b, lot3, [3, 3], 'structure', 0.5, 30);
    expect(out.animated.find((p) => p.kind === 'craneJib')?.owner).toBe(5);
    expect(b.owner).toBe(5);
  });
});
