import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAYER_SELECTION } from '../../SceneContext';
import { CityBuildContext } from '../build/CityBuildContext';
import type { CompanySpec } from '../chunkProtocol';
import { CityInteractionAdapter, packPickIndex } from '../interactionSource';
import { loadLayout } from './fixtures';

describe('CityInteractionAdapter (W6 CityInteractionSource)', () => {
  it('lists built company buildings, packs the grid index and builds an outline object on LAYER_SELECTION only', () => {
    const ctx = new CityBuildContext(loadLayout('portbay'));
    const lot = ctx.grid.parcels.find((q) => q.vacant && !q.landmark && q.depositId === null && q.w >= 3 && q.h >= 3)!;
    const spec: CompanySpec = {
      id: 7, typeId: 'supermarket', category: 'supermarket', owner: 2, companyId: '3', level: 2, stage: 'complete', progress: 1,
      px: lot.px, pz: lot.pz, w: 3, h: 3, turns: lot.facing, utilization: 0.5, products: [],
    };
    ctx.setCovers([{ id: 7, px: spec.px, pz: spec.pz, w: 3, h: 3 }]);
    let specs: CompanySpec[] = [spec];
    const box = new THREE.Box3(new THREE.Vector3(ctx.x0(spec.px), 0, ctx.z0(spec.pz)), new THREE.Vector3(ctx.x0(spec.px) + 72, 12, ctx.z0(spec.pz) + 72));
    const adapter = new CityInteractionAdapter({
      cityId: ctx.grid.cityId, gridW: ctx.W, gridH: ctx.H, specs: () => specs, box: (id) => (id === 7 ? box : null),
      buildContext: () => ctx, month: () => 6,
    }, new THREE.MeshLambertMaterial());
    adapter.refresh();
    expect(adapter.revision).toBe(1);
    expect([...adapter.buildings()].map((b) => b.id)).toEqual([7]);
    const idx = adapter.getPickIndex()!;
    expect(idx.ids).toEqual([7]);
    expect(idx.cellBuilding[spec.pz * ctx.W + spec.px]).toBe(0);
    expect(idx.cellBuilding[(spec.pz + 2) * ctx.W + spec.px + 2]).toBe(0);
    expect(idx.maxHeight).toBeGreaterThan(12);

    const obj = adapter.getBuildingObject(7) as THREE.Mesh;
    expect(obj).toBeInstanceOf(THREE.Mesh);
    expect(obj.parent).toBe(adapter.outlineGroup);
    expect(obj.layers.isEnabled(LAYER_SELECTION)).toBe(true);
    expect(obj.layers.isEnabled(0)).toBe(false);
    obj.geometry.computeBoundingBox();
    const bb = obj.geometry.boundingBox!;
    // The building stands inside its footprint.
    expect(bb.min.x).toBeGreaterThanOrEqual(ctx.x0(spec.px) - 0.5);
    expect(bb.max.x).toBeLessThanOrEqual(ctx.x0(spec.px) + 72 + 0.5);
    expect(bb.max.y).toBeGreaterThan(3);
    expect(adapter.getBuildingObject(7)).toBe(obj);
    expect(adapter.getBuildingObject(99)).toBeNull();

    // A level change replaces the object (the old one leaves the scene, so W6 asks again).
    specs = [{ ...spec, level: 3 }];
    adapter.refresh();
    expect(obj.parent).toBeNull();
    expect(adapter.getBuildingObject(7)).not.toBe(obj);
    adapter.dispose();
  });

  it('packPickIndex matches W6 buildPickIndex semantics', () => {
    const idx = packPickIndex(4, 3, [
      { id: 10, px: 0, pz: 0, w: 2, h: 1, box: [0, 0, 0, 1, 5, 1] },
      { id: 11, px: 3, pz: 2, w: 3, h: 3, box: [0, 0, 0, 1, 30, 1] },
    ]);
    expect([...idx.cellBuilding]).toEqual([0, 0, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1]);
    expect(idx.maxHeight).toBe(31);
  });
});
