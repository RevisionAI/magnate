import { describe, expect, it } from 'vitest';
import type { BuildPreviewDto } from '@/bridge/protocol';
import { anchorFor, classifyPreview, nextRotation, PlacementGhost } from '../PlacementGhost';
import { autoOverlayFor } from '../Overlays';

function preview(over: Partial<BuildPreviewDto> = {}): BuildPreviewDto {
  return {
    typeId: 'supermarket', cityId: 'metropolis', constructionCost: 1_200_000, totalCost: 1_200_000, monthlyOpex: 15_000,
    capacity: 6, affordable: true, shortfall: 0, cashAfter: 13_800_000, geographyOk: true, geographyIssues: [],
    eligibleProductIds: [], footprintW: 3, footprintH: 3, placementOk: true, ...over,
  };
}

describe('placement ghost helpers', () => {
  it('centres the footprint on the cursor and clamps it into the city', () => {
    expect(anchorFor(10.4, 10.6, 3, 3, 40, 40)).toEqual({ px: 9, pz: 9 });
    expect(anchorFor(10.0, 10.0, 2, 2, 40, 40)).toEqual({ px: 9, pz: 9 });
    expect(anchorFor(0.2, 0.2, 3, 3, 40, 40)).toEqual({ px: 0, pz: 0 });
    expect(anchorFor(39.9, 39.9, 5, 3, 40, 40)).toEqual({ px: 35, pz: 37 });
    // Stable anywhere inside the cursor's plot (even footprints included).
    expect(anchorFor(12.499, 7.501, 4, 4, 40, 40)).toEqual(anchorFor(12.501, 7.499, 4, 4, 40, 40));
    expect(anchorFor(12.01, 7.99, 4, 4, 40, 40)).toEqual({ px: 10, pz: 5 });
  });

  it('rotates in 90° steps both ways', () => {
    expect(nextRotation(0, 1)).toBe(90);
    expect(nextRotation(270, 1)).toBe(0);
    expect(nextRotation(0, -1)).toBe(270);
  });

  it('classifies previews into the four ghost colours', () => {
    expect(classifyPreview(preview(), false).status).toBe('valid');
    const road = classifyPreview(preview({ placementOk: false, placementIssue: 'road' }), false);
    expect(road).toMatchObject({ status: 'blocked', issue: 'road' });
    expect(road.reason).toMatch(/road/i);
    expect(classifyPreview(preview({ placementOk: false, placementIssue: 'occupied' }), true)).toMatchObject({ status: 'own', issue: 'own' });
    expect(classifyPreview(preview({ placementOk: false, placementIssue: 'occupied' }), false).status).toBe('blocked');
    const geo = classifyPreview(preview({ geographyOk: false, geographyIssues: ['coastal'] }), false);
    expect(geo).toMatchObject({ status: 'blocked', issue: 'geography', reason: 'Needs a coastal city' });
    const cash = classifyPreview(preview({ affordable: false, shortfall: 800_000, cashAfter: -800_000 }), false);
    expect(cash).toMatchObject({ status: 'warning', issue: 'cash' });
    expect(cash.reason).toContain('$800K');
    expect(classifyPreview(preview({ runwayMonthsAfter: 2.4 }), false)).toMatchObject({ status: 'warning', issue: 'runway' });
    expect(classifyPreview(preview({ runwayMonthsAfter: 12 }), false).status).toBe('valid');
  });

  it('humanises unknown engine issue codes', () => {
    const r = classifyPreview(preview({ placementOk: false, placementIssue: 'NEEDS_COAST' as never }), false);
    expect(r.reason).toBe('Must face the sea');
  });

  it('picks the overlay the building type wants (UX §6.6)', () => {
    expect(autoOverlayFor({ retail: true, category: 'supermarket' })).toBe('traffic');
    expect(autoOverlayFor({ retail: false, category: 'farm' })).toBe('zones');
    expect(autoOverlayFor({ retail: false, category: 'factory' })).toBe('landValue');
  });
});

describe('PlacementGhost state machine', () => {
  const type = { id: 'supermarket', name: 'Supermarket', category: 'supermarket', footprintWidth: 3, footprintHeight: 2, retail: true };

  it('throttles previews, caches by plot + rotation and drops the cache on a new revision', async () => {
    const calls: string[] = [];
    const ghost = new PlacementGhost(async ({ at }) => {
      calls.push(`${at.px},${at.pz},${at.rotation}`);
      return preview({ placementOk: at.px !== 0 });
    }, () => false);
    ghost.start(type, 'metropolis', 40, 40);
    ghost.invalidate(1);
    ghost.setCursor(10.5, 10.5);
    ghost.update(0.016, 1000, 500, true);
    expect(ghost.state()?.at).toEqual({ px: 9, pz: 9, rotation: 0 });
    expect(ghost.state()?.status).toBe('pending');
    expect(calls).toEqual(['9,9,0']);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    ghost.update(0.016, 1016, 500, true);
    expect(ghost.state()?.status).toBe('valid');
    // Throttle: a move within 100 ms waits.
    ghost.setCursor(1.2, 10.5);
    ghost.update(0.016, 1050, 500, true);
    expect(calls.length).toBe(1);
    ghost.update(0.016, 1120, 500, true);
    expect(calls).toEqual(['9,9,0', '0,9,0']);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    ghost.update(0.016, 1130, 500, true);
    expect(ghost.state()?.status).toBe('blocked');
    // Back to a cached spot: no query.
    ghost.setCursor(10.5, 10.5);
    ghost.update(0.016, 1300, 500, true);
    expect(ghost.state()?.status).toBe('valid');
    expect(calls.length).toBe(2);
    // Rotation swaps the footprint and queries the rotated anchor.
    ghost.rotate(1);
    ghost.update(0.016, 1400, 500, true);
    expect(ghost.state()).toMatchObject({ w: 2, h: 3 });
    expect(calls[2]).toMatch(/,90$/);
    // A new engine revision invalidates the cache.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    ghost.invalidate(2);
    ghost.update(0.016, 1600, 500, true);
    expect(calls.length).toBe(4);
    ghost.dispose();
  });

  it('locks on confirm and ignores the cursor until released', () => {
    const ghost = new PlacementGhost(async () => preview(), () => false);
    ghost.start(type, 'metropolis', 40, 40);
    ghost.setCursor(10.5, 10.5);
    ghost.update(0.016, 0, 500, true);
    ghost.lock(true);
    ghost.setCursor(20.5, 20.5);
    ghost.update(0.016, 200, 500, true);
    expect(ghost.state()?.at?.px).toBe(9);
    expect(ghost.state()?.locked).toBe(true);
    ghost.lock(false);
    ghost.setCursor(20.5, 20.5);
    ghost.update(0.016, 400, 500, true);
    expect(ghost.state()?.at?.px).toBe(19);
    ghost.stop();
    expect(ghost.state()).toBeNull();
    ghost.dispose();
  });
});
