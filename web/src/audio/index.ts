// Public audio API used by the rest of the client (UI shell, scene, dev pages). The original stub
// surface is unchanged — init / setVolumes / setMuted / ui / attachScene / dispose — and every member
// is a safe no-op until `init()` runs on the first user gesture. Game-event reactions (music state,
// stingers, voice lines, building sounds) are driven internally by subscribing to `bus` from
// '@/game/events' and to the game store; callers only add what the audio side cannot see:
//
//   audio.warmup()                 optional, at boot: create the context + engine before any gesture
//   audio.init()                   on the first user gesture (creates if needed + unlocks the AudioContext)
//   audio.setVolumes({...})        0..1 per bus; persisted by the audio settings store (useAudioSettings)
//   audio.setMuted(b) / toggleMute()
//   audio.ui('click')              UI feedback cue (also: tab, slider (with value), toggleOn/Off, …)
//   audio.attachScene({ camera, scene, getTarget? })  share the context / listener with three.js
//   audio.setFrame(frame)          renderer AudioFrame at 10 Hz (zoom band, focus, land use, time, weather)
//   audio.setEmitters(buildings)   positional building loops (world metres)
//   audio.onSubtitle(cb)           advisor / anchor subtitles and toasts (also bus topic 'subtitle')
//   audio.setPreferences({...})    advisor frequency, subtitles, mute in background (+ mono, reduceSudden)
//   audio.contextState             'none' before init, then the AudioContext state ("Enable sound" chip)
//   audio.audition(lineId)         play one VO line now (AudioLab voice browser, QA)
//   audio.play(id) / requestVoice(id) / setMusicState(state) / setOverlayOpen(open)
//   audio.dispose()
//
// The engine itself (graph, directors, recipes, beds) is a separate chunk, imported on the first
// init()/warmup(); init() unlocks the AudioContext synchronously inside the gesture so WebKit allows it.

import type * as THREE from 'three';
import type { AudioSystem, SceneAudioHostLike } from './AudioSystem';
import { useAudioSettings, type AdvisorFrequency, type AudioSettings } from './settings';
import type { SfxPlayOptions } from './sfx/SfxPlayer';
import type { SubtitleEvent, VoiceRequestOptions } from './voice/VoiceQueue';
import type { AudioFrame } from './ambience/ambienceModel';
import type { EmitterSource } from './world/emitterModel';
import type { TruckSource } from './world/EmitterManager';
import type { MusicState } from './music/musicRules';

export type BusName = 'master' | 'music' | 'sfx' | 'voice' | 'ambience';
export type Volumes = Record<BusName, number>;
export type UiCue =
  | 'click'
  | 'hover'
  | 'open'
  | 'close'
  | 'toggle'
  | 'error'
  | 'confirm'
  // additions (A1): finer-grained UI cues from the §6.2 kit
  | 'toggleOn'
  | 'toggleOff'
  | 'tab'
  | 'slider'
  | 'priceTag'
  | 'placeOk'
  | 'placeInvalid';

export interface SceneAudioHost {
  /** The camera the listener follows. */
  readonly camera: THREE.Camera;
  /** The scene positional emitters are added to. */
  readonly scene: THREE.Scene;
  /** Optional: the controls' ground target (else the camera ray's hit on y = 0). */
  readonly getTarget?: () => THREE.Vector3 | { x: number; y: number; z: number } | null;
  /** Optional: plot size in metres (default 24). */
  readonly plotSize?: number;
}

/** Non-volume audio preferences (UX §6.18). Unknown keys are ignored. */
export interface AudioPreferences {
  /** Advisor voice frequency: all lines, P0/P1 + tutorial only, or none (subtitles still show). */
  advisor?: AdvisorFrequency;
  /** Show subtitles for voiced lines (unvoiced advisor toasts always show). */
  subtitles?: boolean;
  /** Suspend audio while the tab is hidden ("keep playing in background" is the inverse). */
  muteInBackground?: boolean;
  mono?: boolean;
  reduceSudden?: boolean;
  iosIgnoreSilentSwitch?: boolean;
}

export interface UiCueOptions {
  /** 0–1 control value for 'slider' (pitch follows the value). */
  value?: number;
}

/** Minimal structural SceneModule (see web/src/scene/SceneContext.ts) so the scene can host audio. */
export interface AudioSceneModule {
  readonly name: 'audio';
  init(ctx: { camera: THREE.Camera; scene: THREE.Scene; controls?: unknown }): void;
  dispose(): void;
}

export interface AudioApi {
  /**
   * Call on the first user gesture, synchronously inside the handler: creates (if needed) and unlocks
   * the AudioContext, then starts the engine. Idempotent.
   */
  init(): Promise<void>;
  setVolumes(volumes: Partial<Volumes>): void;
  setMuted(muted: boolean): void;
  /** UI feedback cue. Unknown cues are no-ops (the shell may send cues newer than this build). */
  ui(cue: UiCue | (string & {}), opts?: UiCueOptions): void;
  attachScene(host: SceneAudioHost | null): void;
  dispose(): void;
  // ---- additions (A1)
  /**
   * Optional, at boot / title mount (no gesture needed): create the context (suspended until a gesture)
   * and start the engine, so the first click only has to resume it. Any later gesture unlocks audio.
   */
  warmup(): Promise<void>;
  /** True once the engine runs (after init() or warmup() resolved). */
  readonly ready: boolean;
  /** 'running' once unlocked; 'none' before init. */
  readonly contextState: AudioContextState | 'none' | 'interrupted';
  toggleMute(): boolean;
  /** Advisor frequency, subtitles, mute in background (persisted with the volumes). */
  setPreferences(prefs: AudioPreferences): void;
  /** Play one VO line now, outside the queue (AudioLab / QA); resolves to its seconds (0 = no take). */
  audition(lineId: string): Promise<number>;
  /** Play any SFX id from the catalog (files or procedural). */
  play(id: string, opts?: SfxPlayOptions): boolean;
  /** Queue an advisor / anchor line (or chain) by id (audio-plan §5.2). */
  requestVoice(ids: string | string[], opts?: VoiceRequestOptions): boolean;
  /** Subtitles and advisor toasts (text, duration, priority, voiced?). Returns an unsubscribe. */
  onSubtitle(listener: (e: SubtitleEvent) => void): () => void;
  /** Renderer AudioFrame (10 Hz). */
  setFrame(frame: Partial<AudioFrame>): void;
  /** Positional building emitters for the active city (replaces the list). */
  setEmitters(list: EmitterSource[]): void;
  upsertEmitters(list: EmitterSource[], removedIds?: number[]): void;
  /** Delivery trucks (renderer agents) for the engine loops. */
  setTrucks(list: TruckSource[]): void;
  /** Pin a music state (title/calm/steady/growth/tension/recession/victory/defeat; aliases busy, crisis) or null for automatic. */
  setMusicState(state: MusicState | 'busy' | 'crisis' | null): void;
  /** Full-screen overlay open (Reports, Finance…): music goes to the modal tone (3.5 kHz, −3 dB). */
  setOverlayOpen(open: boolean): void;
  /** A SceneModule that attaches the listener when added to CityScene. */
  sceneModule(): AudioSceneModule;
  /**
   * The shared THREE.AudioListener (null before init). Scene modules that build their own
   * THREE.PositionalAudio must use this one: its output is routed through the world bus (ducked under
   * VO, on the ambient slider). For one-shots prefer `audio.play(id, { at })`.
   */
  readonly listener: THREE.AudioListener | null;
  /** The running system (AudioLab, debug overlays); null before init. */
  readonly system: AudioSystem | null;
}

const UI_SFX: Record<UiCue, string> = {
  click: 'ui_click',
  hover: 'ui_hover',
  open: 'panel_open',
  close: 'panel_close',
  toggle: 'toggle_on',
  error: 'error',
  confirm: 'confirm',
  toggleOn: 'toggle_on',
  toggleOff: 'toggle_off',
  tab: 'tab_switch',
  slider: 'slider_tick',
  priceTag: 'price_tag',
  placeOk: 'place_ok',
  placeInvalid: 'place_invalid',
};

let system: AudioSystem | null = null;
let pendingHost: SceneAudioHost | null = null;
let initPromise: Promise<void> | null = null;
/** Bumped by dispose(): a start still importing the engine chunk from an older generation discards itself. */
let generation = 0;
/** Subtitle listeners outlive the system (they may subscribe before the first gesture). */
const subtitleListeners = new Set<(e: SubtitleEvent) => void>();

function withSystem(fn: (s: AudioSystem) => void): void {
  if (system) fn(system);
}

let context: AudioContext | null = null;

/**
 * The one AudioContext (created on first need). Constructing it opens the output device, which can
 * block the main thread for a noticeable moment (≈ 0.8 s measured in headless Chrome), hence
 * `warmup()` to pay that before the first click. Null when Web Audio is unavailable.
 */
function ensureContext(): AudioContext | null {
  if (context && context.state !== 'closed') return context;
  context = null;
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  try {
    context = new AudioContext({ latencyHint: 'interactive' });
  } catch (error) {
    console.warn('[audio] Web Audio unavailable', error);
  }
  return context;
}

/** Inside a user gesture: start a 1-sample buffer and resume — what WebKit needs to unlock (§4.5). */
function unlock(ctx: AudioContext): void {
  try {
    const kick = new AudioBufferSourceNode(ctx, { buffer: ctx.createBuffer(1, 1, ctx.sampleRate) });
    kick.connect(ctx.destination);
    kick.start();
  } catch {
    // nothing to unlock with; the lifecycle re-arms on the next gesture
  }
  void ctx.resume().catch(() => undefined);
}

/** Import the engine chunk and start the system on `ctx` (once). */
function startSystem(ctx: AudioContext): Promise<void> {
  if (!initPromise) {
    const gen = generation;
    initPromise = (async () => {
      let created: AudioSystem;
      try {
        const { AudioSystem } = await import('./AudioSystem');
        created = new AudioSystem(ctx);
      } catch (error) {
        console.warn('[audio] audio engine failed to start', error);
        if (gen === generation) initPromise = null; // allow a retry
        else void ctx.close().catch(() => undefined); // disposed meanwhile: nobody else owns this context
        return;
      }
      if (gen !== generation) {
        created.dispose(); // dispose() ran while the chunk was loading
        return;
      }
      system = created;
      system.onSubtitle((e) => {
        for (const l of subtitleListeners) l(e);
      });
      system.start(); // installs the lifecycle: any later gesture unlocks a still-suspended context
      if (pendingHost) system.attachScene(pendingHost);
    })();
  }
  return initPromise;
}

export const audio: AudioApi = {
  warmup() {
    const ctx = ensureContext();
    return ctx ? startSystem(ctx) : Promise.resolve();
  },

  init() {
    const ctx = ensureContext(); // synchronous: still inside the user gesture
    if (!ctx) return Promise.resolve();
    unlock(ctx);
    return startSystem(ctx);
  },

  setVolumes(volumes) {
    const patch: Partial<AudioSettings> = {};
    const to100 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100);
    if (volumes.master !== undefined) patch.master = to100(volumes.master);
    if (volumes.music !== undefined) patch.music = to100(volumes.music);
    if (volumes.sfx !== undefined) patch.sfx = to100(volumes.sfx);
    if (volumes.voice !== undefined) patch.voice = to100(volumes.voice);
    if (volumes.ambience !== undefined) patch.ambient = to100(volumes.ambience);
    useAudioSettings.getState().set(patch);
  },

  setMuted(muted) {
    useAudioSettings.getState().set({ muted });
  },

  toggleMute() {
    const muted = !useAudioSettings.getState().muted;
    useAudioSettings.getState().set({ muted });
    return muted;
  },

  ui(cue, opts) {
    if (typeof cue !== 'string' || !Object.prototype.hasOwnProperty.call(UI_SFX, cue)) return; // unknown cue: no-op
    const id = UI_SFX[cue as UiCue];
    withSystem((s) => {
      try {
        s.play(id, cue === 'slider' ? { params: { v: opts?.value ?? 0.5 } } : undefined);
      } catch (error) {
        console.warn('[audio] ui cue failed', cue, error);
      }
    });
  },

  setPreferences(prefs) {
    if (!prefs || typeof prefs !== 'object') return;
    const patch: Partial<AudioSettings> = {};
    if (prefs.advisor === 'all' || prefs.advisor === 'important' || prefs.advisor === 'off') patch.advisor = prefs.advisor;
    for (const k of ['subtitles', 'muteInBackground', 'mono', 'reduceSudden', 'iosIgnoreSilentSwitch'] as const) {
      if (typeof prefs[k] === 'boolean') patch[k] = prefs[k];
    }
    if (Object.keys(patch).length) useAudioSettings.getState().set(patch);
  },

  audition(lineId) {
    return system ? system.audition(lineId) : Promise.resolve(0);
  },

  attachScene(host) {
    pendingHost = host;
    withSystem((s) => s.attachScene(host as SceneAudioHostLike | null));
  },

  dispose() {
    generation += 1; // an in-flight start discards itself (and closes its context)
    if (system) system.dispose(); // closes the context
    else if (!initPromise) void context?.close().catch(() => undefined);
    system = null;
    initPromise = null;
    context = null;
  },

  get ready() {
    return system !== null;
  },

  get contextState() {
    return context ? (context.state as AudioContextState | 'interrupted') : 'none';
  },

  play(id, opts) {
    return system ? system.play(id, opts) : false;
  },

  requestVoice(ids, opts) {
    return system ? system.requestVoice(ids, opts) : false;
  },

  onSubtitle(listener) {
    subtitleListeners.add(listener);
    return () => subtitleListeners.delete(listener);
  },

  setFrame(frame) {
    withSystem((s) => s.setFrame(frame));
  },

  setEmitters(list) {
    withSystem((s) => s.setEmitters(list));
  },

  upsertEmitters(list, removedIds) {
    withSystem((s) => s.upsertEmitters(list, removedIds));
  },

  setTrucks(list) {
    withSystem((s) => s.setTrucks(list));
  },

  setMusicState(state) {
    withSystem((s) => s.setMusicState(state));
  },

  setOverlayOpen(open) {
    withSystem((s) => s.setMusicTone(open ? 'modal' : 'normal'));
  },

  sceneModule() {
    return {
      name: 'audio' as const,
      init(ctx) {
        const controls = ctx.controls as { target?: THREE.Vector3 } | undefined;
        audio.attachScene({ camera: ctx.camera, scene: ctx.scene, getTarget: controls?.target ? () => controls.target ?? null : undefined });
      },
      dispose() {
        audio.attachScene(null);
      },
    };
  },

  get listener() {
    return system ? system.engine.listener : null;
  },

  get system() {
    return system;
  },
};

export { useAudioSettings, AUDIO_DEFAULTS, type AudioSettings, type AdvisorFrequency } from './settings';
export type { SubtitleEvent, VoiceRequestOptions, VoiceSkipReason } from './voice/VoiceQueue';
export type { AudioBusEvents } from './AudioSystem';
export type { TraceRecord, TraceSummary } from './debug/AudioTrace';
export type { AudioFrame } from './ambience/ambienceModel';
export type { EmitterSource } from './world/emitterModel';
export type { TruckSource } from './world/EmitterManager';
export type { SfxPlayOptions } from './sfx/SfxPlayer';
export type { MusicState } from './music/musicRules';
