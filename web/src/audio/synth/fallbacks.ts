// Procedural stand-ins for the GENERATE SFX of audio-plan §6.2 (cash register, coin shower, stock
// bell, loan stamp, newspaper, news sting, world one-shots …). The SFX player prefers a manifest
// asset with the same id and uses these only while no generated take exists, so every routed cue is
// audible today and upgrades transparently once `tools/audio` masters the real files.

import { NOTE, ahr, brownBuffer, type Synth } from './primitives';
import type { RecipeDef } from './recipes';

const N = NOTE;
const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** One coin "tink": three inharmonic partials with fast decays. */
function tink(s: Synth, at: number, f: number, pk: number): void {
  s.tone({ f, at, a: 0.0008, d: 0.11, pk });
  s.tone({ f: f * 1.47, at, a: 0.0008, d: 0.07, pk: pk * 0.6 });
  s.tone({ f: f * 2.31, at, a: 0.0006, d: 0.045, pk: pk * 0.4 });
}

function clap(s: Synth, at: number, pk: number): void {
  s.noise({ type: 'bandpass', f: rnd(900, 1700), q: 1.1, at, a: 0.0008, d: rnd(0.012, 0.024), pk });
}

/** Tremolo gain: 0..1 strikes at `rate` Hz (inverted sawtooth = sharp attack, linear decay). */
function striker(s: Synth, rate: number, depth: number, t: number, dur: number): GainNode {
  const g = new GainNode(s.c, { gain: 1 - depth / 2 });
  const lfo = new OscillatorNode(s.c, { type: 'sawtooth', frequency: rate });
  const amt = new GainNode(s.c, { gain: -depth / 2 });
  lfo.connect(amt).connect(g.gain);
  lfo.start(t);
  lfo.stop(t + dur);
  return g;
}

function cashRegister(s: Synth, bellF: number, drawerAt: number): void {
  // key press
  s.noise({ type: 'bandpass', f: 3500, q: 3, a: 0.001, d: 0.015, pk: 0.15 });
  s.tone({ f: 180, f2: 120, a: 0.001, d: 0.04, pk: 0.1 });
  // "ka" (hammer on the bell) then "ching"
  s.fm(3200, 1.41, 3, 0.085, 0.05, 0.03);
  s.bell(bellF, 0.09, 0.12, 0.9);
  // drawer slides open, rattles, stops
  s.noise({ type: 'bandpass', f: 900, f2: 1600, sweep: 0.25, q: 2, at: drawerAt, a: 0.03, d: 0.25, pk: 0.05 });
  for (let i = 0; i < 6; i++) s.noise({ type: 'bandpass', f: 2500, q: 4, at: drawerAt + 0.02 + i * 0.025, a: 0.001, d: 0.012, pk: 0.03 });
  s.tone({ f: 140, f2: 90, at: drawerAt + 0.27, a: 0.001, d: 0.08, pk: 0.12 });
  s.noise({ type: 'lowpass', f: 1200, at: drawerAt + 0.27, a: 0.001, d: 0.04, pk: 0.08 });
}

function stamp(s: Synth, at = 0): void {
  s.tone({ f: 110, f2: 55, at, a: 0.001, d: 0.18, pk: 0.35 });
  s.noise({ type: 'lowpass', f: 900, q: 0.7, at, a: 0.001, d: 0.08, pk: 0.3 });
  s.noise({ type: 'bandpass', f: 2200, q: 1.2, at, a: 0.001, d: 0.03, pk: 0.12 });
  s.tone({ f: 220, at, a: 0.001, d: 0.12, pk: 0.06 });
  s.tone({ type: 'triangle', f: 330, at, a: 0.001, d: 0.06, pk: 0.04 });
}

function horn(s: Synth, at: number, hold: number, pk: number, out: AudioNode): void {
  for (const f of [415, 517]) {
    const o = new OscillatorNode(s.c, { type: 'square', frequency: f * (1 + rnd(-0.01, 0.01)) });
    const g = new GainNode(s.c, { gain: 0 });
    ahr(g.gain, s.t0 + at, pk, 0.008, hold, 0.03);
    o.connect(g).connect(out);
    o.start(s.t0 + at);
    o.stop(s.t0 + at + hold + 0.08);
  }
  s.hold(at + hold + 0.08);
}

export const FALLBACK_RECIPES: Record<string, RecipeDef> = {
  // 26 — Major news (UX §8 #25): a spinning paper whoosh, then a slap on a desk and the pages settle
  newspaper: {
    cls: 'event', dur: 1.2, detune: 40, origin: 'fallback', label: 'newspaper',
    fn: (s) => {
      const spin = striker(s, 11, 0.6, s.t0, 0.62);
      spin.connect(s.out);
      s.noise({ type: 'bandpass', f: 600, f2: 3500, sweep: 0.5, q: 1.2, a: 0.35, d: 0.25, pk: 0.2, to: spin });
      // the slap: paper crack + wooden desk body (3 ms attacks keep the crest factor in check)
      s.noise({ type: 'bandpass', f: 1800, q: 0.9, at: 0.55, a: 0.003, d: 0.08, pk: 0.12 });
      s.noise({ type: 'lowpass', f: 700, at: 0.55, a: 0.003, d: 0.14, pk: 0.1 });
      s.tone({ f: 180, at: 0.55, a: 0.003, d: 0.1, pk: 0.06 });
      // the pages settle: overlapping rustles carry the body of the sound after the slap
      for (const [at, f, pk] of [
        [0.58, 2600, 0.09],
        [0.72, 3200, 0.075],
        [0.88, 2200, 0.06],
        [1.02, 2900, 0.045],
      ] as const)
        s.noise({ type: 'bandpass', f: f * rnd(0.9, 1.1), q: 0.8, at, a: 0.025, d: 0.4, pk });
    },
  },
  // 27 — before every anchor line: rising synth pulse into a brass + timpani hit (F major)
  news_sting: {
    cls: 'stinger', dur: 2.5, detune: 0, origin: 'fallback', label: 'news sting',
    fn: (s) => {
      const lp = s.filter('lowpass', 600, 2);
      lp.frequency.setValueAtTime(600, s.t0);
      lp.frequency.exponentialRampToValueAtTime(3200, s.t0 + 1.25);
      const seq = [N.D4, N.D4, N.D4, N.D4, N.F4, N.F4, N.G4, N.G4, N.A4, N.A4, N.C5, N.C5];
      seq.forEach((f, i) => s.tone({ type: 'sawtooth', f, at: i * 0.107, a: 0.005, d: 0.08, pk: 0.03 + 0.05 * (i / seq.length), to: lp }));
      const hall = s.reverb(1.6, 0.22);
      for (const f of [N.F3, N.A3, N.C4, N.F4]) s.brass(f, 1.3, 0.08, 0.35, { a: 0.02, r: 0.7, cutoff: 3200, to: hall });
      s.timpani(N.F2, 1.3, 0.5, 1.0, hall);
      s.noise({ type: 'highpass', f: 6000, at: 1.3, a: 0.001, d: 0.9, pk: 0.04, to: hall });
    },
  },
  // 30 — cash_register variant b (variant a is the mastered legacy cash_sale)
  cash_register_b: {
    cls: 'economy', dur: 1.2, detune: 30, origin: 'fallback', label: 'cash register (b)',
    fn: (s) => cashRegister(s, 1500, 0.18),
  },
  // 30 — cash_register variant c
  cash_register_c: {
    cls: 'economy', dur: 1.2, detune: 30, origin: 'fallback', label: 'cash register (c)',
    fn: (s) => cashRegister(s, 1660, 0.22),
  },
  // 31 — dividends, firstSale layer: a handful of coins settling on a counter
  coins_small: {
    cls: 'economy', dur: 0.8, detune: 0, origin: 'fallback', label: 'coins (small)',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 5000, q: 1, a: 0.001, d: 0.03, pk: 0.05 });
      let at = 0;
      let k = 1;
      for (let i = 0; i < 9; i++) {
        tink(s, at, rnd(2500, 4600), 0.06 * k);
        at += 0.09 * 0.8 ** i + rnd(0, 0.02);
        k *= 0.82;
      }
    },
  },
  // 32 — record month, IPO: a coin shower into a metal tray
  coins_large: {
    cls: 'economy', dur: 1.8, detune: 0, origin: 'fallback', label: 'coin shower',
    fn: (s) => {
      for (let i = 0; i < 42; i++) {
        const x = Math.random();
        const at = 1.35 * (x < 0.5 ? Math.sqrt(x / 2) : 1 - Math.sqrt((1 - x) / 2)); // triangular density
        tink(s, at, rnd(2200, 5600), rnd(0.02, 0.05));
      }
      s.bell(880, 0.02, 0.012, 1.3);
      s.noise({ type: 'bandpass', f: 6000, q: 0.8, a: 0.3, d: 1.2, pk: 0.015 });
    },
  },
  // 37 — loan documents; patents (rate 0.85 + confirm @180 ms via the router)
  stamp: {
    cls: 'economy', dur: 0.6, detune: 20, origin: 'fallback', label: 'stamp',
    fn: (s) => stamp(s),
  },
  // 38 — UX §8 #27: stamp, then a bank-note counter riffles the bills
  loan_approved: {
    cls: 'economy', dur: 1.6, detune: 0, origin: 'fallback', label: 'loan approved',
    fn: (s) => {
      stamp(s);
      const t0 = 0.28;
      for (let i = 0; i < 24; i++) {
        s.noise({ type: 'bandpass', f: 3000, q: 2.5, at: t0 + i / 28, a: 0.0008, d: 0.012, pk: 0.05 * (0.6 + 0.4 * Math.sin((Math.PI * i) / 24)) });
      }
      const whir = s.filter('bandpass', 400, 2);
      s.tone({ type: 'sawtooth', f: 90, at: t0 - 0.05, a: 0.05, d: 0.95, pk: 0.04, to: whir });
      s.tone({ f: 140, f2: 100, at: t0 + 0.9, a: 0.001, d: 0.06, pk: 0.08 });
    },
  },
  // 39 — IPO (UX §8 #30): the exchange's opening bell, struck continuously for two seconds
  ipo_bell: {
    cls: 'stinger', dur: 3.2, detune: 0, origin: 'fallback', label: 'stock bell',
    fn: (s) => {
      const hall = s.reverb(2.4, 0.3);
      const env = new GainNode(s.c, { gain: 0 });
      ahr(env.gain, s.t0, 0.16, 0.01, 2.0, 1.0);
      env.connect(hall);
      const strikes = striker(s, 14, 0.7, s.t0, 2.2);
      strikes.connect(env);
      const f0 = 523.25; // C5 — dominant of F major
      for (const [m, g] of [
        [1, 1],
        [2.76, 0.45],
        [5.4, 0.22],
        [8.93, 0.1],
      ] as const) {
        const o = new OscillatorNode(s.c, { frequency: f0 * m });
        const og = new GainNode(s.c, { gain: g });
        o.connect(og).connect(strikes);
        o.start(s.t0);
        o.stop(s.t0 + 3.2);
      }
      s.hold(3.2);
    },
  },
  // 40 — quarter end: a heavy ledger closes, pages settle
  quarter_close: {
    cls: 'economy', dur: 1.0, detune: 20, origin: 'fallback', label: 'ledger close',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 1200, f2: 600, sweep: 0.15, q: 1, a: 0.05, d: 0.12, pk: 0.05 });
      s.tone({ f: 95, f2: 60, at: 0.15, a: 0.001, d: 0.2, pk: 0.3 });
      s.noise({ type: 'lowpass', f: 500, at: 0.15, a: 0.001, d: 0.1, pk: 0.25 });
      for (let i = 0; i < 4; i++) s.noise({ type: 'bandpass', f: 3000, q: 1, at: 0.22 + i * rnd(0.06, 0.1), a: 0.005, d: 0.05, pk: 0.02 });
    },
  },
  // 41 — annual tax: an envelope torn open, a letter unfolded
  tax_paid: {
    cls: 'economy', dur: 1.2, detune: 20, origin: 'fallback', label: 'envelope tear',
    fn: (s) => {
      let at = 0;
      for (let i = 0; i < 18; i++) {
        s.noise({ type: 'bandpass', f: rnd(2000, 4000), q: 1.5, at, a: 0.001, d: rnd(0.008, 0.015), pk: rnd(0.05, 0.12) });
        at += rnd(0.01, 0.025);
      }
      for (let i = 0; i < 3; i++) s.noise({ type: 'bandpass', f: 1500, q: 0.8, at: 0.55 + i * 0.16, a: 0.02, d: 0.12, pk: 0.05 });
    },
  },
  // 43 — undercut (UX §8 #16): two steel blades clash once
  price_war: {
    cls: 'alert', dur: 0.8, detune: 30, origin: 'fallback', label: 'blade clash',
    fn: (s) => {
      s.noise({ type: 'highpass', f: 3000, a: 0.0005, d: 0.025, pk: 0.25 });
      s.fm(2350, 1.414, 4, 0, 0.08, 0.7);
      s.tone({ f: 3127, a: 0.0008, d: 0.5, pk: 0.05 });
      s.tone({ f: 3139, a: 0.0008, d: 0.5, pk: 0.04 });
      s.tone({ f: 4890, a: 0.0008, d: 0.35, pk: 0.04 });
      s.tone({ f: N.G6, a: 0.0008, d: 0.6, pk: 0.04 });
    },
  },
  // 46 — brand milestones (UX §8 #20): billboard panels flip, then a neon sign buzzes on
  brand_up: {
    cls: 'event', dur: 1.5, detune: 0, origin: 'fallback', label: 'billboard flip + neon',
    fn: (s) => {
      for (let i = 0; i < 6; i++) {
        const at = i * 0.06;
        const pk = i === 5 ? 0.14 : 0.09;
        s.noise({ type: 'bandpass', f: 1600, q: 3, at, a: 0.0015, d: 0.025, pk });
        s.tone({ f: 300, at, a: 0.0015, d: 0.04, pk: pk * 0.5 });
      }
      const buzz = s.filter('lowpass', 4000, 0.7);
      const buzzBp = s.filter('bandpass', 2400, 1.2, buzz);
      const hum = s.filter('lowpass', 400, 0.7);
      const flick = new GainNode(s.c, { gain: 0 });
      flick.connect(buzzBp);
      flick.connect(hum);
      const t = s.t0 + 0.45;
      for (const [dt, v] of [
        [0, 0.06],
        [0.04, 0],
        [0.09, 0.06],
        [0.12, 0],
        [0.16, 0.07],
      ] as const)
        flick.gain.setValueAtTime(v, t + dt);
      flick.gain.setValueAtTime(0.07, t + 0.85);
      flick.gain.linearRampToValueAtTime(0, t + 1.0);
      const o = new OscillatorNode(s.c, { type: 'sawtooth', frequency: 120 });
      o.connect(flick);
      o.start(t);
      o.stop(t + 1.02);
      s.bell(N.C7, 0.62, 0.012, 0.5);
      s.hold(1.5);
    },
  },
  // 51 — random, per construction site
  crane_winch: {
    cls: 'world', dur: 4.0, detune: 30, origin: 'fallback', label: 'crane winch',
    fn: (s) => {
      const bp = s.filter('bandpass', 900, 3);
      const o = new OscillatorNode(s.c, { type: 'sawtooth', frequency: 180 });
      o.frequency.setValueAtTime(180, s.t0);
      o.frequency.linearRampToValueAtTime(240, s.t0 + 3.0);
      const g = new GainNode(s.c, { gain: 0 });
      ahr(g.gain, s.t0, 0.08, 0.3, 2.6, 0.3);
      o.connect(g).connect(bp);
      o.start(s.t0);
      o.stop(s.t0 + 3.4);
      s.bell(1240, 3.3, 0.06, 0.4);
      s.bell(1650, 3.33, 0.04, 0.3);
      s.noise({ type: 'bandpass', f: 2500, q: 2, at: 3.3, a: 0.001, d: 0.03, pk: 0.1 });
      s.hold(4.0);
    },
  },
  // 52 — construction completed: scissors snip, polite applause, chime arpeggio (the PROC layer)
  ribbon_cut: {
    cls: 'event', dur: 2.0, detune: 0, origin: 'fallback', label: 'ribbon cut',
    fn: (s) => {
      for (const at of [0, 0.03]) s.noise({ type: 'highpass', f: 5000, at, a: 0.0005, d: 0.006, pk: 0.3 });
      s.fm(4200, 1.7, 2, 0, 0.03, 0.08);
      for (let i = 0; i < 60; i++) {
        const at = 0.15 + 1.55 * Math.random() ** 1.3; // dense at first, thinning out
        clap(s, at, rnd(0.02, 0.05) * (1 - 0.5 * ((at - 0.15) / 1.55)));
      }
      const rv = s.reverb(1.2, 0.15);
      [N.F5, N.A5, N.C6, N.F6].forEach((f, i) => s.mallet(f, 0.05 + i * 0.08, 0.1, 0.26, rv));
    },
  },
  // 54 — UX §8 #36: walls crumble, rubble falls, dust settles
  demolish: {
    cls: 'event', dur: 2.5, detune: 20, origin: 'fallback', label: 'demolish',
    fn: (s) => {
      s.noise({ type: 'bandpass', f: 1200, q: 0.8, a: 0.001, d: 0.15, pk: 0.4 });
      s.tone({ f: 70, f2: 40, a: 0.002, d: 0.6, pk: 0.4 });
      s.noise({ type: 'lowpass', f: 250, f2: 120, sweep: 2, q: 0.7, at: 0.05, a: 0.1, d: 2.0, pk: 0.3, brown: true });
      for (let i = 0; i < 26; i++) {
        const at = 0.2 + 1.8 * Math.random() ** 1.4;
        s.noise({ type: 'bandpass', f: rnd(800, 3500), q: 2, at, a: 0.001, d: rnd(0.02, 0.06), pk: 0.12 * (1 - at / 2.2) });
      }
      s.noise({ type: 'highpass', f: 4000, at: 0.6, a: 0.4, d: 1.2, pk: 0.02 });
    },
  },
  // 58 — replaces defeat.mp3: low strings swell into a soft minor piano line resolving downward
  defeat_sting: {
    cls: 'stinger', dur: 4.2, detune: 0, origin: 'fallback', label: 'defeat sting',
    fn: (s) => {
      const hall = s.reverb(2.2, 0.25);
      for (const f of [N.D3, N.F3, N.A3]) s.pad(f, 0, 0.06, 1.0, { a: 0.8, r: 1.2, cutoff: 900, to: hall });
      s.pad(N.D2, 0, 0.05, 1.2, { a: 0.9, r: 1.3, cutoff: 500, to: hall });
      s.piano(N.A4, 1.4, 0.07, 1.2, hall);
      s.piano(N.F4, 1.75, 0.065, 1.2, hall);
      s.piano(N.D4, 2.1, 0.065, 1.6, hall);
      for (const f of [N.D3, N.A3]) s.piano(f, 2.5, 0.05, 1.6, hall);
    },
  },
  // 59 — Poisson (§4.8): a single honk / two quick beeps / one long honk
  car_horn: {
    cls: 'world', dur: 1.0, detune: 40, origin: 'fallback', label: 'car horn',
    fn: (s, p) => {
      const out = s.reverb(0.6, 0.2);
      const lp = s.filter('lowpass', 2200, 0.7, out);
      const v = p.variant ?? Math.floor(Math.random() * 3);
      if (v === 1) {
        horn(s, 0, 0.12, 0.05, lp);
        horn(s, 0.2, 0.12, 0.05, lp);
      } else horn(s, 0, v === 2 ? 0.9 : 0.35, 0.05, lp);
    },
  },
  // 62 — factories; ×2 when starved
  factory_hiss: {
    cls: 'world', dur: 1.5, detune: 50, origin: 'fallback', label: 'steam hiss',
    fn: (s) => {
      const presence = s.filter('peaking', 5000, 0.7, undefined, 4);
      s.noise({ type: 'highpass', f: 2500, a: 0.03, d: 1.3, pk: 0.2, to: presence });
      s.tone({ f: 160, a: 0.001, d: 0.05, pk: 0.1 });
    },
  },
  // 63 — coastal cities only: one deep distant blast across the harbour
  ship_horn: {
    cls: 'world', dur: 4.6, detune: 30, origin: 'fallback', label: 'ship horn',
    fn: (s) => {
      const hall = s.reverb(2.5, 0.35);
      const lp = s.filter('lowpass', 650, 1, hall);
      for (const [f, g] of [
        [N.F2, 0.09],
        [N.F2 * 2.003, 0.05],
        [N.F2 * 0.998, 0.06],
      ] as const)
        s.brass(f, 0, g, 2.6, { a: 0.25, r: 0.9, cutoff: 900, voices: 2, to: lp });
    },
  },
  // 64 — mostly at night: a wailing siren far across the city
  siren_distant: {
    cls: 'world', dur: 6.0, detune: 0, origin: 'fallback', label: 'distant siren',
    fn: (s) => {
      const hall = s.reverb(2.0, 0.4);
      const lp = s.filter('lowpass', 1800, 0.7, hall);
      const o = new OscillatorNode(s.c, { type: 'triangle', frequency: 900 });
      const lfo = new OscillatorNode(s.c, { frequency: 0.4 });
      const depth = new GainNode(s.c, { gain: 300 });
      lfo.connect(depth).connect(o.frequency);
      const g = new GainNode(s.c, { gain: 0 });
      g.gain.setValueAtTime(0, s.t0);
      g.gain.linearRampToValueAtTime(0.05, s.t0 + 1.5);
      g.gain.setValueAtTime(0.05, s.t0 + 4.5);
      g.gain.linearRampToValueAtTime(0, s.t0 + 6.0);
      o.connect(g).connect(lp);
      for (const n of [o, lfo]) {
        n.start(s.t0);
        n.stop(s.t0 + 6.0);
      }
      s.hold(6.0);
    },
  },
  // 66 — only with weather: distant rolling thunder (a structured roll with small random jitter)
  thunder: {
    cls: 'world', dur: 6.0, detune: 0, origin: 'fallback', label: 'thunder',
    fn: (s) => {
      // the body: one slow swell of low rumble — sustained energy keeps the crest factor down
      const body = new AudioBufferSourceNode(s.c, { buffer: brownBuffer(s.c), loop: true });
      const lp = new BiquadFilterNode(s.c, { type: 'lowpass', frequency: rnd(170, 230), Q: 0.6 });
      const g = new GainNode(s.c, { gain: 0 });
      ahr(g.gain, s.t0, 0.13, 0.5, 1.3, 3.4);
      body.connect(lp).connect(g).connect(s.out);
      body.start(s.t0, rnd(0, 2));
      body.stop(s.t0 + 6.0);
      // rolls on top of it, decaying across the sky (small random jitter)
      const roll: [number, number, number][] = [
        [0, 0.16, 2.4],
        [0.45, 0.13, 2.2],
        [1.1, 0.11, 2.6],
        [1.9, 0.08, 2.4],
        [2.8, 0.06, 2.6],
      ];
      for (const [at, pk, d] of roll)
        s.noise({ type: 'lowpass', f: rnd(140, 260), q: 0.7, at: Math.max(0, at + rnd(-0.1, 0.1)), a: rnd(0.25, 0.45), d, pk: pk * rnd(0.9, 1.1), brown: true });
      s.noise({ type: 'bandpass', f: 900, q: 0.8, at: 0.05, a: 0.05, d: 0.6, pk: 0.04, brown: true });
      s.hold(6.0);
    },
  },
};
