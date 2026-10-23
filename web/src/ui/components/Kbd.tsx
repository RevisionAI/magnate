// Key caps for shortcuts: <Kbd>B</Kbd>, <KeyChord chord="Mod+S" /> (⌘ S on macOS, Ctrl S elsewhere).

import clsx from 'clsx';
import type { ReactNode } from 'react';
import styles from './Kbd.module.css';

export function Kbd({ children, small = false, className }: { children: ReactNode; small?: boolean; className?: string }) {
  return <kbd className={clsx(styles.keycap, small && styles.keycapSm, className)}>{children}</kbd>;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const KEY_LABELS: Record<string, string> = {
  Mod: isMac ? '⌘' : 'Ctrl',
  Ctrl: 'Ctrl',
  Shift: isMac ? '⇧' : 'Shift',
  Alt: isMac ? '⌥' : 'Alt',
  Space: 'Space',
  Escape: 'Esc',
  Enter: '↵',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Delete: 'Del',
  Period: '.',
  Comma: ',',
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Equal: '+',
  Minus: '−',
  Tab: 'Tab',
  Home: 'Home',
};

/** Human label for one key of a chord. */
export function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** Renders "Mod+Shift+S" as key caps. */
export function KeyChord({ chord, small = false, className }: { chord: string; small?: boolean; className?: string }) {
  const parts = chord.split('+').filter(Boolean);
  return (
    <span className={clsx(styles.chord, className)}>
      {parts.map((p, i) => (
        <Kbd key={`${p}-${i}`} small={small}>
          {keyLabel(p)}
        </Kbd>
      ))}
    </span>
  );
}
