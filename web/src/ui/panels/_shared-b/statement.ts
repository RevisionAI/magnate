// Statement line models (UX §6.9, econ §4.15): turn the bridge's report DTOs
// into ordered, labelled rows for multi-period tables. Nothing is recomputed
// from game data — rows are the bridge's own lines, grouped and labelled.
// Two presentation rules keep every statement honest while the finance
// workstream adds lines concurrently:
//   1. Any line the bridge returns is shown, even one this client has no label for.
//   2. Each block reconciles to the bridge's own total: when the shown sub-lines
//      do not add up, an explicit "Other" line carries the difference, so a
//      column always sums to the bridge's revenue / opex / net income exactly.

import type { CashFlowDto, IncomeStatementDto, LedgerCategoryId } from '@/bridge/protocol';
import { humanizeId } from '@/util/format';

export type RowKind = 'header' | 'line' | 'subtotal' | 'total' | 'grand' | 'ratio' | 'memo';

/** Where a click on a statement row leads. */
export type DrillTarget =
  | { kind: 'ledger'; categories: LedgerCategoryId[] }
  | { kind: 'tab'; tab: string }
  | { kind: 'none' };

export interface StatementRow {
  id: string;
  label: string;
  kind: RowKind;
  indent: 0 | 1 | 2;
  /** One value per column; null = not reported for that period. */
  values: (number | null)[];
  /** Ratio rows hold fractions (0.42) instead of money. */
  format?: 'money' | 'percent';
  /** Lower is better (costs): flips the colour of deltas. */
  invert?: boolean;
  hint?: string;
  drill?: DrillTarget;
}

/** Below this an "Other" reconciling line is noise from 2-dp rounding. */
const EPS = 0.5;

// ------------------------------------------------------------------ income statement

/** Revenue sub-lines (positive amounts). */
const REVENUE_LINES: { key: string; label: string; drill: DrillTarget }[] = [
  { key: 'productSales', label: 'Product sales', drill: { kind: 'tab', tab: 'products' } },
  { key: 'exportSales', label: 'Exports', drill: { kind: 'tab', tab: 'exports' } },
  { key: 'royaltyIncome', label: 'Royalty income', drill: { kind: 'ledger', categories: ['patentRoyaltyIncome'] } },
  { key: 'otherRevenue', label: 'Other revenue', drill: { kind: 'none' } },
];

/** Operating expense sub-lines (positive amounts = costs). Later lines come from the finance/market workstreams. */
const OPEX_LINES: { key: string; label: string; drill: DrillTarget }[] = [
  { key: 'operatingCosts', label: 'Operating costs', drill: { kind: 'ledger', categories: ['operatingCost'] } },
  { key: 'wages', label: 'Wages', drill: { kind: 'none' } },
  { key: 'utilities', label: 'Utilities', drill: { kind: 'none' } },
  { key: 'maintenance', label: 'Maintenance', drill: { kind: 'none' } },
  { key: 'insurance', label: 'Insurance', drill: { kind: 'none' } },
  { key: 'propertyTax', label: 'Property tax', drill: { kind: 'none' } },
  { key: 'retailVariable', label: 'Store running costs', drill: { kind: 'none' } },
  { key: 'corporateOverhead', label: 'Corporate overhead', drill: { kind: 'none' } },
  { key: 'advertising', label: 'Advertising', drill: { kind: 'ledger', categories: ['advertisingCost'] } },
  { key: 'royaltyExpense', label: 'Royalties paid', drill: { kind: 'ledger', categories: ['patentRoyaltyExpense'] } },
];

/** Below-EBITDA lines: sign +1 = income, −1 = expense (amounts arrive positive). */
const BELOW_LINES: { key: string; label: string; sign: 1 | -1; group: 'da' | 'interest' | 'other' | 'tax' }[] = [
  { key: 'depreciation', label: 'Depreciation & amortisation', sign: -1, group: 'da' },
  { key: 'interestExpense', label: 'Interest expense', sign: -1, group: 'interest' },
  { key: 'distressInterest', label: 'Penalty interest', sign: -1, group: 'interest' },
  { key: 'interestIncome', label: 'Interest income', sign: 1, group: 'interest' },
  { key: 'otherIncome', label: 'Other income', sign: 1, group: 'other' },
  { key: 'disposalGainLoss', label: 'Gains / losses on disposals', sign: 1, group: 'other' },
  { key: 'writeOffs', label: 'Write-offs', sign: -1, group: 'other' },
  { key: 'incomeTax', label: 'Income tax', sign: -1, group: 'tax' },
];

/** Fields that are not statement lines (or are rendered as totals). */
const NON_LINE_KEYS = new Set([
  'period',
  'companyId',
  'months',
  'revenue',
  'cogs',
  'grossProfit',
  'opex',
  'netIncome',
  'grossMargin',
  'netMargin',
  'ebitda',
  'ebit',
  'ebt',
  'pretaxIncome',
  'operatingMargin',
]);

const KNOWN_IS_KEYS = new Set<string>([
  ...REVENUE_LINES.map((l) => l.key),
  ...OPEX_LINES.map((l) => l.key),
  ...BELOW_LINES.map((l) => l.key),
  ...NON_LINE_KEYS,
]);

type Loose = Record<string, unknown>;
const numOf = (dto: Loose | null | undefined, key: string): number | null => {
  const v = dto?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/**
 * True when the statement's `opex` already contains its `depreciation` line —
 * decided per column by which reading reconciles to the reported net income.
 */
export function opexIncludesDepreciation(d: Loose, below: readonly { key: string; sign: 1 | -1; group: string }[] = BELOW_LINES): boolean {
  const da = numOf(d, 'depreciation') ?? 0;
  const ni = numOf(d, 'netIncome');
  if (da === 0 || ni === null) return false;
  const gross = numOf(d, 'grossProfit') ?? (numOf(d, 'revenue') ?? 0) - (numOf(d, 'cogs') ?? 0);
  const rest = below.filter((l) => l.group !== 'da').reduce((s, l) => s + l.sign * (numOf(d, l.key) ?? 0), 0);
  const included = gross - (numOf(d, 'opex') ?? 0) + rest;
  return Math.abs(included - ni) < Math.abs(included - da - ni);
}

/** The numeric top-level fields of an income statement this client has no line for. */
export function unknownIncomeFields(dtos: readonly (IncomeStatementDto | null | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const d of dtos) {
    if (!d) continue;
    for (const [k, v] of Object.entries(d)) if (typeof v === 'number' && !KNOWN_IS_KEYS.has(k)) keys.add(k);
  }
  return [...keys].sort();
}

const present = (dtos: readonly (Loose | null | undefined)[], key: string) => dtos.some((d) => numOf(d, key) !== null && numOf(d, key) !== 0);
const col = (dtos: readonly (Loose | null | undefined)[], f: (d: Loose) => number | null) => dtos.map((d) => (d ? f(d) : null));

/**
 * Income statement rows for one or more period columns (UX §6.9 order):
 * revenue (+ sub-lines), COGS, gross profit, operating expenses (+ sub-lines),
 * EBITDA, D&A, EBIT, interest, other, pre-tax, tax, net income, margins.
 * EBITDA/EBIT/pre-tax subtotals appear only when the finance lines exist.
 */
export function incomeStatementRows(input: readonly (IncomeStatementDto | null | undefined)[]): StatementRow[] {
  const dtos = input as readonly (Loose | null | undefined)[];
  const rows: StatementRow[] = [];

  // Revenue
  rows.push({ id: 'revenue', label: 'Revenue', kind: 'subtotal', indent: 0, values: col(dtos, (d) => numOf(d, 'revenue')), drill: { kind: 'tab', tab: 'products' } });
  const shownRevenue = REVENUE_LINES.filter((l) => present(dtos, l.key));
  for (const l of shownRevenue) rows.push({ id: l.key, label: l.label, kind: 'line', indent: 1, values: col(dtos, (d) => numOf(d, l.key) ?? 0), drill: l.drill });
  const revenueOther = col(dtos, (d) => {
    const total = numOf(d, 'revenue') ?? 0;
    return total - shownRevenue.reduce((s, l) => s + (numOf(d, l.key) ?? 0), 0);
  });
  if (shownRevenue.length > 0 && revenueOther.some((v) => v !== null && Math.abs(v) >= EPS)) {
    rows.push({ id: 'revenueOther', label: 'Other revenue', kind: 'line', indent: 1, values: revenueOther, hint: 'Revenue the statement reports without a line of its own.' });
  }

  // Cost of goods sold, gross profit
  rows.push({
    id: 'cogs',
    label: 'Cost of goods sold',
    kind: 'line',
    indent: 0,
    values: col(dtos, (d) => -(numOf(d, 'cogs') ?? 0)),
    invert: true,
    hint: 'What the goods you sold cost you (inventory at weighted average cost).',
    drill: { kind: 'ledger', categories: ['inputPurchase', 'retailRestock', 'shippingCost'] },
  });
  rows.push({ id: 'grossProfit', label: 'Gross profit', kind: 'total', indent: 0, values: col(dtos, (d) => numOf(d, 'grossProfit') ?? (numOf(d, 'revenue') ?? 0) - (numOf(d, 'cogs') ?? 0)) });

  // Operating expenses. Some bridges (E2 finance) fold depreciation into `opex`
  // while also reporting it on its own line; show opex before D&A either way.
  const below = BELOW_LINES.filter((l) => present(dtos, l.key));
  const grossOf = (d: Loose) => numOf(d, 'grossProfit') ?? (numOf(d, 'revenue') ?? 0) - (numOf(d, 'cogs') ?? 0);
  const opexOf = (d: Loose) => (numOf(d, 'opex') ?? 0) - (opexIncludesDepreciation(d, below) ? (numOf(d, 'depreciation') ?? 0) : 0);
  rows.push({ id: 'opex', label: 'Operating expenses', kind: 'subtotal', indent: 0, values: col(dtos, (d) => -opexOf(d)), invert: true });
  const shownOpex = OPEX_LINES.filter((l) => present(dtos, l.key));
  for (const l of shownOpex) {
    rows.push({ id: l.key, label: l.label, kind: 'line', indent: 1, values: col(dtos, (d) => -(numOf(d, l.key) ?? 0)), invert: true, drill: l.drill });
  }
  const opexOther = col(dtos, (d) => {
    const total = opexOf(d);
    return -(total - shownOpex.reduce((s, l) => s + (numOf(d, l.key) ?? 0), 0));
  });
  if (opexOther.some((v) => v !== null && Math.abs(v) >= EPS)) {
    rows.push({ id: 'opexOther', label: 'Other operating expenses', kind: 'line', indent: 1, values: opexOther, invert: true, hint: 'Operating costs the statement reports without a line of its own.' });
  }

  const ebitda = col(dtos, (d) => numOf(d, 'ebitda') ?? grossOf(d) - opexOf(d));
  if (below.length > 0) {
    rows.push({ id: 'ebitda', label: 'Operating profit (EBITDA)', kind: 'total', indent: 0, values: ebitda, hint: 'Earnings before interest, tax, depreciation and amortisation.' });
    const da = below.filter((l) => l.group === 'da');
    for (const l of da) rows.push({ id: l.key, label: l.label, kind: 'line', indent: 0, values: col(dtos, (d) => l.sign * (numOf(d, l.key) ?? 0)), invert: true });
    let running = ebitda.map((v, i) => (v === null ? null : v + da.reduce((s, l) => s + l.sign * (numOf(dtos[i], l.key) ?? 0), 0)));
    if (da.length > 0) {
      const ebit = col(dtos, (d) => numOf(d, 'ebit'));
      running = running.map((v, i) => ebit[i] ?? v);
      rows.push({ id: 'ebit', label: 'EBIT', kind: 'subtotal', indent: 0, values: running, hint: 'Earnings before interest and tax.' });
    }
    const rest = below.filter((l) => l.group !== 'da' && l.group !== 'tax');
    for (const l of rest) rows.push({ id: l.key, label: l.label, kind: 'line', indent: 0, values: col(dtos, (d) => l.sign * (numOf(d, l.key) ?? 0)), invert: l.sign < 0 });
    const tax = below.filter((l) => l.group === 'tax');
    if (tax.length > 0) {
      const pretax = running.map((v, i) => {
        const explicit = numOf(dtos[i], 'ebt') ?? numOf(dtos[i], 'pretaxIncome');
        if (explicit !== null) return explicit;
        return v === null ? null : v + rest.reduce((s, l) => s + l.sign * (numOf(dtos[i], l.key) ?? 0), 0);
      });
      rows.push({ id: 'ebt', label: 'Profit before tax', kind: 'subtotal', indent: 0, values: pretax });
      for (const l of tax) rows.push({ id: l.key, label: l.label, kind: 'line', indent: 0, values: col(dtos, (d) => l.sign * (numOf(d, l.key) ?? 0)), invert: true });
    }
  }

  // Reconcile to the bridge's net income (lines a later bridge adds without a label land here).
  const explained = dtos.map((d) => {
    if (!d) return null;
    const base = grossOf(d) - opexOf(d);
    return base + below.reduce((s, l) => s + l.sign * (numOf(d, l.key) ?? 0), 0);
  });
  const residual = dtos.map((d, i) => (d && explained[i] !== null ? (numOf(d, 'netIncome') ?? 0) - explained[i]! : null));
  if (residual.some((v) => v !== null && Math.abs(v) >= EPS)) {
    rows.push({ id: 'otherItems', label: 'Other items', kind: 'line', indent: 0, values: residual, hint: 'Items in net income that have no line of their own in this report.' });
  }
  rows.push({ id: 'netIncome', label: 'Net income', kind: 'grand', indent: 0, values: col(dtos, (d) => numOf(d, 'netIncome')) });

  rows.push({ id: 'grossMargin', label: 'Gross margin', kind: 'ratio', indent: 0, values: col(dtos, (d) => numOf(d, 'grossMargin')), format: 'percent' });
  rows.push({ id: 'netMargin', label: 'Net margin', kind: 'ratio', indent: 0, values: col(dtos, (d) => numOf(d, 'netMargin')), format: 'percent' });

  // Anything else numeric the bridge sends: shown as memo lines, never summed.
  for (const key of unknownIncomeFields(input)) {
    rows.push({ id: `memo:${key}`, label: humanizeId(key), kind: 'memo', indent: 0, values: col(dtos, (d) => numOf(d, key)), hint: 'Reported by the engine; shown as-is.' });
  }
  return rows;
}

// ------------------------------------------------------------------ cash flow

/** Spec line names (bridge-spec §4.6.3 + EXT) → label, in statement order per section. */
export const CASH_FLOW_LINES: Record<string, string> = {
  // operating
  productSales: 'Cash from product sales',
  exportSales: 'Cash from exports',
  royaltyIncome: 'Royalties received',
  interestIncome: 'Interest received',
  inputPurchases: 'Input purchases',
  retailRestock: 'Retail restocking',
  shipping: 'Shipping',
  operatingCosts: 'Operating costs',
  wages: 'Wages',
  utilities: 'Utilities',
  advertising: 'Advertising',
  royaltyExpense: 'Royalties paid',
  interestPaid: 'Interest paid',
  interestExpense: 'Interest paid',
  incomeTax: 'Income tax',
  taxes: 'Income tax',
  // investing
  construction: 'Construction',
  upgrades: 'Upgrades',
  equipment: 'Equipment',
  landPurchases: 'Land purchases',
  landPurchase: 'Land purchases',
  landSales: 'Land sales',
  landSale: 'Land sales',
  assetSales: 'Asset sales',
  assetSale: 'Asset sales',
  // financing
  equityInjections: 'Founders’ capital',
  shareIssuance: 'Shares issued',
  shareBuybacks: 'Share buybacks',
  dividends: 'Dividends paid',
  loanProceeds: 'Loans drawn',
  loanRepayments: 'Loan repayments',
  revolverDraws: 'Credit line drawn',
  revolverRepayments: 'Credit line repaid',
};

const LINE_ORDER = Object.keys(CASH_FLOW_LINES);

export function cashFlowLabel(category: string): string {
  return CASH_FLOW_LINES[category] ?? humanizeId(category);
}

/** Ledger categories behind a cash-flow line (drill-down into the ledger explorer). */
const CASH_FLOW_LEDGER: Record<string, LedgerCategoryId[]> = {
  productSales: ['productSale'],
  exportSales: ['exportSale'],
  royaltyIncome: ['patentRoyaltyIncome'],
  inputPurchases: ['inputPurchase'],
  retailRestock: ['retailRestock'],
  shipping: ['shippingCost'],
  operatingCosts: ['operatingCost'],
  advertising: ['advertisingCost'],
  royaltyExpense: ['patentRoyaltyExpense'],
  construction: ['constructionCost'],
  upgrades: ['upgradeCost'],
  equityInjections: ['startingCapital'],
};

type Section = 'operating' | 'investing' | 'financing';
const SECTIONS: { id: Section; label: string; total: string }[] = [
  { id: 'operating', label: 'Operating activities', total: 'Net cash from operations' },
  { id: 'investing', label: 'Investing activities', total: 'Net cash from investing' },
  { id: 'financing', label: 'Financing activities', total: 'Net cash from financing' },
];

function orderOf(category: string): number {
  const i = LINE_ORDER.indexOf(category);
  return i < 0 ? LINE_ORDER.length : i;
}

/**
 * Cash-flow rows for one or more period columns: beginning cash, the three
 * sections with every line the bridge returns (union over columns, statement
 * order, unknown categories last), net change and ending cash.
 */
export function cashFlowRows(dtos: readonly (CashFlowDto | null | undefined)[]): StatementRow[] {
  const rows: StatementRow[] = [];
  rows.push({ id: 'beginningCash', label: 'Cash at start of period', kind: 'subtotal', indent: 0, values: dtos.map((d) => (d ? d.beginningCash : null)) });
  for (const s of SECTIONS) {
    const cats = new Set<string>();
    for (const d of dtos) for (const l of d?.[s.id].lines ?? []) cats.add(l.category);
    const ordered = [...cats].sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b));
    rows.push({ id: `h:${s.id}`, label: s.label, kind: 'header', indent: 0, values: dtos.map(() => null) });
    for (const c of ordered) {
      const ledger = CASH_FLOW_LEDGER[c];
      rows.push({
        id: `${s.id}:${c}`,
        label: cashFlowLabel(c),
        kind: 'line',
        indent: 1,
        values: dtos.map((d) => (d ? (d[s.id].lines.filter((l) => l.category === c).reduce((sum, l) => sum + l.amount, 0)) : null)),
        drill: ledger ? { kind: 'ledger', categories: ledger } : undefined,
      });
    }
    if (ordered.length === 0) rows.push({ id: `${s.id}:none`, label: 'No activity', kind: 'memo', indent: 1, values: dtos.map(() => null) });
    rows.push({ id: `net:${s.id}`, label: s.total, kind: 'total', indent: 0, values: dtos.map((d) => (d ? d[s.id].net : null)) });
  }
  rows.push({ id: 'netChange', label: 'Net change in cash', kind: 'subtotal', indent: 0, values: dtos.map((d) => (d ? d.netChange : null)) });
  rows.push({ id: 'endingCash', label: 'Cash at end of period', kind: 'grand', indent: 0, values: dtos.map((d) => (d ? d.endingCash : null)) });
  return rows;
}

/** Arithmetic check the UI shows next to the bridge's own `reconciles` flag. */
export function cashFlowAddsUp(d: CashFlowDto): boolean {
  const sum = d.operating.net + d.investing.net + d.financing.net;
  return Math.abs(sum - d.netChange) < 0.01 && Math.abs(d.beginningCash + d.netChange - d.endingCash) < 0.01;
}

/** Relative change between two column values; null when undefined. */
export function columnDelta(prev: number | null | undefined, next: number | null | undefined): number | null {
  if (prev === null || prev === undefined || next === null || next === undefined) return null;
  if (prev === 0) return null;
  return (next - prev) / Math.abs(prev);
}
