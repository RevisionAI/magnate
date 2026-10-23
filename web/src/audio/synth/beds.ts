// Procedural ambience beds (audio-plan §6.3: 12 beds) and positional loops (14) that stand in for the
// GENERATE `loop:true` assets until they exist. Each builder schedules a texture for `seconds` into an
// OfflineAudioContext; render.ts bakes the loop seam and normalises loudness (beds −26 LUFS-I stereo,
// positional loops −24 LUFS-I mono), so swapping in a generated file later changes nothing else.

import { NOTE, Synth, brownBuffer, noiseBuffer } from './primitives';
import type { Builder } from './render';

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

interface NoiseLayer {
  type: BiquadFilterType;
  f: number;
  q?: number;
  gain: number;
  brown?: boolean;
  /** Amplitude LFO (rate Hz, depth 0–1). */
  lfo?: [number, number];
  /** Second, slower amplitude LFO for irregular swells. */
  lfo2?: [number, number];
  /** Filter-frequency LFO (rate Hz, depth Hz). */
  sweep?: [number, number];
  pan?: number;
}

function noiseLayer(c: BaseAudioContext, out: AudioNode, seconds: number, o: NoiseLayer): void {
  const buffer = o.brown ? brownBuffer(c, seconds + 2) : noiseBuffer(c, seconds + 2);
  const src = new AudioBufferSourceNode(c, { buffer, loop: true });
  const flt = new BiquadFilterNode(c, { type: o.type, frequency: o.f, Q: o.q ?? 0.707 });
  const g = new GainNode(c, { gain: o.gain });
  const nodes: AudioScheduledSourceNode[] = [src];
  const mod = (p: AudioParam, [rate, depth]: [number, number], scale: number) => {
    const lfo = new OscillatorNode(c, { frequency: rate });
    const amt = new GainNode(c, { gain: depth * scale });
    lfo.connect(amt).connect(p);
    nodes.push(lfo);
  };
  if (o.lfo) mod(g.gain, o.lfo, o.gain);
  if (o.lfo2) mod(g.gain, o.lfo2, o.gain);
  if (o.sweep) mod(flt.frequency, o.sweep, 1);
  let tail: AudioNode = g;
  if (o.pan !== undefined) {
    const p = new StereoPannerNode(c, { pan: o.pan });
    g.connect(p);
    tail = p;
  }
  src.connect(flt).connect(g);
  tail.connect(out);
  src.start(0, Math.random() * 1.5);
  src.stop(seconds);
  for (const n of nodes) {
    if (n === src) continue;
    n.start(0);
    n.stop(seconds);
  }
}

function hum(c: BaseAudioContext, out: AudioNode, seconds: number, f: number, partials: number[], gain: number, lp = 600): void {
  const flt = new BiquadFilterNode(c, { type: 'lowpass', frequency: lp });
  flt.connect(out);
  partials.forEach((g, i) => {
    const o = new OscillatorNode(c, { frequency: f * (i + 1) });
    const og = new GainNode(c, { gain: gain * g });
    o.connect(og).connect(flt);
    o.start(0);
    o.stop(seconds);
  });
}

/** Pulse engine (diesel/tractor): a square firing pulse plus pulsed noise, low-passed. */
function engine(c: BaseAudioContext, out: AudioNode, seconds: number, rate: number, gain: number, lp = 260): void {
  const flt = new BiquadFilterNode(c, { type: 'lowpass', frequency: lp, Q: 0.9 });
  flt.connect(out);
  const sq = new OscillatorNode(c, { type: 'square', frequency: rate });
  const sg = new GainNode(c, { gain: gain * 0.5 });
  const wobble = new OscillatorNode(c, { frequency: 0.3 });
  const wobAmt = new GainNode(c, { gain: rate * 0.04 });
  wobble.connect(wobAmt).connect(sq.frequency);
  sq.connect(sg).connect(flt);
  const nz = new AudioBufferSourceNode(c, { buffer: noiseBuffer(c), loop: true });
  const nf = new BiquadFilterNode(c, { type: 'lowpass', frequency: 500 });
  const ng = new GainNode(c, { gain: gain * 0.5 });
  const am = new OscillatorNode(c, { type: 'square', frequency: rate });
  const amAmt = new GainNode(c, { gain: gain * 0.45 });
  am.connect(amAmt).connect(ng.gain);
  nz.connect(nf).connect(ng).connect(flt);
  for (const n of [sq, wobble, nz, am]) {
    n.start(0);
    n.stop(seconds);
  }
}

/** A car passing: filtered noise swell with a stereo sweep and tyre hiss. */
function carPass(c: BaseAudioContext, out: AudioNode, at: number, dur: number, gain: number, dir: 1 | -1): void {
  const pan = new StereoPannerNode(c, { pan: -0.9 * dir });
  pan.pan.setValueAtTime(-0.9 * dir, at);
  pan.pan.linearRampToValueAtTime(0.9 * dir, at + dur);
  pan.connect(out);
  const g = new GainNode(c, { gain: 0 });
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + dur * 0.5);
  g.gain.linearRampToValueAtTime(0, at + dur);
  g.connect(pan);
  const body = new AudioBufferSourceNode(c, { buffer: brownBuffer(c), loop: true });
  const bf = new BiquadFilterNode(c, { type: 'bandpass', frequency: rnd(350, 700), Q: 0.8 });
  bf.frequency.setValueAtTime(bf.frequency.value * 1.15, at);
  bf.frequency.linearRampToValueAtTime(bf.frequency.value * 0.85, at + dur);
  body.connect(bf).connect(g);
  const hiss = new AudioBufferSourceNode(c, { buffer: noiseBuffer(c), loop: true });
  const hf = new BiquadFilterNode(c, { type: 'bandpass', frequency: 2500, Q: 0.6 });
  const hg = new GainNode(c, { gain: 0.08 });
  hiss.connect(hf).connect(hg).connect(g);
  for (const n of [body, hiss]) {
    n.start(at, Math.random());
    n.stop(at + dur);
  }
}

/** Songbird call: a run of fast up/down chirps. */
function birdCall(c: BaseAudioContext, out: AudioNode, at: number, gain: number): void {
  const pan = new StereoPannerNode(c, { pan: rnd(-0.9, 0.9) });
  pan.connect(out);
  const base = rnd(2600, 5200);
  const n = 3 + Math.floor(Math.random() * 6);
  let t = at;
  for (let i = 0; i < n; i++) {
    const o = new OscillatorNode(c, { frequency: base });
    const up = Math.random() < 0.6;
    o.frequency.setValueAtTime(base * (up ? 0.85 : 1.25), t);
    o.frequency.exponentialRampToValueAtTime(base * (up ? 1.3 : 0.8), t + 0.045);
    const g = new GainNode(c, { gain: 0 });
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(pan);
    o.start(t);
    o.stop(t + 0.07);
    t += rnd(0.07, 0.14);
  }
}

/** Cricket: a 4–5 kHz carrier gated in triple pulses. */
function cricket(c: BaseAudioContext, out: AudioNode, seconds: number, gain: number): void {
  const pan = new StereoPannerNode(c, { pan: rnd(-0.8, 0.8) });
  pan.connect(out);
  const o = new OscillatorNode(c, { frequency: rnd(4200, 5000) });
  const g = new GainNode(c, { gain: 0 });
  o.connect(g).connect(pan);
  const period = rnd(0.45, 0.7);
  for (let t = rnd(0, period); t < seconds - 0.12; t += period * rnd(0.95, 1.05)) {
    for (let k = 0; k < 3; k++) {
      const p = t + k * 0.03;
      g.gain.setValueAtTime(0, p);
      g.gain.linearRampToValueAtTime(gain, p + 0.004);
      g.gain.linearRampToValueAtTime(0, p + 0.02);
    }
  }
  o.start(0);
  o.stop(seconds);
}

/** Seagull "kee-ow". */
function gull(c: BaseAudioContext, out: AudioNode, at: number, gain: number): void {
  const pan = new StereoPannerNode(c, { pan: rnd(-0.8, 0.8) });
  pan.connect(out);
  const o = new OscillatorNode(c, { type: 'triangle', frequency: 1200 });
  o.frequency.setValueAtTime(1200, at);
  o.frequency.exponentialRampToValueAtTime(2100, at + 0.12);
  o.frequency.exponentialRampToValueAtTime(900, at + 0.55);
  const bp = new BiquadFilterNode(c, { type: 'bandpass', frequency: 1800, Q: 1.5 });
  const g = new GainNode(c, { gain: 0 });
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.05);
  g.gain.setValueAtTime(gain, at + 0.4);
  g.gain.linearRampToValueAtTime(0, at + 0.6);
  o.connect(bp).connect(g).connect(pan);
  o.start(at);
  o.stop(at + 0.62);
}

/** Indistinct talker: noise through two formants with syllable-rate gating. */
function talker(c: BaseAudioContext, out: AudioNode, seconds: number, gain: number): void {
  const pan = new StereoPannerNode(c, { pan: rnd(-0.85, 0.85) });
  pan.connect(out);
  const src = new AudioBufferSourceNode(c, { buffer: noiseBuffer(c), loop: true });
  const g = new GainNode(c, { gain: 0 });
  const f1 = new BiquadFilterNode(c, { type: 'bandpass', frequency: rnd(400, 700), Q: 4 });
  const f2 = new BiquadFilterNode(c, { type: 'bandpass', frequency: rnd(1200, 2000), Q: 5 });
  src.connect(f1).connect(g);
  src.connect(f2).connect(g);
  g.connect(pan);
  let t = rnd(0, 1);
  while (t < seconds - 0.3) {
    const phrase = rnd(0.8, 2.4);
    const end = Math.min(seconds - 0.2, t + phrase);
    while (t < end) {
      const syl = rnd(0.09, 0.2);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain * rnd(0.5, 1), t + syl * 0.3);
      g.gain.linearRampToValueAtTime(0, t + syl);
      f1.frequency.setValueAtTime(rnd(350, 800), t);
      t += syl + rnd(0.01, 0.05);
    }
    t += rnd(0.3, 1.2);
  }
  src.start(0, Math.random());
  src.stop(seconds);
}

/** Impact helper inside textures (press, pallets, hammer hits). */
function knock(s: Synth, at: number, f: number, pk: number, noiseF = 900): void {
  s.tone({ f: f * 1.4, f2: f, at, a: 0.001, d: 0.12, pk });
  s.noise({ type: 'lowpass', f: noiseF, at, a: 0.001, d: 0.06, pk: pk * 0.7 });
}

export interface LoopDef {
  build: Builder;
  seconds: number;
  channels: 1 | 2;
  /** Target integrated loudness (beds −26, positional loops −24). */
  lufs: number;
  label: string;
}

// ------------------------------------------------------------------------------------- beds

export const BEDS: Record<string, LoopDef> = {
  amb_city_day: {
    seconds: 30, channels: 2, lufs: -26, label: 'city (day)',
    build: (c, out, sec) => {
      noiseLayer(c, out, sec, { type: 'lowpass', f: 380, gain: 0.5, brown: true, lfo: [0.07, 0.2] });
      noiseLayer(c, out, sec, { type: 'bandpass', f: 900, q: 0.5, gain: 0.05, lfo: [0.11, 0.3], lfo2: [0.023, 0.3] });
      noiseLayer(c, out, sec, { type: 'bandpass', f: 520, q: 0.9, gain: 0.025, lfo: [5.3, 0.5], lfo2: [0.17, 0.4] }); // murmur
      const far = new BiquadFilterNode(c, { type: 'lowpass', frequency: 1200 });
      far.connect(out);
      const s = new Synth(c, far, 0, 0);
      for (const at of [rnd(4, 10), rnd(17, 24)]) {
        for (const f of [415, 517]) s.tone({ type: 'square', f, at, a: 0.01, d: rnd(0.25, 0.5), pk: 0.012 });
      }
    },
  },
  amb_city_night: {
    seconds: 30, channels: 2, lufs: -26, label: 'city (night)',
    build: (c, out, sec) => {
      noiseLayer(c, out, sec, { type: 'lowpass', f: 280, gain: 0.4, brown: true, lfo: [0.05, 0.25] });
      hum(c, out, sec, 120, [1, 0.35, 0.12], 0.02, 500);
      for (const at of [rnd(2, 8), rnd(13, 19), rnd(22, 25)]) carPass(c, out, at, rnd(4, 6), 0.25, Math.random() < 0.5 ? 1 : -1);
    },
  },
  amb_traffic_street: {
    seconds: 20, channels: 2, lufs: -26, label: 'street traffic',
    build: (c, out, sec) => {
      noiseLayer(c, out, sec, { type: 'lowpass', f: 300, gain: 0.35, brown: true, lfo: [0.09, 0.2] });
      let t = rnd(0, 1);
      while (t < sec - 3) {
        carPass(c, out, t, rnd(2.2, 3.8), rnd(0.35, 0.6), Math.random() < 0.5 ? 1 : -1);
        t += rnd(1.2, 3.2);
      }
    },
  },
  amb_crowd: {
    seconds: 20, channels: 2, lufs: -26, label: 'crowd',
    build: (c, out, sec) => {
      for (let i = 0; i < 12; i++) talker(c, out, sec, rnd(0.05, 0.12));
      noiseLayer(c, out, sec, { type: 'bandpass', f: 600, q: 0.6, gain: 0.03, lfo: [0.2, 0.3] });
      const s = new Synth(c, out, 0, 0);
      for (let t = rnd(0, 0.5); t < sec - 0.2; t += rnd(0.25, 0.6)) {
        s.noise({ type: 'bandpass', f: rnd(1200, 2000), q: 2, at: t, a: 0.001, d: 0.02, pk: rnd(0.01, 0.025) });
      }
      s.bell(NOTE.E6, rnd(5, 12), 0.006);
    },
  },
  amb_birds: {
    seconds: 20, channels: 2, lufs: -26, label: 'birds',
    build: (c, out, sec) => {
      noiseLayer(c, out, sec, { type: 'lowpass', f: 800, gain: 0.04, lfo: [0.13, 0.4] });
      let t = rnd(0, 0.8);
      while (t < sec - 1.2) {
        birdCall(c, out, t, rnd(0.04, 0.09));
        t += rnd(0.6, 2.0);
      }
    },
  },
  amb_insects_night: {
    seconds: 20, channels: 2, lufs: -26, label: 'insects (night)',
    build: (c, out, sec) => {
      for (let i = 0; i < 6; i++) cricket(c, out, sec, rnd(0.02, 0.05));
      noiseLayer(c, out, sec, { type: 'bandpass', f: 6200, q: 8, gain: 0.05, lfo: [0.3, 0.5] });
      noiseLayer(c, out, sec, { type: 'lowpass', f: 250, gain: 0.08, brown: true });
    },
  },
  amb_wind_high: {
    seconds: 20, channels: 2, lufs: -26, label: 'high wind',
    build: (c, out, sec) => {
      noiseLayer(c, out, sec, { type: 'bandpass', f: 520, q: 0.5, gain: 0.5, lfo: [0.15, 0.35], lfo2: [0.07, 0.3], sweep: [0.1, 180] });
      noiseLayer(c, out, sec, { type: 'bandpass', f: 1300, q: 0.6, gain: 0.12, lfo: [0.21, 0.5], sweep: [0.05, 300] });
    },
  },
  amb_rain_light: {
    seconds: 20, channels: 2, lufs: -26, label: 'light rain',
    build: (c, out, sec) => {
      noiseLayer(c, out, sec, { type: 'bandpass', f: 4500, q: 0.4, gain: 0.25 });
      const s = new Synth(c, out, 0, 0);
      for (let t = 0; t < sec - 0.05; t += rnd(0.02, 0.09)) s.tone({ f: rnd(2000, 5200), at: t, a: 0.0008, d: 0.012, pk: rnd(0.005, 0.02) });
    },
  },
  amb_rain_heavy: {
    seconds: 20, channels: 2, lufs: -26, label: 'heavy rain',
    build: (c, out, sec) => {
      noiseLayer(c, out, sec, { type: 'lowpass', f: 9000, gain: 0.35 });
      noiseLayer(c, out, sec, { type: 'lowpass', f: 400, gain: 0.4, brown: true, lfo: [0.12, 0.2] });
      noiseLayer(c, out, sec, { type: 'bandpass', f: 700, q: 1, gain: 0.12, lfo: [0.4, 0.4], lfo2: [0.09, 0.3] });
    },
  },
  amb_harbour: {
    seconds: 30, channels: 2, lufs: -26, label: 'harbour',
    build: (c, out, sec) => {
      noiseLayer(c, out, sec, { type: 'lowpass', f: 480, gain: 0.45, brown: true, lfo: [0.25, 0.45], lfo2: [0.08, 0.3] });
      const s = new Synth(c, out, 0, 0);
      for (let t = rnd(0, 2); t < sec - 0.3; t += rnd(1.8, 4.2)) s.noise({ type: 'bandpass', f: rnd(700, 1100), q: 1, at: t, a: 0.03, d: 0.25, pk: 0.05 });
      for (const at of [rnd(3, 9), rnd(14, 20), rnd(23, 27)]) gull(c, out, at, 0.035);
      hum(c, out, sec, 45, [1, 0.5, 0.2], 0.05, 200);
      s.bell(310, rnd(10, 25), 0.01, 0.6);
    },
  },
  amb_river: {
    seconds: 20, channels: 2, lufs: -26, label: 'river',
    build: (c, out, sec) => {
      noiseLayer(c, out, sec, { type: 'bandpass', f: 800, q: 0.4, gain: 0.3, lfo: [0.17, 0.15], lfo2: [0.05, 0.15] });
      noiseLayer(c, out, sec, { type: 'lowpass', f: 300, gain: 0.3, brown: true, lfo: [0.11, 0.2] });
      const s = new Synth(c, out, 0, 0);
      for (let t = rnd(0, 0.5); t < sec - 0.1; t += rnd(0.15, 0.7)) s.tone({ f: rnd(300, 500), f2: rnd(700, 1100), at: t, a: 0.003, d: 0.04, pk: rnd(0.01, 0.025) });
    },
  },
  amb_industrial: {
    seconds: 20, channels: 2, lufs: -26, label: 'industrial district',
    build: (c, out, sec) => {
      hum(c, out, sec, 60, [0.6, 1, 0.4, 0.2], 0.06, 320);
      noiseLayer(c, out, sec, { type: 'bandpass', f: 420, q: 2, gain: 0.15, lfo: [8, 0.15] });
      noiseLayer(c, out, sec, { type: 'lowpass', f: 200, gain: 0.3, brown: true });
      const far = new BiquadFilterNode(c, { type: 'lowpass', frequency: 900 });
      far.connect(out);
      const s = new Synth(c, far, 0, 0);
      const rv = s.reverb(1.0, 0.4);
      for (let t = 0.3; t < sec - 0.3; t += 1.25) knock(new Synth(c, rv, 0, 0), t, 80, 0.25, 600);
    },
  },
};

// --------------------------------------------------------------------------- positional loops

export const LOOPS: Record<string, LoopDef> = {
  loop_factory: {
    seconds: 12, channels: 1, lufs: -24, label: 'factory',
    build: (c, out, sec) => {
      hum(c, out, sec, 50, [1, 0.7, 0.35, 0.2], 0.08, 420);
      noiseLayer(c, out, sec, { type: 'bandpass', f: 2500, q: 3, gain: 0.08, lfo: [12, 0.6] });
      const s = new Synth(c, out, 0, 0);
      for (let t = 0.4; t < sec - 0.3; t += 2.0) {
        s.noise({ type: 'highpass', f: 1500, at: t + 0.18, a: 0.005, d: 0.25, pk: 0.08 });
        knock(s, t, 90, 0.25, 700);
      }
    },
  },
  loop_mine: {
    seconds: 12, channels: 1, lufs: -24, label: 'mine',
    build: (c, out, sec) => {
      engine(c, out, sec, 28, 0.35, 260);
      noiseLayer(c, out, sec, { type: 'bandpass', f: 600, q: 1, gain: 0.25, brown: true, lfo: [3.1, 0.5], lfo2: [0.4, 0.3] });
      noiseLayer(c, out, sec, { type: 'lowpass', f: 150, gain: 0.3, brown: true });
      const s = new Synth(c, out, 0, 0);
      for (let t = rnd(0, 0.3); t < sec - 0.1; t += rnd(0.08, 0.3)) s.noise({ type: 'bandpass', f: rnd(900, 2400), q: 2, at: t, a: 0.001, d: 0.02, pk: rnd(0.02, 0.06) });
    },
  },
  loop_pumpjack: {
    seconds: 10, channels: 1, lufs: -24, label: 'pumpjack',
    build: (c, out, sec) => {
      hum(c, out, sec, 60, [1, 0.5], 0.05, 300);
      const s = new Synth(c, out, 0, 0);
      for (const at of [0.6, 5.6]) {
        const bp = s.filter('bandpass', 1200, 8);
        s.tone({ type: 'sawtooth', f: 180, f2: 120, at, a: 0.15, d: 0.8, pk: 0.12, to: bp });
        knock(s, at + 1.6, 70, 0.12, 400);
      }
    },
  },
  loop_farm: {
    seconds: 12, channels: 1, lufs: -24, label: 'farm',
    build: (c, out, sec) => {
      engine(c, out, sec, 22, 0.18, 200);
      noiseLayer(c, out, sec, { type: 'lowpass', f: 700, gain: 0.05, lfo: [0.15, 0.4] });
      const s = new Synth(c, out, 0, 0);
      const moo = s.filter('bandpass', 700, 2);
      s.tone({ type: 'sawtooth', f: 140, f2: 118, at: rnd(2, 7), a: 0.25, d: 1.3, pk: 0.06, to: moo });
      for (let t = rnd(0, 1); t < sec - 0.2; t += rnd(0.8, 2.2)) {
        for (let k = 0; k < 3; k++) s.noise({ type: 'bandpass', f: rnd(1000, 1500), q: 6, at: t + k * 0.09, a: 0.002, d: 0.04, pk: 0.05 });
      }
    },
  },
  loop_warehouse: {
    seconds: 12, channels: 1, lufs: -24, label: 'warehouse',
    build: (c, out, sec) => {
      noiseLayer(c, out, sec, { type: 'lowpass', f: 250, gain: 0.12, brown: true });
      const s = new Synth(c, out, 0, 0);
      s.tone({ f: 900, f2: 1150, at: 0.5, a: 0.3, d: 2.2, pk: 0.02 });
      s.tone({ f: 1150, f2: 880, at: 6.5, a: 0.3, d: 2.0, pk: 0.02 });
      for (const at of [3.2, 9.0]) {
        knock(s, at, 110, 0.2, 800);
        for (let k = 1; k < 4; k++) s.noise({ type: 'bandpass', f: 1800, q: 3, at: at + k * 0.05, a: 0.001, d: 0.02, pk: 0.05 / k });
      }
      const door = s.filter('bandpass', 1500, 1.2);
      const dg = new GainNode(c, { gain: 0 });
      const lfo = new OscillatorNode(c, { type: 'square', frequency: 30 });
      const amt = new GainNode(c, { gain: 0.04 });
      lfo.connect(amt).connect(dg.gain);
      dg.gain.setValueAtTime(0, 0);
      dg.gain.setValueAtTime(0.04, 4.5);
      dg.gain.setValueAtTime(0, 6.3);
      const nz = new AudioBufferSourceNode(c, { buffer: noiseBuffer(c), loop: true });
      nz.connect(dg).connect(door);
      for (const n of [lfo, nz]) {
        n.start(0);
        n.stop(sec);
      }
    },
  },
  loop_seaport: {
    seconds: 14, channels: 1, lufs: -24, label: 'seaport',
    build: (c, out, sec) => {
      engine(c, out, sec, 18, 0.2, 160);
      noiseLayer(c, out, sec, { type: 'lowpass', f: 420, gain: 0.25, brown: true, lfo: [0.3, 0.4] });
      const s = new Synth(c, out, 0, 0);
      const crane = s.filter('bandpass', 800, 2);
      s.tone({ type: 'sawtooth', f: 140, f2: 160, at: 1, a: 0.5, d: 5, pk: 0.04, to: crane });
      for (const at of [rnd(2, 5), rnd(8, 11)]) {
        s.bell(310, at, 0.06, 0.5);
        s.bell(733, at + 0.02, 0.03, 0.3);
        s.noise({ type: 'bandpass', f: 1200, q: 1.5, at, a: 0.001, d: 0.05, pk: 0.12 });
      }
      gull(c, out, rnd(6, 12), 0.04);
    },
  },
  loop_retail: {
    seconds: 10, channels: 1, lufs: -24, label: 'retail',
    build: (c, out, sec) => {
      for (let i = 0; i < 4; i++) talker(c, out, sec, rnd(0.04, 0.08));
      const s = new Synth(c, out, 0, 0);
      for (const at of [1.0, 6.0]) s.noise({ type: 'bandpass', f: 800, f2: 1100, sweep: 0.9, q: 1, at, a: 0.3, d: 0.7, pk: 0.05 });
      for (let t = rnd(0, 1); t < sec - 0.6; t += rnd(1.5, 3.5)) {
        for (let k = 0; k < 10; k++) s.noise({ type: 'bandpass', f: 2500, q: 2, at: t + k * 0.05, a: 0.001, d: 0.02, pk: rnd(0.01, 0.03) });
      }
    },
  },
  loop_lab: {
    seconds: 10, channels: 1, lufs: -24, label: 'R&D lab',
    build: (c, out, sec) => {
      hum(c, out, sec, 120, [1, 0.4, 0.15], 0.04, 900);
      noiseLayer(c, out, sec, { type: 'bandpass', f: 1200, q: 0.6, gain: 0.04 });
      noiseLayer(c, out, sec, { type: 'lowpass', f: 800, gain: 0.08 });
      const s = new Synth(c, out, 0, 0);
      for (const at of [1.3, 4.9, 8.1]) s.tone({ f: Math.random() < 0.5 ? 1800 : 2400, at, a: 0.002, d: 0.09, pk: 0.02 });
    },
  },
  loop_press: {
    seconds: 10, channels: 1, lufs: -24, label: 'printing press',
    build: (c, out, sec) => {
      noiseLayer(c, out, sec, { type: 'bandpass', f: 3000, q: 1, gain: 0.06, lfo: [16, 0.6] });
      const s = new Synth(c, out, 0, 0);
      for (let t = 0.1; t < sec - 0.2; t += 0.5) knock(s, t, 90, 0.18, 900);
    },
  },
  loop_broadcast: {
    seconds: 10, channels: 1, lufs: -24, label: 'broadcast station',
    build: (c, out, sec) => {
      hum(c, out, sec, 100, [1, 0.4, 0.2, 0.1], 0.05, 800);
      noiseLayer(c, out, sec, { type: 'bandpass', f: 400, q: 1, gain: 0.08 });
      noiseLayer(c, out, sec, { type: 'highpass', f: 3000, gain: 0.015, lfo: [7.3, 0.8] });
      const s = new Synth(c, out, 0, 0);
      for (let t = rnd(0, 0.5); t < sec - 0.05; t += rnd(0.2, 1.1)) s.noise({ type: 'highpass', f: 2500, at: t, a: 0.0005, d: 0.006, pk: rnd(0.01, 0.03) });
    },
  },
  'construct_loop.hammer': {
    seconds: 10, channels: 1, lufs: -24, label: 'construction: hammering',
    build: (c, out, sec) => {
      // site bed: distant generator + general site noise keep the crest factor sane for the hits
      engine(c, out, sec, 24, 0.12, 180);
      noiseLayer(c, out, sec, { type: 'bandpass', f: 700, q: 0.6, gain: 0.06, lfo: [0.3, 0.3] });
      for (const [pitch, start] of [
        [420, 0.2],
        [330, 0.9],
      ] as const) {
        const s = new Synth(c, out, 0, 0);
        let t = start;
        while (t < sec - 0.6) {
          const hits = 4 + Math.floor(Math.random() * 4);
          for (let k = 0; k < hits && t < sec - 0.2; k++) {
            s.noise({ type: 'bandpass', f: 1800, q: 2, at: t, a: 0.0015, d: 0.03, pk: 0.09 });
            s.tone({ f: pitch * 1.3, f2: pitch, at: t, a: 0.0015, d: 0.09, pk: 0.12 }); // wood body
            s.tone({ type: 'triangle', f: pitch * 0.5, at: t, a: 0.002, d: 0.12, pk: 0.06 }); // frame resonance
            s.tone({ f: 3200, at: t, a: 0.0008, d: 0.06, pk: 0.012 }); // nail ring
            t += rnd(0.38, 0.52);
          }
          t += rnd(1.0, 2.0);
        }
      }
    },
  },
  'construct_loop.mixer': {
    seconds: 10, channels: 1, lufs: -24, label: 'construction: cement mixer',
    build: (c, out, sec) => {
      engine(c, out, sec, 25, 0.25, 220);
      noiseLayer(c, out, sec, { type: 'bandpass', f: 300, q: 1, gain: 0.25, brown: true, lfo: [0.8, 0.4] });
      noiseLayer(c, out, sec, { type: 'bandpass', f: 2000, q: 1.5, gain: 0.05, lfo: [0.8, 0.8] });
    },
  },
  'construct_loop.crane': {
    seconds: 10, channels: 1, lufs: -24, label: 'construction: crane',
    build: (c, out, sec) => {
      const bp = new BiquadFilterNode(c, { type: 'bandpass', frequency: 700, Q: 2 });
      bp.connect(out);
      const o = new OscillatorNode(c, { type: 'sawtooth', frequency: 160 });
      const wob = new OscillatorNode(c, { frequency: 0.2 });
      const wa = new GainNode(c, { gain: 6 });
      wob.connect(wa).connect(o.frequency);
      const og = new GainNode(c, { gain: 0.05 });
      o.connect(og).connect(bp);
      for (const n of [o, wob]) {
        n.start(0);
        n.stop(sec);
      }
      noiseLayer(c, out, sec, { type: 'bandpass', f: 1500, q: 6, gain: 0.05, lfo: [6, 0.5] });
      const s = new Synth(c, out, 0, 0);
      for (const at of [rnd(1, 3), rnd(4, 6), rnd(7, 9)]) {
        s.bell(2400, at, 0.015, 0.25);
        s.bell(3100, at + 0.06, 0.01, 0.2);
      }
    },
  },
  truck_engine_loop: {
    seconds: 8, channels: 1, lufs: -24, label: 'delivery truck engine',
    build: (c, out, sec) => {
      engine(c, out, sec, 30, 0.4, 280);
      noiseLayer(c, out, sec, { type: 'lowpass', f: 150, gain: 0.3, brown: true, lfo: [0.25, 0.15] });
    },
  },
};
