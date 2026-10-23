// Draws moving vehicles (art §5.16 "Rendering"): one InstancedMesh per model and LOD with DynamicDrawUsage, compacted
// to the visible instances every frame (count = visible), CPU frustum culling per vehicle, LOD1 boxes beyond 500 m from
// the camera, ambient traffic hidden beyond the district band (camera distance > 1,100 m) while company trucks turn
// into owner-coloured road dots at city zoom so supply chains stay readable from the overview.
import * as THREE from 'three';
import { GeoBuilder, toBufferGeometry, type RGB } from '../../assets/GeoBuilder';
import { propFamilyFor } from '../../assets/registry';
import { VEHICLE_MODELS, SEMI_PROP_IDS, SEMI_LENGTH, type VehicleModelId } from '../../assets/families/vehicles';
import { makeCityMaterial } from '../../materials/CityMaterial';
import { shade } from '../../assets/palette';
import type { Pose } from './RoadGraph';

/** Camera distance (to the orbit target) beyond which ambient vehicles are hidden (art §5.8). */
export const VEHICLE_BAND = 1100;
/** Per-vehicle camera distance beyond which LOD1 boxes are drawn. */
export const LOD1_DISTANCE = 500;
/** Per-vehicle camera distance beyond which nothing is drawn. */
export const MAX_DRAW_DISTANCE = 2400;

const WHITE: RGB = [255, 255, 255];

/** An item to draw this frame. */
export interface VehicleDraw {
  model: string;
  pose: Pose;
  scale: number;
  /** Linear RGB instance colour. */
  r: number;
  g: number;
  b: number;
  /** Bounding radius for culling. */
  radius: number;
  /** Company truck: drawn as a dot at city zoom. */
  dot: boolean;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  count: number;
}

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

/** Linear colour of an sRGB byte triple. */
export function linearRgb(c: readonly [number, number, number]): [number, number, number] {
  return [SRGB_TO_LINEAR[c[0]], SRGB_TO_LINEAR[c[1]], SRGB_TO_LINEAR[c[2]]];
}

export class VehicleRenderer {
  readonly group = new THREE.Group();
  readonly material = makeCityMaterial();
  private readonly geos = new Map<string, [THREE.BufferGeometry, THREE.BufferGeometry]>();
  private readonly batches = new Map<string, Batch>();
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly dotGeo: THREE.BufferGeometry;
  drawn = 0;

  constructor() {
    this.group.name = 'living-city-vehicles';
    for (const id of Object.keys(VEHICLE_MODELS) as VehicleModelId[]) {
      if (id === 'containerShip') continue;
      const m = VEHICLE_MODELS[id];
      this.geos.set(id, [geometryOf((b) => m.build(b, 0)), geometryOf((b) => m.build(b, 1))]);
    }
    for (const id of SEMI_PROP_IDS) {
      const fam = propFamilyFor(id);
      if (!fam) continue;
      const lod1 = geometryOf((b) => {
        b.tint = 0;
        b.box(-1.25, 0.3, -SEMI_LENGTH / 2, 1.25, 4.0, SEMI_LENGTH / 2 - 2.6, shade(WHITE, 0.92), WHITE);
        b.tint = 255;
        b.box(-1.25, 0.3, SEMI_LENGTH / 2 - 2.5, 1.25, 3.5, SEMI_LENGTH / 2, WHITE, WHITE);
      });
      this.geos.set(id, [geometryOf((b) => fam.build(b)), lod1]);
    }
    // road dot for company trucks at city zoom: a flat octagon, tinted by the owner colour, glowing at night
    this.dotGeo = geometryOf((b) => {
      b.tint = 255;
      const n = 8, r = 1;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        b.tri([0, 0, 0], [Math.sin(a0) * r, 0, Math.cos(a0) * r], [Math.sin(a1) * r, 0, Math.cos(a1) * r], [0, 1, 0], WHITE, 120);
      }
    });
  }

  private batch(key: string, geo: THREE.BufferGeometry, need: number): Batch {
    let b = this.batches.get(key);
    if (b && b.mesh.instanceMatrix.count >= need) return b;
    const cap = Math.max(32, 1 << Math.ceil(Math.log2(Math.max(need, 1) * 1.25)));
    if (b) {
      this.group.remove(b.mesh);
      b.mesh.dispose();
    }
    const mesh = new THREE.InstancedMesh(geo, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = `vehicles:${key}`;
    mesh.count = 0;
    this.group.add(mesh);
    b = { mesh, count: 0 };
    this.batches.set(key, b);
    return b;
  }

  /**
   * Draw the given vehicles. `cameraDistance` is the camera-to-target distance (zoom band); per-vehicle LOD uses the
   * distance to the camera itself.
   */
  render(items: readonly VehicleDraw[], camera: THREE.Camera, cameraDistance: number): void {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    for (const b of this.batches.values()) b.count = 0;
    const cam = camera.position;
    const cityZoom = cameraDistance > VEHICLE_BAND;
    // ~15 px across at any city-band zoom (1 px ≈ 0.00058 × distance with the rig's 35° FOV at 1080 p)
    const dotScale = Math.min(16, Math.max(4, cameraDistance * 0.0045));
    // count per key first so batches are allocated once per frame
    const need = new Map<string, number>();
    for (const it of items) {
      const key = cityZoom ? (it.dot ? 'dot' : '') : it.model;
      if (key) need.set(key, (need.get(key) ?? 0) + 1);
    }
    for (const [key, n] of need) {
      if (key === 'dot') this.batch('dot', this.dotGeo, n);
      else {
        const g = this.geos.get(key);
        if (!g) continue;
        this.batch(`${key}:0`, g[0], n);
        this.batch(`${key}:1`, g[1], n);
      }
    }
    let drawn = 0;
    for (const it of items) {
      const p = it.pose;
      if (cityZoom && !it.dot) continue;
      const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!cityZoom && d > MAX_DRAW_DISTANCE) continue;
      this.sphere.center.set(p.x, p.y, p.z);
      this.sphere.radius = cityZoom ? dotScale : it.radius;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      let batch: Batch | undefined;
      let k = it.scale;
      let y = p.y;
      if (cityZoom) {
        batch = this.batches.get('dot');
        k *= dotScale;
        y += 1.2;
      } else {
        batch = this.batches.get(`${it.model}:${d < LOD1_DISTANCE ? 0 : 1}`);
      }
      if (!batch) continue;
      const i = batch.count++;
      const e = batch.mesh.instanceMatrix.array as Float32Array;
      const c = Math.cos(p.yaw) * k, s = Math.sin(p.yaw) * k, o = i * 16;
      e[o] = c; e[o + 1] = 0; e[o + 2] = -s; e[o + 3] = 0;
      e[o + 4] = 0; e[o + 5] = k; e[o + 6] = 0; e[o + 7] = 0;
      e[o + 8] = s; e[o + 9] = 0; e[o + 10] = c; e[o + 11] = 0;
      e[o + 12] = p.x; e[o + 13] = y; e[o + 14] = p.z; e[o + 15] = 1;
      const col = batch.mesh.instanceColor!.array as Float32Array;
      col[i * 3] = it.r;
      col[i * 3 + 1] = it.g;
      col[i * 3 + 2] = it.b;
      drawn++;
    }
    for (const b of this.batches.values()) {
      b.mesh.count = b.count;
      b.mesh.visible = b.count > 0;
      if (b.count > 0) {
        b.mesh.instanceMatrix.clearUpdateRanges();
        b.mesh.instanceMatrix.addUpdateRange(0, b.count * 16);
        b.mesh.instanceMatrix.needsUpdate = true;
        b.mesh.instanceColor!.clearUpdateRanges();
        b.mesh.instanceColor!.addUpdateRange(0, b.count * 3);
        b.mesh.instanceColor!.needsUpdate = true;
      }
    }
    this.drawn = drawn;
  }

  /** Triangles per instance of a model at LOD0 (budget reporting). */
  triangles(model: string): number {
    const g = this.geos.get(model)?.[0];
    return g?.index ? g.index.count / 3 : 0;
  }

  dispose(): void {
    for (const b of this.batches.values()) b.mesh.dispose();
    this.batches.clear();
    for (const [a, b] of this.geos.values()) {
      a.dispose();
      b.dispose();
    }
    this.dotGeo.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

function geometryOf(fn: (b: GeoBuilder) => void): THREE.BufferGeometry {
  const b = new GeoBuilder();
  fn(b);
  return toBufferGeometry(b.finish());
}
