// Reference implementation from docs/overhaul/research/art-rendering.md Appendix A (assets/Instancing.ts).
// Verified to type-check against three 0.186 / postprocessing 6.39.5 / camera-controls 3.1.2.
// Repeated props (trees, lamps, parked cars, pedestrians) = InstancedMesh partitioned into 400 m cells so that
// frustum culling works (InstancedMesh culls as one bounding sphere). LOD = swap families by camera distance.
// W4 additions (backward compatible): PropInstance.y (stacked containers, terrace shrubs) and the PropFamily contract.
import * as THREE from 'three';
import type { GeoBuilder } from './GeoBuilder';

export interface PropInstance {
  x: number; z: number; rotY: number; scale: number; color?: THREE.ColorRepresentation;
  /** Height of the prop origin in world metres (absent = 0, on the ground). */
  y?: number;
}
export const CELL_M = 400;

export function buildPartitionedFamily(geometry: THREE.BufferGeometry, material: THREE.Material, items: PropInstance[], castShadow: boolean): THREE.Group {
  const cells = new Map<string, PropInstance[]>();
  for (const it of items) { const k = `${Math.floor(it.x / CELL_M)},${Math.floor(it.z / CELL_M)}`; (cells.get(k) ?? cells.set(k, []).get(k)!).push(it); }
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  for (const key of [...cells.keys()].sort()) {                      // deterministic order
    const list = cells.get(key)!;
    const im = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rotY); p.set(it.x, it.y ?? 0, it.z); s.setScalar(it.scale);
      im.setMatrixAt(i, m.compose(p, q, s));
      if (it.color !== undefined) im.setColorAt(i, c.set(it.color));
    });
    im.castShadow = castShadow; im.receiveShadow = true;
    im.computeBoundingSphere();                                       // required for culling since r151
    group.add(im);
  }
  return group;
}

/** Distance bands (metres, camera-to-target distance) validated on UHD 630. */
export const LOD_BANDS = { treeLod1: 900, vehicles: 1100, parkedCars: 700, lamps: 800, lightPools: 900, pedestrians: 420, smoke: 2600 } as const;

/** An instanced prop family: geometry (built once with GeoBuilder, then toBufferGeometry) plus metadata.
 *  Authoring frame: origin on the ground at the prop centre, forward / long axis along +Z, metres. Faces written with
 *  GeoBuilder.tint = 255 take the per-instance colour (owner cab, container paint, car body); tint = 0 faces keep their
 *  own colour (glass, tyres, lights). Instances place it with PropInstance {x, y, z, rotY, scale, color}. */
export interface PropFamily {
  readonly id: string;
  /** Triangles per instance (enforced by unit test). */
  readonly triBudget: number;
  readonly castShadow: boolean;
  /** Hide instances beyond this camera-to-target distance (m); see LOD_BANDS. */
  readonly maxDistance: number;
  build(b: GeoBuilder): void;
}
