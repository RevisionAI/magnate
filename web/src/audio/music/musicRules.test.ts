import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INPUTS,
  DWELL_MS,
  TENSION_MIN_MS,
  desiredState,
  intensity,
  normalizeMusicState,
  noteMonthClose,
  pressureWanted,
  transitionFor,
  type DirectorMemory,
  type MusicInputs,
  type MusicState,
} from './musicRules';

/** An established mid-game company: 12 months in, 8 buildings, cash positive, quiet. */
const BASE: MusicInputs = { ...DEFAULT_INPUTS, inGame: true, cash: 5e6, buildings: 8, monthsElapsed: 12 };
const LONG_AGO = -1e9;
const mem = (state: MusicState, enteredAt = LONG_AGO, okCloses = 0): DirectorMemory => ({ state, enteredAt, okCloses });
const NOW = 0;

/**
 * Inputs whose intensity is exactly `k` (0.06 ≤ k ≤ 0.81): 8 buildings give 0.06, then revenue growth
 * (up to 0.25), construction (up to 0.30) and recent events (up to 0.20) fill the rest in that order.
 */
function withIntensity(k: number, extra: Partial<MusicInputs> = {}): MusicInputs {
  let rest = k - 0.15 * (8 / 20);
  const take = (max: number) => {
    const x = Math.max(0, Math.min(max, rest));
    rest -= x;
    return x / max;
  };
  const revQoQ = take(0.25) * 0.25;
  const underConstruction = take(0.3) * 3;
  const events2m = take(0.2) * 6;
  return { ...BASE, revQoQ, underConstruction, events2m, ...extra };
}

describe('intensity (audio-plan §4.7.2)', () => {
  it('weights construction, revenue growth, events, size and speed', () => {
    expect(intensity({ ...BASE, buildings: 0 })).toBe(0);
    expect(intensity({ ...BASE, buildings: 0, underConstruction: 3 })).toBeCloseTo(0.3, 9);
    expect(intensity({ ...BASE, buildings: 0, revQoQ: 0.25 })).toBeCloseTo(0.25, 9);
    expect(intensity({ ...BASE, buildings: 0, events2m: 6 })).toBeCloseTo(0.2, 9);
    expect(intensity({ ...BASE, buildings: 20 })).toBeCloseTo(0.15, 9);
    expect(intensity({ ...BASE, buildings: 0, speed: 4 })).toBeCloseTo(0.1, 9);
    expect(intensity({ ...BASE, underConstruction: 9, revQoQ: 3, events2m: 99, buildings: 99, speed: 8 })).toBe(1);
    for (const k of [0.1, 0.19, 0.3, 0.45, 0.6, 0.81]) expect(intensity(withIntensity(k))).toBeCloseTo(k, 9);
  });
});

describe('desiredState (audio-plan §4.7.3, first match wins)', () => {
  const cases: [string, MusicInputs, DirectorMemory, MusicState][] = [
    ['title screen', { ...BASE, inGame: false }, mem('steady'), 'title'],
    ['won → victory', { ...BASE, outcome: 'won', cash: -1 }, mem('tension'), 'victory'],
    ['lost → defeat', { ...BASE, outcome: 'lost' }, mem('steady'), 'defeat'],
    ['victory is terminal', { ...BASE, outcome: 'playing' }, mem('victory'), 'victory'],
    ['cash < 0 → tension', { ...BASE, cash: -1 }, mem('growth'), 'tension'],
    ['runway < 3 → tension', { ...BASE, runway: 2.9 }, mem('steady'), 'tension'],
    ['runway 3 is not tension', withIntensity(0.3, { runway: 3 }), mem('steady'), 'steady'],
    ['insolvency ≤ 3 → tension', { ...BASE, insolvencyMonthsLeft: 3 }, mem('steady'), 'tension'],
    ['panic → tension', { ...BASE, climate: 'panic' }, mem('steady'), 'tension'],
    ['drawdown ≥ 40 % → tension', { ...BASE, drawdown: 0.4 }, mem('steady'), 'tension'],
    ['tension beats recession', { ...BASE, cash: -1, climate: 'recession' }, mem('recession'), 'tension'],
    ['recession', { ...BASE, climate: 'recession' }, mem('steady'), 'recession'],
    ['recession beats growth', withIntensity(0.9, { climate: 'recession' }), mem('growth'), 'recession'],
    ['growth at 0.60', withIntensity(0.6), mem('steady'), 'growth'],
    ['not growth at 0.59', withIntensity(0.59), mem('steady'), 'steady'],
    ['boom: growth at 0.45', withIntensity(0.45, { climate: 'boom' }), mem('steady'), 'growth'],
    ['growth holds above 0.40', withIntensity(0.41), mem('growth'), 'growth'],
    ['growth exits below 0.40', withIntensity(0.39), mem('growth'), 'steady'],
    ['boom: growth holds above 0.30', withIntensity(0.31, { climate: 'boom' }), mem('growth'), 'growth'],
    ['boom: growth exits below 0.30', withIntensity(0.29, { climate: 'boom' }), mem('growth'), 'steady'],
    ['early game → calm', { ...BASE, monthsElapsed: 5, buildings: 3 }, mem('steady'), 'calm'],
    ['early but 4 buildings → not calm by age', withIntensity(0.3, { monthsElapsed: 5, buildings: 4 }), mem('steady'), 'steady'],
    ['intensity < 0.20 → calm', withIntensity(0.19), mem('steady'), 'calm'],
    ['otherwise steady', withIntensity(0.3), mem('calm'), 'steady'],
  ];
  it.each(cases)('%s', (_name, inputs, memory, want) => {
    expect(desiredState(inputs, memory, NOW)).toBe(want);
  });
});

describe('hysteresis and dwell', () => {
  it('needs 60 s in the current state before moving among calm / steady / growth', () => {
    const fresh = mem('steady', NOW - (DWELL_MS - 1));
    expect(desiredState(withIntensity(0.9), fresh, NOW)).toBe('steady');
    expect(desiredState(withIntensity(0.9), mem('steady', NOW - DWELL_MS), NOW)).toBe('growth');
    expect(desiredState(withIntensity(0.1), mem('growth', NOW - 1000), NOW)).toBe('growth');
  });

  it('never delays an escalation to tension or recession', () => {
    expect(desiredState({ ...BASE, cash: -5 }, mem('calm', NOW - 10), NOW)).toBe('tension');
    expect(desiredState({ ...BASE, climate: 'recession' }, mem('growth', NOW - 10), NOW)).toBe('recession');
  });

  it('leaves tension only after 2 good closes, a safe runway, no panic, and ≥ 30 s', () => {
    const ok: MusicInputs = { ...BASE, runway: null };
    expect(desiredState(ok, mem('tension', LONG_AGO, 1), NOW)).toBe('tension'); // one good close
    expect(desiredState(ok, mem('tension', LONG_AGO, 2), NOW)).not.toBe('tension');
    expect(desiredState({ ...ok, runway: 6 }, mem('tension', LONG_AGO, 5), NOW)).toBe('tension'); // runway must be > 6
    expect(desiredState({ ...ok, runway: 6.5 }, mem('tension', LONG_AGO, 5), NOW)).not.toBe('tension');
    expect(desiredState(ok, mem('tension', NOW - (TENSION_MIN_MS - 1), 5), NOW)).toBe('tension');
    expect(desiredState(ok, mem('tension', NOW - TENSION_MIN_MS, 5), NOW)).not.toBe('tension');
  });

  it('counts consecutive month closes with cash ≥ 0 and resets on a negative one', () => {
    let m = mem('tension');
    m = noteMonthClose(m, { ...BASE, cash: 10 });
    m = noteMonthClose(m, { ...BASE, cash: 0 });
    expect(m.okCloses).toBe(2);
    m = noteMonthClose(m, { ...BASE, cash: -1 });
    expect(m.okCloses).toBe(0);
  });

  it('a recovered player steps down from tension into the state the inputs call for', () => {
    expect(desiredState(withIntensity(0.3, { runway: null }), mem('tension', LONG_AGO, 2), NOW)).toBe('steady');
    expect(desiredState(withIntensity(0.7, { runway: null }), mem('tension', LONG_AGO, 2), NOW)).toBe('growth');
  });
});

describe('pressure layer (§4.7.3 #7)', () => {
  it('plays while a warning is open in an operating state or a recession, never in tension or endings', () => {
    const warn = { ...BASE, warningActive: true };
    for (const s of ['calm', 'steady', 'growth', 'recession'] as MusicState[]) expect(pressureWanted(warn, s)).toBe(true);
    for (const s of ['title', 'tension', 'victory', 'defeat'] as MusicState[]) expect(pressureWanted(warn, s)).toBe(false);
    expect(pressureWanted(BASE, 'steady')).toBe(false);
  });
});

describe('transitionFor (§4.7.4 table)', () => {
  it('quantises and crossfades per the table, with key-compatible stingers', () => {
    expect(transitionFor('title', 'calm')).toMatchObject({ quantize: 'now', fade: 2.5 });
    expect(transitionFor('calm', 'steady')).toMatchObject({ quantize: 'beat', fade: 4, minAhead: 0.5 });
    expect(transitionFor('steady', 'tension')).toMatchObject({ quantize: 'beat', fade: 1.5, stinger: 'stinger.tension' });
    expect(transitionFor('tension', 'steady')).toMatchObject({ quantize: 'bar', fade: 3, stinger: 'stinger.recovery' });
    expect(transitionFor('steady', 'recession')).toMatchObject({ quantize: 'bar', fade: 6 });
    expect(transitionFor('steady', 'recession').stinger).toBeUndefined();
    expect(transitionFor('recession', 'growth')).toMatchObject({ quantize: 'bar', fade: 5, stinger: 'stinger.recovery' });
    expect(transitionFor('growth', 'victory')).toMatchObject({ quantize: 'now', fade: 0.8, stinger: 'victory_fanfare' });
    expect(transitionFor('tension', 'defeat')).toMatchObject({ quantize: 'now', fade: 1.5, stinger: 'defeat_sting' });
    expect(transitionFor(null, 'steady')).toMatchObject({ quantize: 'now' });
  });

  it('accepts the brief’s state names (busy = growth, crisis = tension)', () => {
    expect(normalizeMusicState('busy')).toBe('growth');
    expect(normalizeMusicState('crisis')).toBe('tension');
    expect(normalizeMusicState('steady')).toBe('steady');
    expect(normalizeMusicState('disco')).toBeNull();
  });
});
