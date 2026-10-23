// "Why did net income change?" — labels and grouping for explainNetIncome's
// variance drivers (bridge-spec §5.8: drivers sum exactly to ΔNI). Pure.

import type { ExplainDto, VarianceLineDto } from '@/bridge/protocol';

export interface DriverStep {
  id: string;
  label: string;
  detail: string;
  amount: number;
}

type Names = { product: (id: string) => string; building: (id: number) => string };

// Exhaustive over the protocol's drivers (protocol.ts is the single source since the Wave 2 merge).
const DRIVER_TEXT: Record<VarianceLineDto['driver'], { label: string; detail: string }> = {
  volume: { label: 'Units sold', detail: 'More or fewer units sold, valued at the earlier price' },
  price: { label: 'Selling price', detail: 'Change in the average realised price on this period’s units' },
  unitCost: { label: 'Unit cost', detail: 'Change in what each unit sold cost you' },
  opexExisting: { label: 'Running costs', detail: 'Operating costs of buildings you already had' },
  opexNewBuildings: { label: 'New buildings', detail: 'Running costs of buildings opened since the earlier period' },
  advertising: { label: 'Advertising', detail: 'Change in advertising spend' },
  exports: { label: 'Exports', detail: 'Export revenue minus export cost of goods' },
  royalties: { label: 'Royalties', detail: 'Patent royalties received minus paid' },
  depreciation: { label: 'Depreciation', detail: 'Buildings and equipment wearing out — a cost without a cash payment' },
  interest: { label: 'Interest', detail: 'Interest on loans and the credit line, net of interest earned' },
  tax: { label: 'Income tax', detail: 'Tax on profits, after any losses carried forward' },
  other: { label: 'Other', detail: 'Everything else (the remainder, so the bars add up exactly)' },
};

export function driverLabel(line: VarianceLineDto, names: Names): string {
  const base = DRIVER_TEXT[line.driver]?.label ?? line.driver;
  if (line.productId) return `${base} · ${names.product(line.productId)}`;
  if (line.buildingId !== undefined) return `${base} · ${names.building(line.buildingId)}`;
  return base;
}

/**
 * Waterfall steps, largest effects first. Lines below `minShare` of the largest
 * absolute driver are folded into one "Smaller effects" step so the chart stays
 * readable — the total still equals ΔNI exactly.
 */
export function driverSteps(dto: ExplainDto, names: Names, maxSteps = 7): DriverStep[] {
  const lines = dto.drivers.filter((d) => d.amount !== 0).slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const steps: DriverStep[] = lines.map((l, i) => ({
    id: `${l.driver}:${l.productId ?? ''}:${l.buildingId ?? ''}:${i}`,
    label: driverLabel(l, names),
    detail: DRIVER_TEXT[l.driver]?.detail ?? '',
    amount: l.amount,
  }));
  if (steps.length <= maxSteps) return steps;
  const head = steps.slice(0, maxSteps - 1);
  const rest = steps.slice(maxSteps - 1);
  head.push({ id: 'rest', label: `${rest.length} smaller effects`, detail: rest.map((s) => s.label).join(', '), amount: rest.reduce((s, r) => s + r.amount, 0) });
  return head;
}

/** One-sentence summary: the biggest driver and its direction. */
export function whySummary(dto: ExplainDto, names: Names, fmt: (v: number, signed?: boolean) => string): string {
  const delta = dto.compareNetIncome - dto.baseNetIncome;
  if (Math.abs(delta) < 0.5) return 'Net income did not change.';
  const top = dto.drivers.slice().sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
  const dir = delta > 0 ? 'rose' : 'fell';
  if (!top) return `Net income ${dir} by ${fmt(Math.abs(delta))}.`;
  const label = driverLabel(top, names);
  return `Net income ${dir} by ${fmt(Math.abs(delta))}, mostly from ${label.charAt(0).toLowerCase()}${label.slice(1)} (${fmt(top.amount, true)}).`;
}
