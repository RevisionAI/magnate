// 12-month brand-awareness forecast for the Marketing screen (UX §6.12).
//
// The bridge's `previewAdCampaign` projects exactly one month with the engine's
// own formula for the active ruleset. Classic adds `lift = points × (1 − B/100)`
// and decays only stopped campaigns; Realistic (econ §4.20) decays every month
// and adds the same saturating lift. Rather than hard-coding either rule, the
// forecast is calibrated on the bridge's projection: the gap between
// `current + lift` and `projected` is the decay the engine applied this month,
// expressed as a rate on the current brand. Month 1 of the forecast therefore
// equals the bridge's projection by construction; later months repeat the same
// rule with the same points per month (budget × media bonus ÷ cost per point).

import type { AdPreviewDto } from '@/bridge/protocol';

export interface BrandForecast {
  /** Brand at month 0 (now) … month N while the campaign keeps running. */
  keep: number[];
  /** Brand at month 0 … N if the campaign stops now. */
  stop: number[];
  /** Awareness points bought per month (before saturation). */
  pointsPerMonth: number;
  /** Decay rate applied while running (0 under Classic rules). */
  runningDecay: number;
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));

export function brandForecast(preview: AdPreviewDto, stoppedDecay: number, months = 12): BrandForecast {
  const b0 = clamp(preview.currentBrand);
  const points = preview.costPerPoint > 0 ? preview.effectiveBudget / preview.costPerPoint : 0;
  // Decay the engine applied this month while the campaign runs (Realistic: every month).
  const implied = b0 > 0.01 ? (b0 + preview.lift - preview.projectedBrand) / b0 : 0;
  const runningDecay = Math.min(0.5, Math.max(0, Number.isFinite(implied) ? implied : 0));
  const keep = [b0];
  const stop = [b0];
  let k = b0;
  let s = b0;
  for (let m = 1; m <= months; m++) {
    k = m === 1 ? clamp(preview.projectedBrand) : clamp(k * (1 - runningDecay) + points * (1 - k / 100));
    s = clamp(s * (1 - stoppedDecay));
    keep.push(k);
    stop.push(s);
  }
  return { keep, stop, pointsPerMonth: points, runningDecay };
}

/** Months until the forecast first reaches `target` (null if it never does in the horizon). */
export function monthsToReach(series: readonly number[], target: number): number | null {
  const i = series.findIndex((v) => v >= target);
  return i < 0 ? null : i;
}
