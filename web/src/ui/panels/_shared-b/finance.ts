// Presentation helpers for the Finance screen: an amortisation preview for a
// loan offer (econ §4.10: monthly annuity, payment = P·r / (1 − (1+r)^−n)), and
// the credit-rating scale (AAA … D) for colouring and the rating ladder.
// The bridge's own `monthlyPayment` stays authoritative; the schedule only
// illustrates how that payment splits into interest and principal over time.

import type { BalanceSheetDto, CreditProfileDto, LoanDto, LoanOfferDto } from '@/bridge/protocol';

// ------------------------------------------------------------------ E2 finance views
// The finance DTOs come from protocol.ts (the single source of the bridge contract, E2 fields
// included since the Wave 2 merge). The view names are kept as aliases for the screens.

export type SolvencyId = CreditProfileDto['solvency'];
export type CreditProfileView = CreditProfileDto;
export type LoanOfferView = LoanOfferDto;
export type LoanView = LoanDto;
export type BalanceSheetView = BalanceSheetDto;

/** Largest new term loan available now: the bridge's `newLoanMax`, else the unused credit limit. */
export function borrowable(profile: CreditProfileView): number {
  if (profile.newLoanMax !== undefined && Number.isFinite(profile.newLoanMax)) return Math.max(0, profile.newLoanMax);
  return Math.max(0, profile.creditLimit - profile.outstanding);
}

/** The policy rate as shown in the rules ("4.00%"), from the profile when the bridge reports it. */
export function policyRateText(profile: CreditProfileView | null | undefined): string {
  return ratePct(profile?.policyRate ?? 0.04);
}

/** A finite ratio, or null (bridges omit or send huge sentinels for "no interest"). */
export function finiteRatio(value: number | null | undefined, cap = 999): number | null {
  return value === null || value === undefined || !Number.isFinite(value) || Math.abs(value) >= cap ? null : value;
}

export interface AmortizationRow {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

export interface AmortizationPlan {
  rows: AmortizationRow[];
  payment: number;
  totalInterest: number;
  totalPaid: number;
}

/** Monthly annuity payment (2-dp cents). Zero-rate loans repay linearly. */
export function annuityPayment(principal: number, annualRate: number, termMonths: number): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  const r = annualRate / 12;
  const raw = r === 0 ? principal / termMonths : (principal * r) / (1 - Math.pow(1 + r, -termMonths));
  return Math.round(raw * 100) / 100;
}

/**
 * Month-by-month schedule. `payment` defaults to the annuity payment; pass the
 * bridge's quoted payment to illustrate exactly that offer. The final payment
 * clears the remaining balance so the schedule always ends at zero.
 */
export function amortization(principal: number, annualRate: number, termMonths: number, payment?: number): AmortizationPlan {
  const rows: AmortizationRow[] = [];
  const pay = payment && payment > 0 ? payment : annuityPayment(principal, annualRate, termMonths);
  const r = annualRate / 12;
  let balance = principal;
  let totalInterest = 0;
  let totalPaid = 0;
  for (let m = 1; m <= termMonths && balance > 0.005; m++) {
    const interest = Math.round(balance * r * 100) / 100;
    let principalPart = Math.round((pay - interest) * 100) / 100;
    if (m === termMonths || principalPart > balance) principalPart = Math.round(balance * 100) / 100;
    const paid = interest + principalPart;
    balance = Math.max(0, Math.round((balance - principalPart) * 100) / 100);
    totalInterest += interest;
    totalPaid += paid;
    rows.push({ month: m, payment: paid, interest, principal: principalPart, balance });
  }
  return { rows, payment: pay, totalInterest: Math.round(totalInterest * 100) / 100, totalPaid: Math.round(totalPaid * 100) / 100 };
}

/** Aggregates a schedule by year (charts with long terms stay readable). */
export function amortizationByYear(plan: AmortizationPlan): { year: number; interest: number; principal: number; balance: number }[] {
  const out: { year: number; interest: number; principal: number; balance: number }[] = [];
  for (const row of plan.rows) {
    const year = Math.ceil(row.month / 12);
    let bucket = out[year - 1];
    if (!bucket) {
      bucket = { year, interest: 0, principal: 0, balance: row.balance };
      out[year - 1] = bucket;
    }
    bucket.interest += row.interest;
    bucket.principal += row.principal;
    bucket.balance = row.balance;
  }
  return out;
}

/** Notch scale best → worst (econ §4.10). */
export const RATING_SCALE = ['AAA', 'AA', 'A+', 'A', 'A−', 'BBB', 'BB+', 'BB', 'B+', 'B', 'B−', 'CCC', 'CC', 'C', 'D'] as const;

/** Notch index of a rating string (0 = AAA); accepts ASCII '-' for '−'; null when unknown/unrated. */
export function ratingNotch(rating: string | null | undefined): number | null {
  if (!rating) return null;
  const r = rating.trim().toUpperCase().replace('-', '−');
  const i = (RATING_SCALE as readonly string[]).indexOf(r);
  return i < 0 ? null : i;
}

export type RatingBand = 'prime' | 'investment' | 'speculative' | 'distressed' | 'unrated';

/** AAA–A− prime/high grade, BBB investment grade, BB+–B− speculative, CCC–D distressed. */
export function ratingBand(rating: string | null | undefined): RatingBand {
  const n = ratingNotch(rating);
  if (n === null) return 'unrated';
  if (n <= 4) return 'prime';
  if (n === 5) return 'investment';
  if (n <= 10) return 'speculative';
  return 'distressed';
}

export const RATING_BAND_LABEL: Record<RatingBand, string> = {
  prime: 'High grade',
  investment: 'Investment grade',
  speculative: 'Speculative',
  distressed: 'Distressed',
  unrated: 'Not yet rated',
};

/** "12 months" → "1 year", "60" → "5 years", "18" → "18 months". */
export function termLabel(months: number): string {
  if (months % 12 === 0) {
    const y = months / 12;
    return `${y} year${y === 1 ? '' : 's'}`;
  }
  return `${months} months`;
}

/**
 * Rates travel as fractions (0.0661) like every other ratio in the protocol;
 * a value above 1 is read as a percentage (6.61) so the UI stays right either way.
 */
export function asFraction(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.abs(rate) > 1 ? rate / 100 : rate;
}

/** "6.61%". */
export function ratePct(rate: number, digits = 2): string {
  return `${(asFraction(rate) * 100).toFixed(digits)}%`;
}

/**
 * Rating goals count notches above D (`current`/`target`, unit `rating`):
 * 0 = D … 14 = AAA. Returns the grade, or null outside the scale.
 */
export function ratingFromNotchesAboveD(notches: number | null | undefined): string | null {
  if (notches === null || notches === undefined || !Number.isFinite(notches)) return null;
  const i = RATING_SCALE.length - 1 - Math.round(notches);
  return i >= 0 && i < RATING_SCALE.length ? RATING_SCALE[i]! : null;
}
