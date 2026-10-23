// City sources over the synthetic city layout (modules/synthetic/Layout.ts):
//  - `PlaceholderSource` adapts the interim in-game PlaceholderCity (W1). PlaceholderCity keeps its layout and lot
//    placements private, so the adapter regenerates the same deterministic layout from the catalog city (same
//    parameters as PlaceholderCity) and reads each company building's lot back from the scene (the meshes named
//    `company-<id>` inside the `company-buildings` group). Effects are recovered by re-running the building factory
//    with PlaceholderCity's exact parameters.
//  - `StaticSyntheticSource` wraps a ready layout (scene lab, tests).
import type * as THREE from 'three';
import { useGameStore } from '@/state/gameStore';
import { fnv1a } from '../../env/rng';
import { WATER_NONE } from '../../env/World';
import {
  KIND_PARK, KIND_WATER, ROAD_ARTERIAL, ROAD_STREET, ZONE_CBD, ZONE_COMMERCIAL, ZONE_INDUSTRIAL, layoutSyntheticCity,
  type SyntheticLayout,
} from '../../modules/synthetic/Layout';
import { PLOT_SIZE } from '../../units';
import { buildingFxOutputs, facingByFrontage } from './buildingFx';
import {
  SourceEvents, USE_CBD, USE_COMMERCIAL, USE_INDUSTRIAL, USE_PARK, USE_RESIDENTIAL, USE_WATER,
  type CitySource, type CitySourceChange, type DynamicBuilding, type DynamicLayout,
} from './types';

/** DynamicLayout from a synthetic layout. */
export function dynamicLayoutFromSynthetic(layout: SyntheticLayout, cityId: string, population: number, coastal: boolean, rev = 1): DynamicLayout {
  const n = layout.gridW * layout.gridH;
  const road = new Uint8Array(n);
  const roadY = new Float32Array(n);
  const use = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = layout.road[i];
    road[i] = r === ROAD_ARTERIAL ? 2 : r === ROAD_STREET ? 1 : 0;
    if (r && layout.water[i] !== WATER_NONE) roadY[i] = 0.3;          // bridge deck (synthetic Builder deckY)
    const k = layout.kind[i];
    if (k === KIND_WATER) use[i] = USE_WATER;
    else if (k === KIND_PARK) use[i] = USE_PARK;
    else {
      const z = layout.zone[i];
      use[i] = z === ZONE_CBD ? USE_CBD : z === ZONE_COMMERCIAL ? USE_COMMERCIAL : z === ZONE_INDUSTRIAL ? USE_INDUSTRIAL : USE_RESIDENTIAL;
    }
  }
  return {
    cityId, rev, gridW: layout.gridW, gridH: layout.gridH, seed: layout.seed, population, coastal, road, roadY,
    water: layout.water, use, traffic: null, highways: layout.highways,
  };
}

/** A fixed synthetic city (scene lab, tests): layout only, plus optional buildings. */
export class StaticSyntheticSource implements CitySource {
  readonly kind = 'synthetic';
  readonly layout: DynamicLayout;
  readonly buildings = new Map<number, DynamicBuilding>();
  private readonly events = new SourceEvents();
  constructor(layout: SyntheticLayout, cityId = 'scenelab', population = 250000, coastal = true) {
    this.layout = dynamicLayoutFromSynthetic(layout, cityId, population, coastal);
  }
  setBuildings(list: DynamicBuilding[]): void {
    this.buildings.clear();
    for (const b of list) this.buildings.set(b.id, b);
    this.events.emit('buildings');
  }
  onChange(listener: (what: CitySourceChange) => void): () => void {
    return this.events.on(listener);
  }
}

interface CityLike { id: string; gridWidth: number; gridHeight: number; coastal?: boolean; population?: number }
interface BuildingLike { id: number; typeId: string; category?: string; ownerId: number; cityId: string; level?: number }
interface CompanyLike { id: number; isPlayer?: boolean; colorIndex?: number }
interface TypeLike { id: string; category?: string; footprintWidth?: number; footprintHeight?: number }

// PlaceholderCity's parameters (modules/PlaceholderCity.ts) — keep in step with it while it is the game's city.
const RIVER_CITIES = new Set(['riverside']);
const RESERVE_SHARE = 0.12;
const PLACEHOLDER_UTILIZATION = 0.8;

export class PlaceholderSource implements CitySource {
  readonly kind = 'placeholder';
  layout: DynamicLayout | null = null;
  readonly buildings = new Map<number, DynamicBuilding>();
  private synthetic: SyntheticLayout | null = null;
  private readonly events = new SourceEvents();
  private readonly signatures = new Map<number, string>();
  private unsubscribe: (() => void) | null = null;
  private dirty = true;
  private rev = 0;
  /** PlaceholderCity builds its meshes after the store changes: re-scan until every building has one. */
  private missingSince = -1;
  private lastScan = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.unsubscribe = useGameStore.subscribe((s, p) => {
      if (s.activeCityId !== p.activeCityId || s.catalog !== p.catalog || s.buildings !== p.buildings || s.snapshot !== p.snapshot) this.dirty = true;
    });
  }

  /** True when the scene holds PlaceholderCity's company group (the adapter applies). */
  static detect(scene: THREE.Scene): boolean {
    return !!scene.getObjectByName('company-buildings');
  }

  onChange(listener: (what: CitySourceChange) => void): () => void {
    return this.events.on(listener);
  }

  update(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    // re-scan every 250 ms for at most 10 s while buildings of this city still lack their mesh
    const retry = this.missingSince >= 0 && now - this.missingSince < 10000 && now - this.lastScan >= 250;
    if (!this.dirty && !retry) return;
    this.dirty = false;
    this.lastScan = now;
    const state = useGameStore.getState();
    const cities = (state.catalog?.cities ?? []) as CityLike[];
    const city = cities.find((c) => c.id === state.activeCityId);
    if (!city) return;
    if (!this.layout || this.layout.cityId !== city.id) {
      const seed = fnv1a(city.id);
      const coastal = !!city.coastal;
      this.synthetic = layoutSyntheticCity({ gridW: city.gridWidth, gridH: city.gridHeight, seed, coastal, river: RIVER_CITIES.has(city.id), reserveShare: RESERVE_SHARE });
      this.layout = dynamicLayoutFromSynthetic(this.synthetic, city.id, city.population ?? 250000, coastal, ++this.rev);
      this.buildings.clear();
      this.signatures.clear();
      this.events.emit('layout');
    }
    this.syncBuildings(state.buildings as BuildingLike[], (state.snapshot?.companies ?? []) as CompanyLike[], state.snapshot?.playerId, (state.catalog?.buildingTypes ?? []) as TypeLike[]);
  }

  private syncBuildings(all: BuildingLike[], companies: CompanyLike[], playerId: number | undefined, types: TypeLike[]): void {
    const layout = this.layout, syn = this.synthetic;
    if (!layout || !syn) return;
    const group = this.scene.getObjectByName('company-buildings');
    const meshes = new Map<number, THREE.Object3D>();
    for (const child of group?.children ?? []) {
      const id = child.userData?.buildingId;
      if (typeof id === 'number') meshes.set(id, child);
    }
    const inCity = all.filter((b) => b.cityId === layout.cityId).sort((a, b) => a.id - b.id);
    const alive = new Set<number>();
    let changed = false, missing = 0;
    for (const b of inCity) {
      const mesh = meshes.get(b.id) as (THREE.Object3D & { geometry?: THREE.BufferGeometry }) | undefined;
      if (!mesh?.geometry) {
        missing++;
        continue;
      }
      const type = types.find((t) => t.id === b.typeId);
      const fw = Math.max(1, type?.footprintWidth ?? 2), fh = Math.max(1, type?.footprintHeight ?? 2);
      const lot = this.lotOf(mesh.geometry, fw, fh);
      if (!lot) continue;
      alive.add(b.id);
      const owner = ownerIndex(b.ownerId, companies, playerId);
      const facing = facingByFrontage(syn.road, syn.gridW, syn.gridH, lot.px, lot.pz, fw, fh);
      const level = Math.min(3, Math.max(1, b.level ?? 1));
      const sig = `${b.typeId}:${level}:${owner}:${lot.px},${lot.pz}:${facing}`;
      if (this.signatures.get(b.id) === sig) continue;
      this.signatures.set(b.id, sig);
      const seed = fnv1a(`${layout.cityId}:${b.id}:${b.typeId}`);
      const fx = buildingFxOutputs({
        typeId: b.typeId, px: lot.px, pz: lot.pz, w: fw, h: fh, facing, gridW: layout.gridW, gridH: layout.gridH,
        seed, variant: seed % 2, level, owner, utilization: PLACEHOLDER_UTILIZATION,
      });
      this.buildings.set(b.id, {
        id: b.id, typeId: b.typeId, category: b.category ?? type?.category ?? 'office', ownerId: b.ownerId, owner,
        isPlayer: owner === 0, px: lot.px, pz: lot.pz, w: fw, h: fh, facing, level, status: 'operating', products: [],
        height: fx.height, parts: fx.parts, emitters: fx.emitters,
      });
      changed = true;
    }
    for (const id of [...this.buildings.keys()]) {
      if (alive.has(id)) continue;
      this.buildings.delete(id);
      this.signatures.delete(id);
      changed = true;
    }
    if (!missing) this.missingSince = -1;
    else if (this.missingSince < 0) this.missingSince = this.lastScan;
    if (changed) this.events.emit('buildings');
  }

  /** The reserved-land rect of size fw × fh nearest to the mesh's bounding-box centre. */
  private lotOf(geometry: THREE.BufferGeometry, fw: number, fh: number): { px: number; pz: number } | null {
    const syn = this.synthetic!;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const W = syn.gridW, H = syn.gridH;
    const px0 = Math.round(cx / PLOT_SIZE + W / 2 - fw / 2), pz0 = Math.round(cz / PLOT_SIZE + H / 2 - fh / 2);
    const reserved = new Set(syn.reserved.map((r) => r.pz * W + r.px));
    let best: { px: number; pz: number } | null = null, bestD = Infinity;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = px0 + dx, pz = pz0 + dz;
        if (px < 0 || pz < 0 || px + fw > W || pz + fh > H) continue;
        let ok = true;
        for (let z = 0; z < fh && ok; z++) for (let x = 0; x < fw && ok; x++) ok = reserved.has((pz + z) * W + px + x);
        if (!ok) continue;
        const mx = (px + fw / 2 - W / 2) * PLOT_SIZE, mz = (pz + fh / 2 - H / 2) * PLOT_SIZE;
        const d = (mx - cx) ** 2 + (mz - cz) ** 2;
        if (d < bestD) { bestD = d; best = { px, pz }; }
      }
    }
    return best;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

/** PlaceholderCity's owner colour rule: the player is 0 (D15), rivals 1..7 in company-id order. */
export function ownerIndex(ownerId: number, companies: readonly CompanyLike[], playerId: number | undefined): number {
  const company = companies.find((c) => c.id === ownerId);
  if (company?.colorIndex !== undefined) return company.colorIndex % 8;
  if (ownerId === playerId || company?.isPlayer) return 0;
  const rivals = companies.filter((c) => c.id !== playerId && !c.isPlayer).map((c) => c.id).sort((a, b) => a - b);
  const i = rivals.indexOf(ownerId);
  return i < 0 ? 7 : 1 + (i % 7);
}
