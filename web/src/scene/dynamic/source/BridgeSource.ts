// City source built directly from the engine (bridge `cityLayout` + `cityView`): the same data W2's city renderer
// draws (art §5.3), so with no source registered the living city still lines up with an engine-driven city.
//
// Conventions where the renderer's own choices are not visible from here (documented in the W5 status doc; a city
// module that differs should register its own CitySource instead):
//  - building seed = fnv1a(cityId, px, pz, typeId) (art §4.1), variant = seed % 2;
//  - lot facing = placement.rotation / 90 (engine rotation wins, art §5.3);
//  - road surface: terrain corner heights averaged per plot; bridge plots (`plots.kinds` 'b') at +6 m (art §5.15).
import type { BuildingVisualDto, CityLayoutDto } from '@/bridge/protocol';
import { maybeEngine, useGameStore } from '@/state/gameStore';
import { fnv1a } from '../../assets/shapes';
import { WATER_LAKE, WATER_NONE, WATER_RIVER, WATER_SEA, type Edge, type HighwayExit } from '../../env/World';
import { buildingFxOutputs } from './buildingFx';
import type { EconomyFeed, EconomySnapshot } from './EconomyFeed';
import {
  SourceEvents, USE_CBD, USE_COMMERCIAL, USE_INDUSTRIAL, USE_NONE, USE_PARK, USE_RESIDENTIAL, USE_WATER,
  type CitySource, type CitySourceChange, type DynamicBuilding, type DynamicLayout, type DynamicStatus,
} from './types';

/** Bridge-deck height above the water plots (art §5.15). */
export const BRIDGE_DECK_Y = 6;

/** E3a per-plot encodings (status e3a-citygen §3); typed loosely because protocol.ts does not mirror them yet. */
interface LayoutPlots { kinds?: string; roads?: string; districts?: string; traffic?: number[] }
type LayoutWire = CityLayoutDto & { plots?: LayoutPlots; roads: Array<CityLayoutDto['roads'][number] & { roadClass?: string }> };

/** Convert the engine layout into the living city's layout. Pure (exported for tests). */
export function dynamicLayoutFromBridge(dto: LayoutWire, population: number, coastal: boolean, rev: number): DynamicLayout {
  const W = dto.gridW, H = dto.gridH, n = W * H;
  const road = new Uint8Array(n);
  const roadY = new Float32Array(n);
  const water = new Uint8Array(n);
  const use = new Uint8Array(n);
  let traffic: Float32Array | null = null;
  const plots = dto.plots;
  if (plots?.roads && plots.roads.length === n) {
    for (let i = 0; i < n; i++) {
      const c = plots.roads.charCodeAt(i) - 48;          // '0' none, '1' local, '2' collector, '3' arterial, '4' highway
      road[i] = c <= 0 ? 0 : c <= 2 ? 1 : c === 3 ? 2 : 3;
    }
  } else {
    for (const r of dto.roads ?? []) {
      const cls = r.kind === 'highway' ? 3 : r.kind === 'arterial' ? 2 : 1;
      const path = r.path ?? [];
      for (let k = 0; k < path.length; k++) {
        const a = path[k], b = path[Math.min(k + 1, path.length - 1)];
        const steps = Math.max(Math.abs(b.px - a.px), Math.abs(b.pz - a.pz));
        for (let t = 0; t <= steps; t++) {
          const px = a.px + Math.sign(b.px - a.px) * t, pz = a.pz + Math.sign(b.pz - a.pz) * t;
          if (px >= 0 && pz >= 0 && px < W && pz < H) road[pz * W + px] = Math.max(road[pz * W + px], cls);
        }
      }
    }
  }
  if (plots?.kinds && plots.kinds.length === n) {
    for (let i = 0; i < n; i++) {
      const k = plots.kinds[i];
      water[i] = k === 's' ? WATER_SEA : k === 'v' ? WATER_RIVER : k === 'l' ? WATER_LAKE : WATER_NONE;
      if (k === 'b') roadY[i] = BRIDGE_DECK_Y;
    }
  } else {
    for (const w of dto.water ?? []) {
      const kind = w.kind === 'river' ? WATER_RIVER : w.kind === 'lake' ? WATER_LAKE : WATER_SEA;
      for (let z = w.pz; z < w.pz + w.h; z++) for (let x = w.px; x < w.px + w.w; x++) if (x >= 0 && z >= 0 && x < W && z < H) water[z * W + x] = kind;
    }
    for (let i = 0; i < n; i++) if (road[i] && water[i]) roadY[i] = BRIDGE_DECK_Y;
  }
  const heights = dto.terrain?.heights;
  if (heights && heights.length === (W + 1) * (H + 1)) {
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const c = (zz: number, xx: number) => heights[zz * (W + 1) + xx];
        roadY[z * W + x] += (c(z, x) + c(z, x + 1) + c(z + 1, x) + c(z + 1, x + 1)) / 4;
      }
    }
  }
  if (plots?.districts && plots.districts.length === n) {
    for (let i = 0; i < n; i++) {
      const d = plots.districts[i];
      use[i] = water[i] ? USE_WATER : d === 'C' ? USE_CBD : d === 'c' || d === 'm' || d === 'v' ? USE_COMMERCIAL
        : d === 'a' || d === 'h' ? USE_RESIDENTIAL : d === 'i' || d === 'p' ? USE_INDUSTRIAL : d === 'k' ? USE_PARK : USE_NONE;
    }
  }
  if (plots?.traffic && plots.traffic.length === n) traffic = Float32Array.from(plots.traffic, (t) => Math.max(0, Math.min(1, t / 100)));
  // highways leaving the map
  const highways: HighwayExit[] = [];
  const edgeExit = (edge: Edge, at: number) => { if (!highways.some((h) => h.edge === edge && Math.abs(h.at - at) <= 1)) highways.push({ edge, at }); };
  for (let x = 0; x < W; x++) {
    if (road[x] >= 2) edgeExit('N', x);
    if (road[(H - 1) * W + x] >= 2) edgeExit('S', x);
  }
  for (let z = 0; z < H; z++) {
    if (road[z * W] >= 2) edgeExit('W', z);
    if (road[z * W + W - 1] >= 2) edgeExit('E', z);
  }
  return {
    cityId: dto.cityId, rev, gridW: W, gridH: H, seed: dto.seed ?? fnv1a(dto.cityId), population, coastal, road, roadY,
    water: water.some((v) => v !== WATER_NONE) ? water : null, use, traffic, highways,
  };
}

/** Lot of a visual DTO on the grid: rotated footprint and facing. */
export function lotOfVisual(b: Pick<BuildingVisualDto, 'placement' | 'footprintW' | 'footprintH'>): { px: number; pz: number; w: number; h: number; facing: 0 | 1 | 2 | 3 } {
  const turns = (((Math.round((b.placement?.rotation ?? 0) / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const w = turns % 2 === 0 ? b.footprintW : b.footprintH, h = turns % 2 === 0 ? b.footprintH : b.footprintW;
  return { px: b.placement?.px ?? 0, pz: b.placement?.pz ?? 0, w, h, facing: turns };
}

interface CityLike { id: string; coastal?: boolean; population?: number }

export class BridgeSource implements CitySource {
  readonly kind = 'bridge';
  layout: DynamicLayout | null = null;
  readonly buildings = new Map<number, DynamicBuilding>();
  private readonly events = new SourceEvents();
  private readonly signatures = new Map<number, string>();
  private readonly offs: Array<() => void> = [];
  private cityId: string | null = null;
  private loading: string | null = null;
  private rev = 0;
  private warned = false;

  constructor(private readonly feed: EconomyFeed) {
    this.offs.push(feed.onChange((snap) => this.syncBuildings(snap)));
    this.offs.push(useGameStore.subscribe((s, p) => { if (s.activeCityId !== p.activeCityId) this.loadCity(); }));
    this.loadCity();
  }

  onChange(listener: (what: CitySourceChange) => void): () => void {
    return this.events.on(listener);
  }

  private loadCity(): void {
    const state = useGameStore.getState();
    const cityId = state.activeCityId;
    if (!cityId || cityId === this.cityId || cityId === this.loading) return;
    const engine = maybeEngine();
    if (!engine) return;
    this.loading = cityId;
    const city = ((state.catalog?.cities ?? []) as CityLike[]).find((c) => c.id === cityId);
    engine.call('cityLayout', { cityId })
      .then((dto) => {
        if (useGameStore.getState().activeCityId !== cityId) return;
        this.cityId = cityId;
        this.layout = dynamicLayoutFromBridge(dto as LayoutWire, city?.population ?? 250000, !!city?.coastal, ++this.rev);
        this.buildings.clear();
        this.signatures.clear();
        this.events.emit('layout');
        this.syncBuildings(this.feed.snapshot);
      })
      .catch((error: unknown) => {
        if (!this.warned) console.warn('[living-city] cityLayout unavailable', error);
        this.warned = true;
      })
      .finally(() => { if (this.loading === cityId) this.loading = null; });
  }

  private syncBuildings(snap: EconomySnapshot): void {
    const layout = this.layout;
    if (!layout || snap.cityId !== layout.cityId) return;
    let changed = false;
    const month = snap.monthIndex >= 0 ? (snap.monthIndex % 12) + 1 : undefined;
    for (const [id, b] of snap.visuals) {
      const lot = lotOfVisual(b);
      const progress = b.construction && b.construction.progress < 1 ? b.construction.progress : undefined;
      const status = b.status as DynamicStatus;
      const sig = `${b.visualRev}:${lot.px},${lot.pz},${lot.facing}:${progress === undefined ? '' : Math.floor(progress * 20)}`;
      if (this.signatures.get(id) === sig) continue;
      this.signatures.set(id, sig);
      const seed = fnv1a(layout.cityId, lot.px, lot.pz, b.typeId);
      const fx = buildingFxOutputs({
        typeId: b.typeId, ...lot, gridW: layout.gridW, gridH: layout.gridH, seed, variant: seed % 2, level: b.level,
        owner: b.colorIndex ?? (b.isPlayer ? 0 : 7), utilization: 0.8, productIds: b.products, month,
        closed: status === 'closed', progress,
      });
      this.buildings.set(id, {
        id, typeId: b.typeId, category: b.category, ownerId: b.ownerId, owner: b.colorIndex ?? (b.isPlayer ? 0 : 7),
        isPlayer: b.isPlayer, ...lot, level: b.level, status, products: b.products ?? [], progress, height: fx.height,
        parts: fx.parts, emitters: fx.emitters,
      });
      changed = true;
    }
    for (const id of [...this.buildings.keys()]) {
      if (snap.visuals.has(id)) continue;
      this.buildings.delete(id);
      this.signatures.delete(id);
      changed = true;
    }
    if (changed) this.events.emit('buildings');
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
