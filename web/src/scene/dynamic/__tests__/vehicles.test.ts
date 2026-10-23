import { describe, expect, it } from 'vitest';
import { GeoBuilder, toBufferGeometry } from '../../assets/GeoBuilder';
import { LIVERY, VEHICLE_MODELS, VEHICLE_MODEL_IDS, ambientBodyRgb } from '../../assets/families/vehicles';

function build(id: (typeof VEHICLE_MODEL_IDS)[number], lod: 0 | 1) {
  const b = new GeoBuilder();
  VEHICLE_MODELS[id].build(b, lod);
  const geo = toBufferGeometry(b.finish());
  geo.computeBoundingBox();
  const tris = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3;
  return { geo, tris, box: geo.boundingBox! };
}

describe('vehicle family (art §4.3, §5.8)', () => {
  it('keeps every model and LOD inside its triangle budget', () => {
    for (const id of VEHICLE_MODEL_IDS) {
      const m = VEHICLE_MODELS[id];
      const l0 = build(id, 0), l1 = build(id, 1);
      expect(l0.tris, `${id} LOD0`).toBeGreaterThan(0);
      expect(l0.tris, `${id} LOD0`).toBeLessThanOrEqual(m.triBudget.lod0);
      expect(l1.tris, `${id} LOD1`).toBeLessThanOrEqual(m.triBudget.lod1);
      expect(l1.tris, `${id} LOD1 is cheaper`).toBeLessThan(l0.tris);
    }
  });

  it('is authored around the vehicle centre, forward +Z, at its nominal size', () => {
    for (const id of VEHICLE_MODEL_IDS) {
      const m = VEHICLE_MODELS[id];
      const { box } = build(id, 0);
      const tol = Math.max(0.35, m.length * 0.04);
      expect(box.max.z - box.min.z, `${id} length`).toBeGreaterThan(m.length - tol);
      expect(box.max.z - box.min.z, `${id} length`).toBeLessThan(m.length + tol);
      expect(Math.abs(box.max.z + box.min.z) / 2, `${id} centred`).toBeLessThan(tol);
      expect(box.max.y, `${id} height`).toBeLessThan(m.height + tol);
      // road vehicles stand on the ground; the ship's hull sits a little below the waterline
      expect(box.min.y, `${id} on the ground`).toBeGreaterThanOrEqual(m.cls === 'ship' ? -2 : -0.01);
      expect(box.max.x - box.min.x, `${id} width`).toBeLessThan(m.width + 2.5);
    }
  });

  it('is deterministic and picks body colours from the art distribution', () => {
    const a = build('bus', 0).geo.getAttribute('position').array;
    const b = build('bus', 0).geo.getAttribute('position').array;
    expect(Array.from(a)).toEqual(Array.from(b));
    const seen = new Set<string>();
    for (let u = 0; u < 1; u += 0.01) seen.add(ambientBodyRgb(u).join(','));
    expect(seen.size).toBeGreaterThan(3);
    expect(ambientBodyRgb(0.999)).toBeDefined();
    expect(LIVERY.neutral).toHaveLength(3);
  });
});
