// Stock policy as months of cover (UX §4.5, §6.7.3): the player picks Lean /
// Balanced / Deep instead of typing raw restock units. Pure presentation maths
// over bridge numbers — the forecast itself always comes from the bridge
// (last month's demand once the engine records it, else the bridge's model
// forecast), never from a client-side demand model.

import type { RetailSlotDto } from '@/bridge/protocol';

export type StockPolicyId = 'lean' | 'balanced' | 'deep' | 'custom';

export interface StockPolicy {
  id: Exclude<StockPolicyId, 'custom'>;
  label: string;
  months: number;
  hint: string;
}

export const STOCK_POLICIES: readonly StockPolicy[] = [
  { id: 'lean', label: 'Lean', months: 0.5, hint: 'Half a month on the shelf: least cash tied up, more risk of selling out.' },
  { id: 'balanced', label: 'Balanced', months: 1, hint: 'One month of demand on the shelf.' },
  { id: 'deep', label: 'Deep', months: 1.5, hint: 'A month and a half: rarely sells out, more cash tied up.' },
];

/** Default policy for a new product line (UX §6.7.3). */
export const DEFAULT_POLICY: StockPolicy = STOCK_POLICIES[1];

export type ForecastSource = 'lastMonthDemand' | 'soldPlusLost' | 'model' | 'none';

export interface LineForecast {
  /** Units per month the line is expected to be asked for. */
  units: number;
  source: ForecastSource;
}

/**
 * Monthly demand forecast for a retail line, in the order of UX §6.7.3:
 * last month's demand (engine E10) → last month's sold + lost (E10) → the
 * bridge's model forecast (`modelDemandUnits`). Last month's *sales* alone are
 * never used: sales are capped by stock, so they would shrink the shelf every
 * month (a restock death spiral).
 */
export function lineForecast(retail: Pick<RetailSlotDto, 'lastMonthDemand' | 'lastMonthUnits' | 'lastMonthLostUnits' | 'modelDemandUnits'>): LineForecast {
  if (isPositive(retail.lastMonthDemand)) return { units: retail.lastMonthDemand!, source: 'lastMonthDemand' };
  if (retail.lastMonthLostUnits !== undefined && retail.lastMonthLostUnits !== null && Number.isFinite(retail.lastMonthLostUnits)) {
    const total = (retail.lastMonthUnits ?? 0) + retail.lastMonthLostUnits;
    if (total > 0) return { units: total, source: 'soldPlusLost' };
  }
  if (isPositive(retail.modelDemandUnits)) return { units: retail.modelDemandUnits, source: 'model' };
  return { units: 0, source: 'none' };
}

/** Restock units for a cover in months (at least 1 unit: the bridge refuses 0). */
export function unitsForCover(months: number, forecastUnits: number): number {
  if (!(forecastUnits > 0) || !(months > 0)) return 1;
  return Math.max(1, Math.round(forecastUnits * months));
}

/** Months of cover a restock target represents (null when there is no forecast). */
export function coverMonths(restockTarget: number, forecastUnits: number): number | null {
  if (!(forecastUnits > 0) || !Number.isFinite(restockTarget)) return null;
  return restockTarget / forecastUnits;
}

/** Which policy a target matches (within 5% of the policy's units), else 'custom'. */
export function classifyPolicy(restockTarget: number, forecastUnits: number): StockPolicyId {
  const cover = coverMonths(restockTarget, forecastUnits);
  if (cover === null) return 'custom';
  for (const p of STOCK_POLICIES) {
    if (Math.abs(cover - p.months) <= p.months * 0.05) return p.id;
  }
  return 'custom';
}

export function policyById(id: StockPolicyId): StockPolicy | null {
  return STOCK_POLICIES.find((p) => p.id === id) ?? null;
}

/** Cash tied up in a shelf of `units` at the line's unit cost (world price before the first delivery). */
export function cashTiedUp(units: number, unitCost: number, worldPrice: number): number {
  const cost = unitCost > 0 ? unitCost : worldPrice;
  return Math.max(0, units) * Math.max(0, cost);
}

/** Share of last month's demand that went unserved (null when unknown). */
export function lostShare(retail: Pick<RetailSlotDto, 'lastMonthUnits' | 'lastMonthLostUnits' | 'lastMonthDemand'>): number | null {
  const lost = retail.lastMonthLostUnits;
  if (lost === undefined || lost === null || !Number.isFinite(lost)) return null;
  const demand = isPositive(retail.lastMonthDemand) ? retail.lastMonthDemand! : (retail.lastMonthUnits ?? 0) + lost;
  return demand > 0 ? lost / demand : 0;
}

function isPositive(v: number | null | undefined): boolean {
  return v !== undefined && v !== null && Number.isFinite(v) && v > 0;
}
