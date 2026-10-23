// Audio lab (route: ?dev=audio) — A1. Every SFX recipe and cue, the music state switcher with
// crossfade preview, ambience sliders, positional emitters, the voice queue, synthetic game events,
// per-bus meters and the offline level report. window.__audioLab exposes the same tools to
// tools/audio/recipe-levels.mjs; window.__audioLabReady flips once the page is interactive.

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { audio, type SubtitleEvent } from '@/audio';
import { ALL_RECIPES } from '@/audio/sfx/catalog';
import { bus, type GameBusEvents } from '@/game/events';
import type { MeterBus, MeterReading } from '@/audio/core/AudioEngine';
import { calibrate, measureLoops, measureRecipes, renderRecipe, type MeasureOptions } from './audioLab/measure';
import { meterState } from './audioLab/Meters';
import { AmbiencePanel, EmitterPanel, EventsPanel, LevelsPanel, MixerPanel, MusicPanel, SfxPanel, VoicePanel, useTick } from './audioLab/panels';
import { VoiceBrowser } from './audioLab/VoiceBrowser';
import { VO_LINES } from '@/audio/voice/voiceLines';
import css from './audioLab/AudioLab.module.css';

declare global {
  interface Window {
    __audioLab?: AudioLabApi;
    __audioLabReady?: boolean;
  }
}

export interface AudioLabApi {
  start(): Promise<string>;
  recipeIds(): string[];
  measureRecipes(opts?: MeasureOptions): ReturnType<typeof measureRecipes>;
  measureLoops(ids?: string[]): ReturnType<typeof measureLoops>;
  calibrate: typeof calibrate;
  renderRecipe: typeof renderRecipe;
  play(id: string): boolean;
  music(state: string | null): void;
  meters(): typeof meterState;
  /** Instantaneous per-bus peak/RMS straight from the engine's analysers (for scripted checks). */
  readMeters(): Record<MeterBus, MeterReading> | null;
  /** Emit on the app bus exactly as the game store does (synthetic game events for e2e checks). */
  emit<K extends keyof GameBusEvents>(topic: K, payload: GameBusEvents[K]): void;
  /** Queue an advisor / anchor line. */
  voice(ids: string | string[]): boolean;
  /** Subtitle events received since the lab started (newest last). */
  subtitles(): SubtitleEvent[];
  /** Play one VO line now, outside the queue (seconds; 0 = no take). */
  audition(lineId: string): Promise<number>;
  /** Every registry line id (voice-line browser). */
  voLines(): string[];
  debug(): unknown;
}

const subtitleLog: SubtitleEvent[] = [];
audio.onSubtitle((e) => {
  subtitleLog.push(e);
  if (subtitleLog.length > 100) subtitleLog.shift();
});

const api: AudioLabApi = {
  async start() {
    await audio.init();
    const sys = audio.system;
    if (sys) {
      await sys.assets.init();
      sys.ambience.setActive(true);
    }
    return audio.contextState;
  },
  recipeIds: () => Object.keys(ALL_RECIPES),
  measureRecipes: (opts) => measureRecipes(opts),
  measureLoops: (ids) => measureLoops(ids),
  calibrate,
  renderRecipe,
  play: (id) => audio.play(id, { force: true }),
  music: (state) => audio.setMusicState(state as never),
  meters: () => meterState,
  readMeters: () => audio.system?.engine.readMeters() ?? null,
  emit: (topic, payload) => bus.emit(topic, payload),
  voice: (ids) => audio.requestVoice(ids),
  subtitles: () => [...subtitleLog],
  audition: (id) => audio.audition(id),
  voLines: () => VO_LINES.map((l) => l.id),
  debug: () => {
    const s = audio.system;
    if (!s) return null;
    return {
      context: { state: s.engine.ctx.state, sampleRate: s.engine.ctx.sampleRate, baseLatency: s.engine.ctx.baseLatency },
      format: s.assets.format,
      assets: s.assets.manifest.all().length,
      caches: s.assets.stats(),
      music: s.music.debug(),
      voice: s.voice.state,
      sfx: { voices: s.sfx.activeVoices, ...s.sfx.stats },
      emitters: { voices: s.emitters.voiceCount, sources: s.emitters.sourceCount() },
      ambience: s.ambience.lastGains,
    };
  },
};

export function AudioLab() {
  const [, force] = useState(0);
  useTick(500);
  const started = audio.ready && audio.contextState === 'running';

  useEffect(() => {
    // create the context + engine now (suspended until the start click), as the game's title screen does
    void audio.warmup();
    window.__audioLab = api;
    window.__audioLabReady = true;
    return () => {
      window.__audioLabReady = false;
      delete window.__audioLab;
    };
  }, []);

  const start = async () => {
    await api.start();
    force((n) => n + 1);
  };

  const sys = audio.system;
  const state = audio.contextState;
  return (
    <div className={css.page} data-testid="audio-lab">
      <header className={css.header}>
        <div>
          <h1 className={css.title}>Audio Lab</h1>
          <div className={css.subtitle}>Magnate · A1 audio engine + mastering · ?dev=audio</div>
        </div>
        <div className={css.chips}>
          <span className={clsx(css.chip, state === 'running' ? css.chipOk : css.chipWarn)}>context {state}</span>
          {sys && <span className={css.chip}>{sys.engine.ctx.sampleRate} Hz</span>}
          {sys && <span className={css.chip}>latency {(sys.engine.ctx.baseLatency * 1000).toFixed(1)} ms</span>}
          {sys && <span className={css.chip}>format .{sys.assets.format}</span>}
          {sys && <span className={css.chip}>{sys.assets.manifest.all().length} assets</span>}
          {sys && <span className={css.chip}>music {(sys.assets.stats().music.bytes / 1048576).toFixed(1)} MB decoded</span>}
          {sys && <span className={css.chip}>beds {(sys.assets.stats().ambience.bytes / 1048576).toFixed(1)} MB</span>}
        </div>
      </header>
      {!started && (
        <div className={css.overlay} onClick={() => void start()}>
          <div className={css.overlayCard}>
            <h2 className={css.title}>Click to start audio</h2>
            <p className={css.subtitle}>Browsers only allow sound after a gesture (audio-plan §4.5).</p>
          </div>
        </div>
      )}
      <main className={css.grid}>
        <MixerPanel />
        <MusicPanel />
        <SfxPanel />
        <AmbiencePanel />
        <EmitterPanel />
        <VoicePanel />
        <VoiceBrowser />
        <EventsPanel />
        <LevelsPanel />
      </main>
    </div>
  );
}
