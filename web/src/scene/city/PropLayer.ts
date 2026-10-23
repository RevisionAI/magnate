// Instanced props of the whole city (art §5.5): one InstancedMesh per (family, 400 m cell, LOD), filled from the
// props every chunk build returns. A chunk swap only refills the cells its old and new props touch. Per frame each
// cell is shown or hidden by its family's distance band (art §5.8), switches to LOD1 geometry where the family has
// one, and casts shadows per the tier's tree-shadow policy (LOW: trees within `treeShadowRadius` of the target).
//
// Families resolve through W3's PROP_FAMILIES (with LOD1 geometry and bands) and W4's registry (PropFamily with a
// single LOD); unknown ids are skipped. Light pools use the same machinery with an additive material.
import * as THREE from 'three';
import { GeoBuilder, toBufferGeometry } from '../assets/GeoBuilder';
import { CELL_M, LOD_BANDS } from '../assets/Instancing';
import { PROP_FAMILIES } from '../assets/familiesA';
import { propFamilyFor } from '../assets/registry';
import type { QualityKnobs } from '../core/Quality';
import { PROP_STRIDE } from './chunkProtocol';

interface FamilyGeo {
  id: string;
  lod0: THREE.BufferGeometry | null;
  lod1: THREE.BufferGeometry | null;
  maxDistance: number;
  lod1Distance: number;
  castShadow: boolean;
  tree: boolean;
  material: THREE.Material;
}

interface Cell {
  key: string;
  family: FamilyGeo;
  cx: number;
  cz: number;
  radius: number;
  lod0: THREE.InstancedMesh | null;
  lod1: THREE.InstancedMesh | null;
  state: -1 | 0 | 1;
  casting: boolean;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const POOL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vTone;
void main() {
  vUv = uv;
  vTone = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vTone = instanceColor;
  #endif
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;
const POOL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vTone;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  gl_FragColor = vec4(uColor * vTone * a * a * uOpacity, 1.0);
  #include <colorspace_fragment>
}
`;

export const POOL_FAMILY = '__pool';
const COOL_TONE = new THREE.Color(0.62, 0.8, 1.25);

export interface PropLayerStats { instances: number; cells: number; visibleCells: number }

export class PropLayer {
  readonly group = new THREE.Group();
  /** Per chunk: family → packed instances (PROP_STRIDE floats each). */
  private readonly chunks = new Map<number, Map<string, Float32Array>>();
  /** (family|cell) → contributing chunks. */
  private readonly cellChunks = new Map<string, Set<number>>();
  private readonly cells = new Map<string, Cell>();
  private readonly families = new Map<string, FamilyGeo | null>();
  readonly poolMaterial: THREE.ShaderMaterial;
  private readonly poolGeo: THREE.BufferGeometry;

  constructor(private readonly material: THREE.Material) {
    this.group.name = 'city-props';
    this.poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.poolMaterial = new THREE.ShaderMaterial({
      name: 'CityLightPool', vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color(1.0, 0.72, 0.4) }, uOpacity: { value: 0 } },
    });
  }

  private family(id: string): FamilyGeo | null {
    if (this.families.has(id)) return this.families.get(id)!;
    let fam: FamilyGeo | null = null;
    if (id === POOL_FAMILY) {
      fam = { id, lod0: this.poolGeo, lod1: null, maxDistance: LOD_BANDS.lightPools, lod1Distance: Infinity, castShadow: false, tree: false, material: this.poolMaterial };
    } else if (id in PROP_FAMILIES) {
      const f = PROP_FAMILIES[id as keyof typeof PROP_FAMILIES];
      const g0 = new GeoBuilder(); f.build(g0, 0);
      const a0 = g0.finish();
      let lod1: THREE.BufferGeometry | null = null;
      if (f.triBudget.lod1 > 0) {
        const g1 = new GeoBuilder(); f.build(g1, 1);
        const a1 = g1.finish();
        if (a1.triangleCount > 0) lod1 = toBufferGeometry(a1);
      }
      fam = {
        id, lod0: a0.triangleCount > 0 ? toBufferGeometry(a0) : null, lod1, maxDistance: f.maxDistance, lod1Distance: f.lod1Distance,
        castShadow: f.castShadow, tree: id.startsWith('tree.'), material: this.material,
      };
    } else {
      const f = propFamilyFor(id);
      if (f) {
        const g = new GeoBuilder(); f.build(g);
        const a = g.finish();
        fam = { id, lod0: a.triangleCount > 0 ? toBufferGeometry(a) : null, lod1: null, maxDistance: f.maxDistance, lod1Distance: Infinity, castShadow: f.castShadow, tree: false, material: this.material };
      }
    }
    if (fam && !fam.lod0 && !fam.lod1) fam = null;
    this.families.set(id, fam);
    return fam;
  }

  private readonly dirty = new Set<string>();

  /** Replace a chunk's props (null removes them). Cells refill on the next flush(). */
  setChunk(chunk: number, props: Record<string, Float32Array> | null): void {
    const dirty = this.dirty;
    const old = this.chunks.get(chunk);
    const mark = (fam: string, data: Float32Array) => {
      for (let o = 0; o < data.length; o += PROP_STRIDE) dirty.add(`${fam}|${cellKey(data[o], data[o + 2])}`);
    };
    if (old) for (const [fam, data] of old) mark(fam, data);
    if (props && Object.keys(props).length) {
      const next = new Map<string, Float32Array>();
      for (const fam of Object.keys(props).sort()) {
        const data = props[fam];
        if (!data.length) continue;
        next.set(fam, data);
        mark(fam, data);
        for (let o = 0; o < data.length; o += PROP_STRIDE) {
          const k = `${fam}|${cellKey(data[o], data[o + 2])}`;
          let set = this.cellChunks.get(k);
          if (!set) { set = new Set(); this.cellChunks.set(k, set); }
          set.add(chunk);
        }
      }
      this.chunks.set(chunk, next);
    } else {
      this.chunks.delete(chunk);
    }
  }

  /** Refill the cells touched since the last flush. Returns true when shadow casters may have changed. */
  flush(): boolean {
    if (!this.dirty.size) return false;
    let shadows = false;
    for (const k of [...this.dirty].sort()) shadows = this.rebuildCell(k) || shadows;
    this.dirty.clear();
    return shadows;
  }

  private rebuildCell(key: string): boolean {
    const [fam] = key.split('|');
    const prev = this.cells.get(key);
    const hadShadow = !!prev?.casting;
    if (prev) this.disposeCell(prev);
    this.cells.delete(key);
    const geo = this.family(fam);
    const contributors = this.cellChunks.get(key);
    if (!geo || !contributors) return hadShadow;
    const cell = key.slice(fam.length + 1);
    // Gather the instances of this family that fall in the cell, from every contributing chunk (sorted: deterministic).
    const items: number[] = [];
    for (const chunk of [...contributors].sort((a, b) => a - b)) {
      const data = this.chunks.get(chunk)?.get(fam);
      if (!data) { contributors.delete(chunk); continue; }
      let any = false;
      for (let o = 0; o < data.length; o += PROP_STRIDE) {
        if (cellKey(data[o], data[o + 2]) !== cell) continue;
        any = true;
        for (let k = 0; k < PROP_STRIDE; k++) items.push(data[o + k]);
      }
      if (!any) contributors.delete(chunk);
    }
    if (!contributors.size) this.cellChunks.delete(key);
    const count = items.length / PROP_STRIDE;
    if (!count) return hadShadow;
    const [ix, iz] = cell.split(',').map(Number);
    const entry: Cell = { key, family: geo, cx: (ix + 0.5) * CELL_M, cz: (iz + 0.5) * CELL_M, radius: CELL_M * 0.75, lod0: null, lod1: null, state: -1, casting: false };
    const make = (g: THREE.BufferGeometry | null, lod: number): THREE.InstancedMesh | null => {
      if (!g) return null;
      const mesh = new THREE.InstancedMesh(g, geo.material, count);
      let colored = false;
      for (let i = 0; i < count; i++) if (items[i * PROP_STRIDE + 5] >= 0) { colored = true; break; }
      for (let i = 0; i < count; i++) {
        const o = i * PROP_STRIDE;
        _q.setFromAxisAngle(UP, items[o + 3]);
        _p.set(items[o], items[o + 1], items[o + 2]);
        const sc = fam === POOL_FAMILY ? items[o + 4] * 2 : items[o + 4];
        _s.setScalar(sc);
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
        if (colored) {
          const col = items[o + 5];
          if (fam === POOL_FAMILY) mesh.setColorAt(i, col > 0 ? COOL_TONE : _c.setRGB(1, 1, 1));
          else mesh.setColorAt(i, col >= 0 ? _c.setHex(col) : _c.setRGB(1, 1, 1));
        }
      }
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = fam !== POOL_FAMILY;
      mesh.visible = false;
      mesh.name = `${fam}-${cell}-lod${lod}`;
      if (fam === POOL_FAMILY) mesh.renderOrder = 2;
      this.group.add(mesh);
      return mesh;
    };
    entry.lod0 = make(geo.lod0, 0);
    entry.lod1 = make(geo.lod1, 1);
    this.cells.set(key, entry);
    return hadShadow || geo.castShadow;
  }

  /**
   * Distance bands, LOD and shadow casting. `night` gates light pools. Returns true when the set of shadow casters
   * changed (the caller requests a shadow-map refresh).
   */
  update(camera: THREE.Vector3, target: THREE.Vector3, knobs: QualityKnobs, night: number): boolean {
    let shadowDirty = false;
    this.poolMaterial.uniforms.uOpacity.value = 0.14 * night;
    const poolsOn = night > 0.02;
    for (const cell of this.cells.values()) {
      const f = cell.family;
      const d = Math.hypot(cell.cx - camera.x, cell.cz - camera.z, camera.y) - cell.radius;
      const lodDist = f.tree ? knobs.treeLod1Distance : f.lod1Distance;
      let state: -1 | 0 | 1 = d > f.maxDistance ? -1 : (d > lodDist && cell.lod1) || !cell.lod0 ? 1 : 0;
      if (f.id === POOL_FAMILY && !poolsOn) state = -1;
      if (state !== cell.state) {
        if (cell.lod0) cell.lod0.visible = state === 0;
        if (cell.lod1) cell.lod1.visible = state === 1;
        if (cell.casting) shadowDirty = true;
        cell.state = state;
      }
      let cast = false;
      if (f.castShadow && state === 0 && knobs.shadows) {
        if (f.tree) {
          const dt = Math.hypot(cell.cx - target.x, cell.cz - target.z) - cell.radius;
          cast = knobs.treeShadows && dt < knobs.treeShadowRadius;
        } else cast = true;
      }
      if (cast !== cell.casting) {
        cell.casting = cast;
        if (cell.lod0) cell.lod0.castShadow = cast;
        shadowDirty = true;
      }
    }
    return shadowDirty;
  }

  stats(): PropLayerStats {
    let instances = 0, visible = 0;
    for (const c of this.cells.values()) {
      instances += c.lod0?.count ?? c.lod1?.count ?? 0;
      if (c.state >= 0) visible++;
    }
    return { instances, cells: this.cells.size, visibleCells: visible };
  }

  /** Instance count of a family (tests, read-outs). */
  count(familyId: string): number {
    let n = 0;
    for (const c of this.cells.values()) if (c.family.id === familyId) n += c.lod0?.count ?? c.lod1?.count ?? 0;
    return n;
  }

  private disposeCell(c: Cell): void {
    for (const m of [c.lod0, c.lod1]) {
      if (!m) continue;
      m.removeFromParent();
      m.dispose();
    }
  }

  clear(): void {
    for (const c of this.cells.values()) this.disposeCell(c);
    this.cells.clear();
    this.chunks.clear();
    this.cellChunks.clear();
    this.dirty.clear();
  }

  dispose(): void {
    this.clear();
    for (const f of this.families.values()) {
      if (!f || f.id === POOL_FAMILY) continue;
      f.lod0?.dispose();
      f.lod1?.dispose();
    }
    this.families.clear();
    this.poolGeo.dispose();
    this.poolMaterial.dispose();
    this.group.removeFromParent();
  }
}

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`;
}

/** Pack light pools ([x, y, z, radius, tone] × n) into prop records of the pool family. */
export function poolsAsProps(pools: Float32Array): Float32Array {
  const n = pools.length / 5;
  const out = new Float32Array(n * PROP_STRIDE);
  for (let i = 0; i < n; i++) {
    out[i * PROP_STRIDE] = pools[i * 5];
    out[i * PROP_STRIDE + 1] = pools[i * 5 + 1] + 0.15;
    out[i * PROP_STRIDE + 2] = pools[i * 5 + 2];
    out[i * PROP_STRIDE + 3] = 0;
    out[i * PROP_STRIDE + 4] = pools[i * 5 + 3];
    out[i * PROP_STRIDE + 5] = pools[i * 5 + 4] > 0 ? 1 : 0;
  }
  return out;
}
