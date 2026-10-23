// "Dismiss for 3 months" (UX §6.15): per game, a piece of advice (code +
// params) stays hidden until the month index passed. Kept in local storage —
// a presentation preference, not game state.

import { create } from 'zustand';
import { readJson, writeJson } from '@/util/storage';

export const DISMISS_MONTHS = 3;

type UntilMap = Record<string, number>;

interface DismissState {
  gameId: string | null;
  until: UntilMap;
  load(gameId: string | null): void;
  dismiss(key: string, nowMonthIndex: number): void;
  restoreAll(): void;
}

const storageKey = (gameId: string) => `magnate.advisor.dismissed.${gameId}`;

export const useDismissals = create<DismissState>()((set, get) => ({
  gameId: null,
  until: {},
  load(gameId) {
    if (gameId === get().gameId) return;
    set({ gameId, until: gameId ? readJson<UntilMap>(storageKey(gameId), {}) : {} });
  },
  dismiss(key, nowMonthIndex) {
    const until = { ...get().until, [key]: nowMonthIndex + DISMISS_MONTHS };
    set({ until });
    const id = get().gameId;
    if (id) writeJson(storageKey(id), until);
  },
  restoreAll() {
    set({ until: {} });
    const id = get().gameId;
    if (id) writeJson(storageKey(id), {});
  },
}));

/** Keys still dismissed at `nowMonthIndex`. */
export function activeDismissals(until: UntilMap, nowMonthIndex: number): Set<string> {
  return new Set(Object.entries(until).filter(([, m]) => m > nowMonthIndex).map(([k]) => k));
}
