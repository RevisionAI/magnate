import { beforeEach, describe, expect, it } from 'vitest';
import { AUDIO_DEFAULTS, getAudioSettings, sanitizeSettings, useAudioSettings } from './settings';
import { audio } from './index';

describe('audio settings (audio-plan §4.4, UX §6.18)', () => {
  beforeEach(() => useAudioSettings.getState().reset());

  it('defaults to the UX §6.18 values', () => {
    expect(getAudioSettings()).toEqual(AUDIO_DEFAULTS);
    expect([AUDIO_DEFAULTS.master, AUDIO_DEFAULTS.music, AUDIO_DEFAULTS.sfx, AUDIO_DEFAULTS.voice, AUDIO_DEFAULTS.ambient]).toEqual([
      80, 60, 80, 100, 50,
    ]);
    expect(AUDIO_DEFAULTS.advisor).toBe('important');
    expect(AUDIO_DEFAULTS.subtitles).toBe(true);
  });

  it('sanitizes stale or hand-edited payloads', () => {
    const s = sanitizeSettings({ master: 140, music: -5, sfx: Number.NaN, advisor: 'loud' as never, mono: 'yes' as never });
    expect(s.master).toBe(100);
    expect(s.music).toBe(0);
    expect(s.sfx).toBe(AUDIO_DEFAULTS.sfx);
    expect(s.advisor).toBe('important');
    expect(s.mono).toBe(false);
    expect(sanitizeSettings(null)).toEqual(AUDIO_DEFAULTS);
  });

  it('audio.setVolumes (the U1 stub surface) writes 0–1 volumes into the persisted store as 0–100', () => {
    audio.setVolumes({ master: 0.5, music: 0.25, ambience: 1.2 });
    const s = getAudioSettings();
    expect(s.master).toBe(50);
    expect(s.music).toBe(25);
    expect(s.ambient).toBe(100);
    expect(s.sfx).toBe(AUDIO_DEFAULTS.sfx); // untouched buses keep their value
  });

  it('audio.setMuted / toggleMute flip the muted flag', () => {
    audio.setMuted(true);
    expect(getAudioSettings().muted).toBe(true);
    expect(audio.toggleMute()).toBe(false);
    expect(getAudioSettings().muted).toBe(false);
  });

  it('init() and warmup() resolve harmlessly where Web Audio does not exist', async () => {
    await expect(audio.warmup()).resolves.toBeUndefined();
    await expect(audio.init()).resolves.toBeUndefined();
    expect(audio.ready).toBe(false);
    expect(audio.listener).toBeNull();
  });

  it('the stub surface is a safe no-op before init()', () => {
    expect(audio.ready).toBe(false);
    expect(audio.contextState).toBe('none');
    expect(() => {
      audio.ui('click');
      audio.attachScene(null);
      audio.setFrame({ zoom01: 0.3 });
      audio.dispose();
    }).not.toThrow();
    expect(audio.play('ui_click')).toBe(false);
  });
});
