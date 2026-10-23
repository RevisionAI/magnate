// Pause menu (UX §6.2, L4; Esc when nothing else is open): Resume, Save, Load,
// Settings, Controls, Encyclopedia, Quit to title. Quitting never discards a
// game silently: with unsaved progress it asks "Save before quitting?".

import { BookOpen, DoorOpen, FolderOpen, Keyboard, Play, Save, Settings } from 'lucide-react';
import { useGameStore } from '@/state/gameStore';
import { slotIds } from '@/state/savegame';
import { useSettingsStore } from '@/state/settingsStore';
import { useUiStore } from '@/state/uiStore';
import { Button, Modal } from '@/ui/components';
import { monthYear, playTime } from '@/util/format';
import styles from './Modals.module.css';

/** Asks before leaving with unsaved progress; resolves true when it is OK to leave. */
export async function confirmLeaveGame(action: 'quit' | 'load' | 'new'): Promise<boolean> {
  const game = useGameStore.getState();
  if (!game.hud || !game.hasUnsavedProgress() || !useSettingsStore.getState().gameplay.confirmQuit) return true;
  const months = game.lastSave ? game.hud.monthIndex - game.lastSave.monthIndex : null;
  const body =
    months === null
      ? 'This game has never been saved.'
      : months <= 0
        ? 'You changed things since your last save.'
        : `Your last save was ${months} month${months === 1 ? '' : 's'} ago.`;
  const verb = action === 'quit' ? 'quitting' : action === 'load' ? 'loading' : 'starting a new game';
  const answer = await useUiStore.getState().confirm({
    title: `Save before ${verb}?`,
    body,
    confirmLabel: 'Save first',
    altLabel: action === 'quit' ? 'Quit without saving' : 'Don’t save',
    cancelLabel: 'Cancel',
  });
  if (answer === 'cancel') return false;
  if (answer === 'confirm' && game.gameId) {
    const meta = await useGameStore.getState().saveToSlot(slotIds.quick(game.gameId), { slotKind: 'quicksave' });
    return meta !== null;
  }
  return true;
}

export function PauseMenu({ onClose }: { onClose: () => void }) {
  const hud = useGameStore((s) => s.hud);
  const playSeconds = useGameStore((s) => s.playTimeSec);
  const lastSave = useGameStore((s) => s.lastSave);
  const openModal = useUiStore((s) => s.openModal);
  const quitToTitle = useGameStore((s) => s.quitToTitle);

  const quit = async () => {
    if (await confirmLeaveGame('quit')) quitToTitle();
  };

  const monthsSinceSave = lastSave && hud ? hud.monthIndex - lastSave.monthIndex : null;

  return (
    <Modal open title="Paused" icon={<Play size={18} />} onClose={onClose} size="sm" data-testid="pause-menu">
      <div className={styles.pauseMeta}>
        {hud?.player && <b>{hud.player.name}</b>}
        {hud && <span>{monthYear(hud.date)}</span>}
        <span>Played {playTime(playSeconds)}</span>
        <span>{monthsSinceSave === null ? 'Not saved yet' : monthsSinceSave <= 0 ? 'Saved this month' : `Saved ${monthsSinceSave} mo ago`}</span>
      </div>
      <div className={styles.pause}>
        <Button variant="primary" size="lg" full className={styles.menuButton} icon={<Play size={16} fill="currentColor" />} kbd="Escape" onClick={onClose} data-autofocus data-testid="pause-resume">
          Resume
        </Button>
        <Button size="lg" full className={styles.menuButton} icon={<Save size={16} />} kbd="Mod+S" onClick={() => openModal('saveLoad', { tab: 'save' })} data-testid="pause-save">
          Save game
        </Button>
        <Button size="lg" full className={styles.menuButton} icon={<FolderOpen size={16} />} kbd="Mod+O" onClick={() => openModal('saveLoad', { tab: 'load' })} data-testid="pause-load">
          Load game
        </Button>
        <Button size="lg" full className={styles.menuButton} icon={<Settings size={16} />} onClick={() => openModal('settings')} data-testid="pause-settings">
          Settings
        </Button>
        <Button size="lg" full className={styles.menuButton} icon={<Keyboard size={16} />} kbd="Shift+Slash" onClick={() => openModal('controls')}>
          Controls
        </Button>
        <Button size="lg" full className={styles.menuButton} icon={<BookOpen size={16} />} disabled title="The encyclopedia arrives with the tutorial chapters.">
          Encyclopedia
        </Button>
        <div className={styles.menuDivider} />
        <Button variant="danger" size="lg" full className={styles.menuButton} icon={<DoorOpen size={16} />} onClick={() => void quit()} data-testid="pause-quit">
          Quit to title
        </Button>
      </div>
    </Modal>
  );
}
