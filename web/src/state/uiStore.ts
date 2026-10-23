// UI slice: which overlay (L3) and drawer stack (L2) are open, the modal stack
// (L4), the context menu, build mode and the advisor's speech queue. Pure UI
// state — nothing here talks to the engine.
//
//   useUiStore.getState().openPanel('reports', { tab: 'cashflow' });
//   const ok = await useUiStore.getState().confirm({ title: 'Quit to title?', tone: 'danger' });

import { create } from 'zustand';
import type { ComponentType } from 'react';
import { bus } from '@/game/events';
import { PANEL_META, type PanelId, type PanelParams } from '@/ui/panels/ids';
import { useTutorialStore } from './tutorialStore';

export type ModalId = 'pause' | 'settings' | 'saveLoad' | 'outcome' | 'controls' | 'confirm' | 'briefing';

export type ConfirmResult = 'confirm' | 'cancel' | 'alt';

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional third choice, e.g. "Save & quit". */
  altLabel?: string;
  tone?: 'default' | 'danger';
}

export interface ModalEntry {
  key: number;
  id: ModalId;
  props: Record<string, unknown>;
  confirm?: ConfirmOptions & { resolve: (result: ConfirmResult) => void };
  /** Esc closes it (false for the outcome debrief, which needs an explicit choice). */
  dismissible: boolean;
}

export interface PanelRef {
  id: PanelId;
  params: PanelParams;
  /** Bumps on every (re)open so hosts can replay entrance animations. */
  key: number;
}

export type ContextMenuEntry =
  | {
      kind?: 'item';
      id: string;
      label: string;
      icon?: ComponentType<{ size?: number | string; strokeWidth?: number | string }>;
      shortcut?: string;
      hint?: string;
      disabled?: boolean;
      danger?: boolean;
      onSelect?: () => void;
    }
  | { kind: 'separator'; id: string };

export interface ContextMenuState {
  x: number;
  y: number;
  title?: string;
  subtitle?: string;
  items: ContextMenuEntry[];
}

export type AdvisorTone = 'neutral' | 'success' | 'warning' | 'critical';

export interface AdvisorAction {
  label: string;
  panel?: PanelId;
  params?: PanelParams;
  run?: () => void;
}

export interface AdvisorMessage {
  id: number;
  title?: string;
  text: string;
  tone: AdvisorTone;
  source: 'tutorial' | 'event' | 'tip' | 'system';
  actions?: AdvisorAction[];
  createdAt: number;
}

interface UiState {
  overlay: PanelRef | null;
  drawers: PanelRef[];
  modals: ModalEntry[];
  contextMenu: ContextMenuState | null;
  /** Placement state (Wave 2 build flow); here so Esc can cancel it first. */
  buildMode: { typeId: string | null } | null;
  advisor: { current: AdvisorMessage | null; queue: AdvisorMessage[]; history: AdvisorMessage[] };
  /** Small badges on rail buttons, e.g. markets: '!' when a rival enters a served market. */
  railBadges: Partial<Record<PanelId, string>>;

  openPanel(id: PanelId, params?: PanelParams): void;
  togglePanel(id: PanelId, params?: PanelParams): void;
  closePanel(id: PanelId): void;
  closeOverlay(): void;
  closeDrawer(): void;
  backDrawer(): void;
  openModal(id: Exclude<ModalId, 'confirm'>, props?: Record<string, unknown>): void;
  closeModal(id?: ModalId): void;
  confirm(options: ConfirmOptions): Promise<ConfirmResult>;
  resolveConfirm(key: number, result: ConfirmResult): void;
  openContextMenu(menu: ContextMenuState): void;
  closeContextMenu(): void;
  setBuildMode(mode: { typeId: string | null } | null): void;
  say(message: Omit<AdvisorMessage, 'id' | 'createdAt'>): void;
  dismissAdvisor(): void;
  setRailBadge(id: PanelId, badge: string | null): void;
  /** Esc chain (UX §6.20). Returns what it did. */
  escape(): 'contextMenu' | 'modal' | 'buildMode' | 'drawer' | 'overlay' | 'pause' | 'none';
  /** Clears all presentation state (new game, load, quit to title). */
  reset(): void;
}

let panelKey = 1;
let modalKey = 1;
let adviceId = 1;
const ADVISOR_HISTORY = 50;
const ADVISOR_QUEUE = 6;

function emitPanels(state: Pick<UiState, 'overlay' | 'drawers'>): void {
  bus.emit('panelChanged', {
    overlay: state.overlay?.id ?? null,
    drawer: state.drawers[state.drawers.length - 1]?.id ?? null,
  });
}

export const useUiStore = create<UiState>()((set, get) => ({
  overlay: null,
  drawers: [],
  modals: [],
  contextMenu: null,
  buildMode: null,
  advisor: { current: null, queue: [], history: [] },
  railBadges: {},

  openPanel(id, params = {}) {
    const meta = PANEL_META[id];
    const ref: PanelRef = { id, params, key: panelKey++ };
    if (meta.host === 'overlay') {
      set({ overlay: ref, contextMenu: null });
    } else {
      // One drawer at a time with a back stack; re-opening an id moves it to the top.
      set((s) => ({ drawers: [...s.drawers.filter((d) => d.id !== id), ref].slice(-6), contextMenu: null }));
    }
    if (get().railBadges[id]) get().setRailBadge(id, null);
    useTutorialStore.getState().notifyAction(`panel:${id}`);
    emitPanels(get());
  },

  togglePanel(id, params) {
    const s = get();
    const isOpen = PANEL_META[id].host === 'overlay' ? s.overlay?.id === id : s.drawers[s.drawers.length - 1]?.id === id;
    if (isOpen) s.closePanel(id);
    else s.openPanel(id, params);
  },

  closePanel(id) {
    if (PANEL_META[id].host === 'overlay') {
      if (get().overlay?.id === id) set({ overlay: null });
    } else {
      set((s) => ({ drawers: s.drawers.filter((d) => d.id !== id) }));
    }
    emitPanels(get());
  },

  closeOverlay() {
    if (!get().overlay) return;
    set({ overlay: null });
    emitPanels(get());
  },

  closeDrawer() {
    if (get().drawers.length === 0) return;
    set({ drawers: [] });
    emitPanels(get());
  },

  backDrawer() {
    if (get().drawers.length === 0) return;
    set((s) => ({ drawers: s.drawers.slice(0, -1) }));
    emitPanels(get());
  },

  openModal(id, props = {}) {
    set((s) => ({
      modals: [...s.modals.filter((m) => m.id !== id), { key: modalKey++, id, props, dismissible: id !== 'outcome' }],
      contextMenu: null,
    }));
  },

  closeModal(id) {
    set((s) => {
      if (s.modals.length === 0) return s;
      if (!id) return { modals: s.modals.slice(0, -1) };
      return { modals: s.modals.filter((m) => m.id !== id) };
    });
  },

  confirm(options) {
    return new Promise<ConfirmResult>((resolve) => {
      const key = modalKey++;
      set((s) => ({
        modals: [...s.modals, { key, id: 'confirm', props: {}, dismissible: true, confirm: { ...options, resolve } }],
        contextMenu: null,
      }));
    });
  },

  resolveConfirm(key, result) {
    const entry = get().modals.find((m) => m.key === key);
    set((s) => ({ modals: s.modals.filter((m) => m.key !== key) }));
    entry?.confirm?.resolve(result);
  },

  openContextMenu(menu) {
    set({ contextMenu: menu });
  },

  closeContextMenu() {
    if (get().contextMenu) set({ contextMenu: null });
  },

  setBuildMode(mode) {
    set({ buildMode: mode });
  },

  say(message) {
    const msg: AdvisorMessage = { ...message, id: adviceId++, createdAt: Date.now() };
    set((s) => {
      const history = [...s.advisor.history, msg].slice(-ADVISOR_HISTORY);
      if (!s.advisor.current) return { advisor: { current: msg, queue: s.advisor.queue, history } };
      // Critical messages jump the queue; the queue is bounded (oldest tips drop first).
      const queue = msg.tone === 'critical' ? [msg, ...s.advisor.queue] : [...s.advisor.queue, msg];
      return { advisor: { current: s.advisor.current, queue: queue.slice(0, ADVISOR_QUEUE), history } };
    });
  },

  dismissAdvisor() {
    set((s) => {
      const [next, ...rest] = s.advisor.queue;
      return { advisor: { current: next ?? null, queue: rest, history: s.advisor.history } };
    });
  },

  setRailBadge(id, badge) {
    set((s) => {
      const railBadges = { ...s.railBadges };
      if (badge) railBadges[id] = badge;
      else delete railBadges[id];
      return { railBadges };
    });
  },

  escape() {
    const s = get();
    if (s.contextMenu) {
      s.closeContextMenu();
      return 'contextMenu';
    }
    const top = s.modals[s.modals.length - 1];
    if (top) {
      if (!top.dismissible) return 'none';
      if (top.confirm) s.resolveConfirm(top.key, 'cancel');
      else s.closeModal(top.id);
      return 'modal';
    }
    if (s.buildMode) {
      s.setBuildMode(null);
      return 'buildMode';
    }
    if (s.drawers.length > 0) {
      s.backDrawer();
      return 'drawer';
    }
    if (s.overlay) {
      s.closeOverlay();
      return 'overlay';
    }
    s.openModal('pause');
    return 'pause';
  },

  reset() {
    // Pending confirms resolve as cancelled so no caller hangs.
    for (const m of get().modals) m.confirm?.resolve('cancel');
    set({
      overlay: null,
      drawers: [],
      modals: [],
      contextMenu: null,
      buildMode: null,
      advisor: { current: null, queue: [], history: [] },
      railBadges: {},
    });
    emitPanels(get());
  },
}));

/** The drawer currently showing (top of the back stack). */
export function topDrawer(state: Pick<UiState, 'drawers'>): PanelRef | null {
  return state.drawers[state.drawers.length - 1] ?? null;
}

/** True when an L4 modal is open (time is held). */
export function hasModal(state: Pick<UiState, 'modals'>): boolean {
  return state.modals.length > 0;
}
