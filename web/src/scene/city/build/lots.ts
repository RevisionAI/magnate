// Lots: every parcel (ambient development from the layout, or a vacant lot) and every company building (bridge
// cityView placement) — ground pad on its terrace, retaining walls on its higher sides, and the building from the
// asset registry (W3/W4 factories), built twice (LOD0 near mesh, LOD1 far mesh). Props, signs, light pools,
// emitters, animated parts and the pick box come from the LOD0 build (status w3-assets-a §3.2).
import type { AssetFactory, AssetOutput, AssetParams, LotFrame, Stage } from '../../assets/AssetFactory';
import { lotFrame, seasonOfMonth } from '../../assets/AssetFactory';
import type { GeoBuilder, RGB } from '../../assets/GeoBuilder';
import { WORLD_RGB, mixRgb, ownerRgb, shade } from '../../assets/palette';
import type { FamilyParams } from '../../assets/familiesA';
import { factoryFor } from '../../assets/registry';
import { fnv1a } from '../../assets/shapes';
import { FLAG_PAVED, FLAG_SNOWABLE, FLAG_VEGETATION } from '../../materials/CityMaterial';
import { hash3 } from '../../env/rng';
import { PLOT_SIZE } from '../../units';
import {
  D_APARTMENTS, D_CBD, D_CIVIC, D_COMMERCIAL, D_HOUSES, D_INDUSTRIAL, D_MIXED, D_PARK, D_PORT, D_RURAL, isWaterKind,
  type ParcelInfo,
} from '../layout/types';
import type { CompanySpec } from '../chunkProtocol';
import type { CityBuildContext } from './CityBuildContext';
import type { ChunkWriter } from './ChunkWriter';
import { sideWalls } from './ground';
import { rectUp } from './prims';
import * as R from './rural';

const FACING = ['S', 'E', 'N', 'W'] as const;

/** Kinds whose look follows the month (crop calendar): their chunks rebuild when the month changes. */
const MONTHLY_KINDS: ReadonlySet<string> = new Set(['field', 'orchard', 'vineyard', 'pasture']);
const MONTHLY_TYPES: ReadonlySet<string> = new Set(['small_farm', 'large_farm', 'small_plantation']);

/** Lot frame for a world-aligned rectangle of plots facing `turns`. */
export function lotFor(ctx: CityBuildContext, px: number, pz: number, w: number, h: number, turns: 0 | 1 | 2 | 3): LotFrame {
  const cx = ctx.x0(px) + (w * PLOT_SIZE) / 2, cz = ctx.z0(pz) + (h * PLOT_SIZE) / 2;
  // lotFrame takes the content footprint (widthM along the street); odd turns swap the world extents.
  return turns % 2 === 0 ? lotFrame(cx, cz, w, h, FACING[turns], PLOT_SIZE) : lotFrame(cx, cz, h, w, FACING[turns], PLOT_SIZE);
}

/** A smaller lot of fw × fd metres (lot frame) inside `lot`, pushed to its street front. */
function subLot(lot: LotFrame, fwM: number, fdM: number): LotFrame {
  const dz = (lot.depthM - fdM) / 2;
  const c = Math.round(Math.cos((lot.quarterTurns * Math.PI) / 2)), s = Math.round(Math.sin((lot.quarterTurns * Math.PI) / 2));
  return { cx: lot.cx + dz * s, cz: lot.cz + dz * c, widthM: fwM, depthM: fdM, facing: lot.facing, quarterTurns: lot.quarterTurns };
}

// ------------------------------------------------------------------------------------------------- ambient kinds

interface AmbientPlan {
  /** Registered factory, or a Kit lot builder. */
  factory?: AssetFactory;
  fn?: R.LotFn;
  lot: LotFrame;
  params: AssetParams;
  /** Base ground under the lot (before the factory's own yard). */
  base: RGB;
  baseFlags: number;
  monthly: boolean;
}

function baseGround(district: number, kind: string | null): { rgb: RGB; flags: number } {
  const G = WORLD_RGB.ground, Rd = WORLD_RGB.road;
  const veg = FLAG_VEGETATION | FLAG_SNOWABLE, paved = FLAG_PAVED | FLAG_SNOWABLE;
  if (kind === 'park' || kind === 'forest' || kind === 'orchard') return { rgb: G.park, flags: veg };
  if (kind === 'plaza' || kind === 'parking' || kind === 'office' || kind === 'shop' || kind === 'midrise' || kind === 'strip_mall') return { rgb: Rd.plaza, flags: paved };
  if (kind === 'factory' || kind === 'warehouse' || kind === 'tank_farm' || kind === 'civic:port') return { rgb: Rd.parking, flags: paved };
  switch (district) {
    case D_CBD: case D_COMMERCIAL: case D_MIXED: return { rgb: Rd.plaza, flags: paved };
    case D_INDUSTRIAL: case D_PORT: return { rgb: mixRgb(G.gravel, Rd.parking, 0.5), flags: paved };
    case D_RURAL: return { rgb: G.meadow, flags: veg };
    case D_PARK: return { rgb: G.park, flags: veg };
    case D_CIVIC: return { rgb: G.grass, flags: veg };
    default: return { rgb: G.yard, flags: veg };
  }
}

/** Biggest W4 building of `ids` whose footprint fits the lot (lot frame metres), as a sub-lot at the street front. */
function fitting(lot: LotFrame, ids: readonly string[]): { factory: AssetFactory; lot: LotFrame } | null {
  for (const id of ids) {
    const f = factoryFor(id);
    if (!f) continue;
    const [fw, fh] = f.footprints[0];
    if (fw * PLOT_SIZE <= lot.widthM + 0.01 && fh * PLOT_SIZE <= lot.depthM + 0.01) return { factory: f, lot: subLot(lot, fw * PLOT_SIZE, fh * PLOT_SIZE) };
  }
  return null;
}

/** Facing of a port lot: towards adjacent water (a seaport's +Z must face the water, art §5.3). */
function waterFacing(ctx: CityBuildContext, p: ParcelInfo): 0 | 1 | 2 | 3 {
  const score = [0, 0, 0, 0];
  for (let x = p.px; x < p.px + p.w; x++) {
    if (isWaterKind(ctx.kindAt(x, p.pz + p.h))) score[0]++;
    if (isWaterKind(ctx.kindAt(x, p.pz - 1))) score[2]++;
  }
  for (let z = p.pz; z < p.pz + p.h; z++) {
    if (isWaterKind(ctx.kindAt(p.px + p.w, z))) score[1]++;
    if (isWaterKind(ctx.kindAt(p.px - 1, z))) score[3]++;
  }
  let best = p.facing as number;
  for (let k = 0; k < 4; k++) if (score[k] > score[best]) best = k;
  return best as 0 | 1 | 2 | 3;
}

function planAmbient(ctx: CityBuildContext, p: ParcelInfo, month: number): AmbientPlan {
  const kind = p.ambient?.kind ?? null;
  const lot = lotFor(ctx, p.px, p.pz, p.w, p.h, p.facing);
  const base = baseGround(p.district, kind);
  const seedId = kind ?? 'vacant';
  const params: FamilyParams = {
    seed: fnv1a(ctx.grid.cityId, p.px, p.pz, seedId), variant: p.ambient?.variant ?? 0, level: 1, stage: 'complete', progress: 1,
    owner: 255, utilization: 0.7, lod: 0, season: seasonOfMonth(month), month,
  };
  if (p.ambient && p.ambient.floors > 0) params.floors = p.ambient.floors;
  const plan: AmbientPlan = { lot, params, base: base.rgb, baseFlags: base.flags, monthly: kind !== null && MONTHLY_KINDS.has(kind) };
  const climate = ctx.grid.climate;
  if (kind === null) {
    const d = p.district;
    const urban = d === D_CBD || d === D_COMMERCIAL || d === D_MIXED;
    const parking = factoryFor('ambient:parking');
    // Vacant downtown lots are mostly surface car parks (the player's future sites), the rest fenced gravel.
    if (urban && parking && hash3(p.px, p.pz, ctx.grid.seed, 61) < 0.55 && p.w * p.h <= 9) {
      plan.factory = parking;
      plan.params.variant = 0;
      plan.params.utilization = 0.35 + 0.5 * hash3(p.pz, p.px, ctx.grid.seed, 62);
      plan.base = WORLD_RGB.road.parking;
      return plan;
    }
    plan.fn = R.vacant(d === D_HOUSES || d === D_APARTMENTS || d === D_PARK || d === D_RURAL ? 'lawn' : d === D_INDUSTRIAL || d === D_PORT ? 'yard' : 'gravel');
    return plan;
  }
  const registered = factoryFor(`ambient:${kind}`);
  if (registered) { plan.factory = registered; return plan; }
  switch (kind) {
    case 'field': plan.fn = R.field(climate, p.ambient?.variant ?? 0); return plan;
    case 'pasture': plan.fn = R.pasture; return plan;
    case 'orchard': plan.fn = R.orchard; return plan;
    case 'vineyard': plan.fn = R.vineyard; return plan;
    case 'scrub': plan.fn = R.scrub; return plan;
    case 'forest': plan.fn = R.forest; return plan;
    case 'tank_farm': plan.fn = R.tankFarm; return plan;
    case 'factory': case 'warehouse': {
      const ids = kind === 'factory' ? ['factory_large', 'factory_small', 'warehouse_small'] : ['warehouse_large', 'warehouse_small'];
      const fit = fitting(lot, ids);
      if (fit) { plan.factory = fit.factory; plan.lot = fit.lot; } else plan.fn = R.shed;
      return plan;
    }
    case 'civic:port': {
      const turns = waterFacing(ctx, p);
      const portLot = lotFor(ctx, p.px, p.pz, p.w, p.h, turns);
      const fit = fitting(portLot, ['seaport']);
      if (fit) { plan.factory = fit.factory; plan.lot = fit.lot; } else plan.fn = R.vacant('yard');
      return plan;
    }
  }
  if (kind.startsWith('deposit:')) { plan.fn = kind === 'deposit:oil' ? R.oilDeposit : R.ironDeposit; return plan; }
  // Unknown kinds (art §5.3): built-looking kinds fall back to a house, open ones to a park.
  const open = /park|green|garden|field|land|lot|open/.test(kind);
  plan.factory = factoryFor(open ? 'ambient:park' : 'ambient:house');
  if (!plan.factory) plan.fn = R.vacant('lawn');
  return plan;
}

function runPlan(b: GeoBuilder, plan: AmbientPlan, lod: 0 | 1): AssetOutput {
  const p = { ...plan.params, lod };
  if (plan.factory) return plan.factory.build(b, plan.lot, p);
  return R.kitBuild(b, plan.lot, p, plan.fn ?? R.vacant('lawn'));
}

/** One parcel: base ground on its terrace (plots not under a company), walls, and its ambient development. */
export function buildParcel(ctx: CityBuildContext, w: ChunkWriter, p: ParcelInfo, month: number): void {
  const T = ctx.terrace[p.index];
  const covered = ctx.parcelCovered(p);
  const plan = planAmbient(ctx, p, month);
  const shadeK = 0.97 + 0.05 * hash3(p.px, p.pz, ctx.grid.seed, 11);
  w.both((b) => {
    b.flags = plan.baseFlags;
    for (let z = p.pz; z < p.pz + p.h; z++) {
      for (let x = p.px; x < p.px + p.w; x++) {
        if (ctx.coveredBy(x, z) >= 0) continue;
        rectUp(b, ctx.x0(x), ctx.z0(z), ctx.x0(x) + PLOT_SIZE, ctx.z0(z) + PLOT_SIZE, 0, shade(plan.base, shadeK));
      }
    }
  }, null, T);
  const same = (nx: number, nz: number) => ctx.parcelOf(nx, nz)?.index === p.index && ctx.coveredBy(nx, nz) < 0;
  for (let z = p.pz; z < p.pz + p.h; z++) {
    for (let x = p.px; x < p.px + p.w; x++) {
      if (ctx.coveredBy(x, z) >= 0) continue;
      sideWalls(ctx, w, x, z, () => [T, T], same);
    }
  }
  if (covered) {
    // A company building takes part of the parcel: the rest stays open land, plot by plot — a paved apron on the plots
    // touching the building in town, the district's vacant ground (gravel, yard or lawn) beyond it.
    const d = p.district;
    const urban = d === D_CBD || d === D_COMMERCIAL || d === D_MIXED;
    const far = d === D_INDUSTRIAL || d === D_PORT || d === D_RURAL ? 'yard' : urban ? 'gravel' : 'lawn';
    const touches = (x: number, z: number) => ctx.coveredBy(x + 1, z) >= 0 || ctx.coveredBy(x - 1, z) >= 0 || ctx.coveredBy(x, z + 1) >= 0 || ctx.coveredBy(x, z - 1) >= 0;
    for (let z = p.pz; z < p.pz + p.h; z++) {
      for (let x = p.px; x < p.px + p.w; x++) {
        if (ctx.coveredBy(x, z) >= 0) continue;
        const fn = R.remnant(urban && touches(x, z) ? 'paved' : far);
        const lot = lotFor(ctx, x, z, 1, 1, p.facing);
        const params: FamilyParams = {
          seed: fnv1a(ctx.grid.cityId, x, z, 'remnant'), variant: 0, level: 1, stage: 'complete', progress: 1, owner: 255,
          utilization: 0.7, lod: 0, season: seasonOfMonth(month), month,
        };
        let out: AssetOutput | null = null;
        w.both((b, lod) => {
          const o = R.kitBuild(b, lot, { ...params, lod }, fn);
          if (lod === 0) out = o;
        }, null, T);
        if (out) w.collect(out, T, null, 255, null);
      }
    }
    return;
  }
  if (plan.monthly) w.monthly = true;
  let out: AssetOutput | null = null;
  w.both((b, lod) => {
    const o = runPlan(b, plan, lod);
    if (lod === 0) out = o;
  }, null, T);
  if (out) w.collect(out, T, null, 255, { kind: 'ambient', id: p.id, box: [0, 0, 0, 0, 0, 0] });
}

// ------------------------------------------------------------------------------------------------- companies

const CATEGORY_HEIGHT: Readonly<Record<string, number>> = {
  convenience_store: 6, supermarket: 9, department_store: 24, factory: 14, warehouse: 12, farm: 8, plantation: 8,
  mine: 30, oil_well: 12, seaport: 30, media: 20, rd_center: 18, headquarters: 60,
};

/** Company building: pad on its terrace, walls, factory (or construction site) build. */
export function buildCompany(ctx: CityBuildContext, w: ChunkWriter, c: CompanySpec, month: number): void {
  const T = ctx.companyTerrace.get(c.id) ?? 0;
  const industrial = c.category === 'factory' || c.category === 'warehouse' || c.category === 'seaport' || c.category === 'mine' || c.category === 'oil_well';
  const rural = c.category === 'farm' || c.category === 'plantation';
  const pad: RGB = industrial ? WORLD_RGB.road.parking : rural ? WORLD_RGB.ground.meadow : WORLD_RGB.road.plaza;
  w.both((b) => {
    b.flags = rural ? FLAG_VEGETATION | FLAG_SNOWABLE : FLAG_PAVED | FLAG_SNOWABLE;
    for (let z = c.pz; z < c.pz + c.h; z++) {
      for (let x = c.px; x < c.px + c.w; x++) {
        if (ctx.coveredBy(x, z) !== c.id) continue;
        rectUp(b, ctx.x0(x), ctx.z0(z), ctx.x0(x) + PLOT_SIZE, ctx.z0(z) + PLOT_SIZE, 0, pad);
      }
    }
  }, null, T);
  const same = (nx: number, nz: number) => ctx.coveredBy(nx, nz) === c.id;
  for (let z = c.pz; z < c.pz + c.h; z++) {
    for (let x = c.px; x < c.px + c.w; x++) if (ctx.coveredBy(x, z) === c.id) sideWalls(ctx, w, x, z, () => [T, T], same);
  }

  if (MONTHLY_TYPES.has(c.typeId)) w.monthly = true;
  let out: AssetOutput | null = null;
  w.both((b, lod) => {
    const o = buildCompanyStructure(ctx, b, c, month, lod);
    if (lod === 0) out = o;
  }, null, T);
  if (out) w.collect(out, T, c.id, c.owner, { kind: 'company', id: c.id, box: [0, 0, 0, 0, 0, 0] });
}

/**
 * The company building itself (registered factory, construction site, or the stand-in) written at y = 0 into `b`,
 * without its pad and retaining walls: the chunk builder lifts it by the terrace, and the interaction layer's outline
 * object is built from it on the main thread.
 */
export function buildCompanyStructure(ctx: CityBuildContext, b: GeoBuilder, c: CompanySpec, month: number, lod: 0 | 1): AssetOutput {
  const lot = lotFor(ctx, c.px, c.pz, c.w, c.h, c.turns);
  const stage: Stage = c.stage;
  const building = stage !== 'complete' && stage !== 'closed';
  const factory = building ? factoryFor('construction') : factoryFor(c.typeId);
  const params: FamilyParams = {
    seed: fnv1a(ctx.grid.cityId, c.px, c.pz, c.typeId), variant: hash3(c.id, 1, 2) < 0.5 ? 0 : 1, level: c.level, stage,
    progress: building ? c.progress : 1, owner: c.owner, utilization: c.utilization, lod, season: seasonOfMonth(month), month,
    productIds: c.products, companyId: c.companyId,
  };
  if (c.activity) params.activity = c.activity;
  if (building) {
    params.targetTypeId = c.typeId;
    params.heightHint = c.heightHint ?? CATEGORY_HEIGHT[c.category] ?? 12;
  }
  if (factory) {
    const state = b.saveState();
    try {
      return factory.build(b, lot, params);
    } catch (error) {
      // Never lose the building to a factory bug: log it and draw the stand-in (with the builder state reset).
      console.warn(`[city] ${c.typeId} factory failed; using the stand-in`, error);
      b.restoreState(state);
    }
  }
  return R.kitBuild(b, lot, params, fallbackCompany(c));
}

/** Stand-in for company types without a factory: a block with an owner band and a sign. */
function fallbackCompany(c: CompanySpec): R.LotFn {
  return (k) => {
    const wallC: RGB = WORLD_RGB.wall.concrete;
    k.flagged(FLAG_PAVED | FLAG_SNOWABLE, () => k.slab(-k.hw + 0.3, -k.hd + 0.3, k.hw - 0.3, k.hd - 0.3, 0.03, WORLD_RGB.road.plaza));
    const x0 = -k.hw + 4, x1 = k.hw - 4, z0 = -k.hd + 4, z1 = k.hd - 6;
    const h = 8 + 4 * c.level;
    k.roof(() => k.box(x0, 0, z0, x1, h, z1, wallC, WORLD_RGB.roof.flat));
    k.box(x0 - 0.1, h - 1.6, z1, x1 + 0.1, h - 0.4, z1 + 0.15, ownerRgb(c.owner), ownerRgb(c.owner));
    k.sign([0, h - 1, z1 + 0.16], [0, 0, 1], Math.min(16, (x1 - x0) * 0.7), 1.1);
  };
}

/** Plots under a company footprint in the rotated world frame. */
export function companyPlots(c: Pick<CompanySpec, 'px' | 'pz' | 'w' | 'h'>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let z = c.pz; z < c.pz + c.h; z++) for (let x = c.px; x < c.px + c.w; x++) out.push([x, z]);
  return out;
}

