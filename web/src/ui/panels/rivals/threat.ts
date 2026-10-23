// Contested markets and a threat level per rival (UX §6.13): the markets you
// serve where this rival holds the top share, weighted by market size. Pure
// presentation over bridge marketIntel rows (realised shares, demand).

import type { MarketRowDto } from '@/bridge/protocol';

export interface ContestedMarket {
  cityId: string;
  productId: string;
  theirShare: number;
  yourShare: number;
  demand: number;
}

/** Markets where you sell and `rivalId` is the top rival, biggest first. */
export function contestedMarkets(rows: readonly MarketRowDto[], rivalId: number): ContestedMarket[] {
  return rows
    .filter((r) => r.playerPresent && r.topRival?.companyId === rivalId)
    .map((r) => ({
      cityId: r.cityId,
      productId: r.productId,
      theirShare: clamp01(r.topRival?.share ?? 0),
      yourShare: clamp01(r.playerRealisedShare ?? 0),
      demand: r.potentialDemand,
    }))
    .sort((a, b) => b.demand - a.demand);
}

/**
 * 0..1: the rival's demand-weighted share of the markets you contest, scaled by
 * how much of your served demand those markets are (one small contested
 * market among many safe ones is a low threat).
 */
export function threatLevel(contested: readonly ContestedMarket[], servedDemand?: number): { score: number; label: 'None' | 'Low' | 'Medium' | 'High' } {
  if (contested.length === 0) return { score: 0, label: 'None' };
  const demand = contested.reduce((s, m) => s + m.demand, 0);
  const weighted = demand > 0 ? contested.reduce((s, m) => s + m.theirShare * m.demand, 0) / demand : 0;
  const exposure = servedDemand && servedDemand > 0 ? Math.min(1, demand / servedDemand) : 1;
  const score = clamp01(weighted * (0.5 + 0.5 * exposure));
  return { score, label: score >= 0.7 ? 'High' : score >= 0.4 ? 'Medium' : 'Low' };
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
