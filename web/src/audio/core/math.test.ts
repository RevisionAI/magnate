import { describe, expect, it } from 'vitest';
import { ShuffleBag, centsToRatio, dbToGain, equalPowerCurve, gainToDb, sliderGain, smoothstep } from './math';
import { limiterMakeupDb } from './AudioEngine';
import { AUDIO_DEFAULTS } from '../settings';

describe('dB helpers', () => {
  it('round-trips gain and dB', () => {
    for (const db of [-60, -20, -6.0206, 0, 3]) expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 9);
    expect(gainToDb(0)).toBe(-Infinity);
    expect(centsToRatio(1200)).toBeCloseTo(2, 12);
    expect(centsToRatio(-281)).toBeCloseTo(0.85, 2); // patent stamp at playbackRate 0.85 (audio-plan §6.2 #37)
  });
});

describe('sliderGain (audio-plan §4.4 taper)', () => {
  it('is linear amplitude above 10 % and reaches silence at 0', () => {
    expect(sliderGain(100)).toBe(1);
    expect(sliderGain(50)).toBe(0.5);
    expect(sliderGain(10)).toBeCloseTo(0.1, 12);
    expect(sliderGain(5)).toBeCloseTo(0.025, 12); // quadratic tail: 10·x²
    expect(sliderGain(0)).toBe(0);
    expect(sliderGain(-20)).toBe(0);
    expect(sliderGain(140)).toBe(1);
  });

  it('is continuous and monotonic', () => {
    let prev = -1;
    for (let v = 0; v <= 100; v += 0.5) {
      const g = sliderGain(v);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    expect(sliderGain(9.999)).toBeCloseTo(sliderGain(10), 3);
  });

  it('lands the UX defaults on the §2.3 bus gains (master −1.9, music −4.4, sfx −1.9, voice 0, ambient −6.0 dB)', () => {
    const d = AUDIO_DEFAULTS;
    expect(gainToDb(sliderGain(d.master))).toBeCloseTo(-1.94, 1);
    expect(gainToDb(sliderGain(d.music))).toBeCloseTo(-4.44, 1);
    expect(gainToDb(sliderGain(d.sfx))).toBeCloseTo(-1.94, 1);
    expect(gainToDb(sliderGain(d.voice))).toBe(0);
    expect(gainToDb(sliderGain(d.ambient))).toBeCloseTo(-6.02, 1);
  });
});

describe('equalPowerCurve', () => {
  it('fades in along sin and out along cos with constant power', () => {
    const fin = equalPowerCurve(64, 'in', 0, 1);
    const fout = equalPowerCurve(64, 'out', 1, 0);
    expect(fin[0]).toBe(0);
    expect(fin[63]).toBeCloseTo(1, 6);
    expect(fout[0]).toBeCloseTo(1, 6);
    expect(fout[63]).toBeCloseTo(0, 6);
    for (let k = 0; k < 64; k++) expect((fin[k] as number) ** 2 + (fout[k] as number) ** 2).toBeCloseTo(1, 5);
  });
});

describe('smoothstep', () => {
  it('clamps and eases', () => {
    expect(smoothstep(5, 7, 4)).toBe(0);
    expect(smoothstep(5, 7, 6)).toBe(0.5);
    expect(smoothstep(5, 7, 9)).toBe(1);
  });
});

describe('ShuffleBag (variants, audio-plan §4.10)', () => {
  it('never plays the same variant twice in a row and uses every variant per round', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const bag = new ShuffleBag(['a', 'b', 'c'], random);
    const seq = Array.from({ length: 300 }, () => bag.next());
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    for (let r = 0; r < 100; r++) expect(new Set(seq.slice(r * 3, r * 3 + 3)).size).toBe(3);
  });

  it('handles a single variant', () => {
    const bag = new ShuffleBag(['only']);
    expect([bag.next(), bag.next()]).toEqual(['only', 'only']);
  });
});

describe('limiter make-up compensation', () => {
  it('matches the Web Audio make-up formula for threshold −3 dB, ratio 20, knee 0', () => {
    // curve(0 dBFS) = −3 + 3/20 = −2.85 dB; make-up = 2.85 × 0.6 = 1.71 dB
    expect(limiterMakeupDb()).toBeCloseTo(1.71, 6);
  });
});
