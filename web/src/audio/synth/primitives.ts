// Procedural synthesis kit (audio-plan §6.1). A `Synth` is bound to one trigger: a context, an
// output node, a start time and a per-trigger detune; it tracks when its last node stops so the
// player can recycle the voice. Recipes (recipes.ts, fallbacks.ts, music.ts, beds.ts) are written
// against it in the §6.2 notation, with times in seconds:
//
//   S/T/Q/W(f)          sine / triangle / square / sawtooth        → s.tone({ type, f, ... })
//   a→b                 exponential glide over the whole note      → f, f2
//   env(a, d, pk)       exp attack to pk, then exp decay           → a, d, pk
//   N[type f Qq]        white noise through a biquad (f1→f2 sweep) → s.noise({ type, f, f2, sweep, q })
//   M(f, pk[, d])       mallet: partials 1/4/10                    → s.mallet(f, at, pk, d)
//   B(f, pk[, d])       bell: partials 1/2.76/5.40/8.93            → s.bell(f, at, pk, d)
//   FM(fc, r, i, d, pk) two-operator FM                            → s.fm(fc, r, i, at, pk, d)
//   @t                  start offset                               → at
//
// Works with any BaseAudioContext, so the same recipe renders live or into an OfflineAudioContext.

import { makeNoise, type NoiseKind } from './noise';

const FLOOR = 0.0001;

/** Exponential attack/decay envelope on an AudioParam (audio-plan §6.1 `env`). */
export function env(p: AudioParam, t: number, pk: number, a: number, d: number): void {
  const peak = Math.max(pk, FLOOR * 1.01);
  p.setValueAtTime(FLOOR, t);
  p.exponentialRampToValueAtTime(peak, t + Math.max(a, 0.0005));
  p.exponentialRampToValueAtTime(FLOOR, t + Math.max(a, 0.0005) + Math.max(d, 0.001));
  p.setValueAtTime(0, t + Math.max(a, 0.0005) + Math.max(d, 0.001) + 0.001);
}

/** Attack / hold / release envelope with linear-in-dB-ish curves (for sustained layers). */
export function ahr(p: AudioParam, t: number, pk: number, a: number, hold: number, r: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(pk, t + Math.max(a, 0.002));
  p.setValueAtTime(pk, t + Math.max(a, 0.002) + hold);
  p.setTargetAtTime(0, t + Math.max(a, 0.002) + hold, Math.max(r, 0.005) / 4);
}

// Noise. AudioBuffers are not tied to a context, so one buffer per sample rate serves every context:
// a city load renders a few dozen beds and loops, each in a fresh OfflineAudioContext, and generating
// (or even copying) megasamples of noise for each stalled the main thread (measured: ~650 ms of
// generation and ~150 ms of copies over a 12 s start-up). Renders call `installNoise` first with data
// made in the DSP worker (offthread.ts prepareNoise), so `noiseBuffer` / `brownBuffer` are cache hits;
// a miss (live SFX, tests) generates inline. Channels are decorrelated for stereo beds; a buffer grows
// to the longest request, so textures rendered for N seconds never hear the noise repeat.
const NOISE: Record<NoiseKind, Map<number, AudioBuffer>> = { white: new Map(), brown: new Map() };
const MIN_SECONDS: Record<NoiseKind, number> = { white: 2, brown: 4 };

/** Seconds a request for `minSeconds` should allocate (0 = cached; grows by ≥ 25 % to limit regenerations). */
export function noiseSecondsFor(kind: NoiseKind, rate: number, minSeconds: number): number {
  const have = NOISE[kind].get(rate)?.duration ?? 0;
  const want = Math.max(MIN_SECONDS[kind], minSeconds);
  return have >= want ? 0 : Math.max(want, 1.25 * have);
}

/**
 * Drop cached noise longer than `maxSeconds` (the long buffers only serve bed/loop renders, which
 * happen at city load; ≈ 17 MB at 32 kHz). Playing sources keep their own reference; the next render
 * regenerates in the worker.
 */
export function releaseNoise(maxSeconds: number): void {
  for (const cache of Object.values(NOISE)) for (const [rate, b] of cache) if (b.duration > maxSeconds) cache.delete(rate);
}

/** Cache pre-generated noise (two channels at `rate`) unless a longer buffer is already there. */
export function installNoise(kind: NoiseKind, rate: number, chans: Float32Array<ArrayBuffer>[]): void {
  const have = NOISE[kind].get(rate);
  const frames = chans[0]?.length ?? 0;
  if (have && have.length >= frames) return;
  const b = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, frames), sampleRate: rate });
  chans.forEach((d, ch) => b.copyToChannel(d, ch));
  NOISE[kind].set(rate, b);
}

function sharedNoise(kind: NoiseKind, rate: number, minSeconds: number): AudioBuffer {
  const seconds = noiseSecondsFor(kind, rate, minSeconds);
  if (seconds > 0) installNoise(kind, rate, makeNoise(kind, Math.round(rate * seconds)));
  return NOISE[kind].get(rate) as AudioBuffer;
}

/** White noise (stereo, decorrelated) at least `minSeconds` long, at the context's rate. */
export function noiseBuffer(c: BaseAudioContext, minSeconds = 2): AudioBuffer {
  return sharedNoise('white', c.sampleRate, minSeconds);
}

/** Brown-ish noise (rumbles, city hum; RMS-normalised) at least `minSeconds` long, at the context's rate. */
export function brownBuffer(c: BaseAudioContext, minSeconds = 4): AudioBuffer {
  return sharedNoise('brown', c.sampleRate, minSeconds);
}

/** Procedural decaying-noise impulse response for small rooms / outdoor tails. */
const IRS = new Map<string, AudioBuffer>(); // context-independent, keyed by rate and shape
export function noiseIR(c: BaseAudioContext, seconds: number, decay = 3, brightness = 1): AudioBuffer {
  const key = `${c.sampleRate}:${seconds}:${decay}:${brightness}`;
  let ir = IRS.get(key);
  if (!ir) {
    const n = Math.max(1, Math.round(seconds * c.sampleRate));
    ir = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: c.sampleRate });
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        const w = Math.random() * 2 - 1;
        lp += (w - lp) * Math.min(1, brightness * (1 - 0.85 * x)); // darker as it decays
        d[i] = lp * (1 - x) ** decay;
      }
    }
    IRS.set(key, ir);
  }
  return ir;
}

/**
 * Peak-guard transfer curve: the identity up to `knee` × ceiling, then a tanh shoulder that approaches
 * but never exceeds the ceiling. An odd point count keeps 0 → 0 exact, and linear interpolation is exact
 * in the identity region, so material below the knee passes bit-for-bit.
 */
const GUARD_CURVES = new Map<string, Float32Array<ArrayBuffer>>();
export function peakGuardCurve(ceilingDb: number, knee = 0.7, points = 8193): Float32Array<ArrayBuffer> {
  const key = `${ceilingDb}:${knee}:${points}`;
  let curve = GUARD_CURVES.get(key);
  if (!curve) {
    const ceiling = 10 ** (ceilingDb / 20);
    const k = knee * ceiling;
    const span = ceiling - k;
    curve = new Float32Array(points);
    for (let i = 0; i < points; i++) {
      const x = (2 * i) / (points - 1) - 1;
      const ax = Math.abs(x);
      curve[i] = Math.sign(x) * (ax <= k ? ax : k + span * Math.tanh((ax - k) / span));
    }
    GUARD_CURVES.set(key, curve);
  }
  return curve;
}

/**
 * Per-voice peak guard. Short noise-based transients have a random sample peak (a 2–5 dB spread from
 * trigger to trigger, measured), so a fixed trim cannot hold the class peak ceiling (audio-plan §2.3)
 * on every trigger; this soft shoulder does, and it leaves anything below the knee untouched.
 */
export function peakGuard(c: BaseAudioContext, ceilingDb: number): WaveShaperNode {
  return new WaveShaperNode(c, { curve: peakGuardCurve(ceilingDb), oversample: 'none' });
}

export interface ToneOpts {
  type?: OscillatorType;
  f: number;
  /** Glide target (exponential over attack + decay). */
  f2?: number;
  at?: number;
  a: number;
  d: number;
  pk: number;
  /** Extra detune in cents on top of the trigger detune. */
  cents?: number;
  to?: AudioNode;
  /** Opt out of the trigger detune (musical layers inside a non-musical sound). */
  fixedPitch?: boolean;
}

export interface NoiseOpts {
  at?: number;
  a: number;
  d: number;
  pk: number;
  type: BiquadFilterType;
  f: number;
  f2?: number;
  /** Sweep duration (defaults to the whole note). */
  sweep?: number;
  q?: number;
  /** Filter gain in dB for shelf / peaking types. */
  gain?: number;
  to?: AudioNode;
  brown?: boolean;
}

/** Per-trigger synthesis helper. */
export class Synth {
  /** Seconds after t0 at which the last scheduled node stops. */
  end = 0;
  /** Longest effect tail (delay / reverb) that rings on after the last node stops. */
  tail = 0;
  private readonly ratio: number;

  constructor(
    readonly c: BaseAudioContext,
    readonly out: AudioNode,
    readonly t0: number,
    readonly cents = 0,
  ) {
    this.ratio = 2 ** (cents / 1200);
  }

  private mark(sec: number): void {
    if (sec > this.end) this.end = sec;
  }

  /** Total voice duration in seconds: last node stop plus the longest effect tail. */
  get duration(): number {
    return this.end + this.tail;
  }

  tone(o: ToneOpts): OscillatorNode {
    const at = Math.max(0, o.at ?? 0); // offsets are relative to the trigger; never before it
    const t = this.t0 + at;
    const k = (o.fixedPitch ? 1 : this.ratio) * 2 ** ((o.cents ?? 0) / 1200);
    const osc = new OscillatorNode(this.c, { type: o.type ?? 'sine', frequency: o.f * k });
    if (o.f2) {
      osc.frequency.setValueAtTime(o.f * k, t);
      osc.frequency.exponentialRampToValueAtTime(o.f2 * k, t + o.a + o.d);
    }
    const g = new GainNode(this.c, { gain: 0 });
    env(g.gain, t, o.pk, o.a, o.d);
    osc.connect(g).connect(o.to ?? this.out);
    osc.start(t);
    osc.stop(t + o.a + o.d + 0.02);
    this.mark(at + o.a + o.d + 0.02);
    return osc;
  }

  noise(o: NoiseOpts): BiquadFilterNode {
    const at = Math.max(0, o.at ?? 0); // offsets are relative to the trigger; never before it
    const t = this.t0 + at;
    const src = new AudioBufferSourceNode(this.c, { buffer: o.brown ? brownBuffer(this.c) : noiseBuffer(this.c), loop: true });
    const flt = new BiquadFilterNode(this.c, { type: o.type, frequency: o.f * this.ratio, Q: o.q ?? 0.707, gain: o.gain ?? 0 });
    if (o.f2) {
      flt.frequency.setValueAtTime(o.f * this.ratio, t);
      flt.frequency.exponentialRampToValueAtTime(o.f2 * this.ratio, t + (o.sweep ?? o.a + o.d));
    }
    const g = new GainNode(this.c, { gain: 0 });
    env(g.gain, t, o.pk, o.a, o.d);
    src.connect(flt).connect(g).connect(o.to ?? this.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + o.a + o.d + 0.02);
    this.mark(at + o.a + o.d + 0.02);
    return flt;
  }

  /** M(f, pk, d): partials 1/4/10 with decays d/60 ms/15 ms (marimba-like). */
  mallet(f: number, at: number, pk: number, d = 0.26, to?: AudioNode): void {
    this.tone({ f, at, a: 0.002, d, pk, to });
    this.tone({ f: 4 * f, at, a: 0.001, d: 0.06, pk: 0.25 * pk, to });
    this.tone({ f: 10 * f, at, a: 0.001, d: 0.015, pk: 0.1 * pk, to });
  }

  /** B(f, pk, d): inharmonic bell partials 1/2.76/5.40/8.93. */
  bell(f: number, at: number, pk: number, d = 0.9, to?: AudioNode): void {
    const partials: [number, number, number][] = [
      [1, 1, 1],
      [2.76, 0.4, 0.45],
      [5.4, 0.2, 0.17],
      [8.93, 0.1, 0.07],
    ];
    for (const [m, g, k] of partials) this.tone({ f: f * m, at, a: 0.001, d: d * k, pk: pk * g, to });
  }

  /** Two-operator FM with a decaying index. */
  fm(fc: number, ratio: number, index: number, at: number, pk: number, d: number, to?: AudioNode): void {
    const t = this.t0 + at;
    const f = fc * this.ratio;
    const car = new OscillatorNode(this.c, { frequency: f });
    const mod = new OscillatorNode(this.c, { frequency: f * ratio });
    const depth = new GainNode(this.c, { gain: index * f * ratio });
    depth.gain.setValueAtTime(index * f * ratio, t);
    depth.gain.exponentialRampToValueAtTime(1, t + d);
    mod.connect(depth).connect(car.frequency);
    const g = new GainNode(this.c, { gain: 0 });
    env(g.gain, t, pk, 0.001, d);
    car.connect(g).connect(to ?? this.out);
    for (const o of [car, mod]) {
      o.start(t);
      o.stop(t + d + 0.05);
    }
    this.mark(at + d + 0.05);
  }

  /** Brass-like note: detuned saws through an enveloped low-pass (stingers, fanfares, horns). */
  brass(f: number, at: number, pk: number, hold: number, opts: { a?: number; r?: number; cutoff?: number; voices?: number; to?: AudioNode } = {}): void {
    const t = this.t0 + at;
    const a = opts.a ?? 0.04;
    const r = opts.r ?? 0.25;
    const cutoff = opts.cutoff ?? 2400;
    const lp = new BiquadFilterNode(this.c, { type: 'lowpass', frequency: cutoff * 0.25, Q: 1.2 });
    lp.frequency.setValueAtTime(cutoff * 0.25, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + a + 0.03);
    lp.frequency.setTargetAtTime(cutoff * 0.55, t + a + 0.05, hold * 0.5 + 0.05);
    const g = new GainNode(this.c, { gain: 0 });
    ahr(g.gain, t, pk, a, hold, r);
    lp.connect(g).connect(opts.to ?? this.out);
    const n = opts.voices ?? 3;
    for (let i = 0; i < n; i++) {
      const det = (i - (n - 1) / 2) * 7;
      const osc = new OscillatorNode(this.c, { type: 'sawtooth', frequency: f * this.ratio, detune: det });
      const vg = new GainNode(this.c, { gain: 1 / n });
      osc.connect(vg).connect(lp);
      osc.start(t);
      osc.stop(t + a + hold + r * 1.5 + 0.05);
    }
    this.mark(at + a + hold + r * 1.5 + 0.05);
  }

  /** Soft string-pad note (slow attack saws, darker filter). */
  pad(f: number, at: number, pk: number, hold: number, opts: { a?: number; r?: number; cutoff?: number; to?: AudioNode } = {}): void {
    this.brass(f, at, pk, hold, { a: opts.a ?? 0.5, r: opts.r ?? 0.8, cutoff: opts.cutoff ?? 1100, voices: 4, to: opts.to });
  }

  /** Timpani / tom: sine with a pitch drop plus a felt-thump noise. */
  timpani(f: number, at: number, pk: number, d = 0.9, to?: AudioNode): void {
    this.tone({ f: f * 1.5, f2: f, at, a: 0.003, d, pk, to, fixedPitch: true });
    this.tone({ f: f * 2.0, f2: f * 1.6, at, a: 0.003, d: d * 0.4, pk: pk * 0.35, to, fixedPitch: true });
    this.noise({ at, a: 0.002, d: 0.06, pk: pk * 0.5, type: 'lowpass', f: 700, to });
  }

  /** Piano-ish note: mallet body plus a soft hammer and a longer second partial. */
  piano(f: number, at: number, pk: number, d = 1.6, to?: AudioNode): void {
    this.tone({ type: 'triangle', f, at, a: 0.004, d, pk, to });
    this.tone({ f: 2 * f, at, a: 0.003, d: d * 0.5, pk: pk * 0.35, to });
    this.tone({ f: 3 * f, at, a: 0.002, d: d * 0.25, pk: pk * 0.12, to });
    this.noise({ at, a: 0.001, d: 0.02, pk: pk * 0.15, type: 'bandpass', f: Math.min(4000, f * 6), q: 1.5, to });
  }

  // ---- routing helpers (all connect to `to` or the synth output) ----

  filter(type: BiquadFilterType, f: number, q = 0.707, to?: AudioNode, gain = 0): BiquadFilterNode {
    const flt = new BiquadFilterNode(this.c, { type, frequency: f, Q: q, gain });
    flt.connect(to ?? this.out);
    return flt;
  }

  gain(g: number, to?: AudioNode): GainNode {
    const n = new GainNode(this.c, { gain: g });
    n.connect(to ?? this.out);
    return n;
  }

  /** Feedback delay with a low-pass in the loop; returns its input (dry + wet are both output). */
  delay(time: number, feedback: number, lpHz: number, wet = 1, to?: AudioNode): GainNode {
    const input = new GainNode(this.c);
    const dl = new DelayNode(this.c, { delayTime: time, maxDelayTime: Math.max(1, time) });
    const fb = new GainNode(this.c, { gain: feedback });
    const lp = new BiquadFilterNode(this.c, { type: 'lowpass', frequency: lpHz });
    const wetG = new GainNode(this.c, { gain: wet });
    const dest = to ?? this.out;
    input.connect(dest);
    input.connect(dl);
    dl.connect(lp).connect(fb).connect(dl);
    lp.connect(wetG).connect(dest);
    // the tail lasts until feedback^n < -60 dB
    const repeats = Math.ceil(Math.log(0.001) / Math.log(Math.max(0.01, Math.min(0.95, feedback))));
    this.tail = Math.max(this.tail, time * repeats);
    return input;
  }

  /** Convolution reverb with a procedural IR; returns its input (dry passes through). */
  reverb(seconds: number, wet: number, to?: AudioNode, decay = 3): GainNode {
    const input = new GainNode(this.c);
    const conv = new ConvolverNode(this.c, { buffer: noiseIR(this.c, seconds, decay), disableNormalization: false });
    const wetG = new GainNode(this.c, { gain: wet });
    const dest = to ?? this.out;
    input.connect(dest);
    input.connect(conv).connect(wetG).connect(dest);
    this.tail = Math.max(this.tail, seconds);
    return input;
  }

  /** Extend the voice lifetime explicitly (e.g. for tails that outlive the last oscillator). */
  hold(sec: number): void {
    this.mark(sec);
  }
}

/** Musical pitch set (F major family, audio-plan §6.1) plus helpers. */
export const NOTE = {
  D2: 73.42,
  F2: 87.31,
  A2: 110,
  Bb2: 116.54,
  C3: 130.81,
  D3: 146.83,
  E3: 164.81,
  F3: 174.61,
  G3: 196,
  A3: 220,
  Bb3: 233.08,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392,
  A4: 440,
  Bb4: 466.16,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  G5: 783.99,
  Ab5: 830.61,
  A5: 880,
  C6: 1046.5,
  D6: 1174.66,
  E6: 1318.51,
  F6: 1396.91,
  G6: 1567.98,
  A6: 1760,
  B6: 1975.53,
  C7: 2093,
  D7: 2349.32,
  E7: 2637.02,
  F7: 2793.83,
} as const;
