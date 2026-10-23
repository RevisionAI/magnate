import { describe, expect, it } from 'vitest';
import { amortization, amortizationByYear, annuityPayment, asFraction, ratePct, ratingBand, ratingNotch, termLabel } from './finance';
import { toCsv } from './csv';

describe('loan amortisation preview', () => {
  it('annuity payment matches P·r / (1 − (1+r)^−n)', () => {
    // $100,000 at 6% for 12 months → $8,606.64
    expect(annuityPayment(100_000, 0.06, 12)).toBe(8606.64);
    expect(annuityPayment(12_000, 0, 12)).toBe(1000);
    expect(annuityPayment(0, 0.06, 12)).toBe(0);
  });

  it('the schedule repays the principal exactly and ends at zero', () => {
    const plan = amortization(250_000, 0.0725, 36);
    expect(plan.rows).toHaveLength(36);
    expect(plan.rows.at(-1)!.balance).toBe(0);
    const principal = plan.rows.reduce((s, r) => s + r.principal, 0);
    expect(principal).toBeCloseTo(250_000, 2);
    expect(plan.totalPaid).toBeCloseTo(250_000 + plan.totalInterest, 2);
    // interest falls and principal rises month by month
    expect(plan.rows[0]!.interest).toBeGreaterThan(plan.rows[35]!.interest);
    expect(plan.rows[0]!.principal).toBeLessThan(plan.rows[35]!.principal);
  });

  it('honours a quoted payment and rolls up by year', () => {
    const plan = amortization(100_000, 0.06, 24, 5_000);
    expect(plan.payment).toBe(5_000);
    expect(plan.rows.at(-1)!.balance).toBe(0);
    const years = amortizationByYear(plan);
    expect(years.map((y) => y.year)).toEqual([1, 2]);
    expect(years[1]!.balance).toBe(0);
    expect(years[0]!.principal + years[1]!.principal).toBeCloseTo(100_000, 2);
  });
});

describe('credit ratings and rates', () => {
  it('maps notches to bands', () => {
    expect(ratingNotch('AAA')).toBe(0);
    expect(ratingNotch('a-')).toBe(4);
    expect(ratingNotch('A−')).toBe(4);
    expect(ratingNotch('ZZ')).toBeNull();
    expect(ratingBand('AA')).toBe('prime');
    expect(ratingBand('BBB')).toBe('investment');
    expect(ratingBand('B-')).toBe('speculative');
    expect(ratingBand('CCC')).toBe('distressed');
    expect(ratingBand(null)).toBe('unrated');
  });

  it('formats terms and rates', () => {
    expect(termLabel(12)).toBe('1 year');
    expect(termLabel(60)).toBe('5 years');
    expect(termLabel(18)).toBe('18 months');
    expect(asFraction(6.61)).toBeCloseTo(0.0661, 6);
    expect(asFraction(0.0661)).toBe(0.0661);
    expect(ratePct(0.0661)).toBe('6.61%');
  });
});

describe('CSV export', () => {
  it('quotes per RFC 4180 and keeps numbers raw', () => {
    expect(
      toCsv([
        ['Line', 'Mar 26'],
        ['Sales, retail', 1234.567],
        ['Say "hi"', null],
        ['NaN', Number.NaN],
      ]),
    ).toBe('Line,Mar 26\r\n"Sales, retail",1234.57\r\n"Say ""hi""",\r\nNaN,');
  });
});
