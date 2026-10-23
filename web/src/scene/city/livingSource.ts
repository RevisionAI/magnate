// The living city's view of the rendered city (W5 contract `CitySource`, scene/dynamic/source/types.ts): road classes
// and road surface heights per plot (terrain and the real bridge arches), water, land use, traffic, highway exits, and
// every company building with its lot, facing, status, roof height and the animated parts and particle emitters its
// factory produced in the chunk build (so smoke rises from the chimneys on screen).
//
// The types are mirrored structurally so this file compiles with or without W5's module; registration goes through an
// eager glob import of `../dynamic/source/registry.ts` (empty when the module does not exist).
import type * as THREE from 'three';
import type { AnimatedPart, Emitter } from '../assets/AssetFactory';
import type { HighwayExit } from '../env/World';
import { PLOT_SIZE } from '../units';
import type { CityBuildContext } from './build/CityBuildContext';
import type { ChunkAnimatedPart, ChunkEmitter, CompanySpec } from './chunkProtocol';
import type { BuildingVisualDto } from '@/bridge/protocol';
import {
  D_APARTMENTS, D_CBD, D_COMMERCIAL, D_HOUSES, D_INDUSTRIAL, D_MIXED, D_PARK, D_PORT, R_ARTERIAL, R_HIGHWAY, isRoadKind,
  isWaterKind,
} from './layout/types';

/** W5 land-use codes (types.ts USE_*). */
const USE_NONE = 0, USE_RESIDENTIAL = 1, USE_COMMERCIAL = 2, USE_CBD = 3, USE_INDUSTRIAL = 4, USE_PARK = 5, USE_WATER = 6;

/** W5 `DynamicLayout`. */
export interface LivingLayout {
  cityId: string;
  rev: number;
  gridW: number;
  gridH: number;
  seed: number;
  population: number;
  coastal: boolean;
  road: Uint8Array;
  roadY: Float32Array | null;
  water: Uint8Array | null;
  use: Uint8Array | null;
  traffic: Float32Array | null;
  highways: readonly HighwayExit[];
}

/** W5 `DynamicBuilding`. */
export interface LivingBuilding {
  id: number;
  typeId: string;
  category: string;
  ownerId: number;
  owner: number;
  isPlayer: boolean;
  px: number;
  pz: number;
  w: number;
  h: number;
  facing: 0 | 1 | 2 | 3;
  level: number;
  status: string;
  products: string[];
  progress?: number;
  height: number;
  parts: AnimatedPart[];
  emitters: Emitter[];
}

export type LivingChange = 'layout' | 'buildings';

/** What the adapter reads from the city module. */
export interface LivingHost {
  buildContext(): CityBuildContext | null;
  population(): number;
  water(): Uint8Array | null;
  highways(): readonly HighwayExit[];
  specs(): readonly CompanySpec[];
  dto(id: number): BuildingVisualDto | undefined;
  box(id: number): THREE.Box3 | null;
  emitters(): readonly ChunkEmitter[];
  parts(): readonly ChunkAnimatedPart[];
}

type Register = (ctx: { scene: THREE.Scene }, source: unknown) => void;
const livingModules = import.meta.glob<{ registerCitySource?: Register }>('../dynamic/source/registry.ts', { eager: true });

/** Register (or clear) the source with the living city, when that layer is present. */
export function registerLivingSource(ctx: { scene: THREE.Scene }, source: CityLivingSource | null): boolean {
  let done = false;
  for (const m of Object.values(livingModules)) {
    if (typeof m.registerCitySource === 'function') { m.registerCitySource(ctx, source); done = true; }
  }
  return done;
}

export class CityLivingSource {
  readonly kind = 'w2-city';
  layout: LivingLayout | null = null;
  buildings = new Map<number, LivingBuilding>();
  private readonly listeners = new Set<(what: LivingChange) => void>();
  private rev = 0;

  constructor(private readonly host: LivingHost) {}

  onChange(listener: (what: LivingChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(what: LivingChange): void {
    for (const l of [...this.listeners]) l(what);
  }

  /** A new layout (city switch or revision): rebuild the plot arrays. */
  refreshLayout(): void {
    const ctx = this.host.buildContext();
    if (!ctx) { this.layout = null; this.emit('layout'); return; }
    this.layout = livingLayout(ctx, ++this.rev, this.host.population(), this.host.water(), this.host.highways());
    this.emit('layout');
  }

  /** Company buildings, emitters or parts changed. */
  refreshBuildings(): void {
    const ctx = this.host.buildContext();
    const out = new Map<number, LivingBuilding>();
    if (ctx) {
      const emitters = new Map<number, Emitter[]>(), parts = new Map<number, AnimatedPart[]>();
      for (const e of this.host.emitters()) if (e.buildingId !== null) (emitters.get(e.buildingId) ?? emitters.set(e.buildingId, []).get(e.buildingId)!).push(e);
      for (const a of this.host.parts()) if (a.buildingId !== null) (parts.get(a.buildingId) ?? parts.set(a.buildingId, []).get(a.buildingId)!).push(a);
      for (const s of this.host.specs()) {
        const dto = this.host.dto(s.id);
        const terrace = ctx.companyTerrace.get(s.id) ?? 0;
        const box = this.host.box(s.id);
        const b: LivingBuilding = {
          id: s.id, typeId: s.typeId, category: s.category, ownerId: dto?.ownerId ?? 0, owner: s.owner, isPlayer: dto?.isPlayer ?? s.owner === 0,
          px: s.px, pz: s.pz, w: s.w, h: s.h, facing: s.turns, level: s.level, status: dto?.status ?? 'operating', products: s.products,
          height: box ? Math.max(1, box.max.y - terrace) : 8, parts: parts.get(s.id) ?? [], emitters: emitters.get(s.id) ?? [],
        };
        if (s.stage !== 'complete' && s.stage !== 'closed') b.progress = s.progress;
        out.set(s.id, b);
      }
    }
    this.buildings = out;
    this.emit('buildings');
  }

  dispose(): void {
    this.listeners.clear();
  }
}

/** The living city's per-plot arrays from the decoded layout (pure; exported for tests). */
export function livingLayout(ctx: CityBuildContext, rev: number, population: number, water: Uint8Array | null, highways: readonly HighwayExit[]): LivingLayout {
  const g = ctx.grid, W = ctx.W, H = ctx.H, n = W * H;
  const road = new Uint8Array(n), roadY = new Float32Array(n), use = new Uint8Array(n), traffic = new Float32Array(n);
  for (let pz = 0; pz < H; pz++) {
    for (let px = 0; px < W; px++) {
      const i = pz * W + px, k = g.kind[i];
      if (isRoadKind(k)) {
        const cls = g.road[i] || 1;
        road[i] = cls >= R_HIGHWAY ? 3 : cls === R_ARTERIAL ? 2 : 1;
        const fn = ctx.warpFn(px, pz);
        roadY[i] = fn(ctx.x0(px) + PLOT_SIZE / 2, ctx.z0(pz) + PLOT_SIZE / 2);
      }
      const d = g.district[i];
      use[i] = isWaterKind(k) ? USE_WATER : d === D_CBD ? USE_CBD : d === D_COMMERCIAL || d === D_MIXED ? USE_COMMERCIAL
        : d === D_HOUSES || d === D_APARTMENTS ? USE_RESIDENTIAL : d === D_INDUSTRIAL || d === D_PORT ? USE_INDUSTRIAL : d === D_PARK ? USE_PARK : USE_NONE;
      traffic[i] = Math.max(0, Math.min(1, (g.traffic[i] ?? 0) / 100));
    }
  }
  return {
    cityId: g.cityId, rev, gridW: W, gridH: H, seed: g.seed, population, coastal: water?.some((v) => v === 1) ?? false, road, roadY,
    water, use, traffic, highways,
  };
}
