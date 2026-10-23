// QA / e2e handle: `window.__magnate` exposes the UI stores and the event bus so
// the smoke tour (scripts/smoke.mjs --tour), the browser console and future
// automated playtests can drive states that are slow to reach by play (an
// outcome debrief, a full toast stack, a tutorial coach mark). Game code never
// reads it; it is the same objects the UI already uses, so it adds no new state.

import { bus } from '@/game/events';
import { fx } from '@/game/fx';
import { useAlertsStore } from '@/state/alertsStore';
import { useGameStore } from '@/state/gameStore';
import { useSettingsStore } from '@/state/settingsStore';
import { useTutorialStore } from '@/state/tutorialStore';
import { useUiStore } from '@/state/uiStore';

export interface MagnateQaHandle {
  game: typeof useGameStore;
  ui: typeof useUiStore;
  alerts: typeof useAlertsStore;
  settings: typeof useSettingsStore;
  tutorial: typeof useTutorialStore;
  bus: typeof bus;
  fx: typeof fx;
}

declare global {
  interface Window {
    __magnate?: MagnateQaHandle;
  }
}

export function installQaHandle(): void {
  if (typeof window === 'undefined') return;
  window.__magnate = { game: useGameStore, ui: useUiStore, alerts: useAlertsStore, settings: useSettingsStore, tutorial: useTutorialStore, bus, fx };
}
