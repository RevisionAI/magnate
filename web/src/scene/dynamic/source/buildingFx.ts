// Re-runs a building's AssetFactory (pure, deterministic) to recover the outputs the city layer does not keep:
// animated parts, particle emitters and the roof height. With the same inputs the factory returns exactly the
// positions of the geometry the city module drew (W4 contract: same seed/lot/params → identical output), so smoke
// leaves the visible chimneys and pumpjacks nod on their own pads.
import { GeoBuilder } from '../../assets/GeoBuilder';
import { lotFrame, stageForProgress, type AnimatedPart, type AssetParams, type Emitter, type Facing, type Stage } from '../../assets/AssetFactory';
import { factoryFor } from '../../assets/registry';
import { PLOT_SIZE } from '../../units';

const FACINGS: readonly Facing[] = ['S', 'E', 'N', 'W'];

/** W3 types (retail, media, R&D, HQ) draw only complete/closed; their sites come from the generic factory. */
const OWN_SITE_TYPES = new Set([
  'factory_small', 'factory_large', 'small_farm', 'large_farm', 'small_plantation', 'iron_mine', 'oil_well',
  'warehouse_small', 'warehouse_large', 'seaport',
]);

export interface FxBuildInput {
  typeId: string;
  /** Rotated footprint on the grid (north-west plot + size) and the lot facing. */
  px: number;
  pz: number;
  w: number;
  h: number;
  facing: 0 | 1 | 2 | 3;
  gridW: number;
  gridH: number;
  seed: number;
  variant: number;
  level: number;
  owner: number;
  utilization: number;
  /** Absent → the factory's seeded default look (what PlaceholderCity draws). */
  productIds?: string[];
  month?: number;
  season?: 0 | 1 | 2 | 3;
  closed?: boolean;
  /** 0..1 while under construction. */
  progress?: number;
}

export interface FxBuildOutput {
  parts: AnimatedPart[];
  emitters: Emitter[];
  /** Highest point of the building (m). */
  height: number;
}

/** Run the factory for one building. Never throws: unknown types or factory errors give empty outputs. */
export function buildingFxOutputs(inp: FxBuildInput): FxBuildOutput {
  const empty: FxBuildOutput = { parts: [], emitters: [], height: 10 };
  const turns = inp.facing;
  const cx = (inp.px + inp.w / 2 - inp.gridW / 2) * PLOT_SIZE;
  const cz = (inp.pz + inp.h / 2 - inp.gridH / 2) * PLOT_SIZE;
  // lot frame extents: widthM runs along the street; for E/W facings the world rect is rotated
  const fw = turns % 2 === 0 ? inp.w : inp.h, fh = turns % 2 === 0 ? inp.h : inp.w;
  const lot = lotFrame(cx, cz, fw, fh, FACINGS[turns], PLOT_SIZE);
  const underConstruction = inp.progress !== undefined && inp.progress < 1;
  const stage: Stage = inp.closed ? 'closed' : underConstruction ? stageForProgress(inp.progress!) : 'complete';
  let factory = factoryFor(inp.typeId);
  const params: AssetParams = {
    seed: inp.seed, variant: inp.variant, level: Math.min(3, Math.max(1, Math.round(inp.level))) as 1 | 2 | 3, stage,
    progress: underConstruction ? inp.progress! : 1, owner: inp.owner, utilization: inp.utilization, lod: 0,
    season: inp.season ?? 1,
  };
  if (inp.productIds) params.productIds = inp.productIds;
  if (inp.month !== undefined) params.month = inp.month;
  if (underConstruction && !OWN_SITE_TYPES.has(inp.typeId)) {
    factory = factoryFor('construction');
    params.targetTypeId = inp.typeId;
  }
  if (!factory) return empty;
  try {
    // a fresh builder per call keeps memory bounded (GeoBuilder grows and never shrinks)
    const b = new GeoBuilder();
    b.owner = inp.owner;
    const out = factory.build(b, lot, params);
    return { parts: out.animated, emitters: out.emitters, height: Math.max(4, out.pickBox[4]) };
  } catch (error) {
    console.warn(`[living-city] factory ${inp.typeId} failed for effects`, error);
    return empty;
  }
}

/** Facing for a footprint by road frontage (art §5.3 rule: most road plots along a side; ties S, E, N, W). */
export function facingByFrontage(road: Uint8Array, gridW: number, gridH: number, px: number, pz: number, w: number, h: number): 0 | 1 | 2 | 3 {
  const at = (x: number, z: number) => (x >= 0 && z >= 0 && x < gridW && z < gridH ? road[z * gridW + x] : 0);
  // PlaceholderCity scores raw class values (street 1, arterial 2); keep that so effects match its geometry
  const score = [0, 0, 0, 0];
  for (let dx = 0; dx < w; dx++) { score[0] += at(px + dx, pz + h); score[2] += at(px + dx, pz - 1); }
  for (let dz = 0; dz < h; dz++) { score[1] += at(px + w, pz + dz); score[3] += at(px - 1, pz + dz); }
  let best = 0;
  for (let k = 1; k < 4; k++) if (score[k] > score[best]) best = k;
  return best as 0 | 1 | 2 | 3;
}

/** Plot just outside the middle of a footprint's front side (where deliveries and shoppers meet the street). */
export function frontPlot(px: number, pz: number, w: number, h: number, facing: 0 | 1 | 2 | 3): { px: number; pz: number } {
  switch (facing) {
    case 0: return { px: px + Math.floor((w - 1) / 2), pz: pz + h };
    case 1: return { px: px + w, pz: pz + Math.floor((h - 1) / 2) };
    case 2: return { px: px + Math.floor((w - 1) / 2), pz: pz - 1 };
    default: return { px: px - 1, pz: pz + Math.floor((h - 1) / 2) };
  }
}
