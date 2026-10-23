import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CityBuildContext } from '../build/CityBuildContext';
import { ChunkManager } from '../ChunkManager';
import { changedPlots, sameRoads } from '../layout/diff';
import { decodeLayout } from '../layout/decode';
import type { CityLayoutWire } from '../layout/types';
import { parcelIds, surfaceHeights } from '../world';
import { loadLayout } from './fixtures';
import { DEFAULT_QUALITY_KNOBS_FOR_TESTS } from './knobs';

interface Peek { chunks: Array<{ builtJob: number }> }

/** A later revision of the layout where one vacant parcel got an ambient house (as after a land sale). */
function developed(wire: CityLayoutWire): { next: CityLayoutWire; parcelId: number } {
  const next = JSON.parse(JSON.stringify(wire)) as CityLayoutWire;
  const grid = decodeLayout(wire);
  const target = grid.parcels.find((p) => p.vacant && !p.landmark && p.depositId === null && p.w * p.h <= 4)!;
  const raw = (next.parcels as unknown as Array<Record<string, unknown>>).find((p) => p.id === target.id)!;
  raw.ambient = { kind: 'house', floors: 2, variant: 1 };
  raw.vacant = false;
  next.layoutRev = wire.layoutRev + 1;
  return { next, parcelId: target.id };
}

describe('layout revisions (E3b layoutRev)', () => {
  it('changedPlots finds exactly the developed parcel; value-only revisions change nothing', () => {
    const wire = loadLayout('portbay');
    const { next, parcelId } = developed(wire);
    const a = decodeLayout(wire), b = decodeLayout(next);
    const p = b.parcelById.get(parcelId)!;
    const changed = changedPlots(a, b)!;
    expect(changed.size).toBe(p.w * p.h);
    expect(changed.has(p.pz * b.gridW + p.px)).toBe(true);
    expect(sameRoads(a, b)).toBe(true);

    const values = JSON.parse(JSON.stringify(wire)) as CityLayoutWire;
    values.layoutRev++;
    for (const q of values.parcels as unknown as Array<Record<string, unknown>>) { q.landValuePerPlot = Number(q.landValuePerPlot ?? 0) * 1.1 + 1; q.forSale = !q.forSale; }
    expect(changedPlots(a, decodeLayout(values))!.size).toBe(0);
    expect(changedPlots(a, decodeLayout(loadLayout('hilltown')))).toBeNull();
  });

  it('ChunkManager.updateLayout rebuilds only the dirty chunks and keeps the rest on screen', async () => {
    const wire = loadLayout('portbay');
    const ctx = new CityBuildContext(wire);
    const material = new THREE.MeshLambertMaterial();
    const m = new ChunkManager({ material, signMaterial: material, uvFor: () => [0, 0, 1, 1], inline: true });
    m.setLayout(wire, 'r1', ctx, surfaceHeights(ctx), parcelIds(ctx.grid));
    const cam = new THREE.Vector3(0, 500, 500), target = new THREE.Vector3();
    const settle = async () => {
      for (let i = 0; i < 4000 && !m.idle; i++) {
        m.update(cam, target, DEFAULT_QUALITY_KNOBS_FOR_TESTS, 0);
        if (i % 20 === 0) await new Promise((r) => setTimeout(r, 5));
      }
      expect(m.idle).toBe(true);
    };
    await settle();
    const before = (m as unknown as Peek).chunks.map((c) => c.builtJob);
    const meshes = m.group.children.length;

    const { next, parcelId } = developed(wire);
    const ctx2 = new CityBuildContext(next);
    const p = ctx2.grid.parcelById.get(parcelId)!;
    const owner = ctx2.chunkOfRect(p.px, p.pz, p.w, p.h);
    m.updateLayout(next, 'r2', ctx2, surfaceHeights(ctx2), parcelIds(ctx2.grid), new Set([owner]));
    // Nothing disappears while the rebuild is pending.
    expect(m.group.children.length).toBe(meshes);
    await settle();
    const after = (m as unknown as Peek).chunks.map((c) => c.builtJob);
    expect(after.filter((j, i) => j !== before[i])).toHaveLength(1);
    expect(after[owner]).not.toBe(before[owner]);
    // The new house is pickable straight down.
    const cx = ctx2.x0(p.px) + (p.w * 24) / 2, cz = ctx2.z0(p.pz) + (p.h * 24) / 2;
    const hit = m.pickIndex!.pick(new THREE.Ray(new THREE.Vector3(cx, 300, cz), new THREE.Vector3(0, -1, 0)));
    expect(hit?.kind).toBe('parcel');
    m.dispose();
  }, 120_000);
});
