// In-game keyboard handling (UX §6.20). One window listener dispatches the
// UI-owned actions of keymap.ts. Rules:
//   • letter hotkeys are ignored while a text field has focus;
//   • while an L4 modal is open only Esc (and mute) work — the modal owns the keyboard;
//   • browser shortcuts we use (Ctrl/⌘+S/L/O/M) call preventDefault;
//   • events another component already handled (defaultPrevented) are skipped;
//   • camera keys (WASD, Q/E, arrows, wheel) are left to the city view.

import { useEffect } from 'react';
import { useGameStore } from '@/state/gameStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useTutorialStore } from '@/state/tutorialStore';
import { useUiStore } from '@/state/uiStore';
import { isPanelId } from '@/ui/panels/ids';
import { actionForEvent, isTypingTarget } from './keymap';

export function runKeyAction(actionId: string): boolean {
  const game = useGameStore.getState();
  const ui = useUiStore.getState();
  switch (actionId) {
    case 'time.pause':
      game.togglePause();
      return true;
    case 'time.speed1':
      game.setSpeed(1);
      return true;
    case 'time.speed2':
      game.setSpeed(2);
      return true;
    case 'time.speed4':
      game.setSpeed(3);
      return true;
    case 'time.speed8':
      game.setSpeed(4);
      return true;
    case 'time.step':
      void game.stepMonth();
      return true;
    case 'time.skip':
      void game.skipToNextEvent();
      return true;
    case 'menu.back':
      ui.escape();
      return true;
    case 'game.quicksave':
      void game.quickSave();
      return true;
    case 'game.quickload':
      void game.quickLoad();
      return true;
    case 'game.saveload':
      ui.openModal('saveLoad', { tab: 'save' });
      return true;
    case 'audio.mute': {
      const s = useSettingsStore.getState();
      s.update('audio', { muted: !s.audio.muted });
      return true;
    }
    case 'help.controls':
      ui.openModal('controls');
      return true;
    case 'city.next':
    case 'city.prev': {
      const cities = game.catalog?.cities ?? [];
      if (cities.length === 0) return true;
      const i = Math.max(0, cities.findIndex((c) => c.id === game.activeCityId));
      const next = cities[(i + (actionId === 'city.next' ? 1 : -1) + cities.length) % cities.length];
      if (next) game.setActiveCity(next.id);
      return true;
    }
    default:
      if (actionId.startsWith('panel.')) {
        const id = actionId.slice('panel.'.length);
        if (isPanelId(id)) ui.togglePanel(id);
        return true;
      }
      return false;
  }
}

/** Installs the in-game hotkeys while `enabled` (the HUD is mounted and playing). */
export function useGameHotkeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const action = actionForEvent(e, useSettingsStore.getState().controls.bindings);
      if (!action) return;
      const modalOpen = useUiStore.getState().modals.length > 0;
      if (modalOpen && !action.inModal) return;
      if (isTypingTarget(e.target) && !action.whileTyping) return;
      if (action.id === 'menu.back' && isTypingTarget(e.target)) {
        (e.target as HTMLElement).blur();
        e.preventDefault();
        return;
      }
      // Space on a focused button must not also "click" it.
      if (runKeyAction(action.id)) {
        e.preventDefault();
        useTutorialStore.getState().notifyAction(`key:${action.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
