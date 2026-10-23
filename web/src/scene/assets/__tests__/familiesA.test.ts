// W3 asset families: determinism, triangle budgets, bounds, owner paint rules and prop families
// (art-rendering §4.1 conventions, §5.24 testing). Pure Node: GeoBuilder needs no GPU.
import { describe, expect, it } from 'vitest';
import type { AssetFactory, AssetOutput, AssetParams, LotFrame, Stage } from '../AssetFactory';
import { Facade, GeoBuilder, type BuiltArrays } from '../GeoBuilder';
import { FAMILIES_A, PROP_FAMILIES, PROP_IDS } from '../familiesA';
import { FLAG_OWNER_ROOF, FLAG_PAVED, FLAG_SNOWABLE, FLAG_VEGETATION } from '../../materials/CityMaterial';
import { FAC, FL_OWNER_ROOF, FL_PAVED, FL_SNOW, FL_VEG, PLOT_M } from '../families/common-a/constants';
import { PLOT_SIZE } from '../../units';

const EPS = 1e-3;
const isCompany = (f: AssetFactory) => !f.id.startsWith('ambient:');

interface Run {
  arrays: BuiltArrays;
  out: AssetOutput;
  lotRect: [number, number, number, number]; // world minX, minZ, maxX, maxZ
}

function lotFor(fw: number, fh: number, qt: 0 | 1 | 2 | 3, cx = 312, cz = -168): LotFrame {
  const facing = (['S', 'E', 'N', 'W'] as const)[qt];
  return { cx, cz, widthM: fw * PLOT_SIZE, depthM: fh * PLOT_SIZE, facing, quarterTurns: qt };
}

function params(over: Partial<AssetParams> = {}): AssetParams {
  return { seed: 1234567, variant: 0, level: 1, stage: 'complete', progress: 1, owner: 2, utilization: 0.7, lod: 0, season: 1, ...over };
}

function run(f: AssetFactory, lot: LotFrame, p: AssetParams, presetOwner = p.owner): Run {
  const b = new GeoBuilder();
  b.owner = presetOwner; // the gallery and the chunk worker may leave any owner on the shared builder
  b.flags = 0;
  const out = f.build(b, lot, p);
  // the factory must restore the caller's builder state
  expect(b.owner).toBe(presetOwner);
  expect(b.ownerRoof).toBe(false);
  expect(b.flags).toBe(0);
  expect(b.tint).toBe(255);
  const odd = (lot.quarterTurns & 1) === 1;
  const wx = (odd ? lot.depthM : lot.widthM) / 2, wz = (odd ? lot.widthM : lot.depthM) / 2;
  return { arrays: b.finish(), out, lotRect: [lot.cx - wx, lot.cz - wz, lot.cx + wx, lot.cz + wz] };
}

function inRect(x: number, z: number, r: Run['lotRect'], eps = EPS): boolean {
  return x >= r[0] - eps && x <= r[2] + eps && z >= r[1] - eps && z <= r[3] + eps;
}

/** Every structural invariant of one build. Returns a short failure description or null. */
function check(f: AssetFactory, r: Run, p: AssetParams): string | null {
  const { arrays: a, out, lotRect } = r;
  const tag = `${f.id} v${p.variant} lod${p.lod} ${p.stage} L${p.level}`;
  if (a.triangleCount <= 0) return `${tag}: no triangles`;
  const budget = p.lod === 1 ? f.triBudget.lod1 : f.triBudget.lod0;
  if (a.triangleCount > budget) return `${tag}: ${a.triangleCount} triangles > budget ${budget}`;
  const [bx0, by0, bz0, bx1, by1, bz1] = out.pickBox;
  if (![bx0, by0, bz0, bx1, by1, bz1].every(Number.isFinite)) return `${tag}: non-finite pick box`;
  if (by1 <= 0) return `${tag}: pick box has no height`;
  if (!inRect(bx0, bz0, lotRect) || !inRect(bx1, bz1, lotRect)) return `${tag}: pick box outside the lot`;
  const P = a.position;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return `${tag}: NaN vertex ${i / 3}`;
    if (y < -EPS) return `${tag}: vertex below ground (${y})`;
    if (!inRect(x, z, lotRect)) return `${tag}: vertex ${i / 3} (${x.toFixed(2)}, ${z.toFixed(2)}) outside lot ${lotRect.map((v) => v.toFixed(1))}`;
    if (x < bx0 - EPS || x > bx1 + EPS || y < by0 - EPS || y > by1 + EPS || z < bz0 - EPS || z > bz1 + EPS) return `${tag}: vertex ${i / 3} outside pick box`;
  }
  for (const v of a.fuv) if (!Number.isFinite(v)) return `${tag}: NaN facade uv`;
  for (const [id, list] of Object.entries(out.props)) {
    if (!(PROP_IDS as readonly string[]).includes(id)) return `${tag}: unknown prop family ${id}`;
    const fam = PROP_FAMILIES[id as keyof typeof PROP_FAMILIES];
    for (const it of list) {
      if (![it.x, it.z, it.rotY, it.scale].every(Number.isFinite) || it.scale <= 0) return `${tag}: bad ${id} instance`;
      if (!inRect(it.x, it.z, lotRect)) return `${tag}: ${id} instance outside the lot`;
      if (fam.needsColor && (typeof it.color !== 'string' || !/^#[0-9A-F]{6}$/i.test(it.color))) return `${tag}: ${id} instance without a colour`;
    }
  }
  if (p.lod === 1 && Object.keys(out.props).length > 0) return `${tag}: props at LOD1`;
  for (const s of out.signs) {
    if (s.corners.length !== 4 || !s.corners.every((c) => c.every(Number.isFinite))) return `${tag}: bad sign quad`;
    if (!s.corners.every((c) => inRect(c[0], c[2], lotRect) && c[1] >= 0)) return `${tag}: sign outside the lot`;
  }
  if (p.stage === 'closed' && (out.signs.length || out.lightPools.length || out.emitters.length || out.animated.length)) return `${tag}: closed building still lit or animated`;
  for (const l of out.lightPools) if (!inRect(l.x, l.z, lotRect) || !(l.radius > 0)) return `${tag}: bad light pool`;
  for (const e of out.emitters) if (!inRect(e.x, e.z, lotRect) || !(e.rate > 0)) return `${tag}: bad emitter`;
  for (const m of out.animated) if (!inRect(m.x, m.z, lotRect)) return `${tag}: animated part outside the lot`;
  // owner paint rules (art §3.4 / §4.1)
  const E = a.extra;
  let roofFlags = 0;
  for (let i = 0; i < E.length; i += 4) {
    const owner = E[i + 2], flags = E[i + 1];
    if (flags & FL_OWNER_ROOF) roofFlags++;
    if (!isCompany(f)) {
      if (owner !== 255) return `${tag}: ambient building carries owner index ${owner}`;
      if (flags & FL_OWNER_ROOF) return `${tag}: ambient building has an owner roof`;
    } else {
      const expected = p.owner >= 0 && p.owner <= 7 ? p.owner : 255;
      if (owner !== expected) return `${tag}: owner index ${owner}, expected ${expected}`;
    }
  }
  if (isCompany(f) && p.owner >= 0 && p.owner <= 7 && roofFlags === 0) return `${tag}: company building without owner-roof faces`;
  return null;
}

const VARIANTS = 8;

describe('W3 families: registry', () => {
  it('registers factories with unique ids, footprints and budgets', () => {
    const ids = FAMILIES_A.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FAMILIES_A) {
      expect(f.footprints.length).toBeGreaterThan(0);
      expect(f.triBudget.lod1).toBeLessThan(f.triBudget.lod0);
      if (!isCompany(f)) expect(f.id).toMatch(/^ambient:[a-z_]+(:[a-z_]+)?$/);
    }
  });

  it('keeps worker-side constants in sync with CityMaterial and GeoBuilder', () => {
    expect(FL_OWNER_ROOF).toBe(FLAG_OWNER_ROOF);
    expect(FL_VEG).toBe(FLAG_VEGETATION);
    expect(FL_PAVED).toBe(FLAG_PAVED);
    expect(FL_SNOW).toBe(FLAG_SNOWABLE);
    expect(PLOT_M).toBe(PLOT_SIZE);
    expect(FAC.HOUSE).toBe(Facade.HOUSE);
    expect(FAC.APARTMENT).toBe(Facade.APARTMENT);
    expect(FAC.CURTAIN).toBe(Facade.CURTAIN);
    expect(FAC.SHOP).toBe(Facade.SHOP);
    expect(FAC.INDUSTRIAL).toBe(Facade.INDUSTRIAL);
    expect(FAC.OFFICE).toBe(Facade.OFFICE);
  });
});

describe.each(FAMILIES_A.map((f) => [f.id, f] as const))('%s', (_id, f) => {
  it('fits every footprint, variant, LOD, stage and level inside its lot and budget', () => {
    const failures: string[] = [];
    const stages: Stage[] = ['complete', 'closed'];
    for (const [fw, fh] of f.footprints) {
      for (let v = 0; v < VARIANTS; v++) {
        for (const lod of [0, 1] as const) {
          for (const stage of stages) {
            for (const level of [1, 2, 3] as const) {
              const qt = ((v + level) & 3) as 0 | 1 | 2 | 3;
              const p = params({ seed: 7919 * (v + 1) + fw * 31 + fh, variant: v, lod, stage, level, owner: v % 9 === 8 ? 255 : v % 8, season: (v & 3) as 0 | 1 | 2 | 3, utilization: (v % 4) / 3 });
              const err = check(f, run(f, lotFor(fw, fh, qt), p, 5), p);
              if (err) failures.push(err);
            }
          }
        }
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });

  it('honours engine-provided floors (FamilyParams.floors) without leaving the lot or the budget', () => {
    const failures: string[] = [];
    for (const [fw, fh] of f.footprints) {
      for (const floors of [1, 3, 8, 15, 40, 60, 99]) {
        for (const lod of [0, 1] as const) {
          for (let v = 0; v < 8; v++) {
            const p = { ...params({ seed: 31 * floors + v, variant: v, lod, owner: v % 8 }), floors };
            const err = check(f, run(f, lotFor(fw, fh, (v & 3) as 0 | 1 | 2 | 3), p, 7), p);
            if (err) failures.push(`${err} (floors ${floors})`);
          }
        }
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });

  it('is deterministic: identical inputs give byte-identical arrays and outputs', () => {
    const [fw, fh] = f.footprints[f.footprints.length - 1];
    for (const v of [0, 3, 5]) {
      const p = params({ seed: 99991 + v, variant: v, owner: 4, season: 2 });
      const lot = lotFor(fw, fh, 1, -48, 96);
      const a = run(f, lot, p), b = run(f, lot, p);
      for (const k of ['position', 'normal', 'color', 'fuv', 'facade', 'extra', 'index'] as const) {
        expect(Buffer.from(a.arrays[k].buffer, a.arrays[k].byteOffset, a.arrays[k].byteLength).equals(Buffer.from(b.arrays[k].buffer, b.arrays[k].byteOffset, b.arrays[k].byteLength))).toBe(true);
      }
      expect(JSON.stringify(a.out)).toBe(JSON.stringify(b.out));
    }
  });

  it('varies with the seed and variant', () => {
    const [fw, fh] = f.footprints[0];
    const lot = lotFor(fw, fh, 0, 0, 0);
    const a = run(f, lot, params({ seed: 11, variant: 0 })).arrays;
    const b = run(f, lot, params({ seed: 977, variant: 1 })).arrays;
    const same = a.position.length === b.position.length && a.position.every((x, i) => x === b.position[i]) && a.color.every((x, i) => x === b.color[i]);
    expect(same).toBe(false);
  });

  it('rotates with the lot: the world footprint swaps on quarter turns', () => {
    const [fw, fh] = f.footprints[0];
    for (const qt of [0, 1, 2, 3] as const) {
      const r = run(f, lotFor(fw, fh, qt, 0, 0), params({ variant: 2 }));
      const [x0, , z0, x1, , z1] = r.out.pickBox;
      const odd = (qt & 1) === 1;
      expect(x1 - x0).toBeLessThanOrEqual((odd ? fh : fw) * PLOT_SIZE + EPS);
      expect(z1 - z0).toBeLessThanOrEqual((odd ? fw : fh) * PLOT_SIZE + EPS);
    }
  });
});

describe('W3 prop families', () => {
  it.each(PROP_IDS.map((id) => [id]))('%s stays within budget, on the ground and deterministic', (id) => {
    const fam = PROP_FAMILIES[id];
    expect(fam.id).toBe(id);
    for (const lod of [0, 1] as const) {
      const b1 = new GeoBuilder(), b2 = new GeoBuilder();
      fam.build(b1, lod);
      fam.build(b2, lod);
      const a = b1.finish(), b = b2.finish();
      expect(a.triangleCount).toBeLessThanOrEqual(lod === 0 ? fam.triBudget.lod0 : fam.triBudget.lod1);
      if (lod === 0) expect(a.triangleCount).toBeGreaterThan(0);
      expect(Array.from(a.position)).toEqual(Array.from(b.position));
      for (let i = 0; i < a.position.length; i += 3) {
        expect(Number.isFinite(a.position[i]) && Number.isFinite(a.position[i + 1]) && Number.isFinite(a.position[i + 2])).toBe(true);
        expect(a.position[i + 1]).toBeGreaterThanOrEqual(-EPS);
      }
      for (let i = 0; i < a.extra.length; i += 4) expect(a.extra[i + 2]).toBe(255);
    }
  });

  it('marks tinted crowns and bodies with tint weight 255 and leaves lamps untinted', () => {
    for (const id of ['tree.deciduous', 'tree.conifer', 'car.parked'] as const) {
      const b = new GeoBuilder();
      PROP_FAMILIES[id].build(b, 0);
      const a = b.finish();
      let tinted = 0;
      for (let i = 3; i < a.color.length; i += 4) if (a.color[i] === 255) tinted++;
      expect(tinted).toBeGreaterThan(0);
    }
    const b = new GeoBuilder();
    PROP_FAMILIES['lamp.street'].build(b, 0);
    const a = b.finish();
    let emissive = 0;
    for (let i = 0; i < a.extra.length; i += 4) if (a.extra[i] > 0) emissive++;
    expect(emissive).toBeGreaterThan(0);
  });
});
