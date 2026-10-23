import { describe, expect, it } from 'vitest';
import type { CashFlowDto, IncomeStatementDto } from '@/bridge/protocol';
import { cashFlowAddsUp, cashFlowLabel, cashFlowRows, columnDelta, incomeStatementRows, unknownIncomeFields } from './statement';

const period = { from: { year: 2026, month: 1 }, to: { year: 2026, month: 1 } } as unknown as IncomeStatementDto['period'];

function is(over: Partial<IncomeStatementDto> & Record<string, unknown>): IncomeStatementDto {
  return {
    period,
    companyId: 1,
    revenue: 1000,
    productSales: 1000,
    exportSales: 0,
    royaltyIncome: 0,
    cogs: 600,
    grossProfit: 400,
    opex: 150,
    operatingCosts: 100,
    advertising: 50,
    royaltyExpense: 0,
    netIncome: 250,
    grossMargin: 0.4,
    netMargin: 0.25,
    ...over,
  } as IncomeStatementDto;
}

const row = (rows: ReturnType<typeof incomeStatementRows>, id: string) => rows.find((r) => r.id === id);

describe('income statement rows', () => {
  it('shows bridge lines in statement order and no reconciling lines when they add up', () => {
    const rows = incomeStatementRows([is({})]);
    expect(rows.map((r) => r.id)).toEqual(['revenue', 'productSales', 'cogs', 'grossProfit', 'opex', 'operatingCosts', 'advertising', 'netIncome', 'grossMargin', 'netMargin']);
    expect(row(rows, 'cogs')!.values).toEqual([-600]);
    expect(row(rows, 'advertising')!.values).toEqual([-50]);
  });

  it('reads E2 statements whose opex already includes depreciation (no double count)', () => {
    // E2 finance fixture: opex 1,192,138.92 = operating 637,000 + advertising 350,000 + D&A 205,138.92.
    const dto = is({
      revenue: 2625000,
      productSales: 945000,
      exportSales: 1680000,
      cogs: 798000,
      grossProfit: 1827000,
      opex: 1192138.92,
      operatingCosts: 637000,
      advertising: 350000,
      depreciation: 205138.92,
      incomeTax: 158715.27,
      otherIncome: -3064861.11,
      netIncome: -2588715.3,
    });
    const rows = incomeStatementRows([dto]);
    expect(row(rows, 'opex')!.values[0]).toBeCloseTo(-987000, 2);
    expect(row(rows, 'opexOther')).toBeUndefined();
    expect(row(rows, 'ebitda')!.values[0]).toBeCloseTo(840000, 2);
    expect(row(rows, 'ebit')!.values[0]).toBeCloseTo(634861.08, 2);
    expect(row(rows, 'otherIncome')!.values[0]).toBeCloseTo(-3064861.11, 2);
    expect(row(rows, 'otherItems')).toBeUndefined();
  });

  it('adds EBITDA, EBIT, interest, pre-tax and tax once finance lines exist', () => {
    const rows = incomeStatementRows([is({ depreciation: 20, interestExpense: 10, incomeTax: 55, netIncome: 165 })]);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['ebitda', 'depreciation', 'ebit', 'interestExpense', 'ebt', 'incomeTax']));
    expect(ids.indexOf('ebitda')).toBeLessThan(ids.indexOf('ebit'));
    expect(ids.indexOf('ebt')).toBeLessThan(ids.indexOf('incomeTax'));
    expect(row(rows, 'ebitda')!.values).toEqual([250]);
    expect(row(rows, 'ebit')!.values).toEqual([230]);
    expect(row(rows, 'ebt')!.values).toEqual([220]);
    expect(row(rows, 'otherItems')).toBeUndefined();
  });

  it('reconciles unlabelled amounts into explicit "Other" lines so columns sum to the bridge totals', () => {
    const rows = incomeStatementRows([is({ opex: 180, netIncome: 200, mysteryFee: 20 })]);
    expect(row(rows, 'opexOther')!.values).toEqual([-30]);
    expect(row(rows, 'otherItems')!.values).toEqual([-20]);
    // unknown numeric fields are listed as memo lines, never summed
    expect(row(rows, 'memo:mysteryFee')).toMatchObject({ kind: 'memo', label: 'Mystery Fee', values: [20] });
    expect(unknownIncomeFields([is({ mysteryFee: 1 })])).toEqual(['mysteryFee']);
  });

  it('keeps null for a missing column', () => {
    const rows = incomeStatementRows([null, is({})]);
    expect(row(rows, 'revenue')!.values).toEqual([null, 1000]);
    expect(row(rows, 'netIncome')!.values).toEqual([null, 250]);
  });
});

function cf(): CashFlowDto {
  return {
    period,
    companyId: 1,
    beginningCash: 1000,
    operating: { lines: [{ category: 'productSales', amount: 500 }, { category: 'operatingCosts', amount: -200 }, { category: 'zebraFees', amount: -10 }], net: 290 },
    investing: { lines: [{ category: 'construction', amount: -400 }], net: -400 },
    financing: { lines: [], net: 0 },
    netChange: -110,
    endingCash: 890,
    reconciles: true,
  } as unknown as CashFlowDto;
}

describe('cash flow rows', () => {
  it('lists every category per section in statement order, unknown last', () => {
    const rows = cashFlowRows([cf()]);
    const op = rows.filter((r) => r.id.startsWith('operating:')).map((r) => r.id);
    expect(op).toEqual(['operating:productSales', 'operating:operatingCosts', 'operating:zebraFees']);
    expect(rows.find((r) => r.id === 'financing:none')).toBeTruthy();
    expect(rows.at(-1)).toMatchObject({ id: 'endingCash', values: [890] });
    expect(cashFlowLabel('zebraFees')).toBe('Zebra Fees');
  });

  it('checks the arithmetic', () => {
    expect(cashFlowAddsUp(cf())).toBe(true);
    expect(cashFlowAddsUp({ ...cf(), endingCash: 900 })).toBe(false);
  });

  it('column deltas', () => {
    expect(columnDelta(100, 150)).toBe(0.5);
    expect(columnDelta(-100, -50)).toBe(0.5);
    expect(columnDelta(0, 5)).toBeNull();
    expect(columnDelta(null, 5)).toBeNull();
  });
});
