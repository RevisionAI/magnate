// Tiny typed pub/sub used to decouple game systems. The store emits; audio,
// the 3D scene, toasts and the advisor subscribe. Nothing here knows about
// React or Three.js. Topics are the integration seam for FX, audio and UI juice
// (MASTER-PLAN §4.9) — extend additively, never rename.

import type { GameEventDto, SnapshotDto, TickResultDto } from '@/bridge/protocol';
import type { SubtitleEvent } from '@/audio/voice/VoiceQueue';

/** A world-anchored or screen-anchored floating label ("+$412K"), UX §8. */
export interface PopupRequest {
  text: string;
  /** gain = player colour, loss = red, gold = milestones, neutral = white. */
  tone: 'gain' | 'loss' | 'gold' | 'neutral';
  /** Screen position (CSS px). When absent, `anchor` or the screen centre is used. */
  x?: number;
  y?: number;
  /** A `data-ui-id` to rise from (e.g. 'topbar.cash'). */
  anchor?: string;
  /** Delay before spawning (ms) — used to stagger month-close popups. */
  delayMs?: number;
}

/** The month-close beat (UX §6.4): one per closed month, after the HUD updated. */
export interface MonthClosedMoment {
  /** The month that just closed. */
  month: { year: number; month: number };
  revenue: number;
  netIncome: number;
  cashStart: number;
  cashEnd: number;
  valueStart: number;
  valueEnd: number;
  /** Consecutive profitable months ending with this one (0 when this one lost money). */
  profitStreak: number;
  /** True when this close is one of several in a skip/batch (popups aggregate). */
  batched: boolean;
}

export interface GameBusEvents {
  /** A month closed in the engine (one per simulated month). */
  tick: TickResultDto;
  /** Each engine event from a tick or a mutating command, fanned out individually. */
  gameEvent: GameEventDto;
  /** A new game started or a save was loaded. */
  gameStarted: SnapshotDto;
  /** Player placed a building (engine accepted it). */
  buildingPlaced: { buildingId: number; typeId: string; cityId: string };
  /** Player selected (or cleared) a building in the city view. */
  buildingSelected: { buildingId: number | null };
  /** UI interaction sounds and similar low-level cues. (UI code calls audio.ui() directly; kept for compatibility.) */
  ui: { cue: 'click' | 'hover' | 'open' | 'close' | 'toggle' | 'error' | 'confirm' };
  /**
   * Playback speed changed. `speed` is the *effective* speed index as in the
   * baseline contract (0 = paused or held by a menu; 1..4 = 1×/2×/4×/8×, see
   * SECONDS_PER_MONTH). Additive fields: `multiplier` is the effective playback
   * rate (0, 1, 2, 4, 8), `index` the speed the player selected (unchanged while
   * a menu holds time), `held` whether a menu/overlay is freezing time.
   */
  speedChanged: { speed: number; multiplier?: number; index?: number; held?: boolean; reason?: string | null };

  // ---- additive topics (U1) -------------------------------------------------

  /** The month-close beat, after the HUD snapshot was applied (roll-up, chip, popups). */
  monthClosed: MonthClosedMoment;
  /** Floating "+$X" label request (screen space). */
  popup: PopupRequest;
  /**
   * World-anchored popup over a building (UX §8). The 3D layer (W6) renders it;
   * the UI only emits. `amount` is the building's monthly net income.
   */
  worldPopup: { buildingId: number; text: string; tone: PopupRequest['tone']; amount: number; delayMs?: number };
  /**
   * An advisor / anchor line the player should read (A3): voiced lines while they play (when the
   * Subtitles setting is on), unvoiced ones as toasts. Same payload as `audio.onSubtitle`.
   */
  subtitle: SubtitleEvent;
  /** Confetti burst (goal achieved, record month, victory). Screen-space origin, CSS px. */
  confetti: { x?: number; y?: number; intensity?: number };
  /** Ask the city view to frame a building / city (toast "Locate", news "Locate"). */
  locate: { buildingId?: number; cityId?: string };
  /** The game auto-paused (UX §6.4 triggers). */
  autoPaused: { trigger: string; message: string };
  /** A full-screen overlay (L3) or drawer (L2) opened/closed. */
  panelChanged: { overlay: string | null; drawer: string | null };
  /** Scenario outcome reached (also delivered as scenarioWon/scenarioLost game events). */
  outcome: { status: 'won' | 'lost'; reason?: string };
  /** A save was written (manual, quick or auto). */
  saved: { slotId: string; slotKind: string };
  /** Settings changed (graphics/gameplay consumers subscribe instead of polling the store). */
  settingsChanged: { group: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private readonly handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => set!.delete(handler as Handler<never>);
  }

  /** Subscribe for a single delivery. */
  once<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as Handler<E[K]>)(payload);
      } catch (error) {
        console.error(`[bus] handler for ${String(type)} failed`, error);
      }
    }
  }

  /** Number of handlers for a topic (diagnostics/tests). */
  listenerCount(type: keyof E): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}

/** The single app-wide bus. */
export const bus = new EventBus<GameBusEvents>();
