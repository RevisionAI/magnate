// Goal presentation (UX §6.16, D11): values formatted by unit, the latch
// state in words, the "how to" link per goal kind, and outcome reasons. Pure.

import type { GoalDto, GoalKind, GoalUnit, HistorySeries, OutcomeReason } from '@/bridge/protocol';
import { compact, money, monthYear, percent } from '@/util/format';
import { ratingFromNotchesAboveD } from '../_shared-b/finance';
import type { PanelId, PanelParams } from '../ids';

export function formatGoalValue(unit: GoalUnit, value: number): string {
  // Switch on the string so units a newer bridge adds (E2: 'rating') are handled before the protocol type knows them.
  switch (unit as string) {
    case 'rating':
      return ratingFromNotchesAboveD(value) ?? 'Unrated';
    case 'usd':
      return money(value, Math.abs(value) >= 1e6 ? 1 : 0);
    case 'ratio':
      return percent(value, value < 0.1 ? 1 : 0);
    case 'flag':
      return value >= 1 ? 'Yes' : 'Not yet';
    case 'months':
      return `${Math.round(value)} mo`;
    case 'points':
      return `${Math.round(value)}`;
    default:
      return compact(value, 0);
  }
}

export type GoalState = 'latched' | 'met' | 'open' | 'missed';

/**
 * reachOnce goals are done once latched (achievedAt), even if the metric later
 * falls; holdAtDeadline goals count only while met at the deadline (D11).
 */
export function goalState(g: GoalDto, finished: boolean): GoalState {
  if (g.mode === 'reachOnce' && g.achievedAt) return 'latched';
  if (g.achieved) return 'met';
  return finished ? 'missed' : 'open';
}

export function stateText(g: GoalDto, state: GoalState): string {
  switch (state) {
    case 'latched':
      return `Reached ${monthYear(g.achievedAt!)}${g.achieved ? '' : ' · locked in'}`;
    case 'met':
      return g.mode === 'holdAtDeadline' ? 'Met now — hold it until the deadline' : 'Met';
    case 'missed':
      return 'Not reached';
    default:
      return g.mode === 'holdAtDeadline' ? 'Must be met at the deadline' : 'Reach it once and it stays done';
  }
}

export interface HowTo {
  label: string;
  panel: PanelId;
  params: PanelParams;
}

export function howTo(g: Pick<GoalDto, 'kind' | 'productId' | 'cityId' | 'category'>): HowTo | null {
  const market = { productId: g.productId ?? null, cityId: g.cityId ?? null };
  const map: Partial<Record<GoalKind, HowTo>> = {
    corporateValue: { label: 'Balance sheet', panel: 'reports', params: { tab: 'balance' } },
    marketShare: { label: 'Open the market', panel: 'markets', params: market },
    ownsBuilding: { label: 'Build one', panel: 'build', params: g.category ? { typeId: g.category } : {} },
    productRetailed: { label: 'Build a store', panel: 'build', params: { group: 'retail', productId: g.productId ?? null } },
    adCampaignActive: { label: 'Plan the campaign', panel: 'marketing', params: market },
    netIncome: { label: 'P&L', panel: 'reports', params: { tab: 'pnl' } },
    topBrand: { label: 'Marketing', panel: 'marketing', params: market },
    exportRevenue: { label: 'Exports', panel: 'reports', params: { tab: 'exports' } },
    consecutiveProfitable: { label: 'Why? (P&L)', panel: 'reports', params: { tab: 'pnl' } },
  };
  // E2 finance goal kinds (string keys: older protocols do not list them).
  const finance: Record<string, HowTo> = {
    companyValue: { label: 'Balance sheet', panel: 'reports', params: { tab: 'balance' } },
    totalAssets: { label: 'Balance sheet', panel: 'reports', params: { tab: 'balance' } },
    netWorth: { label: 'Balance sheet', panel: 'reports', params: { tab: 'balance' } },
    creditRating: { label: 'Credit profile', panel: 'finance', params: { tab: 'bank' } },
    loanTaken: { label: 'Finance › Bank', panel: 'finance', params: { tab: 'bank' } },
  };
  return map[g.kind] ?? finance[g.kind as string] ?? null;
}

/**
 * History series that tracks a goal's metric (for a progress sparkline), when
 * one exists. `topBrand` history is the company's best brand anywhere, so it
 * only stands for a brand goal that names no product or city.
 */
export function goalSeries(g: Pick<GoalDto, 'kind' | 'metric' | 'productId' | 'cityId'>): HistorySeries | null {
  const kind = g.kind as string;
  if (g.metric === 'totalAssets' || kind === 'totalAssets') return 'totalAssets';
  if (g.metric === 'bookEquity' || kind === 'netWorth') return 'equity';
  if (g.metric === 'corporateValue' || g.metric === 'companyValue' || kind === 'corporateValue' || kind === 'companyValue') return 'corporateValue';
  if (g.kind === 'topBrand' && !g.productId && !g.cityId) return 'topBrand';
  return null;
}

export const OUTCOME_TEXT: Record<OutcomeReason, string> = {
  allGoals: 'Every goal met.',
  bankruptcy: 'Cash stayed below zero for too many month-ends in a row.',
  insolvency: 'The company could not pay its way and was declared insolvent.',
  deadline: 'The deadline passed before every goal was met.',
};
