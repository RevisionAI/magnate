// three.js objects for a synthetic city: merged chunk meshes (depth pre-pass occluders), instanced trees, street
// lamps with emissive heads, night light pools and the far-field lamp grid (art §3.13), with the distance bands of
// art §5.8. Also derives the SceneWorld and the audio LandUseGrid from the layout.
import * as THREE from 'three';
import { GeoBuilder, toBufferGeometry, type RGB } from '../../assets/GeoBuilder';
import { buildPartitionedFamily, CELL_M, LOD_BANDS } from '../../assets/Instancing';
import { makeCityMaterial } from '../../materials/CityMaterial';
import { LAYER_OCCLUDER } from '../../core/PostPipeline';
import type { QualityKnobs } from '../../core/Quality';
import { TreeField } from '../../env/Trees';
import type { SeasonState, Climate } from '../../env/Seasons';
import type { SceneWorld } from '../../env/World';
import { LandUseGrid } from '../../audio/AudioFrameProducer';
import type { SyntheticLayout } from './Layout';
import { buildSyntheticCity, type LampInstance, type SyntheticCityArrays } from './Builder';

const LAMP_POLE: RGB = [0x4a, 0x4e, 0x55];
const LAMP_HEAD: RGB = [0xff, 0xe6, 0xb8];

/** Street lamp: pole, arm towards local +Z, emissive head (extra.x = 255 → glows at night). 30 triangles. */
function lampGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.tint = 0;
  b.box(-0.11, 0, -0.11, 0.11, 7.6, 0.11, LAMP_POLE, LAMP_POLE);
  b.box(-0.06, 7.45, 0, 0.06, 7.6, 1.9, LAMP_POLE, LAMP_POLE);
  // Head: five faces with full emission.
  const x0 = -0.3, x1 = 0.3, y0 = 7.25, y1 = 7.5, z0 = 1.4, z1 = 2.3;
  b.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], LAMP_HEAD, null, null, 255);
  b.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], LAMP_HEAD, null, null, 255);
  b.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], LAMP_HEAD, null, null, 255);
  b.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], LAMP_HEAD, null, null, 255);
  b.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], LAMP_HEAD, null, null, 255);
  b.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], LAMP_POLE);
  return toBufferGeometry(b.finish());
}

const POOL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
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
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  gl_FragColor = vec4(uColor * a * a * uOpacity, 1.0);
  #include <colorspace_fragment>
}
`;

interface CellGroup { mesh: THREE.Object3D; cx: number; cz: number }

export interface SyntheticCityStats {
  triangles: number;
  buildings: number;
  chunks: number;
  trees: number;
  lamps: number;
  buildMs: number;
}

/** SceneWorld for a synthetic layout. */
export function worldFromLayout(layout: SyntheticLayout, cityId: string, climate: Climate, reliefM: number, population: number): SceneWorld {
  return { cityId, gridW: layout.gridW, gridH: layout.gridH, seed: layout.seed, climate, water: layout.water, reliefM, highways: layout.highways, population };
}

export class SyntheticCityView {
  readonly group = new THREE.Group();
  readonly material = makeCityMaterial();
  readonly trees: TreeField;
  readonly landUse: LandUseGrid;
  readonly stats: SyntheticCityStats;
  readonly arrays: SyntheticCityArrays;
  private readonly chunkMeshes: THREE.Mesh[] = [];
  private readonly lampCells: CellGroup[] = [];
  private readonly poolCells: CellGroup[] = [];
  private readonly lampGeo = lampGeometry();
  private readonly poolGeo = new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2);
  private readonly poolMat: THREE.ShaderMaterial;
  private readonly farLamps: THREE.Points;
  private readonly farMat: THREE.PointsMaterial;

  constructor(readonly layout: SyntheticLayout, cityId: string, opts: { coastal: boolean; population: number }) {
    const t0 = performance.now();
    this.group.name = 'synthetic-city';
    const arrays = buildSyntheticCity(layout);
    this.arrays = arrays;
    for (const c of arrays.chunks) {
      const mesh = new THREE.Mesh(toBufferGeometry(c.arrays), this.material);
      mesh.name = `chunk-${c.ix}-${c.iz}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.layers.enable(LAYER_OCCLUDER);
      this.chunkMeshes.push(mesh);
      this.group.add(mesh);
    }
    this.trees = new TreeField(arrays.trees, this.material, CELL_M, layout.seed);
    this.group.add(this.trees.group);

    const lampGroup = buildPartitionedFamily(this.lampGeo, this.material, arrays.lamps.map((l) => ({ x: l.x, z: l.z, rotY: l.rotY, scale: 1 })), false);
    for (const child of [...lampGroup.children]) this.lampCells.push(cellOf(child as THREE.InstancedMesh));
    lampGroup.name = 'street-lamps';
    this.group.add(lampGroup);

    this.poolMat = new THREE.ShaderMaterial({
      name: 'LightPool', vertexShader: POOL_VERT, fragmentShader: POOL_FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color(1.0, 0.72, 0.4) }, uOpacity: { value: 0 } },
    });
    const pools = buildPools(arrays.lamps, this.poolGeo, this.poolMat);
    pools.name = 'light-pools';
    for (const child of pools.children) this.poolCells.push(cellOf(child as THREE.InstancedMesh));
    this.group.add(pools);

    // Far-field lamps: one warm point per lamp so the road grid reads as strings of light at night (> 800 m).
    const pts = new Float32Array(arrays.lamps.length * 3);
    arrays.lamps.forEach((l, i) => { pts[i * 3] = l.x + Math.sin(l.rotY) * 1.9; pts[i * 3 + 1] = 7.4; pts[i * 3 + 2] = l.z + Math.cos(l.rotY) * 1.9; });
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    pg.computeBoundingSphere();
    this.farMat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, color: new THREE.Color('#FFC98A').multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    this.farLamps = new THREE.Points(pg, this.farMat);
    this.farLamps.name = 'far-lamps';
    this.farLamps.visible = false;
    this.group.add(this.farLamps);

    this.landUse = new LandUseGrid(cityId, layout.gridW, layout.gridH, arrays.landUse, opts);
    this.stats = {
      triangles: arrays.triangles, buildings: arrays.buildings, chunks: arrays.chunks.length, trees: arrays.trees.length,
      lamps: arrays.lamps.length, buildMs: performance.now() - t0,
    };
  }

  applySeason(season: SeasonState): void {
    this.trees.applySeason(season);
  }

  /**
   * Distance bands (art §5.8): lamps ≤ 800 m, light pools ≤ 900 m at night, far-field lamp points beyond, tree LOD.
   * Returns true when shadow casters changed.
   */
  update(cameraPos: THREE.Vector3, target: THREE.Vector3, distance: number, night: number, knobs: QualityKnobs): boolean {
    const r = CELL_M * 0.75;
    for (const c of this.lampCells) c.mesh.visible = Math.hypot(c.cx - cameraPos.x, c.cz - cameraPos.z, cameraPos.y) - r < LOD_BANDS.lamps;
    const poolsOn = night > 0.02;
    this.poolMat.uniforms.uOpacity.value = 0.14 * night;
    for (const c of this.poolCells) c.mesh.visible = poolsOn && Math.hypot(c.cx - cameraPos.x, c.cz - cameraPos.z, cameraPos.y) - r < LOD_BANDS.lightPools;
    this.farLamps.visible = poolsOn && distance > LOD_BANDS.lamps * 0.85;
    this.farMat.opacity = night * Math.min(1, (distance - LOD_BANDS.lamps * 0.85) / 200);
    return this.trees.update(cameraPos, target, knobs);
  }

  dispose(): void {
    for (const m of this.chunkMeshes) m.geometry.dispose();
    this.trees.dispose();
    this.group.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
    this.lampGeo.dispose();
    this.poolGeo.dispose();
    this.poolMat.dispose();
    this.farLamps.geometry.dispose();
    this.farMat.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

function cellOf(mesh: THREE.InstancedMesh): CellGroup {
  mesh.computeBoundingSphere();
  const s = mesh.boundingSphere;
  return { mesh, cx: s ? s.center.x : 0, cz: s ? s.center.z : 0 };
}

function buildPools(lamps: readonly LampInstance[], geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Group {
  const cells = new Map<string, LampInstance[]>();
  for (const l of lamps) {
    const k = `${Math.floor(l.x / CELL_M)},${Math.floor(l.z / CELL_M)}`;
    let list = cells.get(k);
    if (!list) { list = []; cells.set(k, list); }
    list.push(l);
  }
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  for (const key of [...cells.keys()].sort()) {
    const list = cells.get(key)!;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((l, i) => mesh.setMatrixAt(i, m.makeTranslation(l.x + Math.sin(l.rotY) * 2.2, 0.2, l.z + Math.cos(l.rotY) * 2.2)));
    mesh.computeBoundingSphere();
    mesh.renderOrder = 2;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    group.add(mesh);
  }
  return group;
}
