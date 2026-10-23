// Company overlay model (pure): the player's buildings grouped by city with
// per-city totals, and the "needs attention" filter. Numbers are the bridge's
// BuildingSummaryDto fields.

import type { BuildingSummaryDto, CityDto } from '@/bridge/protocol';

export interface CityGroup {
  cityId: string;
  cityName: string;
  buildings: BuildingSummaryDto[];
  netIncome: number;
  opex: number;
  problems: number;
}

const PROBLEM_STATUS = new Set(['idle', 'starved', 'soldOut']);

/** A building that needs the player: idle, starved, sold out, or losing money last month. */
export function needsAttention(b: BuildingSummaryDto): boolean {
  return PROBLEM_STATUS.has(b.status) || (b.status !== 'underConstruction' && b.status !== 'passive' && b.netIncomeThisMonth < 0);
}

const REASON: Readonly<Record<string, string>> = { idle: 'Idle: nothing set up', starved: 'Short of inputs', soldOut: 'Sold out last month' };

/** Why a building needs attention (null when it does not). */
export function attentionReason(b: BuildingSummaryDto): string | null {
  if (!needsAttention(b)) return null;
  return REASON[b.status] ?? 'Lost money last month';
}

/** One-line summary of the reasons, e.g. "1 idle · 2 losing money". */
export function attentionSummary(buildings: readonly BuildingSummaryDto[]): string {
  const flagged = buildings.filter(needsAttention);
  if (flagged.length === 0) return 'all good';
  const counts = new Map<string, number>();
  for (const b of flagged) {
    const key = b.status === 'idle' ? 'idle' : b.status === 'starved' ? 'short of inputs' : b.status === 'soldOut' ? 'sold out' : 'losing money';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `${n} ${k}`).join(' · ');
}

/** Groups by city, cities ordered by population (then name), empty cities dropped. */
export function groupByCity(buildings: readonly BuildingSummaryDto[], cities: readonly CityDto[], filter: 'all' | 'attention' = 'all'): CityGroup[] {
  const order = [...cities].sort((a, b) => b.population - a.population || a.name.localeCompare(b.name));
  const groups: CityGroup[] = [];
  const known = new Set(order.map((c) => c.id));
  const cityList = [...order.map((c) => ({ id: c.id, name: c.name })), ...[...new Set(buildings.map((b) => b.cityId))].filter((id) => !known.has(id)).map((id) => ({ id, name: id }))];
  for (const c of cityList) {
    const all = buildings.filter((b) => b.cityId === c.id);
    const list = filter === 'attention' ? all.filter(needsAttention) : all;
    if (list.length === 0) continue;
    groups.push({
      cityId: c.id,
      cityName: c.name,
      buildings: list,
      netIncome: all.reduce((s, b) => s + b.netIncomeThisMonth, 0),
      opex: all.reduce((s, b) => s + b.monthlyOpex, 0),
      problems: all.filter(needsAttention).length,
    });
  }
  return groups;
}

export interface PortfolioTotals {
  count: number;
  netIncome: number;
  opex: number;
  problems: number;
  idle: number;
  unitsUsed: number;
  unitsTotal: number;
}

export function portfolioTotals(buildings: readonly BuildingSummaryDto[]): PortfolioTotals {
  return {
    count: buildings.length,
    netIncome: buildings.reduce((s, b) => s + b.netIncomeThisMonth, 0),
    opex: buildings.reduce((s, b) => s + b.monthlyOpex, 0),
    problems: buildings.filter(needsAttention).length,
    idle: buildings.filter((b) => b.status === 'idle').length,
    unitsUsed: buildings.reduce((s, b) => s + b.configuredSlots, 0),
    unitsTotal: buildings.reduce((s, b) => s + (b.slotKind === 'none' ? 0 : b.capacity), 0),
  };
}
