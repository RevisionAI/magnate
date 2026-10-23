// The interaction layer's view of the city (W6 contract `CityInteractionSource`, scene/interaction/CitySource.ts):
// company buildings with their rotated footprints and factory pick boxes, a grid pick index in W6's packed shape, and
// a real outline object per building (the building's own geometry, rebuilt on the main thread from the same factory
// the chunk worker used, on LAYER_SELECTION only so the camera never draws it twice).
//
// The types are mirrored structurally so this file compiles with or without W6's module present; registration goes
// through an eager glob import of `../interaction/CitySource.ts` (empty when the module does not exist).
import * as THREE from 'three';
import { toBufferGeometry, GeoBuilder } from '../assets/GeoBuilder';
import { LAYER_SELECTION } from '../SceneContext';
import { buildCompanyStructure } from './build/lots';
import type { CityBuildContext } from './build/CityBuildContext';
import type { CompanySpec } from './chunkProtocol';

/** W6 `CityBuildingRef`: rotated footprint (plots) + world AABB. */
export interface CityBuildingRef {
  id: number;
  px: number;
  pz: number;
  w: number;
  h: number;
  box: readonly [number, number, number, number, number, number];
}

/** W6 `PickIndex` (scene/interaction/Picking.ts). */
export interface InteractionPickIndex {
  w: number;
  h: number;
  cellBuilding: Int32Array;
  boxes: Float32Array;
  ids: number[];
  maxHeight: number;
}

/** What the adapter reads from the city module. */
export interface InteractionHost {
  readonly cityId: string | null;
  readonly gridW: number;
  readonly gridH: number;
  /** Company specs of the active city, sorted by id. */
  specs(): readonly CompanySpec[];
  /** Factory pick box of a built company building (null until its chunk is built). */
  box(id: number): THREE.Box3 | null;
  /** Main-thread build context of the active layout (covers installed), or null. */
  buildContext(): CityBuildContext | null;
  month(): number;
}

type Provide = (ctx: object, source: unknown) => void;
const interactionModules = import.meta.glob<{ provideCitySource?: Provide }>('../interaction/CitySource.ts', { eager: true });

/** Register (or clear) the city's source with the interaction layer, when that layer is present. */
export function provideInteractionSource(ctx: object, source: CityInteractionAdapter | null): boolean {
  let done = false;
  for (const m of Object.values(interactionModules)) {
    if (typeof m.provideCitySource === 'function') { m.provideCitySource(ctx, source); done = true; }
  }
  return done;
}

export class CityInteractionAdapter {
  /** Bumps whenever buildings, boxes or the pick index change. */
  revision = 0;
  readonly outlineGroup = new THREE.Group();
  private refs = new Map<number, CityBuildingRef>();
  private index: InteractionPickIndex | null = null;
  private readonly objects = new Map<number, { key: string; mesh: THREE.Mesh }>();

  constructor(private readonly host: InteractionHost, private readonly material: THREE.Material) {
    this.outlineGroup.name = 'city-outline-objects';
  }

  get cityId(): string | null { return this.host.cityId; }
  get gridW(): number { return this.host.gridW; }
  get gridH(): number { return this.host.gridH; }

  /** Rebuild the building list and pick index (after a cityView or pick-box change). */
  refresh(): void {
    const refs = new Map<number, CityBuildingRef>();
    for (const s of this.host.specs()) {
      const b = this.host.box(s.id);
      if (!b) continue;
      refs.set(s.id, { id: s.id, px: s.px, pz: s.pz, w: s.w, h: s.h, box: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z] });
    }
    this.refs = refs;
    this.index = packPickIndex(this.host.gridW, this.host.gridH, refs.values());
    // Outline objects whose building changed (or vanished) are dropped; W6 re-asks when its object loses its parent.
    const keys = new Map(this.host.specs().map((s) => [s.id, specKey(s)]));
    for (const [id, o] of [...this.objects]) {
      if (keys.get(id) !== o.key || !refs.has(id)) this.dropObject(id);
    }
    this.revision++;
  }

  /** City switch: forget everything. */
  reset(): void {
    for (const id of [...this.objects.keys()]) this.dropObject(id);
    this.refs = new Map();
    this.index = null;
    this.revision++;
  }

  getPickIndex(): InteractionPickIndex | null {
    return this.index;
  }

  getBuilding(id: number): CityBuildingRef | null {
    return this.refs.get(id) ?? null;
  }

  buildings(): Iterable<CityBuildingRef> {
    return this.refs.values();
  }

  /** The building's own geometry (LOD1: same silhouette, fewer triangles) for the outline pass; null if unknown. */
  getBuildingObject(id: number): THREE.Object3D | null {
    const spec = this.host.specs().find((s) => s.id === id);
    const ctx = this.host.buildContext();
    if (!spec || !ctx || !this.refs.has(id)) return null;
    const key = specKey(spec);
    const have = this.objects.get(id);
    if (have && have.key === key) return have.mesh;
    if (have) this.dropObject(id);
    const b = new GeoBuilder();
    buildCompanyStructure(ctx, b, spec, this.host.month(), 1);
    const arrays = b.finish();
    if (!arrays.triangleCount) return null;
    const mesh = new THREE.Mesh(toBufferGeometry(arrays), this.material);
    mesh.name = `outline-building-${id}`;
    mesh.position.y = ctx.companyTerrace.get(id) ?? 0;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.layers.set(LAYER_SELECTION);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.buildingId = id;
    mesh.userData.cityOutline = true;
    this.outlineGroup.add(mesh);
    mesh.updateMatrixWorld(true);
    this.objects.set(id, { key, mesh });
    return mesh;
  }

  private dropObject(id: number): void {
    const o = this.objects.get(id);
    if (!o) return;
    o.mesh.removeFromParent();
    o.mesh.geometry.dispose();
    this.objects.delete(id);
  }

  dispose(): void {
    for (const id of [...this.objects.keys()]) this.dropObject(id);
    this.outlineGroup.removeFromParent();
  }
}

function specKey(s: CompanySpec): string {
  return JSON.stringify([s.typeId, s.px, s.pz, s.w, s.h, s.turns, s.level, s.stage, s.progress, s.owner]);
}

/** W6's packed grid index: later entries win on shared plots (none overlap in practice). */
export function packPickIndex(w: number, h: number, entries: Iterable<CityBuildingRef>): InteractionPickIndex {
  const list = [...entries];
  const cellBuilding = new Int32Array(Math.max(0, w * h)).fill(-1);
  const boxes = new Float32Array(list.length * 6);
  const ids: number[] = [];
  let maxHeight = 1;
  list.forEach((e, slot) => {
    ids.push(e.id);
    for (let k = 0; k < 6; k++) boxes[slot * 6 + k] = e.box[k];
    maxHeight = Math.max(maxHeight, e.box[4]);
    for (let z = Math.max(0, e.pz); z < Math.min(h, e.pz + e.h); z++) {
      for (let x = Math.max(0, e.px); x < Math.min(w, e.px + e.w); x++) cellBuilding[z * w + x] = slot;
    }
  });
  return { w, h, cellBuilding, boxes, ids, maxHeight: maxHeight + 1 };
}
