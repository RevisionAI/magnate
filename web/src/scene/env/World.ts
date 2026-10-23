// What the render core needs to know about the active city: plot grid size, water, climate, relief, highway exits.
// The city layer sets it with `ctx.setWorld(world)` — W2's CityLayoutModule from `CityLayoutDto` (bridge §8.1 + art
// §5.3 requests), the interim PlaceholderCity / SceneLab from their synthetic layouts. Camera bounds, outskirts,
// water, fog, shadow clipping and the audio frame all derive from it.
import { PLOT_SIZE } from '../units';
import type { Climate } from './Seasons';
import type { GroundRect } from './ShadowFit';

/** Plot water kinds in `SceneWorld.water`. */
export const WATER_NONE = 0;
export const WATER_SEA = 1;
export const WATER_RIVER = 2;
export const WATER_LAKE = 3;

export type Edge = 'N' | 'E' | 'S' | 'W';

/** A highway leaving the city: `at` is the plot index along the edge (x for N/S, z for E/W). */
export interface HighwayExit {
  edge: Edge;
  at: number;
}

export interface SceneWorld {
  cityId: string;
  /** Grid size in plots (PLOT_SIZE m each). */
  gridW: number;
  gridH: number;
  /** Deterministic seed for outskirts/weather (e.g. fnv1a(cityId) or CityLayoutDto.seed). */
  seed: number;
  climate: Climate;
  /** Row-major gridW×gridH plot water mask (WATER_*), or null when the city has no water. */
  water: Uint8Array | null;
  /** Outskirts relief amplitude in metres (art §3.12: Hilltown 180, Riverside 50, Metropolis 25, Eastside 30, Portbay 15). */
  reliefM: number;
  /** Highways continued into the outskirts. */
  highways: readonly HighwayExit[];
  /** City population (ambient density for the audio frame). */
  population: number;
}

/** City rectangle in world metres (the city is centred on the origin). */
export function cityRect(world: Pick<SceneWorld, 'gridW' | 'gridH'>): GroundRect {
  const hw = (world.gridW * PLOT_SIZE) / 2, hh = (world.gridH * PLOT_SIZE) / 2;
  return { minX: -hw, maxX: hw, minZ: -hh, maxZ: hh };
}

/** Water kind of plot (px, pz); out-of-range plots report WATER_NONE. */
export function waterAt(world: Pick<SceneWorld, 'gridW' | 'gridH' | 'water'>, px: number, pz: number): number {
  if (!world.water || px < 0 || pz < 0 || px >= world.gridW || pz >= world.gridH) return WATER_NONE;
  return world.water[pz * world.gridW + px];
}

/** Number of contiguous water plots inward from `edge` at position `i` along it (0 = land at the edge). */
export function waterDepthFromEdge(world: Pick<SceneWorld, 'gridW' | 'gridH' | 'water'>, edge: Edge, i: number, kinds: ReadonlySet<number>): number {
  const { gridW: w, gridH: h } = world;
  let n = 0;
  for (;;) {
    let px: number, pz: number;
    switch (edge) {
      case 'N': px = i; pz = n; break;
      case 'S': px = i; pz = h - 1 - n; break;
      case 'W': px = n; pz = i; break;
      default: px = w - 1 - n; pz = i; break;
    }
    if (px < 0 || pz < 0 || px >= w || pz >= h || !kinds.has(waterAt(world, px, pz))) return n;
    n++;
  }
}

const SEA = new Set([WATER_SEA]);

/** Edges that open onto the sea: more than a third of the edge's plots are sea. */
export function seaEdges(world: Pick<SceneWorld, 'gridW' | 'gridH' | 'water'>): Edge[] {
  const out: Edge[] = [];
  if (!world.water) return out;
  for (const edge of ['N', 'E', 'S', 'W'] as const) {
    const len = edge === 'N' || edge === 'S' ? world.gridW : world.gridH;
    let sea = 0;
    for (let i = 0; i < len; i++) if (waterDepthFromEdge(world, edge, i, SEA) > 0) sea++;
    if (sea > len / 3) out.push(edge);
  }
  return out;
}

/** A river or lake channel touching a land edge; continued into the outskirts. Positions in plots along the edge. */
export interface RiverMouth {
  edge: Edge;
  from: number;
  to: number;          // inclusive
}

/** Runs of river/lake plots on the city edges (not on sea edges). */
export function riverMouths(world: Pick<SceneWorld, 'gridW' | 'gridH' | 'water'>): RiverMouth[] {
  const out: RiverMouth[] = [];
  if (!world.water) return out;
  const seaSides = new Set(seaEdges(world));
  const inland = new Set([WATER_RIVER, WATER_LAKE]);
  for (const edge of ['N', 'E', 'S', 'W'] as const) {
    if (seaSides.has(edge)) continue;
    const len = edge === 'N' || edge === 'S' ? world.gridW : world.gridH;
    let start = -1;
    for (let i = 0; i <= len; i++) {
      const wet = i < len && waterDepthFromEdge(world, edge, i, inland) > 0;
      if (wet && start < 0) start = i;
      if (!wet && start >= 0) { out.push({ edge, from: start, to: i - 1 }); start = -1; }
    }
  }
  return out;
}

/** Default outskirts relief by city (art §3.12). */
export function defaultRelief(cityId: string): number {
  const table: Record<string, number> = { hilltown: 180, riverside: 50, metropolis: 25, eastside: 30, portbay: 15 };
  return table[cityId] ?? 30;
}
