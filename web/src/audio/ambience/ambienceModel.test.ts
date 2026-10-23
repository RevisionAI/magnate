import { describe, expect, it } from 'vitest';
import { BED_IDS, bedGains, dayAmount, defaultFrame, oneShotRules, poissonFireProbability, zoom01FromDistance, type AudioFrame } from './ambienceModel';
import { constructLoopFor, emitterScore, emitterSpec, refDistance, selectVoices, type EmitterSource } from '../world/emitterModel';

const frame = (over: Partial<AudioFrame> = {}): AudioFrame => ({ ...defaultFrame('metropolis', true), ...over });

describe('zoom mapping (audio-plan §4.15)', () => {
  it('maps camera distance 40 m → 0, ≈268 m → 0.5, 1800 m → 1 on a log scale', () => {
    expect(zoom01FromDistance(40)).toBe(0);
    expect(zoom01FromDistance(268)).toBeCloseTo(0.5, 2);
    expect(zoom01FromDistance(1800)).toBe(1);
    expect(zoom01FromDistance(5)).toBe(0);
    expect(zoom01FromDistance(9000)).toBe(1);
  });
});

describe('bed mix (audio-plan §4.8)', () => {
  it('produces a finite 0…1 gain for every bed', () => {
    const g = bedGains(frame());
    expect(Object.keys(g).sort()).toEqual([...BED_IDS].sort());
    for (const v of Object.values(g)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('street zoom hears traffic and crowds; city zoom hears the city bed and high wind', () => {
    const street = bedGains(frame({ zoom01: 0 }));
    const city = bedGains(frame({ zoom01: 1 }));
    expect(street.amb_traffic_street).toBeGreaterThan(0.3);
    expect(city.amb_traffic_street).toBe(0);
    expect(street.amb_crowd).toBeGreaterThan(city.amb_crowd);
    expect(city.amb_city_day).toBeGreaterThan(street.amb_city_day);
    expect(city.amb_wind_high).toBeGreaterThan(0.2);
    expect(street.amb_wind_high).toBe(0);
  });

  it('follows the lighting clock: day beds at noon, night beds at midnight, fixed daylight when null', () => {
    expect(dayAmount(null)).toBe(1);
    expect(dayAmount(12)).toBe(1);
    expect(dayAmount(0)).toBe(0);
    const noon = bedGains(frame({ timeOfDay: 12, month: 6 }));
    const night = bedGains(frame({ timeOfDay: 0, month: 6, area: { ...frame().area, green: 0.6 } }));
    expect(noon.amb_city_night).toBe(0);
    expect(night.amb_city_day).toBe(0);
    expect(night.amb_city_night).toBeGreaterThan(0);
    expect(night.amb_insects_night).toBeGreaterThan(0); // summer night over a park
    expect(bedGains(frame({ timeOfDay: null })).amb_city_night).toBe(0);
  });

  it('rain swaps light for heavy and silences birds; harbour only on the coast', () => {
    const light = bedGains(frame({ rain: 0.3 }));
    const heavy = bedGains(frame({ rain: 1 }));
    expect(light.amb_rain_light).toBeGreaterThan(0.5);
    expect(light.amb_rain_heavy).toBe(0);
    expect(heavy.amb_rain_heavy).toBe(1);
    expect(heavy.amb_rain_light).toBe(0);
    expect(heavy.amb_birds).toBe(0);
    expect(bedGains(frame({ coastal: false })).amb_harbour).toBe(0);
    expect(bedGains(frame({ coastal: true, distToWaterPlots: 2 })).amb_harbour).toBeGreaterThan(0.3);
  });

  it('applies the city presets (hilltown is quieter and windier than metropolis)', () => {
    const metro = bedGains(frame({ cityId: 'metropolis', zoom01: 0.8 }));
    const hill = bedGains(frame({ cityId: 'hilltown', zoom01: 0.8 }));
    expect(hill.amb_city_day).toBeLessThan(metro.amb_city_day);
    expect(hill.amb_wind_high).toBeGreaterThan(metro.amb_wind_high);
  });
});

describe('random world one-shots', () => {
  const counts = { warehouses: 2, factories: 1, operatingFactories: 1, constructionSites: 1, busyStores: 3 };

  it('fires with the Poisson probability per step', () => {
    expect(poissonFireProbability(0, 0.1)).toBe(0);
    expect(poissonFireProbability(60, 1)).toBeCloseTo(1 - Math.exp(-1), 9);
  });

  it('halves every rate at 4×/8× and silences night-only/weather-only sounds when absent', () => {
    const normal = oneShotRules(frame({ zoom01: 0.2 }), counts, false);
    const fast = oneShotRules(frame({ zoom01: 0.2 }), counts, true);
    for (let i = 0; i < normal.length; i++) expect(fast[i]?.rate).toBeCloseTo((normal[i]?.rate ?? 0) / 2, 9);
    expect(normal.find((r) => r.id === 'thunder')?.rate).toBe(0); // no rain
    expect(normal.find((r) => r.id === 'ship_horn')?.rate).toBeGreaterThan(0);
    expect(oneShotRules(frame({ coastal: false }), counts, false).find((r) => r.id === 'ship_horn')?.rate).toBe(0);
  });
});

describe('positional emitters (audio-plan §4.9)', () => {
  const src = (over: Partial<EmitterSource>): EmitterSource => ({ id: 1, category: 'factory', x: 0, z: 0, footprintW: 2, footprintH: 2, ...over });

  it('maps categories, status and activity onto loops', () => {
    expect(emitterSpec(src({ status: 'operating', activity: { utilization: 1 } }))).toMatchObject({ loop: 'loop_factory', a: 1 });
    expect(emitterSpec(src({ status: 'idle' }))?.a).toBe(0.1);
    expect(emitterSpec(src({ category: 'oil_well', status: 'idle' }))).toBeNull(); // the pumpjack stops
    expect(emitterSpec(src({ category: 'supermarket', activity: { unitsSold: 1e6 } }))).toMatchObject({ loop: 'loop_retail', night: 0.15 });
    expect(emitterSpec(src({ category: 'media', typeId: 'tv_station' }))?.loop).toBe('loop_broadcast');
    expect(emitterSpec(src({ category: 'headquarters' }))).toBeNull();
    expect(emitterSpec(src({ status: 'underConstruction' }))?.loop).toMatch(/^construct_loop\./);
  });

  it('picks the construction loop deterministically per building', () => {
    const picks = new Set(Array.from({ length: 30 }, (_, i) => constructLoopFor(i)));
    expect(picks.size).toBe(3);
    expect(constructLoopFor(42)).toBe(constructLoopFor(42));
  });

  it('scores by activity and inverse distance beyond the reference distance', () => {
    const ref = refDistance(src({ footprintW: 2, footprintH: 3 }), 24);
    expect(ref).toBeCloseTo(1.2 * 3 * 24, 9);
    expect(emitterScore(1, 1, ref, 0)).toBe(1);
    expect(emitterScore(1, 1, ref, ref)).toBe(1);
    expect(emitterScore(1, 1, ref, 3 * ref)).toBeLessThan(0.5);
    expect(emitterScore(0.5, 1, ref, 0)).toBe(0.5);
  });

  it('holds a budget of 8 voices with 1.25× hysteresis against flapping', () => {
    const scores = Array.from({ length: 12 }, (_, i) => ({ key: `b${i}`, s: 1 - i * 0.05 }));
    const first = selectVoices(scores, new Set(), 8);
    expect([...first].sort()).toEqual(['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']);
    // a newcomer slightly louder than the weakest holder does not steal its voice …
    const nudged = scores.map((x) => (x.key === 'b8' ? { ...x, s: 0.7 } : x)); // weakest holder b7 = 0.65
    expect(selectVoices(nudged, first, 8).has('b8')).toBe(false);
    // … one clearly louder (> 1.25×) does
    const loud = scores.map((x) => (x.key === 'b9' ? { ...x, s: 0.9 } : x));
    const next = selectVoices(loud, first, 8);
    expect(next.has('b9')).toBe(true);
    expect(next.has('b7')).toBe(false);
    expect(next.size).toBe(8);
    // silent emitters release their voice
    expect(selectVoices(scores.map((x) => ({ ...x, s: x.key === 'b0' ? 0 : x.s })), first, 8).has('b0')).toBe(false);
  });
});
