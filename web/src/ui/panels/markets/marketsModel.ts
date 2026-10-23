// Markets overlay model (pure): the city × product matrix from `marketIntel`
// rows (unserved markets included), the metric shown in each cell, filters and
// the share → colour ramp. Values are bridge fields; nothing is re-modelled.

import type { MarketRowDto } from '@/bridge/protocol';
import { percent, price as fmtPrice } from '@/util/format';
import { qty as compact } from '../_shared-a/numbers';

export type MarketMetric = 'demand' | 'share' | 'competition' | 'price';

export const METRICS: readonly { id: MarketMetric; label: string; hint: string }[] = [
  { id: 'demand', label: 'Demand', hint: 'Units shoppers want per month' },
  { id: 'share', label: 'Your share', hint: 'Your share of units sold last month (realised)' },
  { id: 'competition', label: 'Competition', hint: 'Retailers selling it (yours included)' },
  { id: 'price', label: 'Price', hint: 'Your price, or the cheapest rival’s' },
];

/** The player's share for a row: realised last month when there were sales, else none. */
export function playerShare(row: MarketRowDto): number | null {
  if (!row.playerPresent) return null;
  return row.playerRealisedShare ?? 0;
}

export function metricValue(row: MarketRowDto, metric: MarketMetric): number | null {
  switch (metric) {
    case 'demand':
      return row.potentialDemand;
    case 'share':
      return playerShare(row);
    case 'competition':
      return row.retailerCount;
    case 'price':
      return row.playerPrice ?? row.cheapestRivalPrice ?? null;
  }
}

export function metricText(row: MarketRowDto, metric: MarketMetric): string {
  const v = metricValue(row, metric);
  if (v === null) return metric === 'share' ? '—' : metric === 'price' ? 'no offers' : '—';
  switch (metric) {
    case 'demand':
      return compact(v);
    case 'share':
      return percent(v, 0);
    case 'competition':
      return v === 0 ? 'none' : String(v);
    case 'price':
      return fmtPrice(v);
  }
}

/** Bar length 0..1 for a cell, relative to the largest value of that metric in the visible matrix. */
export function metricFill(row: MarketRowDto, metric: MarketMetric, max: number): number {
  const v = metricValue(row, metric);
  if (v === null || !(max > 0)) return 0;
  if (metric === 'share') return Math.max(0, Math.min(1, v));
  return Math.max(0, Math.min(1, v / max));
}

export interface MatrixFilters {
  onlyMine: boolean;
  contested: boolean;
}

export function filterRows(rows: readonly MarketRowDto[], f: MatrixFilters): MarketRowDto[] {
  return rows.filter((r) => (!f.onlyMine || r.playerPresent) && (!f.contested || (r.playerPresent && r.rivalCount > 0)));
}

export interface Matrix {
  cities: { id: string; name: string }[];
  products: { id: string; name: string }[];
  cell: Map<string, MarketRowDto>;
}

export const cellKey = (cityId: string, productId: string) => `${cityId}|${productId}`;

/**
 * Cities in the bridge's order (largest first), products by total demand
 * (biggest markets on top), cells keyed by city|product.
 */
export function buildMatrix(rows: readonly MarketRowDto[]): Matrix {
  const cities: { id: string; name: string }[] = [];
  const productDemand = new Map<string, { name: string; demand: number }>();
  const cell = new Map<string, MarketRowDto>();
  for (const r of rows) {
    if (!cities.some((c) => c.id === r.cityId)) cities.push({ id: r.cityId, name: r.cityName });
    const p = productDemand.get(r.productId) ?? { name: r.productName, demand: 0 };
    p.demand += r.potentialDemand;
    productDemand.set(r.productId, p);
    cell.set(cellKey(r.cityId, r.productId), r);
  }
  const products = [...productDemand.entries()].sort((a, b) => b[1].demand - a[1].demand || a[0].localeCompare(b[0])).map(([id, p]) => ({ id, name: p.name }));
  return { cities, products, cell };
}

/** Share → colour mix 0..1 used by the cell tint (grey at 0 %, gold at 100 %). */
export function shareTint(share: number | null): number {
  if (share === null) return 0;
  return Math.max(0, Math.min(1, share));
}

/** Unserved markets with demand, biggest first (the opportunities the old client never showed). */
export function unservedMarkets(rows: readonly MarketRowDto[]): MarketRowDto[] {
  return rows.filter((r) => r.retailerCount === 0 && r.potentialDemand > 0).sort((a, b) => b.potentialDemand - a.potentialDemand || a.cityId.localeCompare(b.cityId));
}
