import { describe, expect, it } from 'vitest';
import { isClosed, monthKey, monthOptions, monthSpan, parseMonthKey, periodColumns, rangeCaption } from './periods';

const d = (year: number, month: number) => ({ year, month });

describe('statement periods', () => {
  it('month columns end at now, oldest first, clamped to the game start', () => {
    const cols = periodColumns('month', d(2026, 3), d(2026, 1), 6);
    expect(cols.map((c) => c.label)).toEqual(['Jan 26', 'Feb 26', 'Mar 26']);
    expect(cols.map((c) => c.open)).toEqual([false, false, true]);
  });

  it('quarters are calendar-aligned and the first one can be partial', () => {
    const cols = periodColumns('quarter', d(2026, 5), d(2025, 11), 8);
    expect(cols.map((c) => c.label)).toEqual(['Q4 2025', 'Q1 2026', 'Q2 2026']);
    expect(cols[0]).toMatchObject({ from: d(2025, 11), to: d(2025, 12) });
    expect(cols[2]).toMatchObject({ from: d(2026, 4), to: d(2026, 5), open: true });
  });

  it('years span calendar years up to now', () => {
    const cols = periodColumns('year', d(2027, 2), d(2025, 6), 5);
    expect(cols.map((c) => c.label)).toEqual(['2025', '2026', '2027']);
    expect(cols[1]).toMatchObject({ from: d(2026, 1), to: d(2026, 12), open: false });
    expect(cols[2]!.caption).toBe('Jan–Feb 2027');
  });

  it('custom ranges compare with the equal-length period before them', () => {
    const cols = periodColumns('custom', d(2026, 12), d(2025, 1), 0, { from: d(2026, 7), to: d(2026, 9) });
    expect(cols.map((c) => [c.from, c.to])).toEqual([
      [d(2026, 4), d(2026, 6)],
      [d(2026, 7), d(2026, 9)],
    ]);
    // reversed and before-start ranges are normalised; no comparison before the start
    const early = periodColumns('custom', d(2026, 12), d(2026, 1), 0, { from: d(2026, 3), to: d(2025, 1) });
    expect(early).toHaveLength(1);
    expect(early[0]).toMatchObject({ from: d(2026, 1), to: d(2026, 3) });
  });

  it('captions, keys and spans', () => {
    expect(rangeCaption(d(2025, 11), d(2026, 2))).toBe('Nov 2025–Feb 2026');
    expect(rangeCaption(d(2026, 3), d(2026, 3))).toBe('Mar 2026');
    expect(monthKey(d(2026, 3))).toBe('2026-03');
    expect(parseMonthKey('2026-03')).toEqual(d(2026, 3));
    expect(parseMonthKey('nope')).toBeNull();
    expect(monthSpan(d(2025, 11), d(2026, 2))).toBe(4);
    expect(monthOptions(d(2026, 1), d(2026, 3))).toEqual([d(2026, 3), d(2026, 2), d(2026, 1)]);
    expect(isClosed({ to: d(2026, 2) }, d(2026, 3))).toBe(true);
    expect(isClosed({ to: d(2026, 3) }, d(2026, 3))).toBe(false);
  });
});
