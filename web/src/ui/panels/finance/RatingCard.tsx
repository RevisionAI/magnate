// Credit rating badge + the AAA…D ladder (econ §4.10 notch scale) and the
// facts the rating is built from (coverage, leverage, limit, next review).

import clsx from 'clsx';
import { Meter, Panel } from '@/ui/components';
import { monthYear } from '@/util/format';
import { useMoneyFormat } from '../_shared-b/components';
import { borrowable, type CreditProfileView, finiteRatio, RATING_BAND_LABEL, RATING_SCALE, ratePct, ratingBand, ratingNotch } from '../_shared-b/finance';
import shared from '../_shared-b/shared.module.css';
import styles from './Finance.module.css';

export function RatingBadge({ rating, pricedAs }: { rating: string | null; pricedAs?: string | null }) {
  const band = ratingBand(rating);
  return (
    <div className={clsx(styles.rating, styles[`band-${band}`])}>
      <div className={clsx(styles.ratingBadge, (rating ?? 'NR').length > 2 && styles.ratingBadgeLong)} data-testid="credit-rating">
        {rating ?? 'NR'}
      </div>
      <div className={styles.ratingText}>
        <span className={styles.ratingBand}>{RATING_BAND_LABEL[band]}</span>
        <span className={`${shared.small} ${shared.muted}`}>
          {band === 'unrated' && pricedAs ? `Loans priced as ${pricedAs} until the first rating · reviewed quarterly` : 'Rated quarterly from interest cover, leverage and size'}
        </span>
      </div>
    </div>
  );
}

export function RatingLadder({ rating }: { rating: string | null }) {
  const n = ratingNotch(rating);
  return (
    <div className={styles.ladder} aria-label="Rating scale">
      {RATING_SCALE.map((r, i) => (
        <span key={r} className={clsx(styles.rung, i === n && styles.rungOn, i <= 4 ? styles.rungPrime : i <= 10 ? styles.rungSpec : styles.rungBad)}>
          {r}
        </span>
      ))}
    </div>
  );
}

export function CreditProfileCard({ profile }: { profile: CreditProfileView }) {
  const fmt = useMoneyFormat();
  const used = profile.creditLimit > 0 ? Math.min(1, profile.outstanding / profile.creditLimit) : 0;
  const cover = finiteRatio(profile.interestCoverage);
  const leverage = finiteRatio(profile.debtToEquity);
  const netDebtToEbitda = finiteRatio(profile.netDebtToEbitda);
  return (
    <Panel title="Credit profile" padding="md" variant="solid" accent data-testid="credit-profile">
      <RatingBadge rating={profile.rating} pricedAs={profile.pricingRating ?? null} />
      <RatingLadder rating={profile.rating} />
      <div className={shared.stackTight} style={{ marginTop: 14 }}>
        <div className={shared.meterRow}>
          <span className={shared.muted}>Borrowed {fmt(profile.outstanding)} of {fmt(profile.creditLimit)}</span>
          <b className={shared.num}>{Math.round(used * 100)}%</b>
        </div>
        <Meter value={used} segments={20} thresholds={[{ at: 0, tone: 'success' }, { at: 0.6, tone: 'warning' }, { at: 0.85, tone: 'danger' }]} label="Credit used" />
        <Fact label="Your borrowing rate" value={ratePct(profile.interestRate)} />
        <Fact label="New loans available" value={fmt(borrowable(profile))} />
        <Fact label="Interest cover (EBIT ÷ interest)" value={cover === null ? 'No interest' : `${cover.toFixed(1)}×`} />
        <Fact label="Debt to equity" value={leverage === null ? '—' : leverage.toFixed(2)} />
        {netDebtToEbitda !== null && <Fact label="Net debt ÷ EBITDA" value={netDebtToEbitda <= 0 ? 'Net cash' : `${netDebtToEbitda.toFixed(1)}×`} />}
        {profile.ebitdaTtm !== undefined && <Fact label="EBITDA, last 12 months" value={fmt(profile.ebitdaTtm)} />}
        {profile.lastReview && <Fact label="Last review" value={monthYear(profile.lastReview)} />}
        <Fact label="Next review" value={monthYear(profile.nextReview)} />
      </div>
    </Panel>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={shared.meterRow}>
      <span className={shared.muted}>{label}</span>
      <b className={shared.num}>{value}</b>
    </div>
  );
}
