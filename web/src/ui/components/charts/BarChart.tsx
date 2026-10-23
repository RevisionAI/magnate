// Responsive vertical bar chart (± values), and a 100% stacked bar for
// compositions (balance sheet, market split).
//
//   <BarChart data={months.map((m) => ({ label: m.label, value: m.netIncome }))} yFormat={money} signed />
//   <StackedBar segments={[{ label: 'Cash', value: 9e6 }, { label: 'Buildings', value: 4e6 }]} format={money} />

import { scaleBand, scaleLinear } from 'd3-scale';
import { useMemo, useState } from 'react';
import { CHART } from '@/theme/tokens';
import { percent } from '@/util/format';
import { useElementSize } from '../../hooks';
import styles from './charts.module.css';

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  data: readonly BarDatum[];
  height?: number;
  yFormat?: (value: number) => string;
  /** Colour bars by sign (profit/loss palette) instead of a single series colour. */
  signed?: boolean;
  color?: string;
  className?: string;
  'aria-label'?: string;
}

const M = { top: 10, right: 8, bottom: 22, left: 56 };

export function BarChart({ data, height = 180, yFormat = (v) => String(Math.round(v)), signed = false, color = CHART.series[0], className, ...aria }: BarChartProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const { x, y, ticks } = useMemo(() => {
    const values = data.map((d) => d.value);
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    const yScale = scaleLinear()
      .domain([lo, hi === lo ? lo + 1 : hi])
      .nice(4)
      .range([height - M.bottom, M.top]);
    const xScale = scaleBand<number>()
      .domain(data.map((_, i) => i))
      .range([M.left, Math.max(M.left + 1, width - M.right)])
      .paddingInner(0.28)
      .paddingOuter(0.12);
    return { x: xScale, y: yScale, ticks: yScale.ticks(4) };
  }, [data, width, height]);

  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor((width - M.left) / 48))));
  const zero = y(0);

  return (
    <div ref={ref} className={`${styles.chart} ${className ?? ''}`} role="img" aria-label={aria['aria-label']}>
      {width > 0 && data.length === 0 && (
        <div className={styles.empty} style={{ height }}>
          No data yet
        </div>
      )}
      {width > 0 && data.length > 0 && (
        <svg className={styles.svg} width={width} height={height} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? styles.zeroLine : styles.gridLine} x1={M.left} x2={width - M.right} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} />
              <text className={styles.axisText} x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const bx = x(i) ?? 0;
            const top = Math.min(y(d.value), zero);
            const h = Math.max(1, Math.abs(y(d.value) - zero));
            const fill = d.color ?? (signed ? (d.value >= 0 ? 'var(--c-pos)' : 'var(--c-neg)') : color);
            return (
              <g key={i} onPointerEnter={() => setHover(i)}>
                <rect x={bx - 2} y={M.top} width={x.bandwidth() + 4} height={height - M.top - M.bottom} fill="transparent" />
                <rect
                  className={`${styles.bar} ${hover !== null && hover !== i ? styles.barDim : ''}`}
                  x={bx}
                  y={top}
                  width={x.bandwidth()}
                  height={h}
                  rx={2}
                  fill={fill}
                />
                {(i % every === 0 || i === data.length - 1) && (
                  <text className={styles.axisText} x={bx + x.bandwidth() / 2} y={height - 6} textAnchor="middle">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <div className={styles.tip} style={{ left: Math.min((x(hover) ?? 0) + x.bandwidth() + 6, Math.max(0, width - 140)), top: M.top }}>
          <div className={styles.tipTitle}>{data[hover]!.label}</div>
          <div className={styles.tipRow}>
            <b>{yFormat(data[hover]!.value)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

export interface StackSegment {
  label: string;
  value: number;
  color?: string;
}

export interface StackedBarProps {
  segments: readonly StackSegment[];
  height?: number;
  format?: (value: number) => string;
  legend?: boolean;
  className?: string;
}

export function StackedBar({ segments, height = 12, format = (v) => String(Math.round(v)), legend = true, className }: StackedBarProps) {
  // Colours follow the segment's position in `segments`, so bar and legend always agree.
  const colored = segments.map((s, i) => ({ ...s, color: s.color ?? CHART.series[i % CHART.series.length]! }));
  const positive = colored.filter((s) => s.value > 0);
  const total = positive.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className={className}>
      <div className={styles.stack} style={{ height }} role="img" aria-label={positive.map((s) => `${s.label} ${percent(total ? s.value / total : 0, 0)}`).join(', ')}>
        {positive.map((s) => (
          <div
            key={s.label}
            className={styles.stackSeg}
            title={`${s.label}: ${format(s.value)} (${percent(total ? s.value / total : 0, 0)})`}
            style={{ width: `${total ? (s.value / total) * 100 : 0}%`, background: s.color }}
          />
        ))}
      </div>
      {legend && (
        <div className={styles.legend}>
          {colored.map((s) => (
            <span key={s.label} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: s.color }} />
              {s.label}
              <span className={styles.legendValue}>
                {format(s.value)} · {percent(total && s.value > 0 ? s.value / total : 0, 0)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
