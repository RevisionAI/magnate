// Small controls: Badge, Toggle, Segmented, Field (settings row), TextInput,
// EmptyState, Skeleton.

import clsx from 'clsx';
import { forwardRef, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { audio } from '@/audio';
import styles from './Controls.module.css';

export type Tone = 'neutral' | 'gold' | 'info' | 'success' | 'warning' | 'danger' | 'opportunity';

// ------------------------------------------------------------------ Badge

export interface BadgeProps {
  tone?: Tone;
  variant?: 'soft' | 'solid';
  dot?: boolean;
  /** Numeric badge (compact pill). */
  count?: number;
  square?: boolean;
  children?: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ tone = 'neutral', variant = 'soft', dot = false, count, square = false, children, className, title }: BadgeProps) {
  const isCount = count !== undefined;
  return (
    <span
      className={clsx(styles.badge, styles[`tone-${tone}`], variant === 'solid' && styles.solid, isCount && styles.badgeCount, square && styles.badgeSquare, className)}
      title={title}
    >
      {dot && <span className={styles.dot} />}
      {isCount ? (count > 99 ? '99+' : count) : children}
    </span>
  );
}

// ------------------------------------------------------------------ Toggle

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  id?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function Toggle({ checked, onChange, label, disabled = false, size = 'md', id, ...aria }: ToggleProps) {
  const flip = () => {
    if (disabled) return;
    audio.ui('toggle');
    onChange(!checked);
  };
  return (
    <span className={clsx(styles.toggle, size === 'sm' && styles.toggleSm)} aria-disabled={disabled}>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-label={aria['aria-label'] ?? (typeof label === 'string' ? label : undefined)}
        data-testid={aria['data-testid']}
        disabled={disabled}
        className={styles.switch}
        onClick={flip}
      />
      {label && (
        <span className={styles.toggleLabel} onClick={flip}>
          {label}
        </span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ Segmented

export interface SegmentOption<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
  testId?: string;
}

export interface SegmentedProps<T extends string | number> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  full?: boolean;
  label?: string;
  className?: string;
}

export function Segmented<T extends string | number>({ options, value, onChange, size = 'md', full = false, label, className }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    for (let step = 1; step <= options.length; step++) {
      const i = (index + dir * step + options.length) % options.length;
      const option = options[i];
      if (option && !option.disabled) {
        refs.current[i]?.focus();
        audio.ui('toggle');
        onChange(option.value);
        return;
      }
    }
  };
  return (
    <div role="radiogroup" aria-label={label} className={clsx(styles.segmented, size === 'sm' && styles.segmentedSm, full && styles.segmentedFull, className)}>
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            title={o.title}
            data-testid={o.testId}
            className={styles.segment}
            onClick={() => {
              if (checked) return;
              audio.ui('toggle');
              onChange(o.value);
            }}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Field

export interface FieldProps {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Control under the label instead of beside it. */
  stacked?: boolean;
  htmlFor?: string;
  className?: string;
}

/** A settings/form row: label + description on the left, control on the right. */
export function Field({ label, description, children, stacked = false, htmlFor, className }: FieldProps) {
  return (
    <div className={clsx(styles.field, stacked && styles.fieldStacked, className)}>
      <div>
        <label className={styles.fieldLabel} htmlFor={htmlFor}>
          {label}
        </label>
        {description && <div className={styles.fieldDescription}>{description}</div>}
      </div>
      <div className={styles.fieldControl}>{children}</div>
    </div>
  );
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md';
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({ size = 'md', className, ...rest }, ref) {
  return <input ref={ref} className={clsx(styles.input, size === 'sm' && styles.inputSm, className)} spellCheck={false} {...rest} />;
});

// ------------------------------------------------------------------ EmptyState

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, body, action, compact = false, className }: EmptyStateProps) {
  return (
    <div className={clsx(styles.empty, compact && styles.emptyCompact, className)}>
      {icon && <div className={styles.emptyIcon}>{icon}</div>}
      <div className={styles.emptyTitle}>{title}</div>
      {body && <div className={styles.emptyBody}>{body}</div>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Skeleton

export function Skeleton({ width = '100%', height = 12, radius, className }: { width?: number | string; height?: number | string; radius?: number; className?: string }) {
  return <span className={clsx(styles.skeleton, className)} style={{ width, height, borderRadius: radius }} aria-hidden />;
}
