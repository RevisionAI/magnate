// Responsive multi-series line chart with gridlines, a zero line, a hover
// crosshair and a value tooltip. SVG via d3-scale/d3-shape.
//
//   <LineChart labels={months} series={[{ id: 'value', label: 'Company value', values }]} yFormat={money} />

import { scaleLinear } from 'd3-scale';
import { area as d3area, curveMonotoneX, line as d3line } from 'd3-shape';
import { useMemo, useState, type PointerEvent } from 'react';
import { CHART } from '@/theme/tokens';
import { useElementSize, useStableId } from '../../hooks';
import styles from './charts.module.css';

export interface LineSeries {
  id: string;
  label: string;
  values: readonly (number | null)[];
  color?: string;
  area?: boolean;
  dashed?: boolean;
}

export interface LineChartProps {
  series: readonly LineSeries[];
  /** X labels, one per value index ("Jan 26"…). */
  labels: readonly string[];
  height?: number;
  yFormat?: (value: number) => string;
  /** Include 0 in the y domain (default: when the data crosses or nears zero). */
  zeroBased?: boolean;
  legend?: boolean;
  className?: string;
  'aria-label'?: string;
}

const M = { top: 10, right: 12, bottom: 22, left: 56 };

export function LineChart({ series, labels, height = 200, yFormat = (v) => String(Math.round(v)), zeroBased, legend = true, className, ...aria }: LineChartProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const gid = useStableId('lc');
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(labels.length, ...series.map((s) => s.values.length), 0);
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? CHART.series[i % CHART.series.length]! }));

  const { x, y, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
    let lo = all.length ? Math.min(...all) : 0;
    let hi = all.length ? Math.max(...all) : 1;
    const includeZero = zeroBased ?? (lo <= 0 || lo < (hi - lo) * 0.5);
    if (includeZero) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const yScale = scaleLinear().domain([lo, hi]).nice(4).range([height - M.bottom, M.top]);
    const xScale = scaleLinear().domain([0, Math.max(1, n - 1)]).range([M.left, Math.max(M.left + 1, width - M.right)]);
    return { x: xScale, y: yScale, ticks: yScale.ticks(4) };
  }, [series, n, width, height, zeroBased]);

  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - M.left) / 64))));

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(x.invert(px));
    setHover(i >= 0 && i < n ? i : null);
  };

  const hasData = n > 1 && series.some((s) => s.values.some((v) => v !== null));

  return (
    <div ref={ref} className={`${styles.chart} ${className ?? ''}`} role="img" aria-label={aria['aria-label']}>
      {width > 0 && !hasData && (
        <div className={styles.empty} style={{ height }}>
          Not enough history yet
        </div>
      )}
      {width > 0 && hasData && (
        <svg className={styles.svg} width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <defs>
            {colored.map((s, i) => (
              <linearGradient key={s.id} id={`${gid}-${i}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? styles.zeroLine : styles.gridLine} x1={M.left} x2={width - M.right} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} />
              <text className={styles.axisText} x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            // Every `every`-th label, plus the last one unless it would crowd the previous label.
            i % every === 0 || (i === n - 1 && (n - 1) % every >= Math.ceil(every / 2)) ? (
              <text key={`x-${i}`} className={styles.axisText} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
                {l}
              </text>
            ) : null,
          )}
          {colored.map((s, si) => {
            const pts = s.values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null && Number.isFinite(p.v));
            const path = d3line<{ i: number; v: number }>()
              .x((p) => x(p.i))
              .y((p) => y(p.v))
              .curve(curveMonotoneX)(pts);
            const fill =
              s.area !== false && si === 0
                ? d3area<{ i: number; v: number }>()
                    .x((p) => x(p.i))
                    .y0(y(Math.max(y.domain()[0]!, Math.min(0, y.domain()[1]!))))
                    .y1((p) => y(p.v))
                    .curve(curveMonotoneX)(pts)
                : null;
            return (
              <g key={s.id}>
                {fill && <path d={fill} fill={`url(#${gid}-${si})`} />}
                <path d={path ?? ''} className={`${styles.line} ${s.dashed ? styles.dashed : ''}`} stroke={s.color} />
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line className={styles.crosshair} x1={x(hover)} x2={x(hover)} y1={M.top} y2={height - M.bottom} />
              {colored.map((s) => {
                const v = s.values[hover];
                return v !== null && v !== undefined && Number.isFinite(v) ? (
                  <circle key={s.id} className={styles.dot} cx={x(hover)} cy={y(v)} r={4} fill={s.color} />
                ) : null;
              })}
            </g>
          )}
        </svg>
      )}
      {hover !== null && hasData && (
        <div className={styles.tip} style={{ left: Math.min(Math.max(0, x(hover) + 10), Math.max(0, width - 150)), top: M.top }}>
          <div className={styles.tipTitle}>{labels[hover] ?? ''}</div>
          {colored.map((s) => {
            const v = s.values[hover];
            return (
              <div key={s.id} className={styles.tipRow}>
                <span>
                  <span className={styles.swatch} style={{ background: s.color }} />
                  {s.label}
                </span>
                <b>{v === null || v === undefined ? '—' : yFormat(v)}</b>
              </div>
            );
          })}
        </div>
      )}
      {legend && series.length > 1 && (
        <div className={styles.legend}>
          {colored.map((s) => (
            <span key={s.id} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
