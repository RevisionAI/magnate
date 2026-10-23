// Player settings (UX §6.18), persisted to localStorage (versioned). Settings are
// a per-browser convenience, not game state: they never enter a save.
//
//   const volume = useSettingsStore((s) => s.audio.music);
//   useSettingsStore.getState().update('audio', { music: 40 });
//
// Consumers outside React (audio, scene) read `useSettingsStore.getState()` and
// subscribe with `useSettingsStore.subscribe(...)` or the bus topic `settingsChanged`.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ColourVisionMode } from '@/theme/tokens';
import { isSpeed, type Speed } from '@/game/clock';
import { bus } from '@/game/events';
import { safeStorage } from '@/util/storage';
import { AUTO_PAUSE_DEFAULTS, type AutoPauseTrigger } from './autopause';

export type AdvisorVoice = 'all' | 'important' | 'off';
export type QualityPreset = 'auto' | 'low' | 'medium' | 'high' | 'ultra';
/** Art §2.3: cosmetic 12-minute day by default; fixed times for comfort/reduced motion. */
export type DayNightMode = 'dynamic' | 'day' | 'golden' | 'night';
export type ReducedMotionMode = 'system' | 'on' | 'off';
export type NumberFormat = 'short' | 'full';

export interface AudioSettings {
  /** 0–100 (UX §6.18 defaults 80 / 60 / 80 / 100 / 50). */
  master: number;
  music: number;
  sfx: number;
  voice: number;
  ambient: number;
  muted: boolean;
  muteInBackground: boolean;
  advisorVoice: AdvisorVoice;
  subtitles: boolean;
}

export interface GraphicsSettings {
  quality: QualityPreset;
  /** Render resolution scale, 50–100 (%). */
  resolutionScale: number;
  shadows: boolean;
  dayNight: DayNightMode;
  /** Ambient agents (traffic, shoppers) density, 0–100 (%). */
  ambientDensity: number;
  /** 0 = uncapped (vsync); 30 = render every other frame (the renderer's two modes). */
  fpsCap: 0 | 30;
}

export interface GameplaySettings {
  /** Speed Space resumes to when nothing was chosen yet. */
  defaultSpeed: Exclude<Speed, 0>;
  /** UX §6.2: full-screen screens (L3) pause time. ON by default. */
  pauseInFullscreen: boolean;
  autoPause: Record<AutoPauseTrigger, boolean>;
  /** In-game months between autosaves; 0 = off (D17: 3 rotating slots). */
  autosaveMonths: 0 | 3 | 6 | 12;
  tutorialHints: boolean;
  numberFormat: NumberFormat;
  /** Ask before quitting to the title with unsaved progress. */
  confirmQuit: boolean;
}

export interface InterfaceSettings {
  /** 80–150 (%). */
  uiScale: number;
  colourVision: ColourVisionMode;
  reducedMotion: ReducedMotionMode;
  highContrast: boolean;
  reduceTransparency: boolean;
  /** Always show company emblem shapes next to owner colours. */
  emblems: boolean;
}

export interface ControlsSettings {
  /** Action id → chords, overriding the defaults in ui/input/keymap.ts. */
  bindings: Record<string, string[]>;
  edgeScroll: boolean;
  invertRotate: boolean;
  /** 50–200 (%). */
  zoomSensitivity: number;
}

export interface Settings {
  audio: AudioSettings;
  graphics: GraphicsSettings;
  gameplay: GameplaySettings;
  interface: InterfaceSettings;
  controls: ControlsSettings;
}

export type SettingsGroup = keyof Settings;

export const SETTINGS_VERSION = 1;
export const SETTINGS_STORAGE_KEY = 'magnate.settings';

export const DEFAULT_SETTINGS: Settings = {
  audio: {
    master: 80,
    music: 60,
    sfx: 80,
    voice: 100,
    ambient: 50,
    muted: false,
    muteInBackground: true,
    advisorVoice: 'important',
    subtitles: true,
  },
  graphics: {
    quality: 'auto',
    resolutionScale: 100,
    shadows: true,
    dayNight: 'dynamic',
    ambientDensity: 100,
    fpsCap: 0,
  },
  gameplay: {
    defaultSpeed: 1,
    pauseInFullscreen: true,
    autoPause: { ...AUTO_PAUSE_DEFAULTS },
    autosaveMonths: 6,
    tutorialHints: true,
    numberFormat: 'short',
    confirmQuit: true,
  },
  interface: {
    uiScale: 100,
    colourVision: 'off',
    reducedMotion: 'system',
    highContrast: false,
    reduceTransparency: false,
    emblems: true,
  },
  controls: {
    bindings: {},
    edgeScroll: false,
    invertRotate: false,
    zoomSensitivity: 100,
  },
};

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
const oneOf = <T extends string | number>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/**
 * Validates and fills a (possibly partial, older or corrupted) settings object.
 * Unknown keys are dropped; every value is clamped to its legal range.
 */
export function sanitizeSettings(input: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const src = (typeof input === 'object' && input !== null ? input : {}) as Partial<Record<SettingsGroup, Record<string, unknown>>>;
  const a = src.audio ?? {};
  const g = src.graphics ?? {};
  const p = src.gameplay ?? {};
  const i = src.interface ?? {};
  const c = src.controls ?? {};
  const autoPauseIn = (typeof p.autoPause === 'object' && p.autoPause !== null ? p.autoPause : {}) as Record<string, unknown>;
  const autoPause = Object.fromEntries(
    (Object.keys(d.gameplay.autoPause) as AutoPauseTrigger[]).map((k) => [k, bool(autoPauseIn[k], d.gameplay.autoPause[k])]),
  ) as Record<AutoPauseTrigger, boolean>;
  const bindingsIn = (typeof c.bindings === 'object' && c.bindings !== null ? c.bindings : {}) as Record<string, unknown>;
  const bindings: Record<string, string[]> = {};
  for (const [action, chords] of Object.entries(bindingsIn)) {
    if (Array.isArray(chords) && chords.every((x) => typeof x === 'string')) bindings[action] = chords as string[];
  }
  const defaultSpeed = isSpeed(p.defaultSpeed) && p.defaultSpeed !== 0 ? p.defaultSpeed : d.gameplay.defaultSpeed;
  return {
    audio: {
      master: clamp(a.master, 0, 100, d.audio.master),
      music: clamp(a.music, 0, 100, d.audio.music),
      sfx: clamp(a.sfx, 0, 100, d.audio.sfx),
      voice: clamp(a.voice, 0, 100, d.audio.voice),
      ambient: clamp(a.ambient, 0, 100, d.audio.ambient),
      muted: bool(a.muted, d.audio.muted),
      muteInBackground: bool(a.muteInBackground, d.audio.muteInBackground),
      advisorVoice: oneOf(a.advisorVoice, ['all', 'important', 'off'] as const, d.audio.advisorVoice),
      subtitles: bool(a.subtitles, d.audio.subtitles),
    },
    graphics: {
      quality: oneOf(g.quality, ['auto', 'low', 'medium', 'high', 'ultra'] as const, d.graphics.quality),
      resolutionScale: clamp(g.resolutionScale, 50, 100, d.graphics.resolutionScale),
      shadows: bool(g.shadows, d.graphics.shadows),
      dayNight: oneOf(g.dayNight, ['dynamic', 'day', 'golden', 'night'] as const, d.graphics.dayNight),
      ambientDensity: clamp(g.ambientDensity, 0, 100, d.graphics.ambientDensity),
      fpsCap: oneOf(g.fpsCap, [0, 30] as const, d.graphics.fpsCap),
    },
    gameplay: {
      defaultSpeed,
      pauseInFullscreen: bool(p.pauseInFullscreen, d.gameplay.pauseInFullscreen),
      autoPause,
      autosaveMonths: oneOf(p.autosaveMonths, [0, 3, 6, 12] as const, d.gameplay.autosaveMonths),
      tutorialHints: bool(p.tutorialHints, d.gameplay.tutorialHints),
      numberFormat: oneOf(p.numberFormat, ['short', 'full'] as const, d.gameplay.numberFormat),
      confirmQuit: bool(p.confirmQuit, d.gameplay.confirmQuit),
    },
    interface: {
      uiScale: clamp(i.uiScale, 80, 150, d.interface.uiScale),
      colourVision: oneOf(i.colourVision, ['off', 'deutan', 'protan', 'tritan'] as const, d.interface.colourVision),
      reducedMotion: oneOf(i.reducedMotion, ['system', 'on', 'off'] as const, d.interface.reducedMotion),
      highContrast: bool(i.highContrast, d.interface.highContrast),
      reduceTransparency: bool(i.reduceTransparency, d.interface.reduceTransparency),
      emblems: bool(i.emblems, d.interface.emblems),
    },
    controls: {
      bindings,
      edgeScroll: bool(c.edgeScroll, d.controls.edgeScroll),
      invertRotate: bool(c.invertRotate, d.controls.invertRotate),
      zoomSensitivity: clamp(c.zoomSensitivity, 50, 200, d.controls.zoomSensitivity),
    },
  };
}

/** Migrates a persisted payload from any earlier version to the current shape. */
export function migrateSettings(persisted: unknown, version: number): Settings {
  // v0 (pre-versioned prototype) stored a flat audio object under `volumes`; fold it in.
  if (version < 1 && persisted && typeof persisted === 'object') {
    const old = persisted as { volumes?: Record<string, number> };
    if (old.volumes) return sanitizeSettings({ audio: { ...old.volumes } });
  }
  return sanitizeSettings(persisted);
}

interface SettingsActions {
  update<K extends SettingsGroup>(group: K, patch: Partial<Settings[K]>): void;
  setAutoPause(trigger: AutoPauseTrigger, enabled: boolean): void;
  setBinding(actionId: string, chords: string[] | null): void;
  reset(group?: SettingsGroup): void;
}

export type SettingsState = Settings & SettingsActions;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      update(group, patch) {
        const merged = sanitizeSettings({ ...pickSettings(get()), [group]: { ...get()[group], ...patch } });
        set({ [group]: merged[group] } as Partial<SettingsState>);
        bus.emit('settingsChanged', { group });
      },
      setAutoPause(trigger, enabled) {
        get().update('gameplay', { autoPause: { ...get().gameplay.autoPause, [trigger]: enabled } });
      },
      setBinding(actionId, chords) {
        const bindings = { ...get().controls.bindings };
        if (chords === null) delete bindings[actionId];
        else bindings[actionId] = chords;
        get().update('controls', { bindings });
      },
      reset(group) {
        if (group) {
          set({ [group]: structuredCloneSafe(DEFAULT_SETTINGS[group]) } as Partial<SettingsState>);
          bus.emit('settingsChanged', { group });
        } else {
          set(structuredCloneSafe(DEFAULT_SETTINGS));
          for (const g of Object.keys(DEFAULT_SETTINGS)) bus.emit('settingsChanged', { group: g });
        }
      },
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: SETTINGS_VERSION,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => pickSettings(state),
      migrate: (persisted, version) => migrateSettings(persisted, version),
      merge: (persisted, current) => ({ ...current, ...sanitizeSettings(persisted) }),
    },
  ),
);

/** Just the data part of the store (no actions). */
export function pickSettings(state: Settings): Settings {
  return {
    audio: state.audio,
    graphics: state.graphics,
    gameplay: state.gameplay,
    interface: state.interface,
    controls: state.controls,
  };
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Effective reduced motion: the explicit setting, else the OS preference. */
export function effectiveReducedMotion(mode: ReducedMotionMode, osPrefers: boolean): boolean {
  return mode === 'on' || (mode === 'system' && osPrefers);
}
