// UI ↔ audio glue over the stable API in '@/audio' (A1 owns the implementation).
//
//   installAudioUnlock()   — audio.init() on the first user gesture (audio-plan §4.5:
//                            the AudioContext must be created inside a gesture)
//   uiSound('tab')         — UI feedback cue; the finer-grained cues A1 adds (tab,
//                            toggleOn/Off, slider…) degrade to no-ops on older builds
//   audioContextState()    — 'running' | 'suspended' | … | 'none' | 'unknown'
//
// Everything here is feature-detected so the shell keeps compiling and running
// against the Wave 1 stub and A1's full engine alike.

import { audio, type UiCue } from '@/audio';

/** The stable cues plus A1's additions (audio/index.ts UiCue in the A1 build). */
export type UiSoundCue = UiCue | 'toggleOn' | 'toggleOff' | 'tab' | 'slider' | 'priceTag' | 'placeOk' | 'placeInvalid';

type LooseAudio = {
  ui: (cue: string, opts?: { value?: number }) => void;
  contextState?: string;
  setPreferences?: (prefs: Record<string, unknown>) => void;
};

const loose = audio as unknown as LooseAudio;

/** Plays a UI cue; unknown cues are ignored by the audio engine. */
export function uiSound(cue: UiSoundCue, opts?: { value?: number }): void {
  try {
    loose.ui(cue, opts);
  } catch (error) {
    console.warn('[audio] ui cue failed', error);
  }
}

/** The AudioContext state when the audio engine reports it, else 'unknown'. */
export function audioContextState(): string {
  try {
    const state = loose.contextState;
    return typeof state === 'string' ? state : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Non-volume audio preferences (advisor voice frequency, subtitles, mute in
 * background). Forwarded when the audio API exposes `setPreferences` (requested
 * from A1); a no-op otherwise.
 */
export function setAudioPreferences(prefs: { advisor: 'all' | 'important' | 'off'; subtitles: boolean; muteInBackground: boolean }): void {
  try {
    loose.setPreferences?.(prefs);
  } catch (error) {
    console.warn('[audio] preferences not applied', error);
  }
}

const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;
let unlockInstalled = false;

/**
 * Calls `audio.init()` on the first user gesture (capture phase, so it runs inside
 * the gesture before any handler can stop it). A1's lifecycle re-arms itself for
 * later suspensions, so this only needs to fire once.
 */
export function installAudioUnlock(target: Window = window): void {
  if (unlockInstalled) return;
  unlockInstalled = true;
  const capture = { capture: true } as const;
  const kick = () => {
    for (const g of GESTURES) target.removeEventListener(g, kick, capture);
    audio.init().catch((error: unknown) => console.warn('[audio] init failed', error));
  };
  for (const g of GESTURES) target.addEventListener(g, kick, capture);
}
