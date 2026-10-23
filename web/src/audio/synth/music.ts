// Procedural music content that stands in for the not-yet-generated cues of audio-plan §7: the six
// stingers, the "Undertow" pressure layer and the "Closing Bell" defeat cue. Everything stays in the
// F major / D minor / G minor family so it is consonant with the existing cues and the UI pitch set.

import { NOTE, Synth } from './primitives';
import type { RecipeDef } from './recipes';
import type { Builder } from './render';

const N = NOTE;

export const STINGER_RECIPES: Record<string, RecipeDef> = {
  // any → tension: single dramatic low brass + timpani hit, short dark tail (D minor)
  'stinger.tension': {
    cls: 'stinger', dur: 3.0, detune: 0, origin: 'fallback', label: 'stinger: tension',
    fn: (s) => {
      const hall = s.reverb(1.8, 0.25);
      for (const f of [N.D2, N.A2, N.D3, N.F3]) s.brass(f, 0, 0.07, 0.3, { a: 0.015, r: 1.1, cutoff: 1400, to: hall });
      s.timpani(N.D2, 0, 0.55, 1.4, hall);
    },
  },
  // tension/recession → calmer: rising string swell resolving to a bright F major chord + chime
  'stinger.recovery': {
    cls: 'stinger', dur: 4.0, detune: 0, origin: 'fallback', label: 'stinger: recovery',
    fn: (s) => {
      const hall = s.reverb(2.0, 0.25);
      s.pad(N.A3, 0, 0.05, 1.0, { a: 1.2, r: 1.0, cutoff: 1600, to: hall });
      s.pad(N.C4, 0.2, 0.05, 0.8, { a: 1.0, r: 1.0, cutoff: 1800, to: hall });
      for (const f of [N.F4, N.A4, N.C5]) s.brass(f, 1.5, 0.05, 0.6, { a: 0.08, r: 1.2, cutoff: 2600, to: hall });
      s.bell(N.C7, 1.55, 0.02, 1.2, hall);
      s.bell(N.F7, 1.7, 0.012, 1.0, hall);
    },
  },
  // goal achieved, record month, market leader: short triumphant brass flourish + timpani (F major)
  'stinger.triumph': {
    cls: 'stinger', dur: 4.0, detune: 0, origin: 'fallback', label: 'stinger: triumph',
    fn: (s) => {
      const hall = s.reverb(1.8, 0.22);
      [N.C4, N.F4, N.A4].forEach((f, i) => s.brass(f, i * 0.15, 0.08, 0.1, { a: 0.012, r: 0.12, cutoff: 3200, to: hall }));
      for (const f of [N.F3, N.C4, N.F4, N.A4, N.C5]) s.brass(f, 0.45, 0.06, 1.0, { a: 0.02, r: 1.0, cutoff: 3000, to: hall });
      s.timpani(N.F2, 0, 0.35, 0.6, hall);
      s.timpani(N.F2, 0.45, 0.5, 1.2, hall);
      s.noise({ type: 'highpass', f: 6500, at: 0.45, a: 0.002, d: 1.4, pk: 0.035, to: hall });
    },
  },
  // market crash news: descending brass and low strings, falling motif (D minor)
  'stinger.crash': {
    cls: 'stinger', dur: 4.0, detune: 0, origin: 'fallback', label: 'stinger: crash',
    fn: (s) => {
      const hall = s.reverb(2.0, 0.25);
      s.pad(N.D2, 0, 0.06, 2.2, { a: 0.3, r: 1.2, cutoff: 600, to: hall });
      s.pad(N.A2, 0, 0.04, 2.2, { a: 0.3, r: 1.2, cutoff: 700, to: hall });
      [N.A3, N.F3, N.D3, N.A2].forEach((f, i) => s.brass(f, i * 0.35, 0.08, 0.28, { a: 0.02, r: 0.4, cutoff: 1800, to: hall }));
      for (let i = 0; i < 6; i++) s.timpani(N.D2, 1.4 + i * 0.07, 0.15 + i * 0.04, 0.5, hall);
    },
  },
  // climate → boom: bright pizzicato and brass lift (F major)
  'stinger.boom': {
    cls: 'stinger', dur: 3.0, detune: 0, origin: 'fallback', label: 'stinger: boom',
    fn: (s) => {
      const hall = s.reverb(1.5, 0.2);
      [N.F5, N.A5, N.C6, N.F6].forEach((f, i) => s.mallet(f, i * 0.08, 0.08, 0.22, hall));
      for (const f of [N.F4, N.A4, N.C5]) s.brass(f, 0.4, 0.06, 0.5, { a: 0.03, r: 0.8, cutoff: 3000, to: hall });
      s.timpani(N.F2, 0.4, 0.3, 0.8, hall);
    },
  },
  // with ipo_bell: celebratory orchestral swell with a celesta top (F major)
  'stinger.ipo': {
    cls: 'stinger', dur: 5.0, detune: 0, origin: 'fallback', label: 'stinger: IPO',
    fn: (s) => {
      const hall = s.reverb(2.4, 0.28);
      for (const f of [N.F3, N.A3, N.C4, N.F4]) s.pad(f, 0, 0.04, 1.2, { a: 1.4, r: 1.2, cutoff: 1800, to: hall });
      for (const f of [N.F4, N.A4, N.C5, N.F5]) s.brass(f, 1.5, 0.05, 1.2, { a: 0.05, r: 1.2, cutoff: 3200, to: hall });
      s.timpani(N.F2, 1.5, 0.45, 1.4, hall);
      [N.F6, N.A6, N.C7, N.F7, N.C7, N.F7].forEach((f, i) => s.bell(f, 1.6 + i * 0.11, 0.018, 0.9, hall));
    },
  },
};

/** "Undertow": D-pedal low-string tremolo, free time, key-neutral in F / Dm / Gm (20 s seamless). */
export const pressureLayer: Builder = (c, out, seconds) => {
  const lp = new BiquadFilterNode(c, { type: 'lowpass', frequency: 700, Q: 0.8 });
  const trem = new GainNode(c, { gain: 0.55 });
  const tremLfo = new OscillatorNode(c, { frequency: 6.5 });
  const tremAmt = new GainNode(c, { gain: 0.45 });
  tremLfo.connect(tremAmt).connect(trem.gain);
  const swell = new GainNode(c, { gain: 0.75 });
  const swellLfo = new OscillatorNode(c, { frequency: 0.05 }); // one swell per 20 s loop
  const swellAmt = new GainNode(c, { gain: 0.25 });
  swellLfo.connect(swellAmt).connect(swell.gain);
  lp.connect(trem).connect(swell).connect(out);
  const voices: [number, number][] = [
    [N.D2, 0.5],
    [N.D3, 0.35],
    [N.A2, 0.12],
  ];
  const oscs: OscillatorNode[] = [tremLfo, swellLfo];
  for (const [f, g] of voices) {
    for (const det of [-8, 0, 7]) {
      const o = new OscillatorNode(c, { type: 'sawtooth', frequency: f, detune: det });
      const vg = new GainNode(c, { gain: g / 3 });
      o.connect(vg).connect(lp);
      oscs.push(o);
    }
  }
  for (const o of oscs) {
    o.start(0);
    o.stop(seconds);
  }
};

/** "Closing Bell": somber D minor, 70 BPM — slow descending piano over low strings, open-fifth ending. */
export const defeatCue: Builder = (c, out) => {
  const s = new Synth(c, out, 0.05, 0);
  const hall = s.reverb(2.8, 0.3);
  const beat = 60 / 70;
  const bar = 4 * beat;
  const chords: [number, number[]][] = [
    [0, [N.D2, N.A2, N.D3, N.F3]],
    [1, [N.D2, N.A2, N.D3, N.F3]],
    [2, [N.Bb2 / 2, N.F2, N.Bb2, N.D3]],
    [3, [N.G3 / 2, N.D3, N.G3, N.Bb3]],
    [4, [N.A2, N.E3, N.A3, 277.18]],
  ];
  for (const [b, notes] of chords) for (const f of notes) s.pad(f, b * bar, 0.035, bar - 0.4, { a: 0.6, r: 0.9, cutoff: 900, to: hall });
  s.pad(N.D2, 5 * bar, 0.04, bar * 1.2, { a: 0.8, r: 2.5, cutoff: 700, to: hall });
  s.pad(N.A2, 5 * bar, 0.035, bar * 1.2, { a: 0.8, r: 2.5, cutoff: 700, to: hall });
  s.pad(N.D3, 5 * bar, 0.03, bar * 1.2, { a: 0.8, r: 2.5, cutoff: 800, to: hall });
  const melody: [number, number, number][] = [
    // [bar, beat, freq]
    [0, 0, N.A4], [0, 2, N.G4], [0, 3, N.F4],
    [1, 0, N.E4], [1, 2, N.D4],
    [2, 0, N.F4], [2, 2, N.D4], [2, 3, N.Bb3],
    [3, 0, N.D4], [3, 2, N.G3],
    [4, 0, 277.18], [4, 2, N.E4], [4, 3, N.A3],
    [5, 0, N.D4],
  ];
  for (const [b, bt, f] of melody) s.piano(f, b * bar + bt * beat, 0.07, b === 5 ? 4 : 2.2, hall);
  s.piano(N.D3, 5 * bar, 0.045, 4, hall);
  s.piano(N.A3, 5 * bar, 0.04, 4, hall);
};

/** Length of the procedural defeat cue in seconds (6 bars at 70 BPM + the decay). */
export const DEFEAT_CUE_SECONDS = 6 * 4 * (60 / 70) + 6;
