// Statement periods for the management screens (Reports, Finance): month /
// quarter / year columns ending at the current month, clamped to the game start,
// plus a custom range compared with the equal-length period before it.
// Pure date arithmetic only — the numbers come from the bridge per period
// (bridge-spec §4.6.2: a month before `now` is closed and immutable).

import type { DateDto, PeriodArgs } from '@/bridge/protocol';
import { addMonths, monthName, monthOrdinal } from '@/util/format';

export type Granularity = 'month' | 'quarter' | 'year' | 'custom';

export interface PeriodColumn {
  from: DateDto;
  to: DateDto;
  /** Column header ("Mar 26", "Q1 2026", "2026"). */
  label: string;
  /** Longer form for tooltips and captions ("March 2026", "Jan–Mar 2026"). */
  caption: string;
  /** The period includes the current, still-open month (month-to-date). */
  open: boolean;
}

const ord = monthOrdinal;
const fromOrd = (o: number): DateDto => ({ year: Math.floor(o / 12), month: (o % 12) + 1 });
const clampOrd = (o: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, o));

export function shortMonth(d: DateDto): string {
  return `${monthName(d.month)} ${String(d.year).slice(2)}`;
}

/** "Jan–Mar 2026", "Nov 2025–Feb 2026", "Mar 2026". */
export function rangeCaption(from: DateDto, to: DateDto): string {
  if (ord(from) === ord(to)) return `${monthName(from.month)} ${from.year}`;
  if (from.year === to.year) return `${monthName(from.month)}–${monthName(to.month)} ${to.year}`;
  return `${monthName(from.month)} ${from.year}–${monthName(to.month)} ${to.year}`;
}

function column(fromO: number, toO: number, nowO: number, label: string): PeriodColumn {
  const from = fromOrd(fromO);
  const to = fromOrd(toO);
  return { from, to, label, caption: rangeCaption(from, to), open: toO >= nowO };
}

/**
 * Up to `count` columns ending with the period that contains `now`, oldest first.
 * Quarters and years are calendar periods clamped to [start, now] (the first and
 * last column can be partial). `custom` returns the previous equal-length period
 * (when it starts on or after `start`) followed by the custom range itself.
 */
export function periodColumns(
  granularity: Granularity,
  now: DateDto,
  start: DateDto,
  count: number,
  custom?: { from: DateDto; to: DateDto },
): PeriodColumn[] {
  const nowO = ord(now);
  const startO = Math.min(ord(start), nowO);
  const out: PeriodColumn[] = [];
  if (granularity === 'custom') {
    const range = custom ?? { from: now, to: now };
    let a = clampOrd(ord(range.from), startO, nowO);
    let b = clampOrd(ord(range.to), startO, nowO);
    if (a > b) [a, b] = [b, a];
    const len = b - a + 1;
    if (a - len >= startO) out.push(column(a - len, a - 1, nowO, rangeCaption(fromOrd(a - len), fromOrd(a - 1))));
    out.push(column(a, b, nowO, rangeCaption(fromOrd(a), fromOrd(b))));
    return out;
  }
  const size = granularity === 'month' ? 1 : granularity === 'quarter' ? 3 : 12;
  // Calendar-aligned period containing `now`.
  let periodStart = granularity === 'month' ? nowO : nowO - (granularity === 'quarter' ? nowO % 3 : nowO % 12);
  for (let i = 0; i < count; i++) {
    const periodEnd = Math.min(periodStart + size - 1, nowO);
    if (periodEnd < startO) break;
    const a = Math.max(periodStart, startO);
    const d = fromOrd(periodStart);
    const label =
      granularity === 'month'
        ? shortMonth(d)
        : granularity === 'quarter'
          ? `Q${Math.floor((d.month - 1) / 3) + 1} ${d.year}`
          : String(d.year);
    out.unshift(column(a, periodEnd, nowO, label));
    periodStart -= size;
  }
  return out;
}

export function toPeriodArgs(c: Pick<PeriodColumn, 'from' | 'to'>): PeriodArgs {
  return { from: c.from, to: c.to };
}

/** Every month from `start` to `now`, newest first (custom-range pickers). */
export function monthOptions(start: DateDto, now: DateDto): DateDto[] {
  const out: DateDto[] = [];
  for (let o = ord(now); o >= Math.min(ord(start), ord(now)); o--) out.push(fromOrd(o));
  return out;
}

/** Stable string key for a month (Select values). */
export function monthKey(d: DateDto): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}`;
}

export function parseMonthKey(key: string): DateDto | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

/** True when every month of the period is closed (cacheable forever). */
export function isClosed(c: Pick<PeriodColumn, 'to'>, now: DateDto): boolean {
  return ord(c.to) < ord(now);
}

/** Months between two dates inclusive. */
export function monthSpan(from: DateDto, to: DateDto): number {
  return ord(to) - ord(from) + 1;
}

export { addMonths };
