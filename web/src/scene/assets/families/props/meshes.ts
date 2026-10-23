// Main-thread helpers that turn the W3 prop families into GPU objects (three.js). Factories never import this
// module: it is for the chunk manager (reference implementation), the asset gallery and the dev preview.
import * as THREE from 'three';
import { GeoBuilder, toBufferGeometry, type BuiltArrays } from '../../GeoBuilder';
import { buildPartitionedFamily, type PropInstance } from '../../Instancing';
import { PROP_IDS, type PropId } from '../common-a/propIds';
import { PROP_FAMILIES } from './geometry';

/** Typed arrays for one prop family at one LOD (empty when the family has no geometry at that LOD). */
export function buildPropArrays(id: PropId, lod: 0 | 1): BuiltArrays {
  const b = new GeoBuilder();
  PROP_FAMILIES[id].build(b, lod);
  return b.finish();
}

/** Whether a string is a known prop family id. */
export function isPropId(id: string): id is PropId {
  return (PROP_IDS as readonly string[]).includes(id);
}

/**
 * Partitioned InstancedMesh groups (400 m cells, art §5.5) for a factory's `props` map. LOD1 families that have no
 * LOD1 geometry are skipped (they are distance-hidden instead). The caller owns the result: call `dispose()`.
 */
export function buildPropMeshes(props: Record<string, PropInstance[]>, material: THREE.Material, lod: 0 | 1 = 0): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  group.name = 'w3-props';
  const geometries: THREE.BufferGeometry[] = [];
  for (const id of Object.keys(props).sort()) {
    if (!isPropId(id) || props[id].length === 0) continue;
    const family = PROP_FAMILIES[id];
    const arrays = buildPropArrays(id, lod);
    if (arrays.triangleCount === 0) continue;
    const geometry = toBufferGeometry(arrays);
    geometries.push(geometry);
    const cells = buildPartitionedFamily(geometry, material, props[id], family.castShadow);
    cells.name = id;
    group.add(cells);
  }
  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose();
      group.removeFromParent();
    },
  };
}
