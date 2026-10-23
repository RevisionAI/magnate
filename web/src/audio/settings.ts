// Audio settings (UX §6.18 defaults) persisted per viewer in localStorage (audio-plan §4.4).
// Viewer preferences live here, separate from game state (web/src/state/gameStore.ts): different
// lifetimes. The settings screen can bind to `useAudioSettings` directly or go through
// `audio.setVolumes()` / `audio.setMuted()`; both write this store.

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type AdvisorFrequency = 'all' | 'important' | 'off';

export interface AudioSettings {
  /** 0–100 sliders. */
  master: number;
  music: number;
  sfx: number;
  voice: number;
  ambient: number;
  muted: boolean;
  /** Suspend audio while the tab is hidden ("keep playing in background" is the inverse). */
  muteInBackground: boolean;
  /** Advisor voice frequency: all lines, P0/P1 + tutorial only, or none (subtitles still show). */
  advisor: AdvisorFrequency;
  subtitles: boolean;
  /** Mono downmix (accessibility). */
  mono: boolean;
  /** −6 dB on stinger/alert SFX plus a soft attack on stingers. */
  reduceSudden: boolean;
  /** Safari 16.4+: play even with the iOS silent switch on. */
  iosIgnoreSilentSwitch: boolean;
}

export const AUDIO_DEFAULTS: Readonly<AudioSettings> = Object.freeze({
  master: 80,
  music: 60,
  sfx: 80,
  voice: 100,
  ambient: 50,
  muted: false,
  muteInBackground: true,
  advisor: 'important',
  subtitles: true,
  mono: false,
  reduceSudden: false,
  iosIgnoreSilentSwitch: false,
});

const memory = new Map<string, string>();
/** localStorage when available; an in-memory map in private mode, blocked storage or Node tests. */
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      memory.set(k, v);
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      memory.delete(k);
    }
  },
};

export interface AudioSettingsStore extends AudioSettings {
  set(patch: Partial<AudioSettings>): void;
  reset(): void;
}

const SLIDERS = ['master', 'music', 'sfx', 'voice', 'ambient'] as const;

/** Clamp/validate a (possibly stale or hand-edited) persisted payload. */
export function sanitizeSettings(raw: Partial<AudioSettings> | null | undefined): AudioSettings {
  const s: AudioSettings = { ...AUDIO_DEFAULTS, ...(raw ?? {}) };
  for (const k of SLIDERS) {
    const v = Number(s[k]);
    s[k] = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : AUDIO_DEFAULTS[k];
  }
  if (!['all', 'important', 'off'].includes(s.advisor)) s.advisor = AUDIO_DEFAULTS.advisor;
  for (const k of ['muted', 'muteInBackground', 'subtitles', 'mono', 'reduceSudden', 'iosIgnoreSilentSwitch'] as const) {
    s[k] = typeof s[k] === 'boolean' ? s[k] : AUDIO_DEFAULTS[k];
  }
  return s;
}

export const useAudioSettings = create<AudioSettingsStore>()(
  persist(
    (set) => ({
      ...AUDIO_DEFAULTS,
      set: (patch) => set((s) => sanitizeSettings({ ...pickSettings(s), ...patch })),
      reset: () => set({ ...AUDIO_DEFAULTS }),
    }),
    {
      name: 'magnate.audio',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => pickSettings(s),
      migrate: (persisted) => sanitizeSettings(persisted as Partial<AudioSettings>),
      merge: (persisted, current) => ({ ...current, ...sanitizeSettings(persisted as Partial<AudioSettings>) }),
    },
  ),
);

export function pickSettings(s: AudioSettings): AudioSettings {
  return {
    master: s.master,
    music: s.music,
    sfx: s.sfx,
    voice: s.voice,
    ambient: s.ambient,
    muted: s.muted,
    muteInBackground: s.muteInBackground,
    advisor: s.advisor,
    subtitles: s.subtitles,
    mono: s.mono,
    reduceSudden: s.reduceSudden,
    iosIgnoreSilentSwitch: s.iosIgnoreSilentSwitch,
  };
}

export const getAudioSettings = (): AudioSettings => pickSettings(useAudioSettings.getState());
