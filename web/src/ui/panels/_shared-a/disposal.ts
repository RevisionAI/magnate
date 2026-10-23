// Sell / demolish previews (E2 `previewDisposal`, bridge §8.4 EXT demolish).
//
// Typed by protocol.ts (`DisposalResultDto`, `DisposalPreviewArgs`), the single source of the
// bridge contract. The hook degrades on its own: an engine without the method
// ('unknown_method'), or a game whose rules have no disposals ('feature_unavailable', Classic),
// reports that instead of throwing, and the panel falls back to a plain confirm.

import { useEffect, useState } from 'react';
import { EngineError } from '@/bridge/engine';
import type { DisposalPreviewArgs, DisposalResultDto } from '@/bridge/protocol';
import { maybeEngine, useGameStore } from '@/state/gameStore';
import { money, signedMoney } from '@/util/format';

export type DisposalKind = NonNullable<DisposalPreviewArgs['kind']>;

/** E2 DisposalResultDto: `bookValue` is the carrying amount (land + CIP + PP&E); the breakdown fields are optional. */
export type DisposalPreview = DisposalResultDto;

export type DisposalPreviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: DisposalPreview }
  /** The engine build has no previewDisposal (older bridge). */
  | { status: 'noPreview' }
  /** This game's rules have no disposals (Classic). */
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

/** Previews a sale or demolition of one of the player's buildings; refreshes with the engine revision. */
export function useDisposalPreview(buildingId: number, kind: DisposalKind, enabled: boolean): DisposalPreviewState {
  const revision = useGameStore((s) => s.revision);
  const [state, setState] = useState<DisposalPreviewState>({ status: 'loading' });
  useEffect(() => {
    const engine = maybeEngine();
    if (!enabled || !engine) return;
    let live = true;
    engine
      .call('previewDisposal', { buildingId, kind })
      .then((preview) => live && setState({ status: 'ready', preview }))
      .catch((e: unknown) => {
        if (!live) return;
        const code = e instanceof EngineError ? e.code : undefined;
        if (code === 'unknown_method') setState({ status: 'noPreview' });
        else if (code === 'feature_unavailable') setState({ status: 'unavailable' });
        else setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [buildingId, kind, enabled, revision]);
  return state;
}

/** "−$120K vs book" style line for the gain or loss against the carrying amount. */
export function gainText(p: Pick<DisposalPreview, 'gainOrLoss'>): string {
  if (Math.abs(p.gainOrLoss) < 0.005) return 'at book value';
  return `${signedMoney(p.gainOrLoss)} ${p.gainOrLoss > 0 ? 'gain' : 'loss'} vs book`;
}

/** The confirm-dialog body for a previewed disposal (plain text). */
export function disposalConfirmBody(p: DisposalPreview, kind: DisposalKind): string {
  const parts: string[] = [];
  parts.push(`You receive ${money(p.proceeds)} now (book value ${money(p.bookValue)}, ${gainText(p)}).`);
  if (p.inventory !== undefined && p.inventory > 0) {
    parts.push(kind === 'sale' ? `Stock worth ${money(p.inventory)} is sold with it at cost.` : `Stock worth ${money(p.inventory)} is cleared at a discount.`);
  }
  if (kind === 'demolition') parts.push('The structure is scrapped and the cleared land is sold.');
  parts.push('This can’t be undone.');
  return parts.join(' ');
}
