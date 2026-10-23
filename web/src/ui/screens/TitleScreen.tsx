// Title / main menu (UX §6.2): the skyline backdrop, the logo, Continue (the newest
// save, with its thumbnail), New Game, the tutorial, Load, Settings and Controls.
// ↑/↓ move through the menu; every entry also works with the mouse alone.

import clsx from 'clsx';
import { BookOpen, FolderOpen, GraduationCap, Keyboard, Play, Settings, Sparkles, Volume2 } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useGameStore } from '@/state/gameStore';
import { latestSlot, useSavesStore } from '@/state/savesStore';
import { slotTitle } from '@/state/savegame';
import { useUiStore } from '@/state/uiStore';
import { useInterval } from '@/ui/hooks';
import { audioContextState, uiSound } from '@/ui/sound';
import { moneyFmt, monthYear, timeAgo } from '@/util/format';
import { SkylineBackdrop } from './SkylineBackdrop';
import styles from './Screens.module.css';

interface MenuEntry {
  id: string;
  label: string;
  icon: ReactNode;
  hint?: string;
  primary?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** "Click anywhere for sound" until the audio context runs (audio-plan §4.5). */
function SoundHint() {
  const [state, setState] = useState(audioContextState);
  useInterval(() => setState(audioContextState()), state === 'running' || state === 'unknown' ? null : 800);
  if (state === 'running' || state === 'unknown') return null;
  return (
    <span className={styles.soundHint}>
      <Volume2 size={13} /> Click anywhere for sound
    </span>
  );
}

export function TitleScreen() {
  const goTo = useGameStore((s) => s.goTo);
  const startNewGame = useGameStore((s) => s.startNewGame);
  const loadSlot = useGameStore((s) => s.loadSlot);
  const init = useGameStore((s) => s.init);
  const slots = useSavesStore((s) => s.slots);
  const openModal = useUiStore((s) => s.openModal);
  const latest = useMemo(() => latestSlot(slots), [slots]);
  const menuRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const entries: MenuEntry[] = [
    {
      id: 'new-game',
      label: 'New Game',
      icon: <Sparkles size={18} />,
      hint: 'Scenarios & sandbox',
      primary: !latest,
      onSelect: () => goTo('scenarioSelect'),
    },
    {
      id: 'play-tutorial',
      label: 'Play the Tutorial',
      icon: <GraduationCap size={18} />,
      hint: 'Your first company',
      onSelect: () => {
        setBusy(true);
        void startNewGame('tutorial').finally(() => setBusy(false));
      },
    },
    {
      id: 'load-game',
      label: 'Load Game',
      icon: <FolderOpen size={18} />,
      hint: slots.length ? `${slots.length} save${slots.length === 1 ? '' : 's'}` : 'No saves yet',
      onSelect: () => openModal('saveLoad', { tab: 'load' }),
    },
    { id: 'open-settings', label: 'Settings', icon: <Settings size={18} />, onSelect: () => openModal('settings') },
    { id: 'open-controls', label: 'Controls', icon: <Keyboard size={18} />, onSelect: () => openModal('controls') },
    { id: 'encyclopedia', label: 'Encyclopedia', icon: <BookOpen size={18} />, hint: 'Soon', disabled: true, onSelect: () => {} },
  ];

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
    uiSound('hover');
  };

  return (
    <div className={`${styles.screen} ${styles.title}`} data-testid="title-screen">
      <SkylineBackdrop />
      <div className={styles.titleScrim} />
      <div className={styles.titleColumn}>
        <h1 className={`${styles.logo} ${styles.logoShine} ${styles.titleLogo}`} data-text="Magnate">
          Magnate
        </h1>
        <p className={styles.tagline}>Build brands, factories, stores — and market power.</p>
        <div className={styles.rule} />

        {latest && (
          <button
            type="button"
            className={styles.continue}
            disabled={busy}
            onClick={() => {
              uiSound('confirm');
              setBusy(true);
              void loadSlot(latest.slotId).finally(() => setBusy(false));
            }}
            data-testid="continue-game"
          >
            <span className={styles.continueThumb}>{latest.thumbnail && <img src={latest.thumbnail} alt="" />}</span>
            <span>
              <span className={styles.continueKicker}>Continue</span>
              <span className={styles.continueTitle}>{slotTitle(latest)}</span>
              <span className={styles.continueMeta}>
                {monthYear(latest.date)} · value {moneyFmt(latest.corporateValue)} · saved {timeAgo(latest.updatedAt)}
              </span>
            </span>
            <span className={styles.continuePlay}>
              <Play size={16} fill="currentColor" />
            </span>
          </button>
        )}

        <div className={styles.menu} ref={menuRef} onKeyDown={onMenuKey} role="menu" aria-label="Main menu">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className={clsx(styles.menuItem, entry.primary && styles.primaryItem)}
              disabled={entry.disabled || busy}
              data-testid={entry.id}
              onPointerEnter={() => !entry.disabled && uiSound('hover')}
              onClick={() => {
                uiSound('click');
                entry.onSelect();
              }}
            >
              <span className={styles.menuIcon}>{entry.icon}</span>
              <span className={styles.menuLabel}>{entry.label}</span>
              {entry.hint && <span className={styles.menuHint}>{entry.hint}</span>}
            </button>
          ))}
        </div>
      </div>
      <footer className={styles.titleFooter}>
        <span>
          Magnate {init ? `· engine ${init.engineVersion} · protocol ${init.protocolVersion}` : ''}
        </span>
        <SoundHint />
      </footer>
    </div>
  );
}
