// Tiny inline trend (HUD month-profit, KPI tiles, table cells). SVG, d3-shape.
//
//   <Sparkline values={niLast12} variant="bars" width={84} height={22} />   // ± bars in profit/loss colours
//   <Sparkline values={cash} tone="gold" area />

import { scaleLinear } from 'd3-scale';
import { area as d3area, curveMonotoneX, line as d3line } from 'd3-shape';
import { useStableId } from '../../hooks';
import styles from './charts.module.css';

export interface SparklineProps {
  values: readonly (number | null)[];
  width?: number;
  height?: number;
  variant?: 'line' | 'bars';
  /** Line colour: a token name or any CSS colour. */
  tone?: 'gold' | 'info' | 'pos' | 'neg' | string;
  area?: boolean;
  /** Mark the last point. */
  dot?: boolean;
  /** Bars: reserve at least this many slots, right-aligned, so a short history draws thin bars that fill in over time. */
  minSlots?: number;
  className?: string;
  'aria-label'?: string;
}

const TONES: Record<string, string> = {
  gold: 'var(--c-gold)',
  info: 'var(--c-blue)',
  pos: 'var(--c-pos)',
  neg: 'var(--c-neg)',
};

export function Sparkline({ values, width = 96, height = 24, variant = 'line', tone = 'gold', area = true, dot = true, minSlots = 0, className, ...aria }: SparklineProps) {
  const gid = useStableId('spark');
  const color = TONES[tone] ?? tone;
  const points = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null && Number.isFinite(p.v));
  const label = aria['aria-label'];

  if (points.length < 2) {
    return (
      <svg className={className} width={width} height={height} role="img" aria-label={label}>
        <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="rgba(160,196,218,0.2)" strokeDasharray="2 3" />
      </svg>
    );
  }

  const n = Math.max(values.length, 2);
  const lo = Math.min(...points.map((p) => p.v));
  const hi = Math.max(...points.map((p) => p.v));

  if (variant === 'bars') {
    const domainLo = Math.min(0, lo);
    const domainHi = Math.max(0, hi);
    const y = scaleLinear().domain([domainLo, domainHi === domainLo ? domainLo + 1 : domainHi]).range([height - 1, 1]);
    const slots = Math.max(values.length, minSlots);
    const slot = width / slots;
    const offset = (slots - values.length) * slot;
    const bw = Math.max(1.5, slot - 2);
    const zero = y(0);
    return (
      <svg className={className} width={width} height={height} role="img" aria-label={label}>
        <line x1={0} x2={width} y1={zero} y2={zero} stroke="rgba(181,196,205,0.28)" />
        {points.map((p) => {
          const top = Math.min(y(p.v), zero);
          const h = Math.max(1, Math.abs(y(p.v) - zero));
          const last = p.i === values.length - 1;
          return (
            <rect
              key={p.i}
              x={offset + p.i * slot + (slot - bw) / 2}
              y={top}
              width={bw}
              height={h}
              rx={1}
              fill={p.v >= 0 ? 'var(--c-pos)' : 'var(--c-neg)'}
              opacity={last ? 1 : 0.62}
            />
          );
        })}
      </svg>
    );
  }

  const pad = 2.5;
  const x = scaleLinear().domain([0, n - 1]).range([pad, width - pad]);
  const y = scaleLinear().domain(lo === hi ? [lo - 1, hi + 1] : [lo, hi]).range([height - pad, pad]);
  const path = d3line<{ i: number; v: number }>()
    .x((p) => x(p.i))
    .y((p) => y(p.v))
    .curve(curveMonotoneX)(points);
  const fill = area
    ? d3area<{ i: number; v: number }>()
        .x((p) => x(p.i))
        .y0(height)
        .y1((p) => y(p.v))
        .curve(curveMonotoneX)(points)
    : null;
  const last = points[points.length - 1]!;
  return (
    <svg className={className} width={width} height={height} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.32} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={fill} fill={`url(#${gid})`} />}
      <path d={path ?? ''} className={styles.line} stroke={color} strokeWidth={1.6} />
      {dot && <circle cx={x(last.i)} cy={y(last.v)} r={2.4} fill={color} />}
    </svg>
  );
}
