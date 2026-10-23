import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CityBuildContext } from '../build/CityBuildContext';
import { ChunkManager } from '../ChunkManager';
import type { CompanySpec } from '../chunkProtocol';
import { DEFAULT_QUALITY_KNOBS_FOR_TESTS } from './knobs';
import { parcelIds, surfaceHeights } from '../world';
import { loadLayout } from './fixtures';

interface Peek { chunks: Array<{ builtJob: number; index: number }> }

async function settle(m: ChunkManager, cam: THREE.Vector3, target: THREE.Vector3): Promise<void> {
  for (let i = 0; i < 4000; i++) {
    m.update(cam, target, DEFAULT_QUALITY_KNOBS_FOR_TESTS, 0);
    if (m.idle) return;
    if (i % 20 === 0) await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('chunk manager never settled');
}

describe('ChunkManager (in-thread builder)', () => {
  it('builds every chunk, indexes picks, and rebuilds only the chunks a company change touches', async () => {
    const wire = loadLayout('hilltown');
    const ctx = new CityBuildContext(wire);
    const material = new THREE.MeshLambertMaterial();
    const m = new ChunkManager({ material, signMaterial: material, uvFor: () => [0, 0, 1, 1], inline: true });
    m.setLayout(wire, 'k1', ctx, surfaceHeights(ctx), parcelIds(ctx.grid));
    const cam = new THREE.Vector3(0, 600, 600), target = new THREE.Vector3();
    await settle(m, cam, target);
    const s = m.stats();
    expect(s.built).toBe(s.chunks);
    expect(s.triangles0).toBeGreaterThan(50_000);
    expect(m.group.children.length).toBeGreaterThan(s.chunks);

    // Ambient pick straight down onto a building.
    const p = ctx.grid.parcels.find((q) => q.ambient && /house|office|midrise|apartment|shop/.test(q.ambient.kind))!;
    const cx = ctx.x0(p.px) + (p.w * 24) / 2, cz = ctx.z0(p.pz) + (p.h * 24) / 2;
    const pick = m.pickIndex!.pick(new THREE.Ray(new THREE.Vector3(cx, 400, cz), new THREE.Vector3(0, -1, 0)));
    expect(pick).not.toBeNull();

    // A company on a vacant lot dirties its own chunk (and only chunks it touches).
    const before = (m as unknown as Peek).chunks.map((c) => c.builtJob);
    const lot = ctx.grid.parcels.find((q) => q.vacant && !q.landmark && q.depositId === null && q.w >= 2 && q.h >= 2 && q.zone !== 'agricultural')!;
    const spec: CompanySpec = {
      id: 42, typeId: 'convenience_store', category: 'convenience_store', owner: 0, companyId: '1', level: 1, stage: 'complete', progress: 1,
      px: lot.px, pz: lot.pz, w: 1, h: 1, turns: lot.facing, utilization: 0.5, products: [],
    };
    ctx.setCovers([{ id: 42, px: spec.px, pz: spec.pz, w: 1, h: 1 }]);
    m.setCompanies([spec]);
    await new Promise((r) => setTimeout(r, 130));
    await settle(m, cam, target);
    const after = (m as unknown as Peek).chunks.map((c) => c.builtJob);
    const rebuilt = after.filter((j, i) => j !== before[i]).length;
    expect(rebuilt).toBeGreaterThanOrEqual(1);
    expect(rebuilt).toBeLessThanOrEqual(4);
    expect(m.pickIndex!.box('company', 42)).not.toBeNull();

    // Same specs again: nothing rebuilds.
    m.setCompanies([{ ...spec }]);
    await new Promise((r) => setTimeout(r, 130));
    await settle(m, cam, target);
    expect((m as unknown as Peek).chunks.map((c) => c.builtJob)).toEqual(after);

    // A season change rebuilds everything; a month change inside the season only the crop chunks.
    m.setMonth(7);
    await new Promise((r) => setTimeout(r, 130));
    await settle(m, cam, target);
    const july = (m as unknown as Peek).chunks.map((c) => c.builtJob);
    expect(july.filter((j, i) => j !== after[i]).length).toBe(s.chunks);
    m.setMonth(8);
    await new Promise((r) => setTimeout(r, 130));
    await settle(m, cam, target);
    const aug = (m as unknown as Peek).chunks.map((c) => c.builtJob);
    const changed = aug.filter((j, i) => j !== july[i]).length;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(s.chunks);

    // From far away every 2 × 2 block draws one merged LOD1 mesh (one merge per frame) and no chunk mesh is visible.
    const far = new THREE.Vector3(0, 6000, 0);
    for (let i = 0; i < 40; i++) m.update(far, target, DEFAULT_QUALITY_KNOBS_FOR_TESTS, 0);
    const visible = m.group.children.filter((o) => o.visible && o instanceof THREE.Mesh && /^(chunk|farblock)-/.test(o.name));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((o) => o.name.startsWith('farblock-'))).toBe(true);
    expect(visible.length).toBeLessThanOrEqual(Math.ceil(s.chunks / 4) + 2);
    const mergedTris = visible.reduce((n, o) => n + ((o as THREE.Mesh).geometry.getIndex()!.count / 3), 0);
    expect(mergedTris).toBe(m.stats().triangles1);
    // Back to street level: chunks switch back to their own meshes.
    for (let i = 0; i < 3; i++) m.update(cam, target, DEFAULT_QUALITY_KNOBS_FOR_TESTS, 0);
    expect(m.group.children.some((o) => o.visible && o.name.startsWith('farblock-'))).toBe(false);

    m.dispose();
    expect(m.group.parent).toBeNull();
  }, 120_000);
});
