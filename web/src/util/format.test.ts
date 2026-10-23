import { describe, expect, it } from 'vitest';
import {
  addMonths,
  bytes,
  compact,
  durationMonths,
  humanizeId,
  money,
  moneyExact,
  moneyFmt,
  monthsBetween,
  monthYear,
  percent,
  playTime,
  realTimeEstimate,
  relativeChange,
  signedMoney,
  signedPercent,
  timeAgo,
} from './format';

describe('money formatting', () => {
  it('compacts by magnitude', () => {
    expect(money(13_940_000)).toBe('$13.94M');
    expect(money(-450_000)).toBe('-$450K');
    expect(money(12_500_000_000, 1)).toBe('$12.5B');
    expect(money(45_600)).toBe('$45.6K');
    expect(money(1.8)).toBe('$1.80');
    expect(money(4000)).toBe('$4,000');
    expect(money(-9000)).toBe('-$9,000');
    expect(money(Number.NaN)).toBe('—');
  });

  it('signs explicitly', () => {
    expect(signedMoney(412_000)).toBe('+$412K');
    expect(signedMoney(-135_000)).toBe('−$135K');
    expect(signedMoney(0)).toBe('$0');
  });

  it('honours the short/full number format setting', () => {
    expect(moneyFmt(1_234_567, 'short')).toBe('$1.23M');
    expect(moneyFmt(1_234_567, 'full')).toBe('$1,234,567');
    expect(moneyExact(-9_000)).toBe('-$9,000');
  });
});

describe('numbers and percentages', () => {
  it('formats compact numbers and percentages', () => {
    expect(compact(2_630_000)).toBe('2.6M');
    expect(percent(0.4712)).toBe('47.1%');
    expect(signedPercent(0.009)).toBe('+0.9%');
    expect(signedPercent(-0.0123)).toBe('−1.2%');
    expect(signedPercent(0)).toBe('0.0%');
  });

  it('computes relative change safely', () => {
    expect(relativeChange(100, 110)).toBeCloseTo(0.1);
    expect(relativeChange(-100, -50)).toBeCloseTo(0.5);
    expect(relativeChange(0, 10)).toBeNull();
  });
});

describe('dates and durations', () => {
  it('does month arithmetic across years', () => {
    expect(monthsBetween({ year: 2026, month: 1 }, { year: 2030, month: 12 })).toBe(59);
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(monthYear({ year: 2026, month: 3 })).toBe('Mar 2026');
  });

  it('describes durations for briefings', () => {
    expect(durationMonths(1)).toBe('1 month');
    expect(durationMonths(59)).toBe('4 yrs 11 mo');
    expect(durationMonths(24)).toBe('2 years');
    expect(realTimeEstimate(59 * 12)).toBe('≈ 12 min');
    expect(realTimeEstimate(4200)).toBe('≈ 1 h 10 min');
    expect(playTime(3 * 3600 + 5 * 60)).toBe('3 h 05 min');
  });

  it('describes save ages', () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    expect(timeAgo(now - 10_000, now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(timeAgo(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(timeAgo(now - 2 * 86400_000, now)).toBe('2 days ago');
  });

  it('formats misc helpers', () => {
    expect(bytes(1536)).toBe('1.5 KB');
    expect(humanizeId('soft_drink')).toBe('Soft Drink');
    expect(humanizeId('verticalIntegrator')).toBe('Vertical Integrator');
  });
});
