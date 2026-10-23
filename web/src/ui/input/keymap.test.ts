import { describe, expect, it } from 'vitest';
import { RAIL_PANEL_IDS, PANEL_META } from '@/ui/panels/ids';
import { actionForEvent, chordFromEvent, conflictsFor, KEY_ACTIONS, matchChord, type KeyEventLike } from './keymap';

const key = (over: Partial<KeyEventLike>): KeyEventLike => ({ key: '', code: '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...over });

describe('chord matching', () => {
  it('matches letters by produced key and digits/period physically', () => {
    expect(matchChord('B', key({ key: 'b', code: 'KeyB' }))).toBe(true);
    expect(matchChord('B', key({ key: 'B', code: 'KeyB', shiftKey: true }))).toBe(false); // extra Shift
    expect(matchChord('1', key({ key: '1', code: 'Digit1' }))).toBe(true);
    expect(matchChord('Period', key({ key: '.', code: 'Period' }))).toBe(true);
    expect(matchChord('Shift+Period', key({ key: '>', code: 'Period', shiftKey: true }))).toBe(true);
    expect(matchChord('Space', key({ key: ' ', code: 'Space' }))).toBe(true);
    expect(matchChord('Shift+Slash', key({ key: '?', code: 'Slash', shiftKey: true }))).toBe(true);
  });

  it('maps Mod to ⌘ on macOS and Ctrl elsewhere', () => {
    expect(matchChord('Mod+S', key({ key: 's', code: 'KeyS', metaKey: true }), true)).toBe(true);
    expect(matchChord('Mod+S', key({ key: 's', code: 'KeyS', ctrlKey: true }), true)).toBe(false);
    expect(matchChord('Mod+S', key({ key: 's', code: 'KeyS', ctrlKey: true }), false)).toBe(true);
  });

  it('resolves UI actions and honours overrides', () => {
    expect(actionForEvent(key({ key: 'r', code: 'KeyR' }))?.id).toBe('panel.reports');
    expect(actionForEvent(key({ key: 'w', code: 'KeyW' }))).toBeNull(); // camera key belongs to the scene
    expect(actionForEvent(key({ key: 'x', code: 'KeyX' }), { 'panel.reports': ['X'] })?.id).toBe('panel.reports');
    expect(actionForEvent(key({ key: 'Escape', code: 'Escape' }), { 'menu.back': ['Q'] })?.id).toBe('menu.back'); // fixed
  });

  it('captures chords for rebinding and reports conflicts', () => {
    expect(chordFromEvent(key({ key: 'g', code: 'KeyG' }), false)).toBe('G');
    expect(chordFromEvent(key({ key: 's', code: 'KeyS', ctrlKey: true }), false)).toBe('Mod+S');
    expect(chordFromEvent(key({ key: '>', code: 'Period', shiftKey: true }), false)).toBe('Shift+Period');
    expect(chordFromEvent(key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), false)).toBeNull();
    expect(conflictsFor('panel.build', 'R').map((a) => a.id)).toEqual(['panel.reports']);
  });

  it('gives every rail destination its UX §6.20 hotkey', () => {
    const ui = new Map(KEY_ACTIONS.map((a) => [a.id, a.chords[0]]));
    for (const id of RAIL_PANEL_IDS) expect(ui.get(`panel.${id}`)).toBe(PANEL_META[id].hotkey);
    expect(RAIL_PANEL_IDS).toEqual(['build', 'markets', 'reports', 'finance', 'rnd', 'marketing', 'rivals', 'news', 'advisor', 'goals']);
    const defaults = KEY_ACTIONS.filter((a) => a.handler === 'ui').flatMap((a) => a.chords.map((c) => c.toLowerCase()));
    expect(new Set(defaults).size).toBe(defaults.length); // no duplicate default chords
  });
});
