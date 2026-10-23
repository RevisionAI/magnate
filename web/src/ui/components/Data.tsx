// Data display primitives: Progress, Meter, Stat (KPI tile with delta), Money,
// Delta and Percent formatters. Profit/loss colours come from --c-pos/--c-neg,
// which the colour-vision setting remaps; deltas always carry ▲/▼ as well.

import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useSettingsStore } from '@/state/settingsStore';
import { compact, money, moneyExact, percent, signedMoney, signedPercent } from '@/util/format';
import { Tooltip } from './Tooltip';
import styles from './Data.module.css';

export type ProgressTone = 'gold' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

// ------------------------------------------------------------------ Progress

export interface ProgressProps {
  /** 0..1 */
  value: number;
  tone?: ProgressTone;
  size?: 'sm' | 'md' | 'lg';
  label?: ReactNode;
  /** Text at the right of the label ("71%"); true = percent of value. */
  valueLabel?: ReactNode | true;
  striped?: boolean;
  indeterminate?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function Progress({ value, tone = 'gold', size = 'md', label, valueLabel, striped, indeterminate, className, ...rest }: ProgressProps) {
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={clsx(styles.progress, striped && styles.striped, indeterminate && styles.indeterminate, className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(v * 100)}
      data-testid={rest['data-testid']}
    >
      {(label || valueLabel) && (
        <div className={styles.progressHead}>
          <span>{label}</span>
          {valueLabel && <span className={styles.progressValue}>{valueLabel === true ? percent(v, 0) : valueLabel}</span>}
        </div>
      )}
      <div className={clsx(styles.bar, size === 'sm' && styles.barSm, size === 'lg' && styles.barLg)}>
        <div className={clsx(styles.barFill, styles[`fill-${tone}`])} style={{ width: `${v * 100}%` }} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Meter

export interface MeterProps {
  value: number;
  min?: number;
  max?: number;
  segments?: number;
  /** Tone by fraction thresholds, ascending: [{ at: 0, tone: 'danger' }, { at: 0.34, tone: 'warning' }, …]. */
  thresholds?: { at: number; tone: ProgressTone }[];
  label?: string;
  className?: string;
}

/** Segmented gauge (runway, threat level, quality). */
export function Meter({ value, min = 0, max = 1, segments = 10, thresholds, label, className }: MeterProps) {
  const t = max === min ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)));
  const lit = Math.round(t * segments);
  const tone = thresholds ? ([...thresholds].reverse().find((th) => t >= th.at)?.tone ?? 'gold') : 'gold';
  return (
    <div className={clsx(styles.meter, className)} role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={clsx(styles.segment, i < lit && [styles.segmentOn, styles[`fill-${tone}`]])} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Money / Delta / Percent

export interface MoneyProps {
  value: number;
  /** Always show the sign (+$412K / −$135K). */
  signed?: boolean;
  /** Exact dollars ($1,234,567) regardless of the number-format setting. */
  exact?: boolean;
  digits?: number;
  /** Colour by sign. */
  colored?: boolean;
  className?: string;
}

/** Money in the player's number format (Settings → Gameplay: short/full). */
export function Money({ value, signed = false, exact = false, digits = 2, colored = false, className }: MoneyProps) {
  const format = useSettingsStore((s) => s.gameplay.numberFormat);
  const text = exact || format === 'full'
    ? signed && value > 0
      ? `+${moneyExact(value)}`
      : moneyExact(value).replace('-', '−')
    : signed
      ? signedMoney(value, digits)
      : money(value, digits);
  return <span className={clsx(styles.money, colored && (value > 0 ? styles['tone-pos'] : value < 0 ? styles['tone-neg'] : undefined), className)}>{text}</span>;
}

export interface DeltaProps {
  value: number | null;
  kind?: 'money' | 'percent' | 'number';
  /** Higher is worse (costs, debt): flips the colour, not the arrow. */
  invert?: boolean;
  /** Hide the number, show only the arrow. */
  arrowOnly?: boolean;
  className?: string;
}

export function Delta({ value, kind = 'money', invert = false, arrowOnly = false, className }: DeltaProps) {
  if (value === null || !Number.isFinite(value)) return <span className={clsx(styles.delta, styles.deltaFlat, className)}>—</span>;
  const up = value > 0;
  const flat = value === 0 || (kind === 'percent' && Math.abs(value) < 0.0005);
  const good = invert ? !up : up;
  const text = kind === 'money' ? signedMoney(value) : kind === 'percent' ? signedPercent(value) : `${up ? '+' : value < 0 ? '−' : ''}${compact(Math.abs(value))}`;
  return (
    <span className={clsx(styles.delta, flat ? styles.deltaFlat : good ? styles.deltaUp : styles.deltaDown, className)}>
      {!flat && <span className={styles.arrow}>{up ? '▲' : '▼'}</span>}
      {!arrowOnly && text}
    </span>
  );
}

export function Percent({ value, digits = 1, className }: { value: number; digits?: number; className?: string }) {
  return <span className={clsx(styles.money, className)}>{percent(value, digits)}</span>;
}

// ------------------------------------------------------------------ Stat

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  delta?: ReactNode;
  foot?: ReactNode;
  spark?: ReactNode;
  tone?: 'default' | 'pos' | 'neg' | 'gold' | 'warn';
  size?: 'sm' | 'md' | 'lg';
  /** Framed tile (dashboards) vs bare (HUD). */
  tile?: boolean;
  tooltip?: ReactNode;
  tooltipTitle?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** KPI: label, big value, delta/foot line and optional sparkline. */
export function Stat({ label, value, icon, delta, foot, spark, tone = 'default', size = 'md', tile = false, tooltip, tooltipTitle, className, ...rest }: StatProps) {
  const body = (
    <div className={clsx(styles.stat, styles[size], tile && styles.statTile, className)}>
      <div className={styles.statLabel}>
        {icon}
        {label}
      </div>
      <div className={styles.statRow}>
        <span className={clsx(styles.statValue, tone !== 'default' && styles[`tone-${tone}`])} data-testid={rest['data-testid']}>
          {value}
        </span>
        {delta}
      </div>
      {foot && <div className={styles.statFoot}>{foot}</div>}
      {spark && <div className={styles.statSpark}>{spark}</div>}
    </div>
  );
  if (!tooltip && !tooltipTitle) return body;
  return (
    <Tooltip title={tooltipTitle} content={tooltip} side="bottom" wide>
      {body}
    </Tooltip>
  );
}
