// One music deck (audio-plan §4.7.5, v1 single-buffer form): an AudioBufferSourceNode with explicit
// loopStart/loopEnd *inside* the content (never a whole-buffer wrap), so the intro plays once and the
// body loops sample-accurately with the seam baked in by tools/audio. The deck tracks the playhead
// on the context clock for beat/bar quantisation, counts loop bodies for anti-fatigue rests, and can
// end naturally by releasing the loop so playback runs on into the cue's original tail.

import { equalPowerCurve } from '../core/math';

export interface CueSource {
  /** Manifest id (or 'proc:<id>' for rendered procedural cues). */
  id: string;
  buffer: AudioBuffer;
  loop?: { startSec: number; endSec: number; beats?: number };
  grid?: { bpm: number; beatsPerBar: number; firstBeatSec: number };
  /** Seconds of usable ending after loopEnd (the original continuation). */
  tailSec?: number;
}

export interface DeckVariant {
  /** Deck low-pass in Hz (20 kHz = open). */
  toneHz: number;
  /** Deck gain in dB. */
  gainDb: number;
}

export const OPEN_VARIANT: DeckVariant = { toneHz: 20000, gainDb: 0 };

export class MusicDeck {
  readonly out: GainNode;
  /**
   * Stinger duck (separate from `out`, which carries the equal-power fade curves): Web Audio throws
   * NotSupportedError when setTargetAtTime overlaps a setValueCurveAtTime on the same parameter,
   * so ducks and fades never share one (Wave 2 merge fix of the flaky smoke failure).
   */
  readonly duck: GainNode;
  readonly tone: BiquadFilterNode;
  readonly trim: GainNode;
  private src: AudioBufferSourceNode | null = null;
  private cue: CueSource | null = null;
  /** Context time at which file position `offset0` plays. */
  private t0 = 0;
  private offset0 = 0;
  private looping = false;
  private endsAt = Infinity;
  private onEndedCb: (() => void) | null = null;
  variant: DeckVariant = OPEN_VARIANT;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    readonly name: string,
  ) {
    this.trim = new GainNode(ctx, { gain: 1 });
    this.tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.707 });
    this.duck = new GainNode(ctx, { gain: 1 });
    this.out = new GainNode(ctx, { gain: 0 });
    this.trim.connect(this.tone).connect(this.duck).connect(this.out).connect(destination);
  }

  get cueId(): string | null {
    return this.cue?.id ?? null;
  }

  get playing(): boolean {
    return this.src !== null && this.ctx.currentTime < this.endsAt;
  }

  /**
   * Start `cue` at context time `when` from file position `offset` (0 = intro). One-shots (no loop)
   * end on their own; `onEnded` fires when playback stops for good.
   */
  start(cue: CueSource, when: number, offset = 0, variant: DeckVariant = OPEN_VARIANT, onEnded?: () => void): void {
    this.stop(when);
    const src = new AudioBufferSourceNode(this.ctx, { buffer: cue.buffer });
    if (cue.loop) {
      src.loop = true;
      src.loopStart = cue.loop.startSec;
      src.loopEnd = cue.loop.endSec;
    }
    src.connect(this.trim);
    src.start(when, Math.max(0, Math.min(offset, cue.buffer.duration - 0.01)));
    this.src = src;
    this.cue = cue;
    this.t0 = when;
    this.offset0 = offset;
    this.looping = !!cue.loop && offset < cue.loop.endSec;
    this.endsAt = this.looping ? Infinity : when + Math.max(0, cue.buffer.duration - offset);
    this.onEndedCb = onEnded ?? null;
    src.onended = () => {
      if (this.src === src) {
        this.src = null;
        this.endsAt = this.ctx.currentTime;
        const cb = this.onEndedCb;
        this.onEndedCb = null;
        cb?.();
      }
    };
    this.applyVariant(variant, when, 0);
  }

  /** Ramp the deck tone and trim to a variant over `dur` seconds from `at`. */
  applyVariant(v: DeckVariant, at: number, dur: number): void {
    this.variant = v;
    const g = 10 ** (v.gainDb / 20);
    for (const [p, target] of [
      [this.trim.gain, g],
      [this.tone.frequency, v.toneHz],
    ] as const) {
      p.cancelScheduledValues(at);
      if (dur <= 0) p.setValueAtTime(target, at);
      else {
        p.setValueAtTime(p.value, at);
        p.setTargetAtTime(target, at, dur / 3);
      }
    }
  }

  /** Equal-power fade of the deck output to `target` (0..1) over `dur` from `at`. */
  fadeTo(target: number, at: number, dur: number): void {
    const p = this.out.gain;
    const from = p.value;
    p.cancelScheduledValues(at);
    if (dur <= 0.005) {
      p.setValueAtTime(target, at);
      return;
    }
    const curve = target >= from ? equalPowerCurve(64, 'in', from, target) : equalPowerCurve(64, 'out', from, target);
    p.setValueCurveAtTime(curve, at, dur);
  }

  /** Stop at `at` (no fade; fade first with fadeTo). */
  stop(at = this.ctx.currentTime): void {
    const src = this.src;
    if (!src) return;
    this.src = null;
    this.onEndedCb = null;
    this.endsAt = at;
    try {
      src.stop(Math.max(at, this.ctx.currentTime));
    } catch {
      // already stopped
    }
    setTimeout(() => {
      try {
        src.disconnect();
      } catch {
        // gone
      }
    }, Math.max(0, (at - this.ctx.currentTime) * 1000) + 200);
  }

  /** Fade out and stop. */
  fadeOutAndStop(at: number, dur: number): void {
    this.fadeTo(0, at, dur);
    this.stop(at + dur + 0.02);
  }

  // --------------------------------------------------------------------------------- timeline

  /** Unwrapped file position at context time `t` (keeps growing across loop wraps). */
  unwrapped(t = this.ctx.currentTime): number {
    return this.offset0 + Math.max(0, t - this.t0);
  }

  /** File position at context time `t` (wrapped into the loop body while looping). */
  position(t = this.ctx.currentTime): number {
    const u = this.unwrapped(t);
    const l = this.cue?.loop;
    if (!l || !this.looping || u < l.endSec) return u;
    const body = l.endSec - l.startSec;
    return l.startSec + ((u - l.startSec) % body);
  }

  /** Completed loop bodies so far (0 during the intro and the first pass). */
  loopsCompleted(t = this.ctx.currentTime): number {
    const l = this.cue?.loop;
    if (!l || !this.looping) return 0;
    const u = this.unwrapped(t);
    return u < l.endSec ? 0 : Math.floor((u - l.startSec) / (l.endSec - l.startSec));
  }

  /** Beat period in seconds (derived from the loop body when it holds a whole number of beats). */
  beatSec(): number | null {
    const g = this.cue?.grid;
    if (!g) return null;
    const l = this.cue?.loop;
    if (l?.beats) return (l.endSec - l.startSec) / l.beats;
    return 60 / g.bpm;
  }

  /**
   * Context time of the next beat (or bar) at least `minAhead` seconds from now. The grid is
   * continuous across loop wraps because the body is a whole number of beats. Falls back to
   * `now + minAhead` without a grid.
   */
  nextBoundary(unit: 'beat' | 'bar', minAhead: number, now = this.ctx.currentTime): number {
    const beat = this.beatSec();
    const g = this.cue?.grid;
    if (!beat || !g || !this.src) return now + minAhead;
    const step = unit === 'bar' ? beat * g.beatsPerBar : beat;
    const t = now + minAhead;
    const u = this.unwrapped(t);
    const k = Math.ceil((u - g.firstBeatSec) / step - 1e-6);
    const boundary = g.firstBeatSec + Math.max(0, k) * step;
    return t + (boundary - u);
  }

  /**
   * Natural ending: release the loop shortly before the next loop end so playback runs on into the
   * original tail, masking the join with a 24 ms dip. Returns the context time the cue will end, or
   * null if there is no usable tail (the caller should fade instead).
   */
  endNaturally(minAhead = 1.5): number | null {
    const cue = this.cue;
    const src = this.src;
    if (!cue?.loop || !src || !this.looping || !cue.tailSec || cue.tailSec < 4) return null;
    const now = this.ctx.currentTime;
    const l = cue.loop;
    const body = l.endSec - l.startSec;
    const u = this.unwrapped(now + minAhead);
    // next crossing of loopEnd in unwrapped time
    const k = u < l.endSec ? 0 : Math.floor((u - l.endSec) / body) + 1;
    const crossU = l.endSec + k * body;
    const crossT = this.t0 + (crossU - this.offset0);
    const releaseIn = Math.max(0, (crossT - now - 0.5) * 1000);
    setTimeout(() => {
      if (this.src === src) {
        src.loop = false; // playback now runs through loopEnd into the tail
        this.looping = false;
        this.t0 = crossT; // re-anchor the timeline on the un-wrapped path
        this.offset0 = l.endSec;
      }
    }, releaseIn);
    const p = this.trim.gain;
    const g = 10 ** (this.variant.gainDb / 20);
    p.setValueAtTime(g, crossT - 0.012);
    p.linearRampToValueAtTime(g * 0.35, crossT);
    p.linearRampToValueAtTime(g, crossT + 0.012);
    // after the release the source plays loopEnd → end of buffer
    this.endsAt = crossT + (cue.buffer.duration - l.endSec);
    return this.endsAt;
  }
}
