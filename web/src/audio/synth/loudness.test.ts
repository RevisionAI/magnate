import { describe, expect, it, vi } from 'vitest';
import { kWeighting, measureLoudness, truePeakDb } from './loudness';
import { bakeLoop, limitPeaks } from './render';
import { noiseSecondsFor, peakGuardCurve } from './primitives';
import { makeNoise } from './noise';

// DSP-heavy (seconds of 48 kHz audio through the 4x true-peak meter): the default 5 s is too tight on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

const SR = 48000;
const sine = (freq: number, amp: number, seconds: number, sr = SR, phase = 0) =>
  Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sr + phase));
const db = (x: number) => 20 * Math.log10(x);

describe('BS.1770-4 meter', () => {
  it('reproduces the BS.1770-4 48 kHz K-weighting coefficients', () => {
    const [shelf, hp] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 6);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 6);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 6);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 6);
    expect([hp.b0, hp.b1, hp.b2]).toEqual([1, -2, 1]);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 6);
  });

  it('reads a 997 Hz stereo sine at −23 dBFS per channel as −23 LUFS (EBU Tech 3341 case 1)', () => {
    const s = sine(997, 10 ** (-23 / 20), 20);
    const lo = measureLoudness([s, s], SR);
    expect(lo.integrated).toBeCloseTo(-23, 1);
    expect(lo.momentaryMax).toBeCloseTo(-23, 1);
    expect(lo.samplePeak).toBeCloseTo(-23, 1);
  });

  it('treats a mono voice on both speakers as +3 dB (dual mono) and a panned one as single-channel', () => {
    const s = sine(997, 10 ** (-20 / 20), 5);
    expect(measureLoudness([s], SR).integrated).toBeCloseTo(-23.01, 1);
    expect(measureLoudness([s], SR, { dualMono: true }).integrated).toBeCloseTo(-20, 1);
  });

  it('works at other sample rates (32 kHz procedural beds)', () => {
    const s = sine(997, 10 ** (-23 / 20), 10, 32000);
    expect(measureLoudness([s, s], 32000).integrated).toBeCloseTo(-23, 1);
  });

  it('gates silence and short signals: −∞ for silence, zero-padded momentary for a 100 ms blip', () => {
    expect(measureLoudness([new Float32Array(SR)], SR).integrated).toBe(-Infinity);
    const blip = sine(997, 10 ** (-20 / 20), 0.1);
    const lo = measureLoudness([blip, blip], SR);
    expect(lo.momentaryMax).toBeCloseTo(-20 + 10 * Math.log10(0.1 / 0.4), 0); // 100 ms of energy in a 400 ms window
  });

  it('counts non-finite samples', () => {
    const s = sine(997, 0.1, 1);
    s[100] = Number.NaN;
    expect(measureLoudness([s], SR).nonFinite).toBe(1);
  });

  it('finds inter-sample peaks (4× oversampled true peak)', () => {
    // fs/4 sine at 45° phase: every sample sits at ±0.707 but the waveform peaks at 1.0
    const s = sine(SR / 4, 1, 0.05, SR, Math.PI / 4);
    expect(db(Math.max(...s.map(Math.abs)))).toBeCloseTo(-3.01, 1);
    expect(truePeakDb([s])).toBeGreaterThan(-0.3);
  });
});

describe('loop baking and the offline peak limiter', () => {
  it('bakes an equal-power seam so the last sample flows into the first', () => {
    const body = SR; // 1 s loop
    const xf = 4800; // 100 ms seam
    const src = sine(110, 0.5, (body + xf) / SR);
    const [loop] = bakeLoop([src], body, xf);
    expect(loop).toHaveLength(body);
    // across the wrap the waveform continues: the jump is no larger than ordinary sample-to-sample motion
    let maxStep = 0;
    for (let i = 1; i < body; i++) maxStep = Math.max(maxStep, Math.abs((loop![i] as number) - (loop![i - 1] as number)));
    expect(Math.abs((loop![0] as number) - (loop![body - 1] as number))).toBeLessThanOrEqual(maxStep * 1.01);
  });

  it('limits peaks to the ceiling, linked across channels, without touching quiet material', () => {
    const quiet = sine(220, 0.1, 1);
    const loud = sine(220, 0.1, 1);
    for (let i = 24000; i < 24100; i++) loud[i] = 0.9; // a spike
    const quietCopy = quiet.slice();
    limitPeaks([quiet, loud], SR, -6);
    expect(Math.max(...loud.map(Math.abs))).toBeLessThanOrEqual(10 ** (-6 / 20) + 1e-6);
    // far from the spike both channels are untouched (the release wraps around the loop: < 0.01 dB)
    expect(quiet[2000]).toBeCloseTo(quietCopy[2000] as number, 3);
    // linked: the quiet channel is turned down with the loud one at the spike
    expect(Math.abs(quiet[24050] as number)).toBeLessThan(0.9 * Math.abs(quietCopy[24050] as number));
  });
});

describe('peak guard curve (per-voice class ceiling)', () => {
  it('is the identity below the knee and never exceeds the ceiling', () => {
    const ceilingDb = -12;
    const c = 10 ** (ceilingDb / 20);
    const curve = peakGuardCurve(ceilingDb);
    const n = curve.length;
    const at = (x: number) => {
      // WaveShaperNode lookup (Web Audio spec): v = (n − 1)/2 · (x + 1), linear interpolation
      const v = ((n - 1) / 2) * (x + 1);
      const k = Math.min(n - 2, Math.max(0, Math.floor(v)));
      const f = v - k;
      return (1 - f) * (curve[k] as number) + f * (curve[k + 1] as number);
    };
    expect(n % 2).toBe(1);
    expect(at(0)).toBe(0);
    for (const x of [0.01, 0.1, 0.5 * c, 0.69 * c]) {
      expect(at(x)).toBeCloseTo(x, 6);
      expect(at(-x)).toBeCloseTo(-x, 6);
    }
    for (const x of [c, 1.2 * c, 2 * c, 1]) {
      expect(at(x)).toBeLessThanOrEqual(c);
      expect(at(x)).toBeGreaterThan(0.9 * c);
    }
    // monotonic: louder in → louder (or equal) out
    for (let i = 1; i < n; i++) expect(curve[i] as number).toBeGreaterThanOrEqual(curve[i - 1] as number);
    // a peak right at the ceiling loses well under 1 dB
    expect(db(at(c) / c)).toBeGreaterThan(-0.7);
  });
});

describe('noise sources', () => {
  const rms = (d: Float32Array) => Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length);
  it('white noise is uniform in ±1 with decorrelated channels', () => {
    const [l, r] = makeNoise('white', 48000);
    expect(Math.max(...l!.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(rms(l!)).toBeCloseTo(1 / Math.sqrt(3), 1);
    let dot = 0;
    for (let i = 0; i < l!.length; i++) dot += (l![i] as number) * (r![i] as number);
    expect(Math.abs(dot / l!.length)).toBeLessThan(0.01);
  });

  it('brown noise is RMS-normalised to 0.25, so every realisation has the same level', () => {
    for (let k = 0; k < 4; k++) {
      const [l] = makeNoise('brown', 32000 * 4);
      expect(rms(l!)).toBeCloseTo(0.25, 6);
    }
  });

  it('asks for at least the minimum length when nothing is cached', () => {
    expect(noiseSecondsFor('white', 44100, 1)).toBe(2);
    expect(noiseSecondsFor('brown', 44100, 1)).toBe(4);
    expect(noiseSecondsFor('white', 44100, 21)).toBe(21);
  });
});
