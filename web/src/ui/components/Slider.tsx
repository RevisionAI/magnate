// Slider with labelled marks and coloured bands — built for the price slider of
// UX §6.7.3 (unit cost, world price, rival min, ◆ suggested, bracket ceilings;
// red below cost, green suggested band, amber above a ceiling), and reused for
// volumes, UI scale and every other range in Settings.
//
//   <Slider value={p} min={0.76} max={24} step={0.01} scale="log" format={price}
//     marks={[{ value: 1.52, label: 'Unit cost', tone: 'danger' }, { value: 2.4, label: 'Suggested', tone: 'gold', shape: 'diamond' }]}
//     bands={[{ from: 0.76, to: 1.52, tone: 'danger', label: 'Below cost' }]}
//     onChange={setP} onCommit={apply} aria-label="Price" />

import clsx from 'clsx';
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { audio } from '@/audio';
import { useElementSize } from '../hooks';
import styles from './Slider.module.css';

export type SliderTone = 'danger' | 'warning' | 'success' | 'info' | 'gold' | 'neutral';

export interface SliderMark {
  value: number;
  label?: string;
  /** Secondary text after the label, e.g. the value. */
  detail?: string;
  tone?: SliderTone;
  shape?: 'tick' | 'diamond';
}

export interface SliderBand {
  from: number;
  to: number;
  tone: SliderTone;
  label?: string;
}

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Fired on release / keyboard change (apply-on-commit flows). */
  onCommit?: (value: number) => void;
  format?: (value: number) => string;
  marks?: readonly SliderMark[];
  bands?: readonly SliderBand[];
  scale?: 'linear' | 'log';
  disabled?: boolean;
  /** Show min/max under the track. */
  showScale?: boolean;
  /** Show the value bubble while focused/dragging (default true). */
  bubble?: boolean;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

const LABEL_CHAR_PX = 5.6;
const MAX_ROWS = 2;

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  format = (v) => String(v),
  marks = [],
  bands = [],
  scale = 'linear',
  disabled = false,
  showScale = false,
  bubble = true,
  className,
  ...aria
}: SliderProps) {
  const [trackRef, { width }] = useElementSize<HTMLDivElement>();
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const latest = useRef(value);
  latest.current = value;

  const log = scale === 'log' && min > 0;
  const toPos = (v: number) => {
    const c = Math.min(max, Math.max(min, v));
    if (log) return (Math.log(c) - Math.log(min)) / (Math.log(max) - Math.log(min));
    return max === min ? 0 : (c - min) / (max - min);
  };
  const fromPos = (p: number) => {
    const t = Math.min(1, Math.max(0, p));
    const raw = log ? Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min))) : min + t * (max - min);
    return snap(raw);
  };
  const snap = (v: number) => {
    const snapped = Math.round((v - min) / step) * step + min;
    const decimals = (String(step).split('.')[1] ?? '').length;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(decimals))));
  };

  const layout = useMemo(() => {
    if (width <= 0) return { labels: [] as { mark: SliderMark; x: number; row: number }[], rows: marks.some((m) => m.label) ? 1 : 0 };
    const placed: { mark: SliderMark; x: number; row: number }[] = [];
    const rowEnd = Array.from({ length: MAX_ROWS }, () => -Infinity);
    const sorted = [...marks].filter((m) => m.label).sort((a, b) => toPos(a.value) - toPos(b.value));
    for (const mark of sorted) {
      const x = toPos(mark.value) * width;
      const text = `${mark.label}${mark.detail ? ` ${mark.detail}` : ''}`;
      const w = text.length * LABEL_CHAR_PX + 10;
      const left = Math.max(0, Math.min(width - w, x - w / 2));
      const row = rowEnd.findIndex((end) => left >= end + 4);
      if (row === -1) continue; // no room: the tick still shows, with a native title
      rowEnd[row] = left + w;
      placed.push({ mark, x: left + w / 2, row });
    }
    return { labels: placed, rows: Math.max(placed.length ? 1 : 0, ...placed.map((p) => p.row + 1)) };
    // toPos depends on min/max/scale only
  }, [marks, width, min, max, scale]);

  const setFromClient = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = fromPos((clientX - rect.left) / rect.width);
    if (next !== latest.current) onChange(next);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    setFromClient(e.clientX);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging) setFromClient(e.clientX);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDragging(false);
    audio.ui('toggle');
    onCommit?.(latest.current);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next: number | null = null;
    const big = Math.max(step, (max - min) / 10);
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = snap(value + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = snap(value - step);
        break;
      case 'PageUp':
        next = snap(value + big);
        break;
      case 'PageDown':
        next = snap(value - big);
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (next !== value) {
      onChange(next);
      onCommit?.(next);
    }
  };

  const pct = (v: number) => `${toPos(v) * 100}%`;
  const hasLabels = marks.some((m) => m.label);
  const rows = Math.max(1, layout.rows);

  return (
    <div
      className={clsx(styles.root, !hasLabels && styles.noMarks, disabled && styles.disabled, dragging && styles.dragging, bands.length > 0 && styles.withBands, className)}
      style={{ ['--rows' as string]: rows }}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      aria-disabled={disabled || undefined}
      aria-label={aria['aria-label']}
      data-testid={aria['data-testid']}
      onKeyDown={onKey}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {bands.map((b, i) => (
          <div
            key={`band-${i}`}
            className={clsx(styles.band, styles[`band-${b.tone}`])}
            style={{ left: pct(Math.min(b.from, b.to)), width: `calc(${pct(Math.max(b.from, b.to))} - ${pct(Math.min(b.from, b.to))})` }}
            title={b.label}
          />
        ))}
        <div className={styles.fill} style={{ width: pct(value) }} />
        {marks.map((m, i) => (
          <div
            key={`mark-${i}`}
            className={clsx(m.shape === 'diamond' ? styles.markDiamond : styles.mark, styles[`tone-${m.tone ?? 'neutral'}`])}
            style={{ left: pct(m.value) }}
            title={m.label ? `${m.label}: ${format(m.value)}` : format(m.value)}
          />
        ))}
        {layout.labels.map(({ mark, x, row }, i) => (
          <div
            key={`label-${i}`}
            className={clsx(styles.markLabel, styles[`tone-${mark.tone ?? 'neutral'}`])}
            style={{ left: x, bottom: `calc(100% + 0.6rem + ${row}rem)` }}
          >
            {mark.label}
            {mark.detail && <span> {mark.detail}</span>}
          </div>
        ))}
        <div className={styles.thumb} style={{ left: pct(value) }}>
          {bubble && (dragging || focused) && <div className={styles.bubble}>{format(value)}</div>}
        </div>
      </div>
      {showScale && (
        <div className={styles.scaleRow}>
          <span>{format(min)}</span>
          <span>{format(max)}</span>
        </div>
      )}
    </div>
  );
}
