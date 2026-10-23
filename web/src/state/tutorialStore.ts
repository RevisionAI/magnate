// Tutorial system hooks (UX §6.17). Wave 1 ships the machinery — step state,
// latching, the UI gate, coach-mark targets and the advisor bubble — and Wave 3
// authors the chapter scripts (UX §7) against it.
//
//   useTutorialStore.getState().start(script)       // begin a chapter
//   useTutorialStore.getState().notifyAction('panel:build')   // UI actions feed predicates
//   useTutorialStore.getState().evaluate({ hud })   // after every snapshot (the store calls it)
//
// Step state lives here (not in a component), so it survives panel changes and
// is saved in the UI sidecar next to the engine save. Completion is latched.

import { create } from 'zustand';
import type { HudModel } from './hud';
import type { UiEvent } from './gameEvents';

export interface TutorialContext {
  hud: HudModel | null;
  /** Events of the latest close or command. */
  events: readonly UiEvent[];
  /** UI actions seen since the step started ('panel:build', 'speed:2', …). */
  actions: readonly string[];
}

export interface TutorialStep {
  id: string;
  title: string;
  /** ≤ 40 words. */
  body: string;
  /** ≤ 20 words: why this matters. */
  why?: string;
  /** Voice line id (played once per step id per save). */
  vo?: string;
  /** What to spotlight: a `data-ui-id` in the HUD, or a world entity (rendered by the 3D layer). */
  highlight?: { ui?: string; world?: { kind: 'building' | 'plot' | 'buildingType'; id: string | number } };
  /** Optional camera preset id for the city view. */
  camera?: string;
  /** Whitelist of `data-ui-id`s that stay interactive; everything else is dimmed. Omit = no gate. */
  allow?: readonly string[];
  /** Seconds without progress before the hint bubble shows (default 45). */
  hintAfterSec?: number;
  hint?: string;
  skippable?: boolean;
  /** Completion predicate (latched once true). Omit for acknowledge-only steps. */
  complete?: (ctx: TutorialContext) => boolean;
}

export interface TutorialScript {
  id: string;
  title: string;
  steps: readonly TutorialStep[];
}

/** What a save keeps (UI sidecar). */
export interface TutorialPersisted {
  scriptId: string | null;
  index: number;
  latched: string[];
  voPlayed: string[];
}

const registry = new Map<string, TutorialScript>();

/** Chapters register here so a loaded save can resume its script by id. */
export function registerTutorialScript(script: TutorialScript): void {
  registry.set(script.id, script);
}

export function tutorialScript(id: string): TutorialScript | undefined {
  return registry.get(id);
}

interface TutorialState {
  script: TutorialScript | null;
  index: number;
  latched: string[];
  voPlayed: string[];
  actions: string[];
  collapsed: boolean;
  stepStartedAt: number;
  finished: boolean;

  start(script: TutorialScript): void;
  stop(): void;
  /** Acknowledge the current step (the "Next" button) — latches it. */
  next(): void;
  skipAll(): void;
  notifyAction(action: string): void;
  evaluate(ctx: Omit<TutorialContext, 'actions'>): void;
  markVoPlayed(stepId: string): void;
  setCollapsed(collapsed: boolean): void;
  persisted(): TutorialPersisted;
  restore(p: TutorialPersisted | null | undefined): void;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const useTutorialStore = create<TutorialState>()((set, get) => ({
  script: null,
  index: 0,
  latched: [],
  voPlayed: [],
  actions: [],
  collapsed: false,
  stepStartedAt: 0,
  finished: false,

  start(script) {
    registerTutorialScript(script);
    set({ script, index: 0, latched: [], actions: [], stepStartedAt: now(), finished: false, collapsed: false });
  },

  stop() {
    set({ script: null, index: 0, actions: [], finished: false });
  },

  next() {
    const { script, index, latched } = get();
    const step = script?.steps[index];
    if (!script || !step) return;
    const nextIndex = index + 1;
    set({
      latched: latched.includes(step.id) ? latched : [...latched, step.id],
      index: nextIndex,
      actions: [],
      stepStartedAt: now(),
      finished: nextIndex >= script.steps.length,
    });
  },

  skipAll() {
    const { script } = get();
    set({ index: script?.steps.length ?? 0, finished: true, actions: [] });
  },

  notifyAction(action) {
    if (!get().script) return;
    set((s) => ({ actions: s.actions.length > 64 ? [...s.actions.slice(-32), action] : [...s.actions, action] }));
  },

  evaluate(ctx) {
    const { script, index, actions } = get();
    const step = script?.steps[index];
    if (!step?.complete) return;
    let done = false;
    try {
      done = step.complete({ ...ctx, actions });
    } catch (error) {
      console.error(`[tutorial] predicate for ${step.id} failed`, error);
    }
    if (done) get().next();
  },

  markVoPlayed(stepId) {
    set((s) => (s.voPlayed.includes(stepId) ? s : { voPlayed: [...s.voPlayed, stepId] }));
  },

  setCollapsed(collapsed) {
    set({ collapsed });
  },

  persisted() {
    const { script, index, latched, voPlayed } = get();
    return { scriptId: script?.id ?? null, index, latched, voPlayed };
  },

  restore(p) {
    if (!p?.scriptId) {
      set({ script: null, index: 0, latched: p?.latched ?? [], voPlayed: p?.voPlayed ?? [], actions: [], finished: false });
      return;
    }
    const script = registry.get(p.scriptId) ?? null;
    set({
      script,
      index: Math.max(0, p.index),
      latched: p.latched,
      voPlayed: p.voPlayed,
      actions: [],
      stepStartedAt: now(),
      finished: script ? p.index >= script.steps.length : false,
    });
  },
}));

/** The active step, if any. */
export function currentTutorialStep(state: Pick<TutorialState, 'script' | 'index' | 'finished'>): TutorialStep | null {
  if (!state.script || state.finished) return null;
  return state.script.steps[state.index] ?? null;
}
