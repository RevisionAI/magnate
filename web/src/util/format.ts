// Number, money and date formatting shared by every UI surface. Pure functions;
// components pick the variant they need (compact for HUD/charts, exact for
// statements). Minus signs use U+2212 only where noted, so values stay
// copy-pasteable as numbers elsewhere.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export interface DateLike {
  year: number;
  month: number;
}

/** "$1.23M", "-$450K", "$12.5B" — compact money for HUDs and charts. */
export function money(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(digits)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e4) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  if (abs >= 1e3) return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
  return `${sign}$${abs.toFixed(abs >= 100 ? 0 : 2)}`;
}

/** "$1,234,567" — exact money for statements and tables. */
export function moneyExact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** Money in the player's chosen number format (Settings → Gameplay: short | full). */
export function moneyFmt(value: number, format: 'short' | 'full' = 'short', digits = 2): string {
  return format === 'full' ? moneyExact(value) : money(value, digits);
}

/** "+$1.2M" / "−$450K" — always signed; zero renders as "$0". */
export function signedMoney(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '$0';
  const body = money(Math.abs(value), digits);
  return value > 0 ? `+${body}` : `−${body}`;
}

/** Unit price with cents: "$1.80", "$18,000". */
export function price(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value >= 1000
    ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${value.toFixed(2)}`;
}

/** "1.2M", "34.5K", "812". */
export function compact(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(digits)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(digits)}K`;
  return `${sign}${abs.toFixed(abs >= 100 ? 0 : digits)}`;
}

/** "1,234,567". */
export function integer(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

/** "42.0%". Input is a fraction (0.42). */
export function percent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** "+4.2%" / "−1.0%" — signed percentage change. Input is a fraction. */
export function signedPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '—';
  const v = fraction * 100;
  const rounded = Number(v.toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)}%`;
  return `${rounded > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`;
}

/** Relative change (b − a) / |a|; null when undefined (a == 0 or non-finite). */
export function relativeChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return (to - from) / Math.abs(from);
}

export function monthName(month: number, long = false): string {
  const index = Math.min(12, Math.max(1, month)) - 1;
  return (long ? MONTHS_LONG[index] : MONTHS[index]) ?? '';
}

/** "Mar 2026". */
export function monthYear(date: DateLike): string {
  return `${monthName(date.month)} ${date.year}`;
}

/** "March 2026". */
export function monthYearLong(date: DateLike): string {
  return `${monthName(date.month, true)} ${date.year}`;
}

/** Days in a calendar month (Gregorian). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Absolute month index (year × 12 + month − 1) — for differences between dates. */
export function monthOrdinal(date: DateLike): number {
  return date.year * 12 + (date.month - 1);
}

/** Whole months from `a` to `b` (negative when b is earlier). */
export function monthsBetween(a: DateLike, b: DateLike): number {
  return monthOrdinal(b) - monthOrdinal(a);
}

/** The month after/before `date` by `delta` months. */
export function addMonths(date: DateLike, delta: number): DateLike {
  const ord = monthOrdinal(date) + delta;
  return { year: Math.floor(ord / 12), month: (((ord % 12) + 12) % 12) + 1 };
}

/** "3 months", "1 month", "2 yrs 4 mo". */
export function durationMonths(months: number): string {
  const m = Math.max(0, Math.round(months));
  if (m < 24) return `${m} month${m === 1 ? '' : 's'}`;
  const years = Math.floor(m / 12);
  const rest = m % 12;
  return rest === 0 ? `${years} years` : `${years} yrs ${rest} mo`;
}

/** Real-time estimate: "≈ 12 min", "≈ 1 h 10 min", "< 1 min". */
export function realTimeEstimate(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `≈ ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `≈ ${h} h` : `≈ ${h} h ${rest} min`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", else a date. */
export function timeAgo(timestampMs: number, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  const date = new Date(timestampMs);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Play time: "42 min", "3 h 05 min". */
export function playTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60));
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  return `${h} h ${String(total % 60).padStart(2, '0')} min`;
}

/** Byte sizes: "812 B", "14.2 KB", "1.6 MB". */
export function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Title-cases an engine id: "soft_drink" → "Soft Drink" (display fallback when no catalog name exists). */
export function humanizeId(id: string): string {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
