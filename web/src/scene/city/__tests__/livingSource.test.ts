import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CityBuildContext } from '../build/CityBuildContext';
import type { ChunkEmitter, CompanySpec } from '../chunkProtocol';
import { K_BRIDGE, R_ARTERIAL, isRoadKind } from '../layout/types';
import { CityLivingSource, livingLayout } from '../livingSource';
import { highwayExits, waterMask } from '../world';
import { loadLayout } from './fixtures';

describe('CityLivingSource (W5 CitySource)', () => {
  it('maps road classes, road surface heights (terrain) and land use per plot', () => {
    const ctx = new CityBuildContext(loadLayout('hilltown'));
    const L = livingLayout(ctx, 1, 100000, waterMask(ctx.grid), highwayExits(ctx.grid));
    const g = ctx.grid;
    let roads = 0, arterials = 0, lifted = 0;
    for (let i = 0; i < g.kind.length; i++) {
      if (!isRoadKind(g.kind[i])) { expect(L.road[i]).toBe(0); continue; }
      roads++;
      expect(L.road[i]).toBeGreaterThan(0);
      if (g.road[i] === R_ARTERIAL) { arterials++; expect(L.road[i]).toBe(2); }
      if (L.roadY![i] > 0.5) lifted++;
    }
    expect(roads).toBeGreaterThan(100);
    expect(arterials).toBeGreaterThan(0);
    expect(lifted).toBeGreaterThan(0);              // Hilltown roads climb the hills
    expect(L.gridW * L.gridH).toBe(L.use!.length);
  });

  it('bridges carry the arch height; buildings group their emitters and parts', () => {
    const ctx = new CityBuildContext(loadLayout('portbay'));
    const L = livingLayout(ctx, 3, 150000, waterMask(ctx.grid), []);
    expect(L.rev).toBe(3);
    for (let i = 0; i < ctx.grid.kind.length; i++) if (ctx.grid.kind[i] === K_BRIDGE) expect(L.roadY![i]).toBeGreaterThanOrEqual(0);
    const spec: CompanySpec = {
      id: 5, typeId: 'factory_small', category: 'factory', owner: 1, companyId: '2', level: 1, stage: 'structure', progress: 0.4,
      px: 3, pz: 3, w: 3, h: 3, turns: 0, utilization: 0.5, products: [],
    };
    const emitter = { kind: 'smoke', x: 1, y: 20, z: 2, rateAtFull: 4, buildingId: 5, owner: 1 } as unknown as ChunkEmitter;
    const ambient = { ...emitter, buildingId: null } as ChunkEmitter;
    const src = new CityLivingSource({
      buildContext: () => ctx, population: () => 1, water: () => null, highways: () => [], specs: () => [spec], dto: () => undefined,
      box: () => new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 14, 10)), emitters: () => [emitter, ambient], parts: () => [],
    });
    const seen: string[] = [];
    src.onChange((w) => seen.push(w));
    src.refreshLayout();
    src.refreshBuildings();
    expect(seen).toEqual(['layout', 'buildings']);
    const b = src.buildings.get(5)!;
    expect(b.emitters).toHaveLength(1);
    expect(b.progress).toBeCloseTo(0.4);
    expect(b.height).toBeCloseTo(14 - (ctx.companyTerrace.get(5) ?? 0));
    expect(src.layout!.cityId).toBe('portbay');
  });
});
