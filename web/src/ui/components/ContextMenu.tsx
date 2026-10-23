// Right-click context menu (UX §6.5: Inspect, Set price, Advertise here, Upgrade,
// Demolish, Show supply links). Open it from anywhere with
// `useUiStore.getState().openContextMenu({ x, y, title, items })`; the HUD renders
// <ContextMenuHost />. Keyboard: ↑/↓, Enter, Esc. Clamped to the viewport.

import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { audio } from '@/audio';
import { useUiStore, type ContextMenuEntry, type ContextMenuState } from '@/state/uiStore';
import { KeyChord } from './Kbd';
import styles from './ContextMenu.module.css';

type Item = Extract<ContextMenuEntry, { label: string }>;
const isItem = (e: ContextMenuEntry): e is Item => e.kind !== 'separator';

export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: menu.y, left: menu.x });
  const items = menu.items;
  const selectable = items.map((e, i) => (isItem(e) && !e.disabled ? i : -1)).filter((i) => i >= 0);
  const [active, setActive] = useState(selectable[0] ?? -1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)),
    });
    el.focus({ preventScroll: true });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onBlur = () => onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [onClose]);

  const run = (index: number) => {
    const entry = items[index];
    if (!entry || !isItem(entry) || entry.disabled) return;
    audio.ui('click');
    onClose();
    entry.onSelect?.();
  };

  const move = (dir: 1 | -1) => {
    if (selectable.length === 0) return;
    const pos = selectable.indexOf(active);
    setActive(selectable[(pos + dir + selectable.length) % selectable.length]!);
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      className={styles.menu}
      style={pos}
      data-testid="context-menu"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          run(active);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {(menu.title || menu.subtitle) && (
        <div className={styles.head}>
          {menu.title && <div className={styles.title}>{menu.title}</div>}
          {menu.subtitle && <div className={styles.subtitle}>{menu.subtitle}</div>}
        </div>
      )}
      {items.map((entry, i) => {
        if (!isItem(entry)) return <div key={entry.id} className={styles.separator} role="separator" />;
        const Icon = entry.icon;
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            className={clsx(styles.item, entry.danger && styles.danger, i === active && styles.active)}
            onPointerEnter={() => !entry.disabled && setActive(i)}
            onClick={() => run(i)}
            title={entry.disabled ? entry.hint : undefined}
          >
            <span className={styles.icon}>{Icon && <Icon size={15} strokeWidth={1.8} />}</span>
            <span className={styles.label}>
              {entry.label}
              {entry.hint && <span className={styles.hint}>{entry.hint}</span>}
            </span>
            {entry.shortcut && <KeyChord chord={entry.shortcut} small />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Renders the store's context menu (mount once, in the HUD or the UiKit page). */
export function ContextMenuHost() {
  const menu = useUiStore((s) => s.contextMenu);
  const close = useUiStore((s) => s.closeContextMenu);
  if (!menu) return null;
  return <ContextMenu key={`${menu.x}:${menu.y}`} menu={menu} onClose={close} />;
}
