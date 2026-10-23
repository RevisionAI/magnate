// The banded price slider of UX §6.7.3, as pure functions over bridge numbers
// (`suggestPrice`, the retail slot and `marketDetail`). Nothing here models
// demand: markers, bands and warnings only place the bridge's own figures on
// the track, and the "expected at this price" line reads the bridge's
// evaluated price points.

import type { Bracket, BracketDemandDto, PriceSuggestionDto } from '@/bridge/protocol';
import type { SliderBand, SliderMark } from '@/ui/components';
import { price as fmtPrice } from '@/util/format';

export interface PriceContext {
  /** WAC incl. freight; 0 before the first delivery (the world price stands in). */
  unitCost: number;
  worldPrice: number;
  rivalMin?: number | null;
  rivalMedian?: number | null;
  suggested?: number | null;
  ceilings?: readonly { bracket: Bracket; price: number }[];
  /** The line's current or proposed price (kept inside the range). */
  current?: number | null;
}

export interface PriceTrack {
  min: number;
  max: number;
  step: number;
  marks: SliderMark[];
  bands: SliderBand[];
  /** The cost floor the warnings use (unit cost, or world price before the first delivery). */
  costFloor: number;
}

export const BRACKET_LABEL: Readonly<Record<Bracket, string>> = { low: 'Low-income', middle: 'Middle-income', high: 'High-income' };
const BRACKET_SHORT: Readonly<Record<Bracket, string>> = { low: 'Low', middle: 'Mid', high: 'High' };

const cents = (v: number) => Math.round(v * 100) / 100;
const finite = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v) && v > 0;

/** Slider step: max($0.01, 1% of the world price rounded to the cent). */
export function priceStep(worldPrice: number): number {
  return Math.max(0.01, cents(Math.max(0, worldPrice) * 0.01));
}

/**
 * Range [max(0.5 × unit cost, $0.01), max(3 × world price, 1.1 × highest finite
 * ceiling)], widened so the current price and the suggestion always sit on it.
 */
export function priceRange(ctx: PriceContext): { min: number; max: number } {
  const costFloor = ctx.unitCost > 0 ? ctx.unitCost : ctx.worldPrice;
  let min = Math.max(0.01, cents(0.5 * costFloor));
  const ceilingMax = Math.max(0, ...(ctx.ceilings ?? []).map((c) => c.price).filter((p) => Number.isFinite(p)));
  let max = Math.max(3 * ctx.worldPrice, 1.1 * ceilingMax, min * 4);
  for (const v of [ctx.current, ctx.suggested, ctx.rivalMin, ctx.rivalMedian]) {
    if (!finite(v)) continue;
    if (v < min) min = Math.max(0.01, cents(v * 0.9));
    if (v > max) max = v * 1.15;
  }
  return { min, max: cents(max) };
}

export function priceTrack(ctx: PriceContext): PriceTrack {
  const { min, max } = priceRange(ctx);
  const step = priceStep(ctx.worldPrice);
  const costFloor = ctx.unitCost > 0 ? ctx.unitCost : ctx.worldPrice;
  const marks: SliderMark[] = [];
  const bands: SliderBand[] = [];

  marks.push({ value: costFloor, label: ctx.unitCost > 0 ? 'Cost' : 'Cost (est.)', detail: fmtPrice(costFloor), tone: 'danger' });
  if (Math.abs(ctx.worldPrice - costFloor) > step / 2) marks.push({ value: ctx.worldPrice, label: 'World', detail: fmtPrice(ctx.worldPrice), tone: 'info' });
  if (finite(ctx.rivalMin)) marks.push({ value: ctx.rivalMin, label: 'Rival', detail: fmtPrice(ctx.rivalMin), tone: 'neutral' });
  if (finite(ctx.rivalMedian) && finite(ctx.rivalMin) && Math.abs(ctx.rivalMedian - ctx.rivalMin) > step / 2) {
    marks.push({ value: ctx.rivalMedian, label: 'Rival median', tone: 'neutral' });
  }
  if (finite(ctx.suggested)) marks.push({ value: ctx.suggested, label: 'Suggested', detail: fmtPrice(ctx.suggested), tone: 'gold', shape: 'diamond' });

  bands.push({ from: min, to: Math.max(min, costFloor), tone: 'danger', label: 'Below unit cost: every sale loses money' });
  if (finite(ctx.suggested) && ctx.suggested > costFloor) {
    const lo = Math.max(costFloor, ctx.suggested * 0.95);
    const hi = Math.min(max, ctx.suggested * 1.05);
    if (hi > lo) bands.push({ from: lo, to: hi, tone: 'success', label: 'Around the suggested price' });
  }
  const ceilings = [...(ctx.ceilings ?? [])].filter((c) => Number.isFinite(c.price) && c.price > 0).sort((a, b) => a.price - b.price);
  ceilings.forEach((c, i) => {
    marks.push({ value: c.price, label: `${BRACKET_SHORT[c.bracket]} ceiling`, detail: fmtPrice(c.price), tone: 'warning' });
    const to = ceilings[i + 1]?.price ?? max;
    if (to > c.price && c.price < max) {
      bands.push({ from: c.price, to: Math.min(to, max), tone: 'warning', label: `Above ${fmtPrice(c.price)} ${BRACKET_LABEL[c.bracket].toLowerCase()} shoppers stop buying` });
    }
  });
  return { min, max, step, marks: marks.filter((m) => m.value >= min && m.value <= max), bands, costFloor };
}

export interface PriceWarning {
  tone: 'danger' | 'warning';
  text: string;
}

/**
 * Warnings for a price: red below unit cost ("selling at a loss of $X/unit"),
 * amber above a bracket ceiling ("excludes N% of demand", from marketDetail).
 */
export function priceWarnings(priceValue: number, ctx: PriceContext, brackets?: readonly BracketDemandDto[]): PriceWarning[] {
  const out: PriceWarning[] = [];
  const costFloor = ctx.unitCost > 0 ? ctx.unitCost : ctx.worldPrice;
  if (priceValue < costFloor) {
    out.push({ tone: 'danger', text: `Selling at a loss of ${fmtPrice(costFloor - priceValue)} per unit.` });
  }
  const excluded = (ctx.ceilings ?? []).filter((c) => Number.isFinite(c.price) && priceValue > c.price);
  if (excluded.length > 0) {
    const names = excluded.map((c) => BRACKET_LABEL[c.bracket].toLowerCase()).join(' and ');
    const total = (brackets ?? []).reduce((s, b) => s + Math.max(0, b.demand), 0);
    const lost = (brackets ?? []).filter((b) => excluded.some((c) => c.bracket === b.bracket)).reduce((s, b) => s + Math.max(0, b.demand), 0);
    const share = total > 0 ? ` — ${Math.round((lost / total) * 100)}% of this market's demand` : '';
    out.push({ tone: 'warning', text: `Too expensive for ${names} shoppers${share}.` });
  }
  return out;
}

export interface ExpectedAtPrice {
  units: number;
  revenue: number;
  grossProfit: number;
  /** True when the price lies outside the bridge's evaluated points (nearest point shown). */
  extrapolated: boolean;
}

/** The bridge's expected outcome at a price: linear between its evaluated points, nearest point outside them. */
export function expectedAt(points: PriceSuggestionDto['expectedUnitsAt'], priceValue: number): ExpectedAtPrice | null {
  const sorted = [...points].filter((p) => Number.isFinite(p.price)).sort((a, b) => a.price - b.price);
  if (sorted.length === 0) return null;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (priceValue <= first.price) return { units: first.units, revenue: first.revenue, grossProfit: first.grossProfit, extrapolated: priceValue < first.price };
  if (priceValue >= last.price) return { units: last.units, revenue: last.revenue, grossProfit: last.grossProfit, extrapolated: priceValue > last.price };
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (priceValue <= b.price) {
      const t = b.price === a.price ? 0 : (priceValue - a.price) / (b.price - a.price);
      const lerp = (x: number, y: number) => x + (y - x) * t;
      return { units: lerp(a.units, b.units), revenue: lerp(a.revenue, b.revenue), grossProfit: lerp(a.grossProfit, b.grossProfit), extrapolated: false };
    }
  }
  return null;
}

/**
 * Opening price for a new line before the bridge can suggest one (the slot does
 * not exist yet): the cheapest rival's price when there is one, else a curated
 * starter-plan price for the product, else a standard retail markup on the
 * world price (what the shelf is restocked at). The inspector's slider (with
 * the bridge's suggestion) takes over after construction.
 */
export const STANDARD_MARKUP = 1.5;

export function openingPrice(opts: { cheapestRivalPrice?: number | null; starterPrice?: number | null; worldPrice: number }): number {
  if (finite(opts.cheapestRivalPrice)) return cents(opts.cheapestRivalPrice);
  if (finite(opts.starterPrice)) return cents(opts.starterPrice);
  return Math.max(0.01, cents(opts.worldPrice * STANDARD_MARKUP));
}
