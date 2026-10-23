// "What it means for you" (UX §6.14): how a news effect touches the player's
// business — a product you sell, an input your factories buy, or an output you
// make. Pure; built from the player's building slots and the catalog recipes.

import type { BuildingSummaryDto, CatalogDto, EffectDto } from '@/bridge/protocol';

export type Exposure = 'sell' | 'input' | 'make';

export interface PlayerExposure {
  /** Products on your retail shelves. */
  sold: Set<string>;
  /** Products your factories consume. */
  inputs: Set<string>;
  /** Products your farms, mines and factories produce. */
  made: Set<string>;
}

export function playerExposure(buildings: readonly BuildingSummaryDto[], playerId: number | null, catalog: CatalogDto | null): PlayerExposure {
  const sold = new Set<string>();
  const inputs = new Set<string>();
  const made = new Set<string>();
  const recipes = new Map((catalog?.products ?? []).map((p) => [p.id, p.recipe?.inputs.map((i) => i.productId) ?? []]));
  for (const b of buildings) {
    if (playerId !== null && b.ownerId !== playerId) continue;
    for (const p of b.products) {
      if (b.slotKind === 'retail') sold.add(p);
      else if (b.slotKind === 'production') {
        made.add(p);
        for (const i of recipes.get(p) ?? []) inputs.add(i);
      } else if (b.slotKind === 'extraction') made.add(p);
    }
  }
  return { sold, inputs, made };
}

/** The ways an effect touches you (empty when it does not). */
export function exposureTo(effect: EffectDto, ex: PlayerExposure): Exposure[] {
  if (!effect.productId) return [];
  const out: Exposure[] = [];
  if (ex.sold.has(effect.productId)) out.push('sell');
  if (ex.inputs.has(effect.productId)) out.push('input');
  if (ex.made.has(effect.productId)) out.push('make');
  return out;
}

/**
 * Plain-words consequence for one exposure: a world-price rise helps a seller
 * of the product (rivals restock dearer too) and hurts a buyer of the input.
 */
export function consequence(effect: EffectDto, exposure: Exposure, productName: string): { text: string; good: boolean | null } {
  if (effect.kind === 'priceMultiplier') {
    const up = (effect.multiplier ?? 1) > 1;
    if (exposure === 'input') return { text: up ? `Your factories pay more for ${productName}.` : `Your factories pay less for ${productName}.`, good: !up };
    if (exposure === 'make') return { text: up ? `What you make of ${productName} is worth more on the world market.` : `What you make of ${productName} is worth less on the world market.`, good: up };
    return { text: up ? `${productName} costs more to restock — for you and your rivals.` : `${productName} is cheaper to restock — margins widen if you hold your price.`, good: !up };
  }
  if (effect.kind === 'brandShift') {
    const up = (effect.delta ?? 0) > 0;
    return { text: up ? `Shoppers notice ${productName} more — every seller’s awareness rises.` : `${productName} awareness slips for every seller.`, good: null };
  }
  return { text: 'Headline only.', good: null };
}
