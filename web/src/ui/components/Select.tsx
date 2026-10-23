// Custom select (button + listbox). Keyboard: ↑/↓/Home/End move, Enter/Space
// pick, Esc closes, typing jumps to the first matching label.
//
//   <Select value={city} options={cities.map((c) => ({ value: c.id, label: c.name }))} onChange={setCity} />

import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { audio } from '@/audio';
import { useOutsideClick, useStableId } from '../hooks';
import styles from './Select.module.css';

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string | number> {
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  full?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
  className?: string;
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  size = 'md',
  full = false,
  disabled = false,
  className,
  ...aria
}: SelectProps<T>) {
  const listId = useStableId('listbox');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);
  const typed = useRef({ text: '', at: 0 });
  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const refs = useMemo(() => [triggerRef, listRef], []);

  useOutsideClick(refs, () => setOpen(false), open);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const estimated = Math.min(288, options.length * 36 + 8);
    const above = r.bottom + estimated + 8 > window.innerHeight && r.top - estimated - 8 > 0;
    setRect({ top: above ? r.top - estimated - 4 : r.bottom + 4, left: r.left, width: Math.max(r.width, 160), above });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openList = () => {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : Math.max(0, options.findIndex((o) => !o.disabled)));
    setOpen(true);
    audio.ui('open');
  };

  const pick = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (option.value !== value) {
      audio.ui('toggle');
      onChange(option.value);
    }
  };

  const step = (from: number, dir: 1 | -1) => {
    for (let i = 1; i <= options.length; i++) {
      const next = (from + dir * i + options.length) % options.length;
      if (!options[next]?.disabled) return next;
    }
    return from;
  };

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => step(a, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => step(a, -1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(step(-1, 1));
        break;
      case 'End':
        e.preventDefault();
        setActive(step(options.length, -1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        pick(active);
        break;
      case 'Escape':
      case 'Tab':
        e.stopPropagation();
        if (e.key === 'Escape') e.preventDefault();
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const now = performance.now();
          typed.current.text = now - typed.current.at > 700 ? e.key.toLowerCase() : typed.current.text + e.key.toLowerCase();
          typed.current.at = now;
          const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
          if (hit >= 0) setActive(hit);
        }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={clsx(styles.trigger, size === 'sm' && styles.sm, full && styles.full, className)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={aria['aria-label']}
        data-testid={aria['data-testid']}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
      >
        <span className={clsx(styles.value, !selected && styles.placeholder)}>
          {selected?.icon}
          {selected?.label ?? placeholder}
        </span>
        <span className={styles.chevron}>
          <ChevronDown size={14} />
        </span>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            className={styles.list}
            style={{ top: rect.top, left: rect.left, minWidth: rect.width }}
            onKeyDown={onKey}
          >
            {options.map((o, i) => (
              <div
                key={String(o.value)}
                role="option"
                data-index={i}
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                className={clsx(styles.option, i === active && styles.active)}
                onPointerEnter={() => !o.disabled && setActive(i)}
                onClick={() => pick(i)}
              >
                <span className={styles.check}>{o.value === value && <Check size={13} />}</span>
                {o.icon}
                <span className={styles.optionText}>
                  {o.label}
                  {o.description && <span className={styles.optionDescription}>{o.description}</span>}
                </span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
