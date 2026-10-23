// One-shot SFX (audio-plan §4.10): mastered files and procedural recipes behind one id, variants from
// a shuffle bag, random detune on non-musical sounds, per-id cooldowns and polyphony, a global cap of
// 24 voices with priority-then-age stealing, "reduce sudden sounds", and optional positional playback
// through an equal-power panner into the three.js listener (→ world duck → ambient bus).

import { ShuffleBag, centsToRatio, dbToGain, rand } from '../core/math';
import type { AudioEngine } from '../core/AudioEngine';
import type { AssetLoader } from '../assets/AssetLoader';
import type { ManifestAsset } from '../assets/manifest';
import type { AudioSettings } from '../settings';
import { Synth } from '../synth/primitives';
import type { RecipeParams } from '../synth/recipes';
import { ALL_RECIPES, recipeVoiceInput, sfxSpec, type SfxSpec } from './catalog';

export const GLOBAL_VOICE_CAP = 24;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SfxPlayOptions {
  /** World position (metres) → positional playback through the listener. */
  at?: Vec3;
  /** Reference distance for positional plays (default 30 m). */
  refDistance?: number;
  /**
   * Stereo position −1…1 for non-positional mono sounds (distant siren, thunder: audio-plan §4.8 "pan
   * ±0.6"). An equal-power pan keeps the single-channel loudness the world class is mastered to; without
   * it a mono voice is duplicated into both channels (+3 dB), which is what UI and event cues expect.
   */
  pan?: number;
  /** Seconds from now. */
  delay?: number;
  /** Extra detune in cents (e.g. stamp at rate 0.85 = −281 c for patents). */
  detuneCents?: number;
  /** Level offset in dB. */
  levelDb?: number;
  params?: RecipeParams;
  /** Ignore the cooldown (AudioLab auditions). */
  force?: boolean;
  /** Play even if the context is not running yet (offline/tests). */
  allowSuspended?: boolean;
}

type Variant = { kind: 'file'; file: ManifestAsset } | { kind: 'recipe'; recipe: string };

interface Voice {
  id: string;
  priority: number;
  started: number;
  end: number;
  out: GainNode;
  /** Positional PannerNode or StereoPannerNode, if any (disconnected with the voice). */
  panner: AudioNode | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface SfxPlayerDeps {
  engine: AudioEngine;
  assets: AssetLoader;
  settings: () => AudioSettings;
}

export class SfxPlayer {
  private voices: Voice[] = [];
  private readonly lastPlayed = new Map<string, number>();
  private readonly bags = new Map<string, { key: string; bag: ShuffleBag<Variant> }>();
  /** Counters for the AudioLab / tests. */
  readonly stats = { played: 0, suppressedCooldown: 0, suppressedLocked: 0, stolen: 0, unknown: 0 };

  constructor(private readonly deps: SfxPlayerDeps) {}

  get activeVoices(): number {
    this.reap();
    return this.voices.length;
  }

  /** Is there anything (file or recipe) that can play this id? */
  canPlay(id: string): boolean {
    return this.variants(id, this.specOf(id)).length > 0;
  }

  play(id: string, opts: SfxPlayOptions = {}): boolean {
    const spec = this.specOf(id);
    const { engine } = this.deps;
    const ctx = engine.ctx;
    if (ctx.state !== 'running' && !opts.allowSuspended) {
      this.stats.suppressedLocked++;
      return false; // §4.5: before unlock the SFX player drops everything
    }
    const nowMs = performance.now();
    if (!opts.force && nowMs - (this.lastPlayed.get(id) ?? -Infinity) < spec.cooldownMs) {
      this.stats.suppressedCooldown++;
      return false;
    }
    const pool = this.variants(id, spec);
    if (pool.length === 0) {
      this.stats.unknown++;
      return false;
    }
    let variant = this.bag(id, pool).next();
    let buffer: AudioBuffer | undefined;
    if (variant.kind === 'file') {
      buffer = this.deps.assets.peek(variant.file);
      if (!buffer) {
        const file = variant.file;
        const recipeAlt = pool.find((v) => v.kind === 'recipe');
        const requestedAt = ctx.currentTime;
        const pending = this.deps.assets.tryLoad(file);
        if (recipeAlt) {
          variant = recipeAlt; // play a procedural variant now; the file is ready next time
        } else {
          void pending.then((b) => {
            // late by more than 250 ms → drop (a stale cue is worse than none)
            if (b && ctx.currentTime - requestedAt <= 0.25) this.start(spec, { kind: 'file', file }, b, opts);
          });
          this.lastPlayed.set(id, nowMs);
          return true;
        }
      }
    }
    this.lastPlayed.set(id, nowMs);
    this.start(spec, variant, buffer, opts);
    return true;
  }

  stopAll(fade = 0.05): void {
    const t = this.deps.engine.ctx.currentTime;
    for (const v of this.voices) this.release(v, t, fade);
    this.voices = [];
  }

  // ---------------------------------------------------------------------------------------------

  private specOf(id: string): SfxSpec {
    const known = sfxSpec(id);
    if (known) return known;
    const r = ALL_RECIPES[id];
    return {
      id,
      cls: r?.cls ?? 'event',
      ui: false,
      cooldownMs: 120,
      maxVoices: 3,
      priority: 2,
      fileDetune: 0,
      recipes: r ? [id] : [],
      mode: 'fallback',
    };
  }

  private variants(id: string, spec: SfxSpec): Variant[] {
    const files: Variant[] = (this.deps.assets.manifest.get(id)?.variants ?? []).map((file) => ({ kind: 'file', file }));
    const recipes: Variant[] = spec.recipes.filter((r) => ALL_RECIPES[r]).map((recipe) => ({ kind: 'recipe', recipe }));
    if (spec.mode === 'mix') return [...files, ...recipes];
    return files.length ? files : recipes;
  }

  private bag(id: string, pool: Variant[]): ShuffleBag<Variant> {
    const key = pool.map((v) => (v.kind === 'file' ? v.file.files.ogg : v.recipe)).join('|');
    const cur = this.bags.get(id);
    if (cur && cur.key === key) return cur.bag;
    const bag = new ShuffleBag(pool);
    this.bags.set(id, { key, bag });
    return bag;
  }

  private start(spec: SfxSpec, variant: Variant, buffer: AudioBuffer | undefined, opts: SfxPlayOptions): void {
    const { engine, settings } = this.deps;
    const ctx = engine.ctx;
    this.reap();
    this.makeRoom(spec);
    const t = ctx.currentTime + 0.005 + Math.max(0, opts.delay ?? 0);
    const s = settings();
    let levelDb = opts.levelDb ?? 0;
    const sudden = s.reduceSudden && (spec.cls === 'stinger' || spec.cls === 'alert');
    if (sudden) levelDb -= 6;
    const out = new GainNode(ctx, { gain: dbToGain(levelDb) });
    if (sudden && spec.cls === 'stinger') {
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(dbToGain(levelDb), t + 0.03);
    }
    let panner: AudioNode | null = null;
    if (opts.at) {
      panner = new PannerNode(ctx, {
        panningModel: 'equalpower',
        distanceModel: 'inverse',
        refDistance: opts.refDistance ?? 30,
        rolloffFactor: 1.3,
        positionX: opts.at.x,
        positionY: opts.at.y,
        positionZ: opts.at.z,
      });
      out.connect(panner).connect(engine.listener.getInput());
    } else if (opts.pan !== undefined) {
      panner = new StereoPannerNode(ctx, { pan: Math.min(1, Math.max(-1, opts.pan)) });
      out.connect(panner).connect(spec.ui ? engine.uiIn : engine.sfxIn);
    } else {
      out.connect(spec.ui ? engine.uiIn : engine.sfxIn);
    }

    let end = t;
    if (variant.kind === 'file' && buffer) {
      const cents = (spec.fileDetune ? rand(-spec.fileDetune, spec.fileDetune) : 0) + (opts.detuneCents ?? 0);
      const rate = centsToRatio(cents);
      const src = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate });
      src.connect(out);
      src.start(t);
      end = t + buffer.duration / rate;
      if (spec.layer && ALL_RECIPES[spec.layer]) end = Math.max(end, this.synth(spec.layer, out, t, opts));
    } else if (variant.kind === 'recipe') {
      end = this.synth(variant.recipe, out, t, opts);
    }
    const voice: Voice = { id: spec.id, priority: spec.priority, started: t, end, out, panner, timer: null };
    voice.timer = setTimeout(() => this.finish(voice), Math.max(50, (end - ctx.currentTime) * 1000 + 150));
    this.voices.push(voice);
    this.stats.played++;
  }

  /** Run a recipe into `out` at `t`; returns the context time at which it has fully decayed. */
  private synth(recipeId: string, out: AudioNode, t: number, opts: SfxPlayOptions): number {
    const def = ALL_RECIPES[recipeId];
    if (!def) return t;
    const params = opts.params ?? {};
    const cents = (def.detune ? rand(-def.detune, def.detune) : 0) + (def.cents?.(params) ?? 0) + (opts.detuneCents ?? 0);
    const input = recipeVoiceInput(this.deps.engine.ctx, recipeId, out);
    const s = new Synth(this.deps.engine.ctx, input, t, cents);
    def.fn(s, params);
    return t + s.duration;
  }

  /** Enforce per-id polyphony and the global cap (steal lowest priority, then oldest). */
  private makeRoom(spec: SfxSpec): void {
    const t = this.deps.engine.ctx.currentTime;
    const same = this.voices.filter((v) => v.id === spec.id);
    if (same.length >= spec.maxVoices) {
      const oldest = same.reduce((a, b) => (a.started <= b.started ? a : b));
      this.steal(oldest, t);
    }
    while (this.voices.length >= GLOBAL_VOICE_CAP) {
      const victim = this.voices.reduce((a, b) =>
        a.priority < b.priority || (a.priority === b.priority && a.started <= b.started) ? a : b,
      );
      this.steal(victim, t);
    }
  }

  private steal(v: Voice, t: number): void {
    this.stats.stolen++;
    this.release(v, t, 0.03);
    this.voices = this.voices.filter((x) => x !== v);
  }

  private release(v: Voice, t: number, fade: number): void {
    const p = v.out.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(0, t + fade);
    if (v.timer) clearTimeout(v.timer);
    v.timer = setTimeout(() => this.disconnect(v), fade * 1000 + 100);
  }

  private finish(v: Voice): void {
    this.disconnect(v);
    this.voices = this.voices.filter((x) => x !== v);
  }

  private disconnect(v: Voice): void {
    try {
      v.out.disconnect();
      v.panner?.disconnect();
    } catch {
      // already disconnected
    }
  }

  private reap(): void {
    const t = this.deps.engine.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end + 0.2 > t);
  }
}
