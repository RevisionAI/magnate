// Adaptive music (audio-plan §4.7): a state machine over two decks with beat-quantised equal-power
// crossfades, key-compatible stingers, anti-fatigue rests, a pressure layer, and the victory / defeat
// sequences. Rules live in musicRules.ts (pure, tested); this class turns decisions into audio.
//
// Cue resolution is fallback-aware: each state lists its planned cues (§7) and a stand-in built from
// what exists today (title, steady, victory + procedural stingers/defeat). Stand-ins that reuse the
// playing buffer change only the deck's tone/gain, so e.g. calm → steady never restarts the music.

import { dbToGain, rand } from '../core/math';
import type { AudioEngine } from '../core/AudioEngine';
import type { AssetLoader } from '../assets/AssetLoader';
import type { ManifestAsset } from '../assets/manifest';
import { ALL_RECIPES, recipeVoiceInput } from '../sfx/catalog';
import { DEFEAT_CUE_SECONDS, defeatCue, pressureLayer } from '../synth/music';
import { Synth } from '../synth/primitives';
import { renderBuffer } from '../synth/offthread';
import { offlineAvailable } from '../synth/render';
import { MusicDeck, OPEN_VARIANT, type CueSource, type DeckVariant } from './MusicDeck';
import {
  DEFAULT_INPUTS,
  REST,
  breaksRest,
  desiredState,
  intensity,
  noteMonthClose,
  pressureWanted,
  restsAllowed,
  transitionFor,
  type DirectorMemory,
  type MusicInputs,
  type MusicState,
} from './musicRules';

/** One playlist entry: a planned cue with an optional stand-in. */
interface CueChoice {
  cue: string;
  start?: 'intro' | 'loop';
  variant?: DeckVariant;
  /** Force the pressure layer while this choice plays (tension stand-in). */
  pressure?: boolean;
  fallback?: CueChoice;
}

const V = (toneHz: number, gainDb: number): DeckVariant => ({ toneHz, gainDb });

/** §4.7.1 playlists with today's stand-ins. */
export const PLAYLISTS: Readonly<Record<MusicState, CueChoice[]>> = {
  title: [{ cue: 'music.title' }],
  calm: [
    { cue: 'music.calm_a', fallback: { cue: 'music.steady', variant: V(3200, -2.5) } },
    { cue: 'music.calm_b', fallback: { cue: 'music.steady', variant: V(3200, -2.5) } },
  ],
  steady: [{ cue: 'music.steady' }, { cue: 'music.calm_b', fallback: { cue: 'music.steady' } }],
  growth: [{ cue: 'music.growth', fallback: { cue: 'music.title', start: 'loop', variant: V(20000, -1.5) } }],
  tension: [{ cue: 'music.tension', fallback: { cue: 'music.steady', variant: V(1900, -2), pressure: true } }],
  recession: [{ cue: 'music.recession', fallback: { cue: 'music.steady', variant: V(1500, -4) } }],
  victory: [{ cue: 'music.victory' }],
  defeat: [{ cue: 'music.defeat', fallback: { cue: 'proc:music.defeat' } }],
};

const STINGER_MIN_GAP_MS = 20_000;
const PRESSURE_DB = -8;

export interface MusicDirectorDeps {
  engine: AudioEngine;
  assets: AssetLoader;
  /** Real-time clock in ms. */
  now?: () => number;
  /** Ask the ambience to dim (defeat: −6 dB) or restore (0). */
  ambienceDim?: (db: number) => void;
  /** "Reduce sudden sounds" (audio-plan §4.4): stingers −6 dB with a 30 ms attack. */
  reduceSudden?: () => boolean;
  /** Optional trace of state changes and stingers (audio decision trace). */
  onChange?: (what: 'state' | 'stinger', value: string, detail: string) => void;
}

export interface MusicDebug {
  state: MusicState;
  forced: MusicState | null;
  cue: string | null;
  deck: string | null;
  position: number;
  loops: number;
  resting: boolean;
  restLeftSec: number;
  pressure: boolean;
  pendingUnlock: boolean;
  intensity: number;
  lastTransition: string;
}

export class MusicDirector {
  private readonly decks: [MusicDeck, MusicDeck];
  private active = 0;
  private readonly stingerBus: GainNode;
  private readonly pressureGain: GainNode;
  private pressureSrc: AudioBufferSourceNode | null = null;
  private pressureOn = false;
  private inputs: MusicInputs = { ...DEFAULT_INPUTS };
  private mem: DirectorMemory;
  private forced: MusicState | null = null;
  private playlistIdx: Partial<Record<MusicState, number>> = {};
  private currentChoice: CueChoice | null = null;
  private cueStartedAt = 0;
  private restUntil: number | null = null;
  private ending = false;
  private transitionSeq = 0;
  private lastStingerAt = -1e12;
  private lastTransition = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private disposed = false;

  constructor(private readonly deps: MusicDirectorDeps) {
    const { engine } = deps;
    this.now = deps.now ?? (() => performance.now());
    this.decks = [new MusicDeck(engine.ctx, engine.musicIn, 'A'), new MusicDeck(engine.ctx, engine.musicIn, 'B')];
    this.stingerBus = new GainNode(engine.ctx, { gain: 1 });
    this.stingerBus.connect(engine.musicIn);
    this.pressureGain = new GainNode(engine.ctx, { gain: 0 });
    this.pressureGain.connect(engine.musicIn);
    this.mem = { state: 'title', enteredAt: this.now(), okCloses: 0 };
    this.timer = setInterval(() => this.tick(), 500);
  }

  get state(): MusicState {
    return this.mem.state;
  }

  /** Merge new inputs and re-evaluate. */
  setInputs(patch: Partial<MusicInputs>): void {
    this.inputs = { ...this.inputs, ...patch };
    this.evaluate();
  }

  getInputs(): Readonly<MusicInputs> {
    return this.inputs;
  }

  /** A month closed: update the tension-exit counter, then re-evaluate. */
  monthClosed(patch: Partial<MusicInputs> = {}): void {
    this.inputs = { ...this.inputs, ...patch };
    this.mem = noteMonthClose(this.mem, this.inputs);
    this.evaluate();
  }

  /** New game / load: leave terminal states (they crossfade like the title), forget the tension memory. */
  resetForNewGame(): void {
    const terminal = this.mem.state === 'victory' || this.mem.state === 'defeat';
    this.mem = { state: terminal ? 'title' : this.mem.state, enteredAt: this.now(), okCloses: 0 };
    this.inputs = { ...this.inputs, outcome: 'playing' };
    this.restUntil = null;
    this.deps.ambienceDim?.(0);
  }

  /** AudioLab: pin a state (null = automatic). */
  force(state: MusicState | null): void {
    this.forced = state;
    if (state) void this.transitionTo(state);
    else this.evaluate();
  }

  evaluate(): void {
    if (this.disposed) return;
    const target = this.forced ?? desiredState(this.inputs, this.mem, this.now());
    if (target !== this.mem.state || (!this.currentChoice && this.restUntil === null && !this.ending)) {
      if (this.restUntil !== null && target !== this.mem.state && !breaksRest(target)) {
        // a rest is only cut short by tension / victory / defeat / growth: switch state silently
        this.setState(target, 'rest-quiet');
      } else void this.transitionTo(target);
    }
    this.updatePressure();
  }

  /** Called by the system when the context starts running (the latest requested state plays). */
  onUnlock(): void {
    if (!this.currentChoice && this.restUntil === null) void this.transitionTo(this.mem.state, true);
  }

  /** Event stinger on the music bus at the next beat; ≤ 1 per 20 s; ducks the deck −6 dB meanwhile. */
  playStinger(id: string, opts: { force?: boolean } = {}): boolean {
    const t = this.now();
    if (!opts.force && t - this.lastStingerAt < STINGER_MIN_GAP_MS) return false;
    if (this.deps.engine.ctx.state !== 'running' && !opts.force) return false;
    this.lastStingerAt = t;
    const deck = this.decks[this.active];
    const ctx = this.deps.engine.ctx;
    const at = deck.playing ? deck.nextBoundary('beat', 0.1) : ctx.currentTime + 0.02;
    const dur = this.renderStinger(id, at);
    if (deck.playing && dur > 0) {
      // Duck on the deck's dedicated stinger gain (never on `out`, whose fades are value curves).
      const p = deck.duck.gain;
      p.cancelScheduledValues(at);
      p.setValueAtTime(1, at);
      p.setTargetAtTime(dbToGain(-6), at, 0.05);
      p.setTargetAtTime(1, at + dur * 0.8, 0.4);
    }
    return true;
  }

  debug(): MusicDebug {
    const deck = this.decks[this.active];
    const nowMs = this.now();
    return {
      state: this.mem.state,
      forced: this.forced,
      cue: this.currentChoice?.cue ?? null,
      deck: deck.playing ? deck.name : null,
      position: Math.round(deck.position() * 100) / 100,
      loops: deck.loopsCompleted(),
      resting: this.restUntil !== null,
      restLeftSec: this.restUntil === null ? 0 : Math.max(0, Math.round((this.restUntil - nowMs) / 1000)),
      pressure: this.pressureOn,
      pendingUnlock: this.deps.engine.ctx.state !== 'running',
      intensity: Math.round(intensity(this.inputs) * 100) / 100,
      lastTransition: this.lastTransition,
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    const t = this.deps.engine.ctx.currentTime;
    for (const d of this.decks) d.fadeOutAndStop(t, 0.3);
    this.pressureSrc?.stop(t + 0.4);
  }

  // ------------------------------------------------------------------------------------ internals

  private setState(state: MusicState, how: string): void {
    const from = this.mem.state;
    this.mem = { ...this.mem, state, enteredAt: this.now() };
    this.lastTransition = `${how} → ${state}`;
    if (from !== state) this.deps.onChange?.('state', state, `${from} → ${state} (${how})`);
  }

  private pickChoice(state: MusicState): CueChoice | null {
    const list = PLAYLISTS[state];
    if (!list.length) return null;
    const i = (this.playlistIdx[state] ?? -1) + 1;
    this.playlistIdx[state] = i % list.length;
    const c = list[i % list.length] as CueChoice;
    return this.resolve(c);
  }

  /** Follow fallbacks until a cue that exists (manifest asset or procedural). */
  private resolve(c: CueChoice): CueChoice | null {
    let cur: CueChoice | undefined = c;
    while (cur) {
      if (cur.cue.startsWith('proc:') || this.deps.assets.manifest.has(cur.cue)) return cur;
      cur = cur.fallback;
    }
    return null;
  }

  private async loadCue(choice: CueChoice): Promise<CueSource | null> {
    const { assets, engine } = this.deps;
    if (choice.cue === 'proc:music.defeat') {
      if (!offlineAvailable()) return null;
      const buffer = await assets.caches.music.get('proc:music.defeat', () =>
        renderBuffer(engine.ctx, defeatCue, { seconds: DEFEAT_CUE_SECONDS, channels: 2, sampleRate: engine.ctx.sampleRate, targetLufs: -20 }),
      );
      return { id: choice.cue, buffer };
    }
    const asset = assets.manifest.get(choice.cue);
    const file = asset?.variants[0];
    if (!file) return null;
    const buffer = await assets.tryLoad(file);
    if (!buffer) return null;
    return toCueSource(file, buffer);
  }

  private async transitionTo(to: MusicState, resume = false): Promise<void> {
    const seq = ++this.transitionSeq;
    const { engine } = this.deps;
    const ctx = engine.ctx;
    // `from` is what is audibly playing; enteredAt only moves on a real state change (dwell timing)
    const from = this.currentChoice ? this.mem.state : null;
    if (to !== this.mem.state) this.setState(to, from ?? 'start');
    this.restUntil = null;
    this.ending = false;
    if (ctx.state !== 'running') return; // §4.5: keep only the latest requested state until unlock

    const spec = transitionFor(from, to);
    const choice = this.pickChoice(to);
    if (!choice) return;
    const source = await this.loadCue(choice);
    if (seq !== this.transitionSeq || this.disposed || !source) return;

    const out = this.decks[this.active];
    const sameBuffer = out.playing && out.cueId === source.id && !resume && to !== 'victory' && to !== 'defeat';
    const now = ctx.currentTime;
    const at =
      spec.quantize === 'now' || !out.playing ? now + 0.03 : out.nextBoundary(spec.quantize, spec.minAhead, now);
    this.currentChoice = choice;
    this.cueStartedAt = this.now();

    if (to === 'victory') return this.victory(source, out, now);
    if (to === 'defeat') return this.defeat(source, out, now);

    if (sameBuffer) {
      out.applyVariant(choice.variant ?? OPEN_VARIANT, at, spec.fade);
    } else {
      const next = this.decks[1 - this.active] as MusicDeck;
      const offset = choice.start === 'loop' && source.loop ? source.loop.startSec : 0;
      next.start(source, at, offset, choice.variant ?? OPEN_VARIANT, () => this.onDeckEnded(next));
      next.fadeTo(1, at, Math.max(0.05, spec.fade));
      if (out.playing) out.fadeOutAndStop(at, spec.fade);
      this.active = 1 - this.active;
    }
    if (spec.stinger && !resume) this.renderStinger(spec.stinger, at);
    this.lastTransition = `${from ?? 'start'} → ${to} (${choice.cue}${sameBuffer ? ', variant' : ''}) @${spec.quantize} ${spec.fade}s`;
    this.updatePressure();
  }

  private victory(source: CueSource, out: MusicDeck, now: number): void {
    // stinger now, cue +0.4 s (one-shot), 4 s of silence, then the title body at −6 dB
    if (out.playing) out.fadeOutAndStop(now, 0.8);
    this.renderStinger('victory_fanfare', now + 0.02);
    const deck = this.decks[1 - this.active] as MusicDeck;
    this.active = 1 - this.active;
    deck.start(source, now + 0.4, 0, OPEN_VARIANT, () => {
      if (this.mem.state !== 'victory' || this.disposed) return;
      setTimeout(() => void this.playTitleCoda(), 4000);
    });
    deck.fadeTo(1, now + 0.4, 0.05);
    this.lastTransition = '→ victory (fanfare, cue +0.4 s)';
    this.setPressure(false);
  }

  private async playTitleCoda(): Promise<void> {
    if (this.mem.state !== 'victory') return;
    const choice = this.resolve({ cue: 'music.title' });
    const src = choice ? await this.loadCue(choice) : null;
    if (!src || this.mem.state !== 'victory') return;
    const deck = this.decks[1 - this.active] as MusicDeck;
    this.active = 1 - this.active;
    const t = this.deps.engine.ctx.currentTime + 0.05;
    deck.start(src, t, src.loop?.startSec ?? 0, V(20000, -6));
    deck.fadeTo(1, t, 3);
  }

  private defeat(source: CueSource, out: MusicDeck, now: number): void {
    if (out.playing) out.fadeOutAndStop(now, 1.5);
    this.renderStinger('defeat_sting', now + 0.02);
    const deck = this.decks[1 - this.active] as MusicDeck;
    this.active = 1 - this.active;
    deck.start(source, now + 1.0, 0, OPEN_VARIANT);
    deck.fadeTo(1, now + 1.0, 0.05);
    this.deps.ambienceDim?.(-6);
    this.lastTransition = '→ defeat (sting, cue +1.0 s)';
    this.setPressure(false);
  }

  private onDeckEnded(deck: MusicDeck): void {
    if (deck !== this.decks[this.active] || this.disposed) return;
    // natural end of a one-shot or an ending → rest, then the next cue of the state's playlist
    if (this.restUntil === null && restsAllowed(this.mem.state)) this.restUntil = this.now() + rand(REST.minRestMs, REST.maxRestMs);
    this.currentChoice = null;
    this.ending = false;
  }

  /** 2 Hz housekeeping: anti-fatigue endings, rest expiry, re-evaluation. */
  private tick(): void {
    if (this.disposed || this.deps.engine.ctx.state !== 'running') return;
    const deck = this.decks[this.active];
    const state = this.mem.state;
    const nowMs = this.now();
    if (this.restUntil !== null) {
      if (nowMs >= this.restUntil) {
        this.restUntil = null;
        void this.transitionTo(state, true);
      }
      return;
    }
    if (!this.ending && this.currentChoice && deck.playing && restsAllowed(state) && this.forced === null) {
      const tooLong = deck.loopsCompleted() >= REST.maxLoops || nowMs - this.cueStartedAt >= REST.maxMs;
      if (tooLong) {
        this.ending = true;
        const end = deck.endNaturally();
        if (end === null) {
          deck.fadeOutAndStop(this.deps.engine.ctx.currentTime, 6);
          setTimeout(() => this.onDeckEnded(deck), 6100); // a stopped deck fires no onended
        }
        this.lastTransition = `${state}: ${end === null ? 'fade 6 s' : 'natural ending'} → rest`;
      }
    }
    this.evaluate();
  }

  private updatePressure(): void {
    const want = pressureWanted(this.inputs, this.mem.state) || (!!this.currentChoice?.pressure && this.restUntil === null);
    this.setPressure(want);
  }

  private setPressure(on: boolean): void {
    if (on === this.pressureOn) return;
    this.pressureOn = on;
    const ctx = this.deps.engine.ctx;
    const p = this.pressureGain.gain;
    const t = ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    if (on) {
      void this.ensurePressureSource().then(() => {
        if (!this.pressureOn) return;
        const t2 = ctx.currentTime;
        p.cancelScheduledValues(t2);
        p.setValueAtTime(p.value, t2);
        p.linearRampToValueAtTime(dbToGain(PRESSURE_DB), t2 + 4);
      });
    } else {
      p.linearRampToValueAtTime(0, t + 6);
    }
  }

  private async ensurePressureSource(): Promise<void> {
    if (this.pressureSrc || !offlineAvailable()) return;
    const { engine, assets } = this.deps;
    const fromManifest = assets.manifest.get('layer.pressure')?.variants[0];
    const buffer = fromManifest
      ? await assets.tryLoad(fromManifest)
      : await assets.caches.music.get('proc:layer.pressure', () =>
          renderBuffer(engine.ctx, pressureLayer, { seconds: 20, channels: 2, sampleRate: 32000, targetLufs: -20, loopSeam: 2 }),
        );
    if (!buffer || this.pressureSrc || this.disposed) return;
    const src = new AudioBufferSourceNode(engine.ctx, { buffer, loop: true });
    src.connect(this.pressureGain);
    src.start(engine.ctx.currentTime, Math.random() * buffer.duration);
    this.pressureSrc = src;
  }

  /** Play a stinger on the music bus (manifest file if one exists, else the procedural recipe). */
  private renderStinger(id: string, at: number): number {
    const { engine, assets } = this.deps;
    const ctx = engine.ctx;
    // a voice gain per stinger: "reduce sudden sounds" (−6 dB, 30 ms attack) and a clean disconnect
    const voice = new GainNode(ctx, { gain: 1 });
    if (this.deps.reduceSudden?.()) {
      voice.gain.setValueAtTime(0, at);
      voice.gain.linearRampToValueAtTime(dbToGain(-6), at + 0.03);
    }
    voice.connect(this.stingerBus);
    let duration = 0;
    const file = assets.manifest.get(id)?.variants[0];
    const buf = file ? assets.peek(file) : undefined;
    if (buf) {
      const src = new AudioBufferSourceNode(ctx, { buffer: buf });
      src.connect(voice);
      src.start(at);
      duration = buf.duration;
    } else {
      if (file) void assets.tryLoad(file); // ready next time; the procedural version plays now
      const def = ALL_RECIPES[id];
      if (def) {
        const s = new Synth(ctx, recipeVoiceInput(ctx, id, voice), at, 0);
        def.fn(s, {});
        duration = s.duration;
      }
    }
    setTimeout(() => voice.disconnect(), (at - ctx.currentTime + duration) * 1000 + 500);
    return duration;
  }
}

/** Manifest asset → deck cue (loop points, grid, beats in the body, tail length). */
export function toCueSource(file: ManifestAsset, buffer: AudioBuffer): CueSource {
  const grid = file.grid;
  const loop = file.loop;
  const beats = grid && loop && grid.bars ? grid.bars * grid.beatsPerBar : undefined;
  return {
    id: file.id,
    buffer,
    loop: loop ? { startSec: loop.startSec, endSec: loop.endSec, beats } : undefined,
    grid: grid ? { bpm: grid.bpm, beatsPerBar: grid.beatsPerBar, firstBeatSec: grid.firstBeatSec } : undefined,
    tailSec: file.tail ? file.tail.endSec - file.tail.startSec : undefined,
  };
}
