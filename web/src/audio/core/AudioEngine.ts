// The Web Audio graph (audio-plan §4.2): one AudioContext shared with three.js, user and duck buses,
// tone filters, a mono fold and a safety limiter.
//
//  music decks, stingers, pressure ─► musicIn ─► musicTone (LPF) ─► duck.music ─► user.music ───────┐
//  beds ─► ambientIn ─► ambientAir (LPF by zoom) ─► duck.ambient ─┐                                │
//  THREE.AudioListener.gain (positional emitters + world one-shots) ─► duck.world ─┴─► user.ambient ┤
//  gameplay SFX ─► sfxIn ─► duck.sfx ─┐                                                              │
//  UI SFX (never ducked) ─► uiIn ─────┴─► user.sfx ──────────────────────────────────────────────────┤
//  VO ─► voiceIn ─► user.voice ──────────────────────────────────────────────────────────────────────┤
//                                       master (user) ─► monoFold ─► limiter ─► limiterTrim ─► out
//
// The engine owns graph topology only; directors and players own their sources.

import * as THREE from 'three';
import { dbToGain, gainToDb, sliderGain } from './math';
import type { AudioSettings } from '../settings';

export type DuckBus = 'music' | 'ambient' | 'world' | 'sfx';
export type MeterBus = 'master' | 'music' | 'sfx' | 'voice' | 'ambient';
export type MusicTone = 'normal' | 'modal' | 'paused';

/** Ducking depth per bus while a voice line plays (audio-plan §4.2; UX §8: music −10 dB). */
export const DUCK_DB: Readonly<Record<DuckBus, number>> = { music: -10, ambient: -6, world: -4, sfx: -3 };

/** Safety limiter settings (normal peaks stay ≤ −6 dBFS; this only catches pile-ups). */
const LIMITER = { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.15 } as const;

/**
 * DynamicsCompressorNode applies automatic make-up gain (Web Audio spec: (1 / fullRangeGain)^0.6).
 * We undo it so the limiter is transparent below threshold. Analytic value for the settings above;
 * refined at runtime by `calibrateLimiter()`.
 */
export function limiterMakeupDb(threshold = LIMITER.threshold, ratio = LIMITER.ratio): number {
  const fullRangeDb = threshold + (0 - threshold) / ratio; // knee 0: curve value at 0 dBFS
  return -fullRangeDb * 0.6;
}

export interface MeterReading {
  peakDb: number;
  rmsDb: number;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly monoFold: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly limiterTrim: GainNode;
  readonly user: { music: GainNode; sfx: GainNode; voice: GainNode; ambient: GainNode };
  readonly duck: Record<DuckBus, GainNode>;
  readonly musicIn: GainNode;
  readonly musicTone: BiquadFilterNode;
  readonly ambientIn: GainNode;
  readonly ambientAir: BiquadFilterNode;
  readonly sfxIn: GainNode;
  readonly uiIn: GainNode;
  readonly voiceIn: GainNode;
  /** three.js listener, re-routed into duck.world. Created lazily (needs THREE.AudioContext set first). */
  private _listener: THREE.AudioListener | null = null;
  private readonly adopted = new Set<THREE.AudioListener>();
  private analysers: Partial<Record<MeterBus, AnalyserNode>> = {};
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  private disposed = false;

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext({ latencyHint: 'interactive' });
    // Must run before any THREE.Audio / AudioListener exists so three.js shares our context.
    THREE.AudioContext.setContext(this.ctx);
    const c = this.ctx;
    const g = (gain = 1) => new GainNode(c, { gain });

    this.limiter = new DynamicsCompressorNode(c, { ...LIMITER });
    this.limiterTrim = g(dbToGain(-limiterMakeupDb()));
    this.master = g();
    this.monoFold = g();
    this.master.connect(this.monoFold).connect(this.limiter).connect(this.limiterTrim).connect(c.destination);

    this.user = { music: g(), sfx: g(), voice: g(), ambient: g() };
    this.duck = { music: g(), ambient: g(), world: g(), sfx: g() };

    this.musicIn = g();
    this.musicTone = new BiquadFilterNode(c, { type: 'lowpass', frequency: 20000, Q: 0.707 });
    this.musicIn.connect(this.musicTone).connect(this.duck.music).connect(this.user.music).connect(this.master);

    this.ambientIn = g();
    this.ambientAir = new BiquadFilterNode(c, { type: 'lowpass', frequency: 18000, Q: 0.5 });
    this.ambientIn.connect(this.ambientAir).connect(this.duck.ambient).connect(this.user.ambient);
    this.duck.world.connect(this.user.ambient);
    this.user.ambient.connect(this.master);

    this.sfxIn = g();
    this.uiIn = g();
    this.sfxIn.connect(this.duck.sfx).connect(this.user.sfx);
    this.uiIn.connect(this.user.sfx);
    this.user.sfx.connect(this.master);

    this.voiceIn = g();
    this.voiceIn.connect(this.user.voice).connect(this.master);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** The shared THREE.AudioListener, its output re-routed through duck.world → ambient bus. */
  get listener(): THREE.AudioListener {
    if (!this._listener) {
      const l = new THREE.AudioListener();
      l.gain.disconnect(); // three wires listener.gain straight to ctx.destination
      l.gain.connect(this.duck.world);
      this._listener = l;
    }
    return this._listener;
  }

  get hasListener(): boolean {
    return this._listener !== null;
  }

  /**
   * Adopt a THREE.AudioListener another scene module created on the same context: its output joins the
   * world bus (ducked under VO, on the ambient slider) and it leaves the scene graph, so only the rig's
   * listener drives the context's single spatial listener. PositionalAudio built on it keeps working.
   * A listener on a different context (made before audio.init) cannot be routed and is left alone.
   */
  adoptListener(other: THREE.AudioListener): boolean {
    if (other === this._listener || this.adopted.has(other)) return true;
    if (other.context !== this.ctx) {
      console.warn('[audio] a THREE.AudioListener exists on another AudioContext; create scene audio after audio.init()');
      return false;
    }
    try {
      other.gain.disconnect();
    } catch {
      // not connected
    }
    other.gain.connect(this.duck.world);
    other.removeFromParent();
    this.adopted.add(other);
    return true;
  }

  /** Apply user settings (sliders, mute, mono) with a short smoothing ramp. */
  applySettings(s: AudioSettings): void {
    const t = this.ctx.currentTime;
    const tau = 0.05;
    this.master.gain.setTargetAtTime(s.muted ? 0 : sliderGain(s.master), t, tau);
    this.user.music.gain.setTargetAtTime(sliderGain(s.music), t, tau);
    this.user.sfx.gain.setTargetAtTime(sliderGain(s.sfx), t, tau);
    this.user.voice.gain.setTargetAtTime(sliderGain(s.voice), t, tau);
    this.user.ambient.gain.setTargetAtTime(sliderGain(s.ambient), t, tau);
    this.monoFold.channelCount = s.mono ? 1 : 2;
    this.monoFold.channelCountMode = s.mono ? 'explicit' : 'max';
    this.monoFold.channelInterpretation = 'speakers';
  }

  /** Scheduled ducking: the VO duration is known, so no side-chain is needed (audio-plan §4.3). */
  duckFor(startAt: number, durationSec: number): void {
    for (const bus of Object.keys(DUCK_DB) as DuckBus[]) {
      const p = this.duck[bus].gain;
      holdAt(p, startAt);
      p.setTargetAtTime(dbToGain(DUCK_DB[bus]), startAt, 0.04);
      p.setTargetAtTime(1, startAt + durationSec + 0.25, 0.25);
    }
  }

  unduck(at = this.ctx.currentTime): void {
    for (const bus of Object.keys(DUCK_DB) as DuckBus[]) {
      const p = this.duck[bus].gain;
      holdAt(p, at);
      p.setTargetAtTime(1, at, 0.2);
    }
  }

  /** Music tone: normal, modal (full-screen overlay: 3.5 kHz, −3 dB) or paused (900 Hz). */
  setMusicTone(mode: MusicTone): void {
    const t = this.ctx.currentTime;
    const f = { normal: 20000, modal: 3500, paused: 900 }[mode];
    holdAt(this.musicTone.frequency, t);
    this.musicTone.frequency.setTargetAtTime(f, t, mode === 'normal' ? 0.08 : 0.1);
    holdAt(this.musicIn.gain, t);
    this.musicIn.gain.setTargetAtTime(mode === 'modal' ? dbToGain(-3) : 1, t, 0.1);
  }

  /** Ambient air absorption: 18 kHz at street level → ≈2.6 kHz at the city view (audio-plan §4.2). */
  setAmbientAir(zoom01: number): void {
    const f = 18000 * 2 ** (-2.8 * Math.min(1, Math.max(0, zoom01)));
    this.ambientAir.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.3);
  }

  /**
   * Measure the limiter's real make-up gain in an OfflineAudioContext and correct the trim
   * (browsers implement the spec's make-up formula, but this keeps us honest everywhere).
   */
  async calibrateLimiter(): Promise<number> {
    if (typeof OfflineAudioContext === 'undefined') return limiterMakeupDb();
    const sr = 48000;
    const off = new OfflineAudioContext(1, sr / 4, sr);
    const osc = new OscillatorNode(off, { frequency: 997 });
    const level = new GainNode(off, { gain: 0.01 });
    const comp = new DynamicsCompressorNode(off, { ...LIMITER });
    osc.connect(level).connect(comp).connect(off.destination);
    osc.start();
    const out = (await off.startRendering()).getChannelData(0);
    let sum = 0;
    const from = Math.floor(out.length / 2);
    for (let i = from; i < out.length; i++) sum += (out[i] as number) ** 2;
    const rms = Math.sqrt(sum / (out.length - from));
    const makeupDb = gainToDb(rms / (0.01 / Math.SQRT2));
    if (Number.isFinite(makeupDb) && Math.abs(makeupDb) < 12 && !this.disposed) {
      this.limiterTrim.gain.setValueAtTime(dbToGain(-makeupDb), this.ctx.currentTime);
    }
    return makeupDb;
  }

  /** Per-bus peak/RMS (dBFS). Analysers are created on first use, so meters cost nothing until shown. */
  readMeters(): Record<MeterBus, MeterReading> {
    const taps: Record<MeterBus, AudioNode> = {
      master: this.limiterTrim,
      music: this.user.music,
      sfx: this.user.sfx,
      voice: this.user.voice,
      ambient: this.user.ambient,
    };
    const out = {} as Record<MeterBus, MeterReading>;
    for (const bus of Object.keys(taps) as MeterBus[]) {
      let a = this.analysers[bus];
      if (!a) {
        a = new AnalyserNode(this.ctx, { fftSize: 2048, smoothingTimeConstant: 0 });
        taps[bus].connect(a);
        this.analysers[bus] = a;
      }
      if (!this.meterBuf || this.meterBuf.length !== a.fftSize) this.meterBuf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(this.meterBuf);
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < this.meterBuf.length; i++) {
        const v = this.meterBuf[i] as number;
        const abs = v < 0 ? -v : v;
        if (abs > peak) peak = abs;
        sum += v * v;
      }
      out[bus] = { peakDb: gainToDb(peak), rmsDb: gainToDb(Math.sqrt(sum / this.meterBuf.length)) };
    }
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const a of Object.values(this.analysers)) a?.disconnect();
    this.analysers = {};
    this._listener?.gain.disconnect();
    this._listener?.removeFromParent();
    this._listener = null;
    for (const l of this.adopted) l.gain.disconnect();
    this.adopted.clear();
    void this.ctx.close().catch(() => undefined);
  }
}

/**
 * Freeze an AudioParam at its current value from `at` on (Firefox has no cancelAndHoldAtTime).
 */
export function holdAt(p: AudioParam, at: number): void {
  p.cancelScheduledValues(at);
  p.setValueAtTime(p.value, at);
}
