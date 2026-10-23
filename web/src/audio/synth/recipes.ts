// The 38 PROCEDURAL SFX recipes of audio-plan §6.2, transcribed 1:1 from the table (times in
// seconds; the table uses ms). Plus the procedural layer of #52 ribbon_cut. Absolute levels are set
// by calibration.json (per-recipe trim to the class target, measured offline by AudioLab), so the
// `pk` values here only fix the balance inside each sound.

import { NOTE, type Synth } from './primitives';

export type SfxClass = 'ui_micro' | 'ui_notice' | 'economy' | 'event' | 'alert' | 'stinger' | 'world';

export interface RecipeParams {
  /** 0–1 control value (slider position for slider_tick). */
  v?: number;
  /** Consecutive profitable months (month_close_up pitch). */
  streak?: number;
  /** Variant index for recipes with built-in variants (car_horn a/b/c …). */
  variant?: number;
  /** Cycle count for repeating world sounds (truck_reverse). */
  cycles?: number;
}

export interface RecipeDef {
  fn: (s: Synth, p: RecipeParams) => void;
  cls: SfxClass;
  /** Declared length in seconds (the offline test asserts the render fits). */
  dur: number;
  /** Random per-trigger detune range in cents (0 for musical sounds). */
  detune: number;
  /** Deterministic pitch offset in cents from the params (month_close_up streak). */
  cents?: (p: RecipeParams) => number;
  /** Where the recipe comes from: the §6.2 table, or a stand-in for a GENERATE asset. */
  origin: 'proc' | 'fallback' | 'layer';
  /** Short description for the AudioLab. */
  label: string;
}

const N = NOTE;

export const PROC_RECIPES: Record<string, RecipeDef> = {
  // 1 — primary buttons and cards; cooldown 50 ms
  ui_hover: {
    cls: 'ui_micro', dur: 0.05, detune: 25, origin: 'proc', label: 'hover',
    fn: (s) => {
      s.tone({ f: 1760, a: 0.002, d: 0.04, pk: 0.03 });
      s.noise({ type: 'highpass', f: 6000, q: 0.7, a: 0.001, d: 0.008, pk: 0.012 });
    },
  },
  // 2 — replaces the silent ui_click.mp3
  ui_click: {
    cls: 'ui_micro', dur: 0.04, detune: 30, origin: 'proc', label: 'click',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 2800, q: 1.4, a: 0.001, d: 0.01, pk: 0.22 });
      s.tone({ f: 1250, f2: 880, a: 0.001, d: 0.028, pk: 0.16 });
    },
  },
  // 3 — drawer or overlay opens
  panel_open: {
    cls: 'ui_notice', dur: 0.22, detune: 0, origin: 'proc', label: 'panel open',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 500, f2: 2400, sweep: 0.16, q: 1, a: 0.02, d: 0.18, pk: 0.09 });
      s.tone({ f: N.D5, f2: N.A5, at: 0.04, a: 0.005, d: 0.09, pk: 0.05 });
    },
  },
  // 4
  panel_close: {
    cls: 'ui_notice', dur: 0.17, detune: 0, origin: 'proc', label: 'panel close',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 2400, f2: 500, sweep: 0.14, q: 1, a: 0.01, d: 0.15, pk: 0.08 });
      s.tone({ f: N.A5, f2: N.D5, a: 0.005, d: 0.08, pk: 0.045 });
    },
  },
  // 5
  tab_switch: {
    cls: 'ui_micro', dur: 0.025, detune: 0, origin: 'proc', label: 'tab',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 4200, q: 3, a: 0.001, d: 0.006, pk: 0.12 });
      s.tone({ f: N.C7, a: 0.001, d: 0.018, pk: 0.05 });
    },
  },
  // 6
  toggle_on: {
    cls: 'ui_micro', dur: 0.12, detune: 0, origin: 'proc', label: 'toggle on',
    fn: (s) => {
      s.tone({ type: 'triangle', f: N.G5, a: 0.002, d: 0.055, pk: 0.08 });
      s.tone({ type: 'triangle', f: N.D6, at: 0.045, a: 0.002, d: 0.07, pk: 0.08 });
    },
  },
  // 7
  toggle_off: {
    cls: 'ui_micro', dur: 0.12, detune: 0, origin: 'proc', label: 'toggle off',
    fn: (s) => {
      s.tone({ type: 'triangle', f: N.D6, a: 0.002, d: 0.055, pk: 0.08 });
      s.tone({ type: 'triangle', f: N.G5, at: 0.045, a: 0.002, d: 0.07, pk: 0.07 });
    },
  },
  // 8 — v = slider position 0–1; throttled 35 ms
  slider_tick: {
    cls: 'ui_micro', dur: 0.012, detune: 0, origin: 'proc', label: 'slider tick',
    fn: (s, p) => {
      const v = Math.min(1, Math.max(0, p.v ?? 0.5));
      s.tone({ f: 1800 + 1800 * v, a: 0.001, d: 0.01, pk: 0.025 });
    },
  },
  // 9 — commit (C6 → F6 resolves to the tonic)
  confirm: {
    cls: 'ui_notice', dur: 0.33, detune: 0, origin: 'proc', label: 'confirm',
    fn: (s) => {
      s.mallet(N.C6, 0, 0.1);
      s.mallet(N.F6, 0.07, 0.09);
    },
  },
  // 10 — denied action; loanDenied
  error: {
    cls: 'ui_notice', dur: 0.23, detune: 0, origin: 'proc', label: 'error',
    fn: (s) => {
      const lp = s.filter('lowpass', 1400, 0.7);
      for (const at of [0, 0.14]) {
        s.tone({ type: 'square', f: 196, at, a: 0.003, d: 0.085, pk: 0.05, to: lp });
        s.tone({ type: 'square', f: 207.65, at, a: 0.003, d: 0.085, pk: 0.05, to: lp });
      }
    },
  },
  // 11 — also used on resume
  speed_up: {
    cls: 'ui_notice', dur: 0.115, detune: 0, origin: 'proc', label: 'speed up',
    fn: (s) => {
      s.tone({ type: 'sawtooth', f: 220, f2: 440, a: 0.005, d: 0.11, pk: 0.04, to: s.filter('lowpass', 1500, 2) });
    },
  },
  // 12
  speed_down: {
    cls: 'ui_notice', dur: 0.115, detune: 0, origin: 'proc', label: 'speed down',
    fn: (s) => {
      s.tone({ type: 'sawtooth', f: 440, f2: 220, a: 0.005, d: 0.11, pk: 0.04, to: s.filter('lowpass', 1500, 2) });
    },
  },
  // 13 — the router also sets the music tone to 'paused'
  pause: {
    cls: 'ui_notice', dur: 0.165, detune: 0, origin: 'proc', label: 'pause',
    fn: (s) => {
      s.tone({ type: 'sawtooth', f: 330, f2: 165, a: 0.005, d: 0.16, pk: 0.04, to: s.filter('lowpass', 900, 1) });
    },
  },
  // 14 — building clicked, by category
  select_retail: {
    cls: 'ui_notice', dur: 0.3, detune: 0, origin: 'proc', label: 'select retail',
    fn: (s) => {
      s.mallet(N.A5, 0, 0.07, 0.12);
      s.bell(N.A6, 0, 0.02, 0.3);
    },
  },
  // 15 — factory, mine, well, warehouse, port
  select_industrial: {
    cls: 'ui_notice', dur: 0.12, detune: 0, origin: 'proc', label: 'select industrial',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 900, q: 6, a: 0.001, d: 0.04, pk: 0.2 });
      s.tone({ f: 140, f2: 110, a: 0.002, d: 0.08, pk: 0.12 });
    },
  },
  // 16 — farm, plantation
  select_agri: {
    cls: 'ui_notice', dur: 0.09, detune: 0, origin: 'proc', label: 'select agri',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 600, q: 8, a: 0.001, d: 0.03, pk: 0.18 });
      s.tone({ f: 330, a: 0.002, d: 0.06, pk: 0.06 });
    },
  },
  // 17 — R&D, media
  select_knowledge: {
    cls: 'ui_notice', dur: 0.095, detune: 0, origin: 'proc', label: 'select knowledge',
    fn: (s) => {
      s.tone({ f: N.E6, a: 0.002, d: 0.09, pk: 0.05 });
      s.tone({ f: N.B6, a: 0.002, d: 0.09, pk: 0.03 });
    },
  },
  // 18 — placement confirmed (ghost snaps)
  place_ok: {
    cls: 'event', dur: 0.15, detune: 50, origin: 'proc', label: 'place ok',
    fn: (s) => {
      s.noise({ type: 'lowpass', f: 180, q: 1, a: 0.002, d: 0.12, pk: 0.3 });
      s.noise({ type: 'bandpass', f: 2000, q: 2, a: 0.001, d: 0.025, pk: 0.08 });
      s.tone({ f: 90, f2: 60, a: 0.002, d: 0.14, pk: 0.25 });
    },
  },
  // 19 — blocked plot
  place_invalid: {
    cls: 'ui_notice', dur: 0.26, detune: 0, origin: 'proc', label: 'place invalid',
    fn: (s) => {
      const lp = s.filter('lowpass', 800, 1);
      for (const at of [0, 0.15]) s.tone({ type: 'sawtooth', f: 110, at, a: 0.003, d: 0.11, pk: 0.06, to: lp });
    },
  },
  // 20 — price applied at close (UX §8 #12)
  price_tag: {
    cls: 'ui_micro', dur: 0.09, detune: 0, origin: 'proc', label: 'price tag',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 3000, f2: 1500, sweep: 0.06, q: 2, a: 0.002, d: 0.06, pk: 0.1 });
      s.tone({ f: N.G6, at: 0.03, a: 0.001, d: 0.04, pk: 0.03 });
    },
  },
  // 22 — Opportunity severity (UX §6.21)
  notify_opportunity: {
    cls: 'ui_notice', dur: 0.4, detune: 0, origin: 'proc', label: 'opportunity',
    fn: (s) => {
      s.mallet(N.C6, 0, 0.07);
      s.mallet(N.F6, 0.06, 0.07);
      s.mallet(N.A6, 0.12, 0.06);
    },
  },
  // 23 — replaces the 214 Hz thud; same id. Alerts live in 500 Hz – 3 kHz (§4.13).
  notify_warning: {
    cls: 'alert', dur: 0.35, detune: 0, origin: 'proc', label: 'warning',
    fn: (s) => {
      const hp = s.filter('highpass', 300);
      s.tone({ type: 'triangle', f: N.A5, a: 0.004, d: 0.14, pk: 0.1, to: hp });
      s.tone({ f: N.A6, a: 0.004, d: 0.14, pk: 0.03, to: hp });
      s.tone({ type: 'triangle', f: N.F5, at: 0.16, a: 0.004, d: 0.18, pk: 0.1, to: hp });
      s.tone({ f: N.F6, at: 0.16, a: 0.004, d: 0.18, pk: 0.03, to: hp });
    },
  },
  // 24 — Critical severity; cooldown 3 s
  alert_critical: {
    cls: 'alert', dur: 0.56, detune: 0, origin: 'proc', label: 'critical',
    fn: (s) => {
      const lp = s.filter('lowpass', 2400, 1);
      for (const at of [0, 0.21, 0.42]) {
        s.tone({ type: 'sawtooth', f: 440, at, a: 0.003, d: 0.12, pk: 0.07, to: lp });
        s.tone({ type: 'sawtooth', f: 446, at, a: 0.003, d: 0.12, pk: 0.07, to: lp });
        s.tone({ f: 110, at, a: 0.002, d: 0.12, pk: 0.12 });
      }
    },
  },
  // 25 — low runway (UX §8 #32): lub-dub ×3 at 1 Hz
  heartbeat_soft: {
    cls: 'alert', dur: 2.3, detune: 0, origin: 'proc', label: 'heartbeat',
    fn: (s) => {
      for (let i = 0; i < 3; i++) {
        for (const [off, k] of [
          [0, 1],
          [0.18, 0.7],
        ] as const) {
          const at = i + off;
          s.tone({ f: 110, f2: 70, at, a: 0.003, d: 0.09, pk: 0.25 * k });
          s.noise({ type: 'lowpass', f: 900, at, a: 0.001, d: 0.02, pk: 0.05 * k });
        }
      }
    },
  },
  // 28 — NI > 0 (UX §8 #5); +1 semitone per consecutive profitable month, max +5
  month_close_up: {
    cls: 'economy', dur: 0.45, detune: 0, origin: 'proc', label: 'month close up',
    cents: (p) => 100 * Math.min(5, Math.max(0, (p.streak ?? 1) - 1)),
    fn: (s) => {
      s.mallet(N.F6, 0, 0.06);
      s.fm(2637, 1.4, 2.5, 0.04, 0.03, 0.35);
    },
  },
  // 29 — NI < 0 (UX §8 #6)
  month_close_down: {
    cls: 'economy', dur: 0.42, detune: 0, origin: 'proc', label: 'month close down',
    fn: (s) => {
      const lp = s.filter('lowpass', 800);
      s.tone({ type: 'triangle', f: N.F4, f2: N.E4, a: 0.005, d: 0.24, pk: 0.06, to: lp });
      s.tone({ type: 'triangle', f: N.D4, at: 0.09, a: 0.005, d: 0.3, pk: 0.05, to: lp });
    },
  },
  // 33 — share price up
  ticker_up: {
    cls: 'economy', dur: 0.38, detune: 0, origin: 'proc', label: 'ticker up',
    fn: (s) => {
      s.mallet(N.F5, 0, 0.07);
      s.mallet(N.A5, 0.055, 0.07);
      s.mallet(N.C6, 0.11, 0.07);
    },
  },
  // 34 — share price down
  ticker_down: {
    cls: 'economy', dur: 0.38, detune: 0, origin: 'proc', label: 'ticker down',
    fn: (s) => {
      const lp = s.filter('lowpass', 3000);
      s.mallet(N.C6, 0, 0.06, 0.26, lp);
      s.mallet(N.Ab5, 0.06, 0.06, 0.26, lp);
      s.mallet(N.F5, 0.12, 0.06, 0.26, lp);
    },
  },
  // 35 — credit upgrade, cash recovered
  rating_up: {
    cls: 'economy', dur: 0.5, detune: 0, origin: 'proc', label: 'rating up',
    fn: (s) => {
      s.mallet(N.A5, 0, 0.07);
      s.mallet(N.E6, 0.08, 0.07);
      s.bell(N.E7, 0.08, 0.015, 0.4);
    },
  },
  // 36 — credit downgrade
  rating_down: {
    cls: 'economy', dur: 0.4, detune: 0, origin: 'proc', label: 'rating down',
    fn: (s) => {
      const lp = s.filter('lowpass', 2500);
      s.mallet(N.Ab5, 0, 0.06, 0.26, lp);
      s.mallet(N.F5, 0.09, 0.06, 0.26, lp);
    },
  },
  // 42 — rival enters, stake alert (UX §8 #15); feedback delay 180 ms, fb .25, lp 2 kHz
  rival_alert: {
    cls: 'alert', dur: 0.6, detune: 0, origin: 'proc', label: 'rival alert',
    fn: (s) => {
      const d = s.delay(0.18, 0.25, 2000);
      s.tone({ type: 'triangle', f: N.D5, a: 0.003, d: 0.12, pk: 0.08, to: d });
      s.tone({ type: 'triangle', f: N.F5, at: 0.13, a: 0.003, d: 0.22, pk: 0.08, to: d });
      s.tone({ f: N.D6, at: 0.13, a: 0.002, d: 0.18, pk: 0.02, to: d });
    },
  },
  // 44 — became #1 (UX §8 #17)
  overtake: {
    cls: 'event', dur: 0.46, detune: 0, origin: 'proc', label: 'overtake',
    fn: (s) => {
      [N.F5, N.G5, N.A5, N.C6, N.F6].forEach((f, i) => s.mallet(f, i * 0.05, 0.08));
    },
  },
  // 45 — share milestones
  milestone_small: {
    cls: 'event', dur: 0.6, detune: 0, origin: 'proc', label: 'milestone',
    fn: (s) => {
      s.mallet(N.C6, 0, 0.08);
      s.mallet(N.F6, 0.09, 0.08);
      s.bell(N.F7, 0.09, 0.015, 0.5);
    },
  },
  // 47 — UX §8 #9
  stockout: {
    cls: 'alert', dur: 0.32, detune: 0, origin: 'proc', label: 'stock-out',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 800, q: 6, a: 0.001, d: 0.04, pk: 0.18 });
      s.noise({ type: 'bandpass', f: 600, q: 6, at: 0.12, a: 0.001, d: 0.04, pk: 0.16 });
      s.tone({ type: 'triangle', f: N.F4, f2: N.D4, at: 0.06, a: 0.005, d: 0.2, pk: 0.05 });
    },
  },
  // 48 — tech level up (UX §8 #22): rising noise + 7 grains from {F6 G6 A6 C7 D7 F7}
  tech_up: {
    cls: 'event', dur: 0.7, detune: 0, origin: 'proc', label: 'tech up',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 400, f2: 3000, sweep: 0.4, q: 4, a: 0.15, d: 0.25, pk: 0.05 });
      const pool = [N.F6, N.G6, N.A6, N.C7, N.D7, N.F7];
      for (let i = 0; i < 7; i++) {
        const f = pool[Math.floor(Math.random() * pool.length)] as number;
        s.tone({ f, at: 0.04 * i, a: 0.002, d: 0.14, pk: 0.035 });
      }
    },
  },
  // 52 (PROC layer) — construction completed: rising arpeggio into a small procedural room
  ribbon_cut_chime: {
    cls: 'event', dur: 1.6, detune: 0, origin: 'layer', label: 'ribbon chime',
    fn: (s) => {
      const rv = s.reverb(1.2, 0.15);
      [N.F5, N.A5, N.C6, N.F6].forEach((f, i) => s.mallet(f, i * 0.08, 0.1, 0.26, rv));
    },
  },
  // 60 — loading docks: square 1040 Hz gated 450/450 ms, 3–6 cycles, ±2 % f
  truck_reverse: {
    cls: 'world', dur: 5.4, detune: 0, origin: 'proc', label: 'truck reverse',
    fn: (s, p) => {
      const cycles = Math.max(3, Math.min(6, p.cycles ?? 3 + Math.floor(Math.random() * 4)));
      const f = 1040 * (1 + (Math.random() * 2 - 1) * 0.02);
      const bp = s.filter('bandpass', f, 6);
      const osc = new OscillatorNode(s.c, { type: 'square', frequency: f });
      const g = new GainNode(s.c, { gain: 0 });
      osc.connect(g).connect(bp);
      const t = s.t0;
      for (let i = 0; i < cycles; i++) {
        const on = t + i * 0.9;
        g.gain.setValueAtTime(0, on);
        g.gain.linearRampToValueAtTime(0.05, on + 0.005);
        g.gain.setValueAtTime(0.05, on + 0.445);
        g.gain.linearRampToValueAtTime(0, on + 0.45);
      }
      osc.start(t);
      osc.stop(t + cycles * 0.9);
      s.hold(cycles * 0.9);
    },
  },
  // 61 — warehouses
  forklift_beep: {
    cls: 'world', dur: 0.92, detune: 0, origin: 'proc', label: 'forklift beep',
    fn: (s) => {
      for (const at of [0, 0.4, 0.8]) s.tone({ f: 2700, at, a: 0.002, d: 0.11, pk: 0.04 });
    },
  },
  // 65 — busy retail at street zoom
  door_chime: {
    cls: 'world', dur: 1.3, detune: 0, origin: 'proc', label: 'door chime',
    fn: (s) => {
      s.bell(N.E6, 0, 0.05);
      s.bell(N.C6, 0.35, 0.05);
    },
  },
};

/** Ids of the 38 recipes in the §6.2 table (excludes the ribbon_cut layer). */
export const TABLE_RECIPE_IDS = Object.keys(PROC_RECIPES).filter((id) => PROC_RECIPES[id]?.origin === 'proc');
