// Build drawer (UX §6.6): Palette → Placing → Confirm → constructing.
// The flow state lives in `_shared-a/buildFlow` (so the placement ghost can hand
// a plot back); this component routes between the three steps and applies
// deep links: `openPanel('build', { cityId, productId, typeId })`.

import { useEffect } from 'react';
import { useGameStore } from '@/state/gameStore';
import { installPlacementBridge, useBuildFlow } from '../_shared-a/buildFlow';
import type { PanelProps } from '../registry';
import { BuildConfirm } from './Confirm';
import { BuildPalette } from './Palette';
import { BuildPlacing } from './Placing';

export default function BuildPanel({ params }: PanelProps) {
  const step = useBuildFlow((s) => s.step);

  useEffect(() => {
    installPlacementBridge();
  }, []);

  // Deep links ("Open store here", "Build here"): city + product (+ type) preset.
  useEffect(() => {
    const flow = useBuildFlow.getState();
    const game = useGameStore.getState();
    const cityId = typeof params.cityId === 'string' ? params.cityId : null;
    const productId = typeof params.productId === 'string' ? params.productId : null;
    const typeId = typeof params.typeId === 'string' ? params.typeId : null;
    if (cityId && cityId !== game.activeCityId) game.setActiveCity(cityId);
    if (productId !== null || cityId !== null || typeId !== null) {
      if (flow.step !== 'palette') flow.reset();
      flow.setProduct(productId);
    }
    if (typeId && (cityId ?? game.activeCityId)) flow.start(typeId, cityId ?? game.activeCityId!, productId);
  }, [params.cityId, params.productId, params.typeId]);

  if (step === 'confirm') return <BuildConfirm />;
  if (step === 'placing') return <BuildPlacing />;
  return <BuildPalette />;
}
