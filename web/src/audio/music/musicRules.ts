// Music state rules (audio-plan §4.7.2–4.7.3). Pure functions: inputs → desired state, with the
// hysteresis and dwell rules, so they are table-tested without audio.
//
// States: title · calm · steady · growth · tension · recession · victory · defeat. The workstream
// brief's names map onto these: "busy" = growth, "crisis" = tension (see MUSIC_STATE_ALIASES).

export type MusicState = 'title' | 'calm' | 'steady' | 'growth' | 'tension' | 'recession' | 'victory' | 'defeat';
export type Climate = 'panic' | 'recession' | 'normal' | 'prosperous' | 'boom';

export const MUSIC_STATES: readonly MusicState[] = ['title', 'calm', 'steady', 'growth', 'tension', 'recession', 'victory', 'defeat'];
export const MUSIC_STATE_ALIASES: Readonly<Record<string, MusicState>> = { busy: 'growth', crisis: 'tension' };

export function normalizeMusicState(s: string): MusicState | null {
  if ((MUSIC_STATES as readonly string[]).includes(s)) return s as MusicState;
  return MUSIC_STATE_ALIASES[s] ?? null;
}

export interface MusicInputs {
  /** False on the title / scenario screens. */
  inGame: boolean;
  outcome: 'playing' | 'won' | 'lost';
  cash: number;
  /** Cash runway in months while burning cash; null when cash flow is not negative. */
  runway: number | null;
  /** Insolvency countdown (months) while one is running, else null. */
  insolvencyMonthsLeft: number | null;
  climate: Climate;
  /** Revenue of the last 3 closed months ÷ the previous 3, minus 1. */
  revQoQ: number;
  underConstruction: number;
  buildings: number;
  /** Player-relevant events in the last 120 s of real time. */
  events2m: number;
  /** Speed multiplier: 0 paused, 1, 2, 4, 8. */
  speed: number;
  monthsElapsed: number;
  /** 1 − price ÷ max(price over 3 months), when listed. */
  drawdown: number;
  /** Any Warning-or-worse alert is open. */
  warningActive: boolean;
}

export const DEFAULT_INPUTS: Readonly<MusicInputs> = {
  inGame: false,
  outcome: 'playing',
  cash: 0,
  runway: null,
  insolvencyMonthsLeft: null,
  climate: 'normal',
  revQoQ: 0,
  underConstruction: 0,
  buildings: 0,
  events2m: 0,
  speed: 1,
  monthsElapsed: 0,
  drawdown: 0,
  warningActive: false,
};

export interface DirectorMemory {
  state: MusicState;
  /** Real time (ms) the current state was entered. */
  enteredAt: number;
  /** Consecutive month closes satisfying the tension exit test (cash ≥ 0). */
  okCloses: number;
}

export const TENSION_MIN_MS = 30_000;
export const DWELL_MS = 60_000;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** §4.7.2 intensity in [0, 1]. */
export function intensity(i: MusicInputs): number {
  return clamp01(
    0.3 * Math.min(i.underConstruction / 3, 1) +
      0.25 * clamp01(i.revQoQ / 0.25) +
      0.2 * Math.min(i.events2m / 6, 1) +
      0.15 * Math.min(i.buildings / 20, 1) +
      0.1 * (i.speed >= 4 ? 1 : 0),
  );
}

export function tensionEntry(i: MusicInputs): boolean {
  return (
    i.cash < 0 ||
    (i.runway !== null && i.runway < 3) ||
    (i.insolvencyMonthsLeft !== null && i.insolvencyMonthsLeft <= 3) ||
    i.climate === 'panic' ||
    i.drawdown >= 0.4
  );
}

/** Update the tension-exit counter at a month close. */
export function noteMonthClose(mem: DirectorMemory, i: MusicInputs): DirectorMemory {
  return { ...mem, okCloses: i.cash >= 0 ? mem.okCloses + 1 : 0 };
}

const OPERATING: ReadonlySet<MusicState> = new Set(['calm', 'steady', 'growth']);

/**
 * §4.7.3 — first match wins:
 *  1. outcome won → victory, lost → defeat (terminal, immediate)
 *  2. tension on cash < 0 | runway < 3 | insolvency ≤ 3 | panic | drawdown ≥ 40 %; exit only after
 *     2 closes with cash ≥ 0, runway null or > 6, no panic, and ≥ 30 s in tension
 *  3. recession while climate = recession (re-evaluated at closes)
 *  4. growth at intensity ≥ 0.60 (≥ 0.45 in a boom); stay until < 0.40 (< 0.30 in a boom)
 *  5. calm early (months < 6 and buildings < 4) or intensity < 0.20
 *  6. steady
 *  7. changes among calm/steady/growth need ≥ 60 s in the current state
 */
export function desiredState(i: MusicInputs, mem: DirectorMemory, now: number): MusicState {
  const cur = mem.state;
  if (!i.inGame) return 'title';
  if (i.outcome === 'won') return 'victory';
  if (i.outcome === 'lost') return 'defeat';
  if (cur === 'victory' || cur === 'defeat') return cur; // terminal until a new game resets the director

  if (tensionEntry(i)) return 'tension';
  if (cur === 'tension') {
    const canExit =
      mem.okCloses >= 2 && (i.runway === null || i.runway > 6) && i.climate !== 'panic' && now - mem.enteredAt >= TENSION_MIN_MS;
    if (!canExit) return 'tension';
  }

  if (i.climate === 'recession') return 'recession';

  const k = intensity(i);
  const boom = i.climate === 'boom';
  let want: MusicState;
  if (k >= 0.6 || (boom && k >= 0.45)) want = 'growth';
  else if (cur === 'growth' && k >= (boom ? 0.3 : 0.4)) want = 'growth';
  else if ((i.monthsElapsed < 6 && i.buildings < 4) || k < 0.2) want = 'calm';
  else want = 'steady';

  if (OPERATING.has(cur) && OPERATING.has(want) && want !== cur && now - mem.enteredAt < DWELL_MS) return cur;
  return want;
}

/** Pressure layer: warning-or-worse open while in an operating state or recession (§4.7.3 #7). */
export function pressureWanted(i: MusicInputs, state: MusicState): boolean {
  return i.warningActive && (OPERATING.has(state) || state === 'recession');
}

export type Quantize = 'now' | 'beat' | 'bar';

export interface TransitionSpec {
  quantize: Quantize;
  /** Minimum lead time before the quantised point (s). */
  minAhead: number;
  /** Crossfade length (s). */
  fade: number;
  stinger?: string;
}

/** §4.7.4 transition table. */
export function transitionFor(from: MusicState | null, to: MusicState): TransitionSpec {
  if (to === 'victory') return { quantize: 'now', minAhead: 0, fade: 0.8, stinger: 'victory_fanfare' };
  if (to === 'defeat') return { quantize: 'now', minAhead: 0, fade: 1.5, stinger: 'defeat_sting' };
  if (to === 'title') return { quantize: 'now', minAhead: 0, fade: 2.5 };
  if (from === null || from === 'title' || from === 'victory' || from === 'defeat') return { quantize: 'now', minAhead: 0, fade: 2.5 };
  if (to === 'tension') return { quantize: 'beat', minAhead: 0.1, fade: 1.5, stinger: 'stinger.tension' };
  if (from === 'tension') return { quantize: 'bar', minAhead: 0.5, fade: 3, stinger: 'stinger.recovery' };
  if (to === 'recession') return { quantize: 'bar', minAhead: 0.5, fade: 6 };
  if (from === 'recession') return { quantize: 'bar', minAhead: 0.5, fade: 5, stinger: 'stinger.recovery' };
  return { quantize: 'beat', minAhead: 0.5, fade: 4 };
}

/** Anti-fatigue (§4.7.4): rest after 2 loop bodies or 6 minutes in calm/steady/growth/recession. */
export const REST = { maxLoops: 2, maxMs: 6 * 60_000, minRestMs: 45_000, maxRestMs: 90_000 } as const;

export function restsAllowed(state: MusicState): boolean {
  return OPERATING.has(state) || state === 'recession';
}

/** A rest is cut short by tension, victory, defeat or growth. */
export function breaksRest(state: MusicState): boolean {
  return state === 'tension' || state === 'victory' || state === 'defeat' || state === 'growth';
}
