// Advisor model (UX §6.15, bridge-spec §4.6.9): turns the bridge's advisor
// items into Morgan's ranked priorities — a title per code, the deep link that
// shows the problem, the one-click fix, and "dismiss for 3 months" keys. Pure.

import type { AdvisorCode, AdvisorDto, AdvisorItemDto, MethodName, UiSeverity } from '@/bridge/protocol';
import type { PanelId, PanelParams } from '../ids';

export const CODE_TITLE: Record<AdvisorCode, string> = {
  firstRevenue: 'Open your first business',
  activateIdle: 'Idle buildings',
  needRetail: 'Nowhere to sell',
  restoreProfit: 'Back to profit',
  buildBrand: 'Build a brand',
  addResearch: 'Start research',
  scale: 'Grow what works',
  lowRunway: 'Cash is running out',
  insolvency: 'Insolvency: the clock is running',
  sellingBelowCost: 'Selling below cost',
  exportingAtLoss: 'Exporting at a loss',
  unsellableRetail: 'Unsellable stock',
  rivalPatentBlocksYou: 'Blocked by a patent',
  adsWithoutStore: 'Ads with no store',
  idleBuilding: 'Idle building',
  losingBuilding: 'Building losing money',
  rivalUndercut: 'Undercut by a rival',
  unservedOpportunity: 'Unserved market',
  patentLeverage: 'License your patent',
  techGap: 'Technology gap',
};

/** Severity order for ranking (higher first). */
const SEVERITY_RANK: Record<UiSeverity, number> = { danger: 3, warning: 2, info: 1, success: 0 };

export interface AdviceLink {
  label: string;
  panel?: PanelId;
  params?: PanelParams;
  /** Select this building (opens the inspector). */
  buildingId?: number;
}

export interface Advice {
  key: string;
  item: AdvisorItemDto;
  title: string;
  /** Opportunities are gains, problems are losses at stake. */
  kind: 'problem' | 'opportunity' | 'step';
  links: AdviceLink[];
  fix: { method: MethodName; args: unknown; label: string } | null;
}

/** Stable identity of one piece of advice (code + its params), for dismissals. */
export function adviceKey(item: AdvisorItemDto): string {
  const params = Object.keys(item.params)
    .sort()
    .map((k) => `${k}=${item.params[k]}`)
    .join('&');
  return `${item.code}?${params}`;
}

const OPPORTUNITIES = new Set<AdvisorCode>(['unservedOpportunity', 'patentLeverage', 'scale']);
const STEPS = new Set<AdvisorCode>(['firstRevenue', 'needRetail', 'buildBrand', 'addResearch']);

function parseArgs(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Where each code's problem lives in the UI. */
export function adviceLinks(item: AdvisorItemDto): AdviceLink[] {
  const b = item.buildingIds?.[0] ?? (item.params.buildingId ? Number(item.params.buildingId) : undefined);
  const market = item.productId && item.cityId ? { productId: item.productId, cityId: item.cityId } : null;
  const links: AdviceLink[] = [];
  switch (item.code) {
    case 'firstRevenue':
    case 'needRetail':
      links.push({ label: 'Open Build', panel: 'build', params: { group: 'retail' } });
      break;
    case 'scale':
      links.push({ label: 'Markets', panel: 'markets', params: {} });
      break;
    case 'restoreProfit':
      links.push({ label: 'Why? (P&L)', panel: 'reports', params: { tab: 'pnl' } });
      break;
    case 'buildBrand':
      links.push({ label: 'Plan a campaign', panel: 'marketing', params: {} });
      break;
    case 'addResearch':
      links.push({ label: 'Research', panel: 'rnd', params: {} });
      break;
    case 'insolvency': // B2: active while the cure window is open (E2 distress or the interim negative-cash rule)
    case 'lowRunway':
      links.push({ label: 'Bank', panel: 'finance', params: { tab: 'bank' } }, { label: 'Cash flow', panel: 'reports', params: { tab: 'cashflow' } });
      break;
    case 'rivalPatentBlocksYou':
    case 'patentLeverage':
      links.push({ label: 'Patents', panel: 'rnd', params: { tab: 'patents' } });
      break;
    case 'techGap':
      links.push({ label: 'Research this', panel: 'rnd', params: { tab: 'products', productId: item.productId ?? null } });
      break;
    case 'adsWithoutStore':
      links.push({ label: 'Campaigns', panel: 'marketing', params: { productId: item.productId ?? null, cityId: item.cityId ?? null } });
      if (item.cityId) links.push({ label: 'Build a store', panel: 'build', params: { group: 'retail', cityId: item.cityId, productId: item.productId ?? null } });
      break;
    case 'unservedOpportunity':
      links.push({ label: 'Build a store here', panel: 'build', params: { group: 'retail', cityId: item.cityId ?? null, productId: item.productId ?? null } });
      if (market) links.push({ label: 'Market', panel: 'markets', params: market });
      break;
    case 'rivalUndercut':
      if (market) links.push({ label: 'Market', panel: 'markets', params: market });
      links.push({ label: 'Advertise', panel: 'marketing', params: market ?? {} });
      break;
    default:
      break;
  }
  if (b !== undefined && Number.isFinite(b)) links.unshift({ label: (item.buildingIds?.length ?? 1) > 1 ? `Show (${item.buildingIds!.length})` : 'Show building', buildingId: b });
  return links;
}

/**
 * Morgan's list: the priority first unless a ranked hint outweighs it, then
 * every hint by severity and $/month impact; dismissed keys are left out.
 */
export function rankAdvice(dto: AdvisorDto, dismissed: ReadonlySet<string>): Advice[] {
  const all = [dto.priority, ...dto.hints];
  const seen = new Set<string>();
  const out: Advice[] = [];
  for (const item of all) {
    const key = adviceKey(item);
    if (seen.has(key) || dismissed.has(key)) continue;
    seen.add(key);
    const args = item.fix ? parseArgs(item.fix.argsJson) : null;
    out.push({
      key,
      item,
      title: CODE_TITLE[item.code] ?? item.code,
      kind: OPPORTUNITIES.has(item.code) ? 'opportunity' : STEPS.has(item.code) ? 'step' : 'problem',
      links: adviceLinks(item),
      fix: item.fix && args !== null ? { method: item.fix.method, args, label: item.fix.label } : null,
    });
  }
  return out.sort((a, b) => SEVERITY_RANK[b.item.severity] - SEVERITY_RANK[a.item.severity] || (b.item.impactPerMonth ?? 0) - (a.item.impactPerMonth ?? 0));
}

/** Σ impact of the shown problems (opportunities are reported separately). */
export function totalAtStake(list: readonly Advice[]): { problems: number; opportunities: number } {
  let problems = 0;
  let opportunities = 0;
  for (const a of list) {
    const v = a.item.impactPerMonth ?? 0;
    if (a.kind === 'opportunity') opportunities += v;
    else problems += v;
  }
  return { problems, opportunities };
}
