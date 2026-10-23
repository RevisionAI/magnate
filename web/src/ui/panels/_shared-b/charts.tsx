// Charts the U3 screens need beyond the design system's LineChart/BarChart:
//   ComboChart — grouped or stacked bars plus line overlays on one y axis
//                (revenue bars + net income line; principal/interest + balance).
//   Waterfall  — a horizontal variance waterfall (start → drivers → end).
// SVG via d3-scale/d3-shape, styled with the design system's chart classes.

import clsx from 'clsx';
import { scaleBand, scaleLinear } from 'd3-scale';
import { curveMonotoneX, line as d3line } from 'd3-shape';
import { useMemo, useState, type ReactNode } from 'react';
import { CHART } from '@/theme/tokens';
import { useElementSize } from '@/ui/hooks';
import chartStyles from '@/ui/components/charts/charts.module.css';
import styles from './shared.module.css';

export interface ComboSeries {
  id: string;
  label: string;
  values: readonly (number | null)[];
  color?: string;
  dashed?: boolean;
  /** Bars: colour each bar by sign (profit/loss palette). */
  signed?: boolean;
}

export interface ComboChartProps {
  labels: readonly string[];
  bars?: readonly ComboSeries[];
  lines?: readonly ComboSeries[];
  /** Stack the bar series instead of grouping them side by side. */
  stacked?: boolean;
  height?: number;
  yFormat?: (v: number) => string;
  /** Highlight one column (e.g. the open month). */
  highlight?: number | null;
  legend?: boolean;
  className?: string;
  'aria-label'?: string;
}

const M = { top: 12, right: 12, bottom: 22, left: 60 };

export function ComboChart({ labels, bars = [], lines = [], stacked = false, height = 200, yFormat = (v) => String(Math.round(v)), highlight = null, legend = true, className, ...aria }: ComboChartProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const barSeries = bars.map((s, i) => ({ ...s, color: s.color ?? CHART.series[i % CHART.series.length]! }));
  const lineSeries = lines.map((s, i) => ({ ...s, color: s.color ?? CHART.series[(i + bars.length) % CHART.series.length]! }));

  const { x, inner, y, ticks } = useMemo(() => {
    const vals: number[] = [0];
    if (stacked) {
      for (let i = 0; i < n; i++) {
        let pos = 0;
        let neg = 0;
        for (const s of bars) {
          const v = s.values[i] ?? 0;
          if (v >= 0) pos += v;
          else neg += v;
        }
        vals.push(pos, neg);
      }
    } else for (const s of bars) for (const v of s.values) if (v !== null && Number.isFinite(v)) vals.push(v);
    for (const s of lines) for (const v of s.values) if (v !== null && Number.isFinite(v)) vals.push(v);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) hi = lo + 1;
    const yScale = scaleLinear().domain([lo, hi]).nice(4).range([height - M.bottom, M.top]);
    const xScale = scaleBand<number>()
      .domain(Array.from({ length: n }, (_, i) => i))
      .range([M.left, Math.max(M.left + 1, width - M.right)])
      .paddingInner(0.3)
      .paddingOuter(0.15);
    const innerScale = scaleBand<number>()
      .domain(stacked ? [0] : bars.map((_, i) => i))
      .range([0, xScale.bandwidth()])
      .paddingInner(0.12);
    lo = yScale.domain()[0]!;
    return { x: xScale, inner: innerScale, y: yScale, ticks: yScale.ticks(4) };
  }, [bars, lines, stacked, n, width, height]);

  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - M.left) / 56))));
  const zero = y(0);
  const center = (i: number) => (x(i) ?? 0) + x.bandwidth() / 2;
  const hasData = n > 0 && [...bars, ...lines].some((s) => s.values.some((v) => v !== null && v !== 0));

  return (
    <div ref={ref} className={clsx(chartStyles.chart, className)} role="img" aria-label={aria['aria-label']}>
      {width > 0 && !hasData && (
        <div className={chartStyles.empty} style={{ height }}>
          No activity in this range yet
        </div>
      )}
      {width > 0 && hasData && (
        <svg className={chartStyles.svg} width={width} height={height} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? chartStyles.zeroLine : chartStyles.gridLine} x1={M.left} x2={width - M.right} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} />
              <text className={chartStyles.axisText} x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {labels.map((_, i) => {
            const bx = x(i) ?? 0;
            let pos = 0;
            let neg = 0;
            return (
              <g key={i} onPointerEnter={() => setHover(i)}>
                <rect x={bx - 3} y={M.top} width={x.bandwidth() + 6} height={height - M.top - M.bottom} fill={highlight === i ? 'rgba(215,183,102,0.06)' : 'transparent'} />
                {barSeries.map((s, si) => {
                  const v = s.values[i];
                  if (v === null || v === undefined || !Number.isFinite(v)) return null;
                  let y0: number;
                  let y1: number;
                  let left: number;
                  let w: number;
                  if (stacked) {
                    const base = v >= 0 ? pos : neg;
                    y0 = y(base);
                    y1 = y(base + v);
                    if (v >= 0) pos += v;
                    else neg += v;
                    left = bx;
                    w = x.bandwidth();
                  } else {
                    y0 = zero;
                    y1 = y(v);
                    left = bx + (inner(si) ?? 0);
                    w = inner.bandwidth();
                  }
                  const fill = s.signed ? (v >= 0 ? 'var(--c-pos)' : 'var(--c-neg)') : s.color;
                  return (
                    <rect
                      key={s.id}
                      className={clsx(chartStyles.bar, hover !== null && hover !== i && chartStyles.barDim)}
                      x={left}
                      y={Math.min(y0, y1)}
                      width={Math.max(1, w)}
                      height={Math.max(1, Math.abs(y1 - y0))}
                      rx={2}
                      fill={fill}
                      opacity={0.92}
                    />
                  );
                })}
                {(i % every === 0 || i === n - 1) && (
                  <text className={chartStyles.axisText} x={center(i)} y={height - 6} textAnchor="middle">
                    {labels[i]}
                  </text>
                )}
              </g>
            );
          })}
          {lineSeries.map((s) => {
            const pts = s.values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null && Number.isFinite(p.v));
            const path = d3line<{ i: number; v: number }>()
              .x((p) => center(p.i))
              .y((p) => y(p.v))
              .curve(curveMonotoneX)(pts);
            return (
              <g key={s.id} pointerEvents="none">
                <path d={path ?? ''} className={clsx(chartStyles.line, s.dashed && chartStyles.dashed)} stroke={s.color} />
                {pts.map((p) => (
                  <circle key={p.i} cx={center(p.i)} cy={y(p.v)} r={hover === p.i ? 4 : 2.6} fill={s.color} className={chartStyles.dot} />
                ))}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && hasData && (
        <div className={chartStyles.tip} style={{ left: Math.min(Math.max(0, center(hover) + 12), Math.max(0, width - 170)), top: M.top }}>
          <div className={chartStyles.tipTitle}>{labels[hover]}</div>
          {[...barSeries, ...lineSeries].map((s) => {
            const v = s.values[hover];
            return (
              <div key={s.id} className={chartStyles.tipRow}>
                <span>
                  <span className={chartStyles.swatch} style={{ background: s.color }} />
                  {s.label}
                </span>
                <b>{v === null || v === undefined ? '—' : yFormat(v)}</b>
              </div>
            );
          })}
        </div>
      )}
      {legend && barSeries.length + lineSeries.length > 1 && (
        <div className={chartStyles.legend}>
          {[...barSeries, ...lineSeries].map((s) => (
            <span key={s.id} className={chartStyles.legendItem}>
              <span className={chartStyles.swatch} style={{ background: s.signed ? 'var(--c-pos)' : s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ waterfall

export interface WaterfallStep {
  id: string;
  label: ReactNode;
  amount: number;
  /** Tooltip text. */
  title?: string;
}

export interface WaterfallProps {
  start: { label: ReactNode; value: number };
  steps: readonly WaterfallStep[];
  end: { label: ReactNode; value: number };
  format: (v: number, signed?: boolean) => string;
  /**
   * 'zero' (default): bars measured from $0. 'auto': the axis zooms to the range
   * the steps move through (a cash bridge where $24M start and end would
   * otherwise dwarf a $40K month); totals are then drawn from the axis floor.
   */
  baseline?: 'zero' | 'auto';
  className?: string;
  'data-testid'?: string;
}

/** start → each step as a floating bar (green up, red down) → end. */
export function Waterfall({ start, steps, end, format, baseline = 'zero', className, ...rest }: WaterfallProps) {
  const points = [start.value];
  let run = start.value;
  for (const s of steps) {
    run += s.amount;
    points.push(run);
  }
  points.push(end.value);
  if (baseline === 'zero') points.push(0);
  let lo = Math.min(...points);
  let hi = Math.max(...points);
  if (baseline === 'auto') {
    const pad = Math.max((hi - lo) * 0.6, Math.abs(hi) * 0.0005, 1);
    lo -= pad;
    hi += pad * 0.25;
  }
  const span = hi - lo || 1;
  const clampPct = (v: number) => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
  const pct = clampPct;
  const floor = baseline === 'auto' ? lo : 0;
  const bar = (a: number, b: number) => ({ left: `${pct(Math.min(a, b))}%`, width: `${Math.max(0.6, Math.abs(pct(b) - pct(a)))}%` });
  const zeroLeft = lo <= 0 && hi >= 0 ? `${pct(0)}%` : null;
  let cursor = start.value;
  return (
    <div className={clsx(styles.waterfall, className)} data-testid={rest['data-testid']}>
      <div className={clsx(styles.wfRow, styles.wfRowTotal)}>
        <span className={styles.wfLabel}>{start.label}</span>
        <span className={styles.wfTrack}>
          {zeroLeft && <span className={styles.wfZero} style={{ left: zeroLeft }} />}
          <span className={clsx(styles.wfBar, styles.wfTotal)} style={bar(floor, start.value)} />
        </span>
        <span className={styles.wfAmount}>{format(start.value)}</span>
      </div>
      {steps.map((s) => {
        const a = cursor;
        cursor += s.amount;
        return (
          <div key={s.id} className={styles.wfRow} title={s.title}>
            <span className={styles.wfLabel}>{s.label}</span>
            <span className={styles.wfTrack}>
              {zeroLeft && <span className={styles.wfZero} style={{ left: zeroLeft }} />}
              <span className={clsx(styles.wfBar, s.amount >= 0 ? styles.wfUp : styles.wfDown)} style={bar(a, cursor)} />
            </span>
            <span className={clsx(styles.wfAmount, s.amount > 0 ? styles.pos : s.amount < 0 ? styles.neg : undefined)}>{format(s.amount, true)}</span>
          </div>
        );
      })}
      <div className={clsx(styles.wfRow, styles.wfRowTotal)}>
        <span className={styles.wfLabel}>{end.label}</span>
        <span className={styles.wfTrack}>
          {zeroLeft && <span className={styles.wfZero} style={{ left: zeroLeft }} />}
          <span className={clsx(styles.wfBar, styles.wfTotal)} style={bar(floor, end.value)} />
        </span>
        <span className={styles.wfAmount}>{format(end.value)}</span>
      </div>
    </div>
  );
}
