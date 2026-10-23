// Text helpers for the management screens: engine ids in content text become
// display names ("soft_drink in metropolis" → "Soft Drink in Metropolis"), news
// effects become plain sentences, and activity-feed kinds map onto the nine
// business-log filters (UX §6.14, ActivityFeed parity). Pure functions.

import type { EffectDto, GameEventKind } from '@/bridge/protocol';
import { percent } from '@/util/format';

export interface NameLookup {
  product: (id: string) => string;
  city: (id: string) => string;
}

/**
 * Replaces engine ids (`snake_case` product/city ids) that appear as whole words
 * in a sentence with their display names. Only ids the lookup knows are touched.
 */
export function humanizeIds(text: string, ids: Iterable<string>, names: (id: string) => string): string {
  let out = text;
  const list = [...ids].filter((id) => id.length > 2).sort((a, b) => b.length - a.length);
  for (const id of list) {
    const re = new RegExp(`(?<![\\w])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'g');
    out = out.replace(re, names(id));
  }
  return out;
}

/** One news effect as a sentence: "Cotton prices −25% for 8 months". */
export function describeEffect(effect: EffectDto, names: NameLookup): string {
  const product = effect.productId ? names.product(effect.productId) : 'Prices';
  const where = effect.cityId ? ` in ${names.city(effect.cityId)}` : '';
  switch (effect.kind) {
    case 'priceMultiplier': {
      const m = effect.multiplier ?? 1;
      const change = m - 1;
      const dir = change >= 0 ? '+' : '−';
      const months = effect.months ? ` for ${effect.months} month${effect.months === 1 ? '' : 's'}` : '';
      return `${product} world price ${dir}${percent(Math.abs(change), 0)}${months}`;
    }
    case 'brandShift': {
      const d = effect.delta ?? 0;
      return `${product} brand awareness ${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))} points${where}`;
    }
    default:
      return 'Headline only — no market effect';
  }
}

/** The tone of an effect for the player: rising input prices are bad, rising sale prices good — unknown here, so neutral by default. */
export function effectDirection(effect: EffectDto): 'up' | 'down' | 'flat' {
  if (effect.kind === 'priceMultiplier') return (effect.multiplier ?? 1) > 1 ? 'up' : (effect.multiplier ?? 1) < 1 ? 'down' : 'flat';
  if (effect.kind === 'brandShift') return (effect.delta ?? 0) > 0 ? 'up' : (effect.delta ?? 0) < 0 ? 'down' : 'flat';
  return 'flat';
}

// ------------------------------------------------------------------ business-log filters

export type FeedCategory = 'sales' | 'construction' | 'rivals' | 'goals' | 'cash' | 'research' | 'marketing' | 'news' | 'operations';

export const FEED_CATEGORIES: { id: FeedCategory; label: string }[] = [
  { id: 'sales', label: 'Sales' },
  { id: 'construction', label: 'Buildings' },
  { id: 'rivals', label: 'Rivals' },
  { id: 'goals', label: 'Goals' },
  { id: 'cash', label: 'Cash & finance' },
  { id: 'research', label: 'Research' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'news', label: 'News' },
  { id: 'operations', label: 'Operations' },
];

const KIND_CATEGORY: Partial<Record<GameEventKind, FeedCategory>> = {
  firstSale: 'sales',
  recordMonth: 'sales',
  buildingSales: 'sales',
  exportSales: 'sales',
  revenueMilestone: 'sales',
  shareRankFirst: 'sales',
  shareMilestone: 'sales',
  buildingConstructed: 'construction',
  buildingUpgraded: 'construction',
  constructionStarted: 'construction',
  constructionCompleted: 'construction',
  buildingDemolished: 'construction',
  landPurchased: 'construction',
  rivalEnteredMarket: 'rivals',
  rivalUndercut: 'rivals',
  takeoverBid: 'rivals',
  goalAchieved: 'goals',
  goalLost: 'goals',
  scenarioWon: 'goals',
  scenarioLost: 'goals',
  monthClosed: 'cash',
  netIncomeFlip: 'cash',
  lossStreak: 'cash',
  cashLow: 'cash',
  lowRunway: 'cash',
  cashNegative: 'cash',
  bankruptcyWarning: 'cash',
  loanTaken: 'cash',
  loanPaymentMissed: 'cash',
  creditRatingChanged: 'cash',
  dividendPaid: 'cash',
  ipoCompleted: 'cash',
  autosaved: 'operations',
  techLevelUp: 'research',
  patentGranted: 'research',
  patentExpired: 'research',
  patentBlocked: 'research',
  licenseGranted: 'research',
  licenseRevoked: 'research',
  campaignStarted: 'marketing',
  campaignChanged: 'marketing',
  campaignCancelled: 'marketing',
  brandMilestone: 'marketing',
  brandFading: 'marketing',
  news: 'news',
  priceEffectEnded: 'news',
  macroShift: 'news',
  slotConfigured: 'operations',
  slotCleared: 'operations',
  priceChanged: 'operations',
  belowCostPrice: 'operations',
  stockout: 'operations',
  overstock: 'operations',
  inputShortage: 'operations',
};

/** Rival construction is a rival move, not one of the player's buildings. */
export function feedCategory(kind: string, isPlayer?: boolean | null, companyId?: number | null, playerId?: number | null): FeedCategory {
  const base = KIND_CATEGORY[kind as GameEventKind] ?? 'operations';
  if (base === 'construction' && (isPlayer === false || (companyId != null && playerId != null && companyId !== playerId))) return 'rivals';
  return base;
}

/** Kinds that belong to a category (server-side `kinds` filter for activityFeed). */
export function kindsOf(category: FeedCategory): GameEventKind[] {
  return (Object.entries(KIND_CATEGORY) as [GameEventKind, FeedCategory][]).filter(([, c]) => c === category).map(([k]) => k);
}

/**
 * Ledger memos are engine text ("sell 40000.00 soft_drink @ B1", "ad tv soft_drink in metropolis").
 * Shown to players with ids replaced by names, building refs by building names and
 * quantities grouped ("sell 40,000 Soft Drink @ Supermarket #1").
 */
export function prettyMemo(
  memo: string,
  lookup: { ids: Iterable<string>; name: (id: string) => string; building: (id: number) => string },
): string {
  // Quantities arrive as raw decimals ("250496.04"): round to whole units with separators.
  let out = memo.replace(/(?<![\w.])(\d+)\.(\d+)\b/g, (_, whole: string, frac: string) => {
    const n = Number(`${whole}.${frac}`);
    return n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  });
  out = out.replace(/(?<![\w.,])(\d{5,})\b/g, (_, n: string) => Number(n).toLocaleString('en-US'));
  out = out.replace(/\(?\bB(\d+)\b\)?/g, (m, id: string) => (m.startsWith('(') ? `(${lookup.building(Number(id))})` : lookup.building(Number(id))));
  out = humanizeIds(out, lookup.ids, lookup.name);
  return out.replace(/\bad (tv|radio|newspaper|magazine)\b/i, (_, ch: string) => `${ch === 'tv' ? 'TV' : ch[0]!.toUpperCase() + ch.slice(1)} ad,`).replace(/^opex\b/, 'Running costs');
}
