import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '@/state/uiStore';
import { installPlacementBridge, submitPlacement, useBuildFlow } from './buildFlow';
import { disposalConfirmBody, gainText } from './disposal';

describe('build flow ↔ placement ghost (W6 contract)', () => {
  beforeEach(() => {
    installPlacementBridge();
    useBuildFlow.getState().reset();
    useUiStore.getState().setBuildMode(null);
  });

  it('a ghost confirm opens the confirm card and keeps build mode on (the ghost stays locked)', () => {
    useBuildFlow.getState().start('supermarket', 'metropolis');
    const mode = useUiStore.getState().buildMode;
    expect(mode).toEqual({ typeId: 'supermarket' });
    expect(submitPlacement({ typeId: 'supermarket', cityId: 'metropolis', at: { px: 4, pz: 7, rotation: 90 }, keepPlacing: true, status: 'valid', preview: null })).toBe(true);
    const flow = useBuildFlow.getState();
    expect(flow.step).toBe('confirm');
    expect(flow.choice).toEqual({ at: { px: 4, pz: 7, rotation: 90 }, source: 'ghost', keepPlacing: true });
    expect(useUiStore.getState().buildMode).toBe(mode);
  });

  it('Back returns to placing without restarting build mode', () => {
    useBuildFlow.getState().start('supermarket', 'metropolis');
    const mode = useUiStore.getState().buildMode;
    submitPlacement({ at: { px: 1, pz: 2, rotation: 0 } });
    useBuildFlow.getState().back();
    expect(useBuildFlow.getState().step).toBe('placing');
    expect(useUiStore.getState().buildMode).toBe(mode);
  });

  it('build mode ending (Esc, right-click, city switch) while confirming a ghost plot resets the flow', () => {
    useBuildFlow.getState().start('supermarket', 'metropolis');
    submitPlacement({ at: { px: 1, pz: 2, rotation: 0 } });
    useUiStore.getState().setBuildMode(null);
    expect(useBuildFlow.getState().step).toBe('palette');
  });

  it('auto-site and plot-list choices stop the ghost', () => {
    useBuildFlow.getState().start('supermarket', 'metropolis');
    useBuildFlow.getState().place({ at: null, source: 'auto' });
    expect(useBuildFlow.getState().step).toBe('confirm');
    expect(useUiStore.getState().buildMode).toBeNull();
  });

  it('ignores a confirm when nothing is being placed', () => {
    expect(submitPlacement({ at: { px: 1, pz: 2, rotation: 0 } })).toBe(false);
    expect(useBuildFlow.getState().step).toBe('palette');
  });
});

describe('disposal preview text', () => {
  const preview = { buildingId: 3, proceeds: 900_000, bookValue: 1_200_000, gainOrLoss: -300_000, inventory: 50_000 };

  it('words the gain or loss against book value', () => {
    expect(gainText(preview)).toBe('−$300K loss vs book');
    expect(gainText({ gainOrLoss: 12_500 })).toBe('+$12.5K gain vs book');
    expect(gainText({ gainOrLoss: 0 })).toBe('at book value');
  });

  it('builds the confirm body for a sale and a demolition', () => {
    expect(disposalConfirmBody(preview, 'sale')).toBe('You receive $900K now (book value $1.20M, −$300K loss vs book). Stock worth $50.0K is sold with it at cost. This can’t be undone.');
    expect(disposalConfirmBody({ ...preview, inventory: 0 }, 'demolition')).toBe(
      'You receive $900K now (book value $1.20M, −$300K loss vs book). The structure is scrapped and the cleared land is sold. This can’t be undone.',
    );
  });
});
