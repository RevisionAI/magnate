// Applies settings to the world outside React: theme CSS variables (UI scale,
// colour-vision palette, motion, contrast, transparency) and the audio buses
// (audio.setVolumes / setMuted). Installed once from main.tsx.

import { audio } from '@/audio';
import { applyThemeOptions, prefersReducedMotion } from '@/theme/cssVars';
import { setAudioPreferences } from '@/ui/sound';
import { effectiveReducedMotion, useSettingsStore, type Settings } from './settingsStore';

/** 0–100 slider value → 0..1 bus gain (the audio engine owns the curve). */
const unit = (v: number) => Math.min(1, Math.max(0, v / 100));

export function applyAudioSettings(s: Settings['audio']): void {
  try {
    audio.setVolumes({
      master: unit(s.master),
      music: unit(s.music),
      sfx: unit(s.sfx),
      voice: unit(s.voice),
      ambience: unit(s.ambient),
    });
    audio.setMuted(s.muted);
    setAudioPreferences({ advisor: s.advisorVoice, subtitles: s.subtitles, muteInBackground: s.muteInBackground });
  } catch (error) {
    console.warn('[settings] audio not ready', error);
  }
}

function applyInterface(s: Settings['interface']): void {
  applyThemeOptions({
    uiScale: s.uiScale,
    colourVision: s.colourVision,
    reducedMotion: effectiveReducedMotion(s.reducedMotion, prefersReducedMotion()),
    highContrast: s.highContrast,
    reduceTransparency: s.reduceTransparency,
  });
}

let installed = false;

/** Applies the current settings and keeps them applied. Idempotent. */
export function installSettingsEffects(): void {
  if (installed) return;
  installed = true;
  const state = useSettingsStore.getState();
  applyInterface(state.interface);
  applyAudioSettings(state.audio);

  useSettingsStore.subscribe((next, prev) => {
    if (next.interface !== prev.interface) applyInterface(next.interface);
    if (next.audio !== prev.audio) applyAudioSettings(next.audio);
  });

  // Follow OS reduced-motion changes while the setting is "system".
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener?.('change', () => applyInterface(useSettingsStore.getState().interface));
  }
}

/** Reduced motion as currently applied (for JS animations: confetti, roll-ups, ticker). */
export function isReducedMotion(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.reducedMotion === 'true';
}
