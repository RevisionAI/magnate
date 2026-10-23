// Instanced trees on CityMaterial (art §3.3 vegetation, §3.14 seasons, §5.5 instancing, §5.8 LOD bands).
// Used by the outskirts forests and the interim synthetic city; W2/W3 may reuse it for street and park trees.
//
// - Partitioned into square cells (InstancedMesh culls as one bounding sphere, so a global mesh would vertex-shade
//   off-screen trees; partitioning measured −3.3 ms at close zoom on the UHD 630).
// - Per-cell LOD: LOD0 (20–32 triangles, deciduous and conifer models) near the camera, LOD1 (8 triangles, one
//   diamond model scaled per species) beyond `knobs.treeLod1Distance`.
// - Shadows: LOD0 cells cast when `knobs.treeShadows`; on LOW only within `knobs.treeShadowRadius` of the target.
// - Seasons recolour deciduous instances in place (autumn share, bare winter canopies, spring blossom).
import * as THREE from 'three';
import { GeoBuilder, toBufferGeometry, type RGB } from '../assets/GeoBuilder';
import { blob, cone, triAuto } from '../assets/shapes';
import { FLAG_SNOWABLE, FLAG_VEGETATION } from '../materials/CityMaterial';
import type { QualityKnobs } from '../core/Quality';
import type { SeasonState } from './Seasons';
import { hash3 } from './rng';

export const SPECIES_DECIDUOUS = 0;
export const SPECIES_CONIFER = 1;

export interface TreeInstance {
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Overall scale (1 ≈ 8 m deciduous / 11 m conifer). */
  scale: number;
  species: 0 | 1;
}

const WHITE: RGB = [255, 255, 255];
const TRUNK: RGB = [0x6e, 0x52, 0x3e];

// Leaf colours (art §3.3) and the per-instance tint jitter (×0.88–1.0).
const LEAF = ['#5E9A4B', '#72A852', '#4B8743'].map((h) => new THREE.Color(h));
const CONIFER = new THREE.Color('#3A6B48');
const AUTUMN = ['#D09A45', '#C0633A'].map((h) => new THREE.Color(h));
const BARE = new THREE.Color('#8A7F70');
const BLOSSOM = new THREE.Color('#F2C6D0');
const TINTS = ['#FFFFFF', '#E8F2D8', '#F4F7E6', '#DDEBCB', '#FFF2D0'].map((h) => new THREE.Color(h));

let models: { lod0: [THREE.BufferGeometry, THREE.BufferGeometry]; lod1: THREE.BufferGeometry } | null = null;
let modelUsers = 0;

function buildModels(): NonNullable<typeof models> {
  // Deciduous LOD0: 4-sided trunk + 3-ring blob crown (32 triangles).
  const d = new GeoBuilder();
  d.tint = 0; d.flags = 0;
  d.box(-0.25, 0, -0.25, 0.25, 2.6, 0.25, TRUNK, TRUNK, null, false);
  d.tint = 255; d.flags = FLAG_VEGETATION | FLAG_SNOWABLE;
  blob(d, 0, 5.2, 0, 3.0, 2.9, 3.0, 3, 6, WHITE);
  // Conifer LOD0: trunk + two stacked cones (20 triangles).
  const c = new GeoBuilder();
  c.tint = 0; c.flags = 0;
  c.box(-0.22, 0, -0.22, 0.22, 1.8, 0.22, TRUNK, TRUNK, null, false);
  c.tint = 255; c.flags = FLAG_VEGETATION | FLAG_SNOWABLE;
  cone(c, 0, 0, 2.6, 0, 1.4, 7.6, 6, WHITE);
  cone(c, 0, 0, 1.9, 0, 5.2, 11.2, 6, WHITE);
  // LOD1: one 8-triangle diamond (crown only); conifers use a tall, thin instance scale.
  const l = new GeoBuilder();
  l.tint = 255; l.flags = FLAG_VEGETATION | FLAG_SNOWABLE;
  const eq = [0, 1, 2, 3].map((i) => [Math.cos((i * Math.PI) / 2 + Math.PI / 4) * 3.0, 4.6, Math.sin((i * Math.PI) / 2 + Math.PI / 4) * 3.0]);
  for (let i = 0; i < 4; i++) {
    const a = eq[i], b = eq[(i + 1) % 4];
    triAuto(l, b, a, [0, 8.6, 0], WHITE);      // upper half (same winding as shapes.cone)
    triAuto(l, a, b, [0, 1.0, 0], WHITE);      // lower half
  }
  return { lod0: [toBufferGeometry(d.finish()), toBufferGeometry(c.finish())], lod1: toBufferGeometry(l.finish()) };
}

function acquireModels(): NonNullable<typeof models> {
  if (!models) models = buildModels();
  modelUsers++;
  return models;
}

function releaseModels(): void {
  if (--modelUsers > 0 || !models) return;
  models.lod0[0].dispose(); models.lod0[1].dispose(); models.lod1.dispose();
  models = null;
}

interface Cell {
  cx: number;
  cz: number;
  radius: number;
  lod0: THREE.InstancedMesh[];   // [deciduous, conifer] (either may be absent → length ≤ 2)
  lod1: THREE.InstancedMesh;
  /** Instance list per LOD0 mesh and for LOD1 (indices into `trees`). */
  lod0Ids: number[][];
  lod1Ids: number[];
  lodState: 0 | 1;
  casting: boolean;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

export class TreeField {
  readonly group = new THREE.Group();
  private readonly cells: Cell[] = [];
  private readonly models = acquireModels();
  private disposed = false;

  constructor(private readonly trees: readonly TreeInstance[], material: THREE.Material, readonly cellSize = 400, private readonly salt = 0) {
    this.group.name = 'trees';
    const byCell = new Map<string, number[]>();
    trees.forEach((t, i) => {
      const k = `${Math.floor(t.x / cellSize)},${Math.floor(t.z / cellSize)}`;
      let list = byCell.get(k);
      if (!list) { list = []; byCell.set(k, list); }
      list.push(i);
    });
    for (const key of [...byCell.keys()].sort()) {                // deterministic order
      const ids = byCell.get(key)!;
      const [ix, iz] = key.split(',').map(Number);
      const lod0Ids: number[][] = [ids.filter((i) => trees[i].species === SPECIES_DECIDUOUS), ids.filter((i) => trees[i].species === SPECIES_CONIFER)];
      const lod0: THREE.InstancedMesh[] = [];
      lod0Ids.forEach((list, species) => {
        const mesh = new THREE.InstancedMesh(this.models.lod0[species], material, Math.max(1, list.length));
        mesh.count = list.length;
        mesh.name = `trees-lod0-${species}`;
        lod0.push(mesh);
      });
      const lod1 = new THREE.InstancedMesh(this.models.lod1, material, ids.length);
      lod1.name = 'trees-lod1';
      const cell: Cell = { cx: (ix + 0.5) * cellSize, cz: (iz + 0.5) * cellSize, radius: cellSize * 0.75, lod0, lod1, lod0Ids, lod1Ids: ids, lodState: 1, casting: false };
      this.writeMatrices(cell);
      for (const mesh of [...lod0, lod1]) {
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        this.group.add(mesh);
      }
      lod1.visible = true;
      this.cells.push(cell);
    }
    this.applySeason(null);                    // also creates the instanceColor buffers before the first render
  }

  get count(): number {
    return this.trees.length;
  }

  private matrixFor(t: TreeInstance, lod1: boolean, bare: boolean): THREE.Matrix4 {
    _q.setFromAxisAngle(_up, t.rotY);
    _p.set(t.x, t.y, t.z);
    const k = t.scale * (bare ? 0.82 : 1);
    if (lod1 && t.species === SPECIES_CONIFER) _s.set(0.62 * k, 1.32 * k, 0.62 * k);
    else _s.setScalar(k);
    return _m.compose(_p, _q, _s);
  }

  private writeMatrices(cell: Cell, bareShare = 0): void {
    cell.lod0Ids.forEach((list, species) => {
      const mesh = cell.lod0[species];
      list.forEach((id, i) => mesh.setMatrixAt(i, this.matrixFor(this.trees[id], false, this.isBare(id, bareShare))));
      mesh.instanceMatrix.needsUpdate = true;
      if (list.length) mesh.computeBoundingSphere();
    });
    cell.lod1Ids.forEach((id, i) => cell.lod1.setMatrixAt(i, this.matrixFor(this.trees[id], true, this.isBare(id, bareShare))));
    cell.lod1.instanceMatrix.needsUpdate = true;
    cell.lod1.computeBoundingSphere();
  }

  private isBare(id: number, bareShare: number): boolean {
    return this.trees[id].species === SPECIES_DECIDUOUS && hash3(id, 7, this.salt) < bareShare;
  }

  /** Instance colour (linear) of tree `id` for a season. */
  private colorFor(id: number, s: SeasonState | null, out: THREE.Color): THREE.Color {
    const t = this.trees[id];
    const h0 = hash3(id, 1, this.salt), h1 = hash3(id, 2, this.salt), h2 = hash3(id, 3, this.salt);
    if (t.species === SPECIES_CONIFER) out.copy(CONIFER);
    else {
      out.copy(LEAF[Math.floor(h0 * LEAF.length) % LEAF.length]);
      if (s) {
        const hs = hash3(id, 7, this.salt);
        if (hs < s.bareShare) out.copy(BARE);
        else if (hs < s.bareShare + s.autumnShare) out.copy(AUTUMN[h2 < 0.55 ? 0 : 1]);
        else if (h2 < s.blossomShare) out.copy(BLOSSOM);
      }
    }
    return out.multiply(TINTS[Math.floor(h1 * TINTS.length) % TINTS.length]);
  }

  /** Recolour (and re-scale bare canopies) for a season. Cheap enough to call on every month change. */
  applySeason(season: SeasonState | null): void {
    const bare = season?.bareShare ?? 0;
    for (const cell of this.cells) {
      cell.lod0Ids.forEach((list, species) => {
        const mesh = cell.lod0[species];
        list.forEach((id, i) => mesh.setColorAt(i, this.colorFor(id, season, _c)));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
      cell.lod1Ids.forEach((id, i) => cell.lod1.setColorAt(i, this.colorFor(id, season, _c)));
      if (cell.lod1.instanceColor) cell.lod1.instanceColor.needsUpdate = true;
      this.writeMatrices(cell, bare);
    }
  }

  /**
   * Per-frame (cheap: one distance test per cell). Returns true when the set of shadow casters changed, so the
   * caller can request a shadow-map refresh.
   */
  update(cameraPos: THREE.Vector3, target: THREE.Vector3, knobs: QualityKnobs): boolean {
    let shadowDirty = false;
    const lodDist = knobs.treeLod1Distance;
    for (const cell of this.cells) {
      const dCam = Math.hypot(cell.cx - cameraPos.x, cell.cz - cameraPos.z, cameraPos.y) - cell.radius;
      const lod: 0 | 1 = dCam < lodDist ? 0 : 1;
      if (lod !== cell.lodState) {
        cell.lodState = lod;
        for (const m of cell.lod0) m.visible = lod === 0 && m.count > 0;
        cell.lod1.visible = lod === 1;
        if (cell.casting) shadowDirty = true;
      }
      const dTarget = Math.hypot(cell.cx - target.x, cell.cz - target.z) - cell.radius;
      const cast = lod === 0 && knobs.shadows && knobs.treeShadows && dTarget < knobs.treeShadowRadius;
      if (cast !== cell.casting) {
        cell.casting = cast;
        for (const m of cell.lod0) m.castShadow = cast;
        shadowDirty = true;
      }
    }
    return shadowDirty;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cell of this.cells) for (const m of [...cell.lod0, cell.lod1]) m.dispose();
    this.group.removeFromParent();
    releaseModels();
  }
}
