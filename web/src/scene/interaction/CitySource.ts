// What the interaction layer needs from the city renderer (W2), and the interim adapter over the placeholder city.
//
// W2 (scene/city/**) registers its implementation once per scene:
//
//   import { provideCitySource } from '@/scene/interaction/CitySource';
//   provideCitySource(ctx, mySource);           // and provideCitySource(ctx, null) on dispose
//
// Until a source is provided, `SceneGraphCitySource` derives the same data from the scene graph: every Object3D with
// `userData.buildingId` (the PlaceholderCity company meshes) becomes a building whose world AABB gives its box and
// covered plots; the grid comes from `ctx.world` (SceneWorld.gridW/gridH). Picking then runs the same grid DDA.
import * as THREE from 'three';
import type { SceneContext } from '../SceneContext';
import { PLOT_SIZE } from '../units';
import { buildPickIndex, type PickIndex } from './Picking';
import type { LayoutGrid } from './CityData';

/** A company building as the city renderer placed it. */
export interface CityBuildingRef {
  id: number;
  /** North-west plot and size of the ROTATED footprint, in plots. */
  px: number;
  pz: number;
  w: number;
  h: number;
  /** World AABB in metres: minX, minY, minZ, maxX, maxY, maxZ. */
  box: readonly [number, number, number, number, number, number];
}

export interface CityInteractionSource {
  /** City currently rendered (null while loading). */
  readonly cityId: string | null;
  readonly gridW: number;
  readonly gridH: number;
  /** Bumps whenever buildings, boxes or the pick index change. */
  readonly revision: number;
  /** Grid-DDA pick index (art §5.12). */
  getPickIndex(): PickIndex | null;
  getBuilding(id: number): CityBuildingRef | null;
  /** Every company building in the rendered city. */
  buildings(): Iterable<CityBuildingRef>;
  /**
   * Optional: the rendered object of a building, outlined directly (OutlineSelection restores its layer mask).
   * Absent or null → W6 outlines a LAYER_SELECTION-only box proxy of the AABB (art §5.13 proxy, simplified).
   */
  getBuildingObject?(id: number): THREE.Object3D | null;
  /** Optional: the decoded engine layout of the rendered city (saves W6 a second `cityLayout` call). */
  getLayout?(): LayoutGrid | null;
}

// --------------------------------------------------------------------------------------------- registry

const provided = new WeakMap<object, CityInteractionSource | null>();
const listeners = new WeakMap<object, Set<(s: CityInteractionSource | null) => void>>();

/** Register (or clear with null) the city renderer's source for this scene. */
export function provideCitySource(ctx: object, source: CityInteractionSource | null): void {
  provided.set(ctx, source);
  for (const l of listeners.get(ctx) ?? []) l(source);
}

export function providedCitySource(ctx: object): CityInteractionSource | null {
  return provided.get(ctx) ?? null;
}

export function onCitySourceChanged(ctx: object, listener: (s: CityInteractionSource | null) => void): () => void {
  let set = listeners.get(ctx);
  if (!set) {
    set = new Set();
    listeners.set(ctx, set);
  }
  set.add(listener);
  return () => set!.delete(listener);
}

// ------------------------------------------------------------------------------------ scene-graph fallback

const _box = new THREE.Box3();

/** Rotated plot footprint covered by a world AABB (shrunk by 1 m so a box flush with a plot edge stays inside). */
export function footprintOfBox(box: readonly number[], gridW: number, gridH: number): { px: number; pz: number; w: number; h: number } {
  const halfW = (gridW * PLOT_SIZE) / 2, halfH = (gridH * PLOT_SIZE) / 2;
  const x0 = Math.floor((box[0] + 1 + halfW) / PLOT_SIZE), x1 = Math.floor((box[3] - 1 + halfW) / PLOT_SIZE);
  const z0 = Math.floor((box[2] + 1 + halfH) / PLOT_SIZE), z1 = Math.floor((box[5] - 1 + halfH) / PLOT_SIZE);
  return { px: x0, pz: z0, w: Math.max(1, x1 - x0 + 1), h: Math.max(1, z1 - z0 + 1) };
}

/**
 * Interim source over the scene graph (PlaceholderCity company meshes carry `userData.buildingId`). Re-scans at most
 * every 250 ms, and only when the set of tagged objects changed.
 */
export class SceneGraphCitySource implements CityInteractionSource {
  revision = 0;
  private refs = new Map<number, CityBuildingRef>();
  private objects = new Map<number, THREE.Object3D>();
  private index: PickIndex | null = null;
  private signature = '';
  private lastScan = -Infinity;

  constructor(private readonly ctx: SceneContext) {}

  get cityId(): string | null {
    return this.ctx.world?.cityId ?? null;
  }

  get gridW(): number {
    return this.ctx.world?.gridW ?? 0;
  }

  get gridH(): number {
    return this.ctx.world?.gridH ?? 0;
  }

  /** Re-scan when due. Returns true when the buildings changed. */
  refresh(nowMs: number, force = false): boolean {
    if (!force && nowMs - this.lastScan < 250) return false;
    this.lastScan = nowMs;
    const world = this.ctx.world;
    if (!world) return false;
    const found: THREE.Object3D[] = [];
    this.ctx.scene.traverseVisible((o) => {
      if (typeof o.userData.buildingId === 'number') found.push(o);
    });
    const signature = `${world.cityId}|${world.gridW}x${world.gridH}|` + found.map((o) => `${o.userData.buildingId}:${o.uuid}`).sort().join(',');
    if (signature === this.signature) return false;
    this.signature = signature;
    this.refs.clear();
    this.objects.clear();
    for (const o of found) {
      const id = o.userData.buildingId as number;
      o.updateWorldMatrix(true, false);
      _box.setFromObject(o);
      if (_box.isEmpty()) continue;
      const box = [_box.min.x, _box.min.y, _box.min.z, _box.max.x, _box.max.y, _box.max.z] as const;
      this.refs.set(id, { id, ...footprintOfBox(box, world.gridW, world.gridH), box });
      this.objects.set(id, o);
    }
    this.index = buildPickIndex(world.gridW, world.gridH, this.refs.values());
    this.revision++;
    return true;
  }

  getPickIndex(): PickIndex | null {
    return this.index;
  }

  getBuilding(id: number): CityBuildingRef | null {
    return this.refs.get(id) ?? null;
  }

  buildings(): Iterable<CityBuildingRef> {
    return this.refs.values();
  }

  getBuildingObject(id: number): THREE.Object3D | null {
    return this.objects.get(id) ?? null;
  }
}
