// Quantity formatting for the U2 panels: whole numbers below 1,000 ("812",
// "0"), compact above without a trailing ".0" ("1.3M", "640K", "1M") —
// `compact()` alone prints "0.0" and "640.0K".

import { compact } from '@/util/format';

export function qty(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1000) return String(Math.round(value));
  return compact(value).replace(/\.0(?=[KMB]$)/, '');
}

/** "4.5 months", "over 3 years" — runway text that stays readable for big cash piles. */
export function runwayText(months: number): string {
  if (!Number.isFinite(months)) return 'not burning cash';
  if (months >= 36) return `over ${Math.floor(months / 12)} years`;
  if (months >= 24) return `${(months / 12).toFixed(1)} years`;
  return `${months.toFixed(1)} month${months.toFixed(1) === '1.0' ? '' : 's'}`;
}
