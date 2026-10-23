import { describe, expect, it } from 'vitest';
import type { BuildingVisualDto } from '@/bridge/protocol';
import { CityBuildContext } from '../build/CityBuildContext';
import { activityById, facingFor, liveUtilization, quantiseUtilization, specFromVisual, stageOf } from '../companies';
import { isRoadKind } from '../layout/types';
import { loadLayout } from './fixtures';

function dto(over: Partial<BuildingVisualDto>): BuildingVisualDto {
  return {
    id: 1, typeId: 'supermarket', category: 'supermarket', slotKind: 'none', ownerId: 1, isPlayer: true, color: '#2F7DE1', colorIndex: 0,
    level: 1, footprintW: 3, footprintH: 2, placement: { px: 10, pz: 12, rotation: 0, source: 'engine' }, status: 'operating', products: [],
    visualRev: 1, ...over,
  };
}

describe('company specs from BuildingVisualDto', () => {
  const ctx = new CityBuildContext(loadLayout('portbay'));

  it('applies the rotation to the footprint (90/270 swap width and depth)', () => {
    const a = specFromVisual(ctx, dto({}), undefined)!;
    expect([a.w, a.h, a.turns]).toEqual([3, 2, 0]);
    const b = specFromVisual(ctx, dto({ placement: { px: 10, pz: 12, rotation: 90, source: 'engine' } }), undefined)!;
    expect([b.w, b.h, b.turns]).toEqual([2, 3, 1]);
    const c = specFromVisual(ctx, dto({ placement: { px: 10, pz: 12, rotation: 270, source: 'engine' } }), undefined)!;
    expect(c.turns).toBe(3);
  });

  it('square interim placements face their best road; engine placements keep their rotation', () => {
    // Find a 2×2 spot with a road along exactly one side.
    let spot: { px: number; pz: number; side: number } | null = null;
    for (let pz = 2; pz < ctx.H - 3 && !spot; pz++) for (let px = 2; px < ctx.W - 3 && !spot; px++) {
      const road = (x: number, z: number) => isRoadKind(ctx.kindAt(x, z));
      const sides = [road(px, pz + 2) && road(px + 1, pz + 2), road(px + 2, pz) && road(px + 2, pz + 1), road(px, pz - 1) && road(px + 1, pz - 1), road(px - 1, pz) && road(px - 1, pz + 1)];
      const inner = [0, 1].every((dz) => [0, 1].every((dx) => !road(px + dx, pz + dz)));
      if (inner && sides.filter(Boolean).length === 1) spot = { px, pz, side: sides.indexOf(true) };
    }
    expect(spot).not.toBeNull();
    const { px, pz, side } = spot!;
    expect(facingFor(ctx, px, pz, 2, 2)).toBe(side);
    const interim = specFromVisual(ctx, dto({ footprintW: 2, footprintH: 2, placement: { px, pz, rotation: 0, source: 'bridge' } }), undefined)!;
    expect(interim.turns).toBe(side);
    const engine = specFromVisual(ctx, dto({ footprintW: 2, footprintH: 2, placement: { px, pz, rotation: 180, source: 'engine' } }), undefined)!;
    expect(engine.turns).toBe(2);
  });

  it('maps status and construction progress onto stages', () => {
    expect(stageOf(dto({ status: 'closed' })).stage).toBe('closed');
    expect(stageOf(dto({})).stage).toBe('complete');
    expect(stageOf(dto({ status: 'underConstruction' })).stage).toBe('structure');
    const c = (progress: number) => dto({ status: 'underConstruction', construction: { started: { year: 2026, month: 1 }, completesAt: { year: 2026, month: 4 }, progress, costPaid: 0, costRemaining: 0 } });
    expect(stageOf(c(0.05)).stage).toBe('foundation');
    expect(stageOf(c(0.9)).stage).toBe('finishing');
    expect(stageOf(c(0.9)).progress).toBeCloseTo(0.9);
  });

  it('interpolates construction days with the clock (1/N of progress per month of an N-month schedule), below 1', () => {
    const c = (progress: number) => dto({ status: 'underConstruction', construction: { started: { year: 2026, month: 1 }, completesAt: { year: 2026, month: 5 }, progress, costPaid: 0, costRemaining: 0 } });
    // 4-month schedule: half a month adds 1/8 of the progress (quantised to 1/20 steps, never below the engine value).
    expect(stageOf(c(0.25), 0).progress).toBeCloseTo(0.25);
    expect(stageOf(c(0.25), 0.5).progress).toBeCloseTo(0.35);
    expect(stageOf(c(0.25), 0.5).stage).toBe(stageOf(c(0.35)).stage);
    expect(stageOf(c(0.75), 1).progress).toBeLessThan(1);
    expect(stageOf(c(0.75), 1).stage).toBe('finishing');
    expect(stageOf(c(0.33), 0.01).progress).toBeCloseTo(0.33);
  });

  it('clamps owner colour and level, and quantises utilization so small swings never rebuild', () => {
    const s = specFromVisual(ctx, dto({ colorIndex: 12, level: 9 }), undefined)!;
    expect(s.owner).toBe(7);
    expect(s.level).toBe(3);
    expect(quantiseUtilization(0.61)).toBe(0.5);
    expect(quantiseUtilization(0.64)).toBe(0.75);
    const rows = activityById({ month: { year: 2026, month: 1 }, ids: [1, 2], revenue: [10, 0], unitsSold: [0, 0], exportUnits: [0, 0], netIncome: [0, 0], utilization: [0.83, null], transfersIn: [5, 0], transfersOut: [0, 0] });
    expect(liveUtilization(rows.get(1))).toBeCloseTo(0.83);
    expect(liveUtilization(rows.get(2))).toBe(0.35);
    expect(liveUtilization(undefined)).toBe(0.6);
    const withActivity = specFromVisual(ctx, dto({}), rows.get(1))!;
    expect(withActivity.utilization).toBe(0.75);
    expect(withActivity.activity?.transfersIn).toBeGreaterThan(0);
  });

  it('drops buildings without a placement', () => {
    expect(specFromVisual(ctx, dto({ placement: undefined as never }), undefined)).toBeNull();
  });
});
