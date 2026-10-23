// Alerts state: the persisted history (Alerts drawer, bell count) and the toast
// stack (≤ 3 visible, the rest queued). Policy decisions live in ./alerts.ts.

import { create } from 'zustand';
import {
  AlertPolicy,
  MAX_VISIBLE_TOASTS,
  SEVERITY_RANK,
  type Alert,
  type AlertAction,
  type AlertSeverity,
  type IngestContext,
} from './alerts';
import type { UiEvent } from './gameEvents';

const HISTORY_CAP = 200;

interface AlertsState {
  history: Alert[];
  toasts: Alert[];
  queue: Alert[];

  ingest(events: readonly UiEvent[], ctx: IngestContext): Alert[];
  /** A UI-originated notice ("Game saved", "Load failed"). */
  notify(input: { kind?: string; severity: AlertSeverity; title: string; body?: string; actions?: AlertAction[]; sticky?: boolean; record?: boolean }): Alert;
  dismissToast(id: number): void;
  acknowledge(id: number): void;
  markAllRead(): void;
  clearHistory(): void;
  reset(): void;
}

const policy = new AlertPolicy();
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function fill(toasts: Alert[], queue: Alert[]): { toasts: Alert[]; queue: Alert[] } {
  const visible = [...toasts];
  const waiting = [...queue];
  while (visible.length < MAX_VISIBLE_TOASTS && waiting.length > 0) {
    // Queue order: severity first, then arrival.
    waiting.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.id - b.id);
    visible.push({ ...waiting.shift()!, createdAt: now() });
  }
  return { toasts: visible, queue: waiting };
}

export const useAlertsStore = create<AlertsState>()((set, get) => ({
  history: [],
  toasts: [],
  queue: [],

  ingest(events, ctx) {
    const result = policy.ingest(events, ctx);
    if (result.alerts.length === 0 && result.toasts.length === 0) return [];
    set((s) => {
      // Countdown alerts update their visible toast in place instead of stacking.
      let toasts = s.toasts.filter((t) => !result.replaceKeys.includes(t.key));
      let queue = s.queue.filter((t) => !result.replaceKeys.includes(t.key));
      queue = [...queue, ...result.toasts];
      ({ toasts, queue } = fill(toasts, queue));
      return { history: [...s.history, ...result.alerts].slice(-HISTORY_CAP), toasts, queue };
    });
    return result.alerts;
  },

  notify(input) {
    const alert = policy.make({
      kind: input.kind ?? 'notice',
      severity: input.severity,
      title: input.title,
      body: input.body ?? null,
      now: now(),
      actions: input.actions,
      sticky: input.sticky,
    });
    set((s) => {
      const filled = fill(s.toasts, [...s.queue, alert]);
      return {
        history: input.record === false ? s.history : [...s.history, alert].slice(-HISTORY_CAP),
        ...filled,
      };
    });
    return alert;
  },

  dismissToast(id) {
    set((s) => fill(s.toasts.filter((t) => t.id !== id), s.queue));
  },

  acknowledge(id) {
    set((s) => ({
      ...fill(s.toasts.filter((t) => t.id !== id), s.queue),
      history: s.history.map((a) => (a.id === id ? { ...a, read: true } : a)),
    }));
  },

  markAllRead() {
    if (!get().history.some((a) => !a.read)) return;
    set((s) => ({ history: s.history.map((a) => (a.read ? a : { ...a, read: true })) }));
  },

  clearHistory() {
    set({ history: [] });
  },

  reset() {
    policy.reset();
    set({ history: [], toasts: [], queue: [] });
  },
}));

/** Unread alerts and the highest unread severity (for the HUD bell). */
export function unreadSummary(history: readonly Alert[]): { count: number; severity: AlertSeverity | null } {
  let count = 0;
  let severity: AlertSeverity | null = null;
  for (const a of history) {
    if (a.read || a.severity === 'info') continue;
    count++;
    if (!severity || SEVERITY_RANK[a.severity] > SEVERITY_RANK[severity]) severity = a.severity;
  }
  return { count, severity };
}
