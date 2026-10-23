import { describe, expect, it } from 'vitest';
import { createSeasonState, sampleSeason, seasonOfMonth } from './Seasons';
import { WeatherSystem, type WeatherKind } from './Weather';

describe('seasons (art §3.14)', () => {
  it('maps months to meteorological seasons', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(seasonOfMonth)).toEqual([3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3]);
    expect(seasonOfMonth(-1)).toBe(3);
    expect(seasonOfMonth(13)).toBe(3);
  });

  it('high summer is neutral; autumn colours trees; winter strips deciduous canopies', () => {
    const s = createSeasonState();
    sampleSeason(6, 0.5, 'temperate', s);          // mid-July
    expect(s.vegTint.toArray()).toEqual([1, 1, 1]);
    expect(s.autumnShare).toBe(0);
    expect(s.bareShare).toBe(0);
    sampleSeason(9, 0.5, 'temperate', s);          // mid-October
    expect(s.autumnShare).toBeCloseTo(0.4, 6);
    expect(s.vegTint.r).toBeGreaterThan(s.vegTint.b);
    sampleSeason(0, 0.5, 'temperate', s);          // mid-January
    expect(s.bareShare).toBe(1);
    expect(s.snow).toBe(0);                        // temperate: snow only from weather
    expect(s.fieldStage).toBe('ploughed');
  });

  it('blends continuously between mid-month keys', () => {
    const a = sampleSeason(8, 0.999, 'temperate', createSeasonState()).autumnShare;
    const b = sampleSeason(9, 0.001, 'temperate', createSeasonState()).autumnShare;
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });

  it('cold climates get seasonal snow in winter; warm climates never go bare', () => {
    expect(sampleSeason(0, 0.5, 'cold', createSeasonState()).snow).toBeCloseTo(1, 6);
    expect(sampleSeason(6, 0.5, 'cold', createSeasonState()).snow).toBe(0);
    const warm = sampleSeason(0, 0.5, 'warm', createSeasonState());
    expect(warm.bareShare).toBe(0);
    expect(warm.autumnShare).toBe(0);
    expect(warm.vegDesat).toBeGreaterThan(0);
  });
});

function sequence(seed: number, seconds: number): WeatherKind[] {
  const w = new WeatherSystem(seed);
  w.setSeason(2, 'temperate');
  const kinds: WeatherKind[] = [];
  for (let t = 0; t < seconds; t += 1) {
    w.update(1);
    if (kinds[kinds.length - 1] !== w.state.kind) kinds.push(w.state.kind);
  }
  return kinds;
}

describe('weather', () => {
  it('starts clear and is deterministic per seed', () => {
    expect(new WeatherSystem(7).state.kind).toBe('clear');
    expect(sequence(1234, 4 * 3600)).toEqual(sequence(1234, 4 * 3600));
    expect(sequence(1234, 4 * 3600)).not.toEqual(sequence(99, 4 * 3600));
  });

  it('rain wets the streets over ~30 s and dries out after; overcast dims the sun', () => {
    const w = new WeatherSystem(1);
    w.force('rain');
    for (let i = 0; i < 60; i++) w.update(1);
    expect(w.state.rain).toBeGreaterThan(0.6);
    expect(w.state.wet).toBe(1);
    expect(w.state.sunScale).toBeLessThan(0.65);
    expect(w.state.fogFar).toBeLessThan(0.8);
    w.force('clear');
    for (let i = 0; i < 200; i++) w.update(1);
    expect(w.state.wet).toBe(0);
    expect(w.state.cloud).toBeLessThan(0.01);
  });

  it('snow builds cover and lingers after the snowfall stops', () => {
    const w = new WeatherSystem(1);
    w.force('snow', true);
    expect(w.state.snowCover).toBe(1);
    w.force('clear');
    for (let i = 0; i < 90; i++) w.update(1);
    expect(w.state.snowCover).toBe(1);             // lingering
    for (let i = 0; i < 200; i++) w.update(1);
    expect(w.state.snowCover).toBe(0);             // melted
  });

  it('storms flash lightning and notify listeners (thunder sync)', () => {
    const w = new WeatherSystem(3);
    w.force('storm', true);
    let strikes = 0;
    w.onLightning(() => strikes++);
    let maxFlash = 0;
    for (let i = 0; i < 60 * 60; i++) { w.update(1 / 60); maxFlash = Math.max(maxFlash, w.state.lightning); }
    expect(strikes).toBeGreaterThan(1);
    expect(maxFlash).toBeGreaterThan(0.5);
  });

  it('switching weather off clears the sky (the forced kind wins in dev tools)', () => {
    const w = new WeatherSystem(5);
    w.force('rain', true);
    w.force(null);
    w.enabled = false;
    for (let i = 0; i < 120; i++) w.update(1);
    expect(w.state.rain).toBeLessThan(0.01);
  });
});
