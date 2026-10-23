// Public API of the city layer for the other scene workstreams (W5 living city, W6 interaction, A1 audio, U-panels).
// The CityModule publishes one CityServices object per SceneContext; consumers look it up and subscribe:
//
//   import { getCityServices, onCityServices } from '@/scene/city';
//   const off = onCityServices(ctx, (city) => { … city.roads … city.pick(ray) … });   // fires now if already set
//
// Everything is in world metres (units.ts): city centred on the origin, plot (0,0) = NW corner, +X east, +Z south.
import type * as THREE from 'three';
import type { SceneContext } from '../SceneContext';
import type { BuildingVisualDto, Rotation } from '@/bridge/protocol';
import type { ChunkAnimatedPart, ChunkEmitter } from './chunkProtocol';
import type { CityGrid } from './layout/types';
import type { CityPick } from './PickIndex';
import type { RoadNetwork } from './RoadNetwork';

/** A lot in world terms: plots, facing, frame and terrace height. */
export interface LotInfo {
  /** NW plot and world-aligned size (rotation applied), in plots. */
  px: number;
  pz: number;
  w: number;
  h: number;
  /** Street-facing side as quarter turns (0 S, 1 E, 2 N, 3 W) — the AssetFactory lot frame. */
  turns: 0 | 1 | 2 | 3;
  /** Lot centre (world metres) and ground height of its terrace. */
  x: number;
  y: number;
  z: number;
  /** Lot extents in the lot frame (widthM along the street, depthM away from it). */
  widthM: number;
  depthM: number;
  /** World AABB of the plots (y from the terrace to +1 m); use `buildingBox` for the building itself. */
  bounds: THREE.Box3;
}

/** A company building as the city renders it. */
export interface CityBuilding {
  id: number;
  dto: BuildingVisualDto;
  lot: LotInfo;
  /** Live utilization 0..1 from the latest cityView activity (producers), or the retail fill proxy. */
  utilization: number;
}

export type CityChange = 'layout' | 'buildings' | 'life' | 'picks';

export interface CityServices {
  readonly cityId: string;
  readonly layoutRev: number;
  /** Decoded layout (per-plot kinds, roads, districts, parcels, terrain…). */
  readonly grid: CityGrid;
  /** Road tiles, nodes, edges and lanes (traffic, trucks, pedestrians). */
  readonly roads: RoadNetwork;
  /** Nearest building, ambient lot or ground plot under a world ray. */
  pick(ray: THREE.Ray): CityPick | null;
  /** Same as `pick` for a client-space pointer position. */
  pickClient(clientX: number, clientY: number): CityPick | null;
  /** Ground height (m) at a world point (terraces, terrain, bridges). */
  groundHeight(x: number, z: number): number;
  /** Company buildings of the active city by id. */
  buildings(): ReadonlyMap<number, CityBuilding>;
  /** World AABB of a company building (from its factory pick box), or null while it is not built yet. */
  buildingBox(id: number): THREE.Box3 | null;
  /** World AABB of an ambient lot's building (parcel id), or null. */
  parcelBox(parcelId: number): THREE.Box3 | null;
  /** Lot of a company building, or null. */
  lotOfBuilding(id: number): LotInfo | null;
  /** Lot of a parcel, or null. */
  lotOfParcel(parcelId: number): LotInfo | null;
  /**
   * Lot for a hypothetical footprint (placement ghost): content footprint fw × fh at NW plot (px, pz) with a
   * rotation (0/90/180/270, front S/E/N/W). Returns null when out of bounds.
   */
  footprintLot(px: number, pz: number, fw: number, fh: number, rotation: Rotation): LotInfo | null;
  /** Facing (quarter turns) a footprint would get from road adjacency (art §5.3), for ghosts without a rotation. */
  facingFor(px: number, pz: number, w: number, h: number): 0 | 1 | 2 | 3;
  /** Particle emitters of every built lot (world metres); rescale `rateAtFull` by `utilization(buildingId)`. */
  getEmitters(): readonly ChunkEmitter[];
  /** Animated parts of every built lot (pumpjacks, cranes, gondolas…); pose with W4's `partPose`. */
  getAnimatedParts(): readonly ChunkAnimatedPart[];
  /** Live utilization of a company building (ambient lots: 0.6). */
  utilization(buildingId: number | null): number;
  /** Change notifications (layout swap, building set, emitters/parts, pick boxes). */
  onChange(listener: (change: CityChange) => void): () => void;
  /** Resolves once every chunk of the current layout is built. */
  whenReady(): Promise<void>;
  /** Chunks built so far out of all chunks of the current layout (loading progress). */
  buildProgress(): { built: number; total: number };
}

interface Registry { current: CityServices | null; listeners: Set<(s: CityServices | null) => void> }

const registries = new WeakMap<SceneContext, Registry>();

function registry(ctx: SceneContext): Registry {
  let r = registries.get(ctx);
  if (!r) { r = { current: null, listeners: new Set() }; registries.set(ctx, r); }
  return r;
}

/** The active city's services for a scene (null until the first layout is decoded). */
export function getCityServices(ctx: SceneContext): CityServices | null {
  return registry(ctx).current;
}

/** Subscribe to the city services of a scene (called immediately when already available, and on every city switch). */
export function onCityServices(ctx: SceneContext, listener: (services: CityServices | null) => void): () => void {
  const r = registry(ctx);
  r.listeners.add(listener);
  if (r.current) listener(r.current);
  return () => { r.listeners.delete(listener); };
}

/** City layer only: publish (or clear) the services. */
export function publishCityServices(ctx: SceneContext, services: CityServices | null): void {
  const r = registry(ctx);
  r.current = services;
  for (const l of [...r.listeners]) l(services);
}
