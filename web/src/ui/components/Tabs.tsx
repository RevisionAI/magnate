// Accessible tabs (roving tabindex, arrow keys, Home/End).
//
//   <Tabs items={[{ id: 'pnl', label: 'P&L' }, …]} value={tab} onChange={setTab} />

import clsx from 'clsx';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { audio } from '@/audio';
import styles from './Tabs.module.css';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  /** Tooltip text (native title). */
  hint?: string;
}

export interface TabsProps<T extends string = string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  variant?: 'underline' | 'pills' | 'vertical';
  size?: 'sm' | 'md';
  className?: string;
  /** aria-label for the tab list. */
  label?: string;
  /** Prefix for tab/panel ids (aria-controls). */
  idPrefix?: string;
}

export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  variant = 'underline',
  size = 'md',
  className,
  label,
  idPrefix,
}: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = items.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);

  const move = (from: number, delta: number) => {
    if (enabled.length === 0) return;
    const pos = enabled.indexOf(from);
    const next = enabled[(pos + delta + enabled.length) % enabled.length]!;
    refs.current[next]?.focus();
    const item = items[next];
    if (item) {
      audio.ui('toggle');
      onChange(item.id);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const horizontal = variant !== 'vertical';
    const prevKey = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const nextKey = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (e.key === prevKey) {
      e.preventDefault();
      move(index, -1);
    } else if (e.key === nextKey) {
      e.preventDefault();
      move(index, 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(enabled[0] ?? 0, 0);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(enabled[enabled.length - 1] ?? 0, 0);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation={variant === 'vertical' ? 'vertical' : 'horizontal'}
      className={clsx(styles.tabs, styles[variant], size === 'sm' && styles.sm, className)}
    >
      {items.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${t.id}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${t.id}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            title={t.hint}
            className={styles.tab}
            data-testid={`tab-${t.id}`}
            onClick={() => {
              if (!selected) {
                audio.ui('toggle');
                onChange(t.id);
              }
            }}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.icon && <span className={styles.icon}>{t.icon}</span>}
            {t.label}
            {t.badge !== undefined && t.badge !== null && <span className={styles.badge}>{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
