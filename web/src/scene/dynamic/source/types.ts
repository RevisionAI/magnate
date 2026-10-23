// The contract between the city renderer (W2, or the interim PlaceholderCity) and the living-city modules (W5).
//
// The living city needs three things the city layer knows: the road plots (where vehicles and people move), where
// each company building stands (lot, facing, owner colour) and the building's animated parts and particle emitters
// as its AssetFactory produced them (so smoke rises from the chimneys the player actually sees). A `CitySource`
// publishes exactly that. Economy data (activity, supply flows, events) comes from the bridge separately
// (EconomyFeed), so a source never has to know about the engine.
//
// How a city module provides a source (no import cycle; see docs/overhaul/status/w5-life.md §2):
//   import { registerCitySource } from '@/scene/dynamic/source/registry';
//   registerCitySource(ctx, mySource);           // in init(); call source.emit('layout' | 'buildings') on changes
// Without a registered source the living city adapts to PlaceholderCity (synthetic layout) or, failing that, builds
// its own view of the engine layout from the bridge (`cityLayout` + `cityView`).
import type { AnimatedPart, Emitter } from '../../assets/AssetFactory';
import type { HighwayExit } from '../../env/World';

/** Road classes as the traffic model uses them: 0 none, 1 street (local/collector), 2 arterial, 3 highway. */
export type RoadClassCode = 0 | 1 | 2 | 3;

/** Land-use codes per plot for ambient density (pedestrians, spawn weights). */
export const USE_NONE = 0;
export const USE_RESIDENTIAL = 1;
export const USE_COMMERCIAL = 2;
export const USE_CBD = 3;
export const USE_INDUSTRIAL = 4;
export const USE_PARK = 5;
export const USE_WATER = 6;

export interface DynamicLayout {
  cityId: string;
  /** Changes whenever the layout changes (new city, land sales…); modules rebuild graphs on change. */
  rev: number;
  gridW: number;
  gridH: number;
  seed: number;
  population: number;
  coastal: boolean;
  /** Row-major road class per plot (RoadClassCode). */
  road: Uint8Array;
  /** Optional road surface height (m) per plot: bridge decks and terrain. Absent = 0. */
  roadY?: Float32Array | null;
  /** Row-major water mask (WATER_* of env/World.ts) or null. */
  water: Uint8Array | null;
  /** Optional per-plot land use (USE_*) for pedestrian density; absent = derived from buildings only. */
  use?: Uint8Array | null;
  /** Optional per-plot traffic field 0..1 (E3a `plots.traffic` / 100) weighting where traffic spawns. */
  traffic?: Float32Array | null;
  /** Arterial exits per map edge (outskirts highways). */
  highways: readonly HighwayExit[];
}

/**
 * Building categories that sell to consumers (content `building-type.schema.json` category enum; the bridge passes
 * the content category through, e.g. `supermarket`, never a group name). `retail` is accepted for synthetic sources.
 */
export const RETAIL_CATEGORIES: ReadonlySet<string> = new Set([
  'retail', 'convenience_store', 'supermarket', 'department_store', 'specialty_store', 'auto_dealer', 'fashion_store',
  'restaurant', 'fast_food', 'hardware_store', 'furniture_store', 'pharmacy', 'gas_station', 'showroom', 'shopping_mall',
]);

/** A store with shoppers, car-park traffic and box-truck deliveries. */
export function isRetail(b: { category: string } | undefined | null): boolean {
  return !!b && RETAIL_CATEGORIES.has(b.category);
}

export type DynamicStatus = 'operating' | 'idle' | 'passive' | 'starved' | 'soldOut' | 'underConstruction' | 'closed' | 'forSale';

export interface DynamicBuilding {
  id: number;
  typeId: string;
  category: string;
  ownerId: number;
  /** Owner colour index 0..7 (0 = player) or 255 for none. */
  owner: number;
  isPlayer: boolean;
  /** Footprint on the plot grid after rotation: north-west plot and size. */
  px: number;
  pz: number;
  w: number;
  h: number;
  /** Quarter turns of the lot frame: the street-facing side (0 = S, 1 = E, 2 = N, 3 = W). */
  facing: 0 | 1 | 2 | 3;
  level: number;
  status: DynamicStatus;
  products: string[];
  /** Construction progress 0..1 while under construction; undefined when complete. */
  progress?: number;
  /** Approximate roof height (m) for effects anchored above the building. */
  height: number;
  /** Animated parts in world metres, exactly as the building's factory produced them (may be empty). */
  parts: AnimatedPart[];
  /** Particle emitters in world metres (smoke, steam, dust, flare). */
  emitters: Emitter[];
}

export type CitySourceChange = 'layout' | 'buildings';

export interface CitySource {
  readonly kind: string;
  /** Current layout, or null while none is known. */
  readonly layout: DynamicLayout | null;
  /** Company buildings of the current city by id. */
  readonly buildings: ReadonlyMap<number, DynamicBuilding>;
  onChange(listener: (what: CitySourceChange) => void): () => void;
  /** Called every frame by the living city (sources may poll the scene here). */
  update?(): void;
  dispose?(): void;
}

/** Small helper for source implementations. */
export class SourceEvents {
  private readonly listeners = new Set<(what: CitySourceChange) => void>();
  on(listener: (what: CitySourceChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(what: CitySourceChange): void {
    for (const l of [...this.listeners]) l(what);
  }
}
