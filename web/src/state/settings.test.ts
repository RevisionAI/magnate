import { describe, expect, it } from 'vitest';
import { themeCss, themeVariables } from '@/theme/cssVars';
import { DEFAULT_SETTINGS, effectiveReducedMotion, migrateSettings, sanitizeSettings, useSettingsStore } from './settingsStore';

describe('settings', () => {
  it('uses the UX §6.18 defaults', () => {
    expect(DEFAULT_SETTINGS.audio).toMatchObject({ master: 80, music: 60, sfx: 80, voice: 100, ambient: 50 });
    expect(DEFAULT_SETTINGS.gameplay.pauseInFullscreen).toBe(true);
    expect(DEFAULT_SETTINGS.gameplay.autoPause.goal).toBe(true);
    expect(DEFAULT_SETTINGS.gameplay.autoPause.everyMonth).toBe(false);
    expect(DEFAULT_SETTINGS.interface.uiScale).toBe(100);
    expect(DEFAULT_SETTINGS.graphics.dayNight).toBe('dynamic');
  });

  it('clamps and repairs corrupted payloads', () => {
    const s = sanitizeSettings({
      audio: { master: 400, music: -3, voice: 'loud', advisorVoice: 'sometimes' },
      interface: { uiScale: 10, colourVision: 'deutan' },
      gameplay: { autosaveMonths: 5, defaultSpeed: 0, autoPause: { rival: false, bogus: true } },
      controls: { bindings: { 'panel.build': ['X'], broken: [1, 2] } },
      junk: true,
    });
    expect(s.audio.master).toBe(100);
    expect(s.audio.music).toBe(0);
    expect(s.audio.voice).toBe(100);
    expect(s.audio.advisorVoice).toBe('important');
    expect(s.interface.uiScale).toBe(80);
    expect(s.interface.colourVision).toBe('deutan');
    expect(s.gameplay.autosaveMonths).toBe(6);
    expect(s.gameplay.defaultSpeed).toBe(1);
    expect(s.gameplay.autoPause.rival).toBe(false);
    expect(s.gameplay.autoPause.goal).toBe(true);
    expect(s.controls.bindings).toEqual({ 'panel.build': ['X'] });
    expect('junk' in s).toBe(false);
  });

  it('migrates the pre-versioned shape', () => {
    const s = migrateSettings({ volumes: { master: 30, music: 10 } }, 0);
    expect(s.audio.master).toBe(30);
    expect(s.audio.music).toBe(10);
    expect(s.audio.sfx).toBe(80);
  });

  it('updates a group through the store', () => {
    useSettingsStore.getState().update('audio', { music: 25 });
    expect(useSettingsStore.getState().audio.music).toBe(25);
    expect(useSettingsStore.getState().audio.master).toBe(80);
    useSettingsStore.getState().setAutoPause('rival', false);
    expect(useSettingsStore.getState().gameplay.autoPause.rival).toBe(false);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().audio.music).toBe(60);
    expect(useSettingsStore.getState().gameplay.autoPause.rival).toBe(true);
  });

  it('resolves reduced motion against the OS', () => {
    expect(effectiveReducedMotion('system', true)).toBe(true);
    expect(effectiveReducedMotion('system', false)).toBe(false);
    expect(effectiveReducedMotion('off', true)).toBe(false);
    expect(effectiveReducedMotion('on', false)).toBe(true);
  });
});

describe('theme variables', () => {
  it('generates CSS custom properties from the tokens', () => {
    const vars = themeVariables();
    expect(vars['--c-gold']).toBe('#D7B766');
    expect(vars['--owner-0']).toBe('#2F7DE1');
    expect(vars['--c-sev-critical']).toBe('#DF6F6A');
    expect(vars['--space-4']).toBe('1rem');
    expect(vars['--space-0_5']).toBe('0.125rem');
    expect(vars['--z-modal']).toBe('500');
    expect(vars['--ease-out']).toContain('cubic-bezier');
    expect(vars['--ease-spring']).toContain('cubic-bezier');
    expect(vars['--dur-rollup']).toBe('calc(600ms * var(--motion-scale, 1))');
    expect(vars['--hud-top-bar-height']).toBe('3.5rem');
    expect(themeCss(vars).startsWith(':root {')).toBe(true);
  });
});
