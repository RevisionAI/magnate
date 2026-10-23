// ITU-R BS.1770-4 loudness for Float32Array PCM at any sample rate (pure; unit-tested in Node).
// Used by the offline recipe level test (audio-plan §4.14), to normalise procedurally rendered loops
// to their class targets, and by the AudioLab level report.
//
// K-weighting coefficients are derived for the actual sample rate by the bilinear design libebur128
// uses (pre-warped tan(π·f0/fs) with BS.1770's analogue prototypes: high shelf +4 dB @ 1681.97 Hz,
// Q 0.7072, shelf-midpoint exponent 0.49967; high-pass 38.135 Hz, Q 0.5003, numerator [1, −2, 1]).
// At 48 kHz it reproduces the BS.1770-4 tables (unit-tested), so EBU Tech 3341 case 1 (997 Hz,
// −23 dBFS stereo) reads −23.0 LUFS.

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  const shelf = (() => {
    const f0 = 1681.974450955533;
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * f0) / sampleRate);
    const Vh = 10 ** (G / 20);
    const Vb = Vh ** 0.4996667741545416;
    const a0 = 1 + K / Q + K * K;
    return {
      b0: (Vh + (Vb * K) / Q + K * K) / a0,
      b1: (2 * (K * K - Vh)) / a0,
      b2: (Vh - (Vb * K) / Q + K * K) / a0,
      a1: (2 * (K * K - 1)) / a0,
      a2: (1 - K / Q + K * K) / a0,
    };
  })();
  const hp = (() => {
    const f0 = 38.13547087602444;
    const Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * f0) / sampleRate);
    const a0 = 1 + K / Q + K * K;
    return { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  })();
  return [shelf, hp];
}

function filter(x: Float32Array, f: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] as number;
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

function filter64(x: Float64Array, f: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] as number;
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

export interface LoudnessResult {
  /** Gated integrated loudness, LUFS (−Infinity for silence). */
  integrated: number;
  /** Maximum 400 ms momentary loudness, LUFS (signals shorter than 400 ms are zero-padded). */
  momentaryMax: number;
  /** Sample peak, dBFS. */
  samplePeak: number;
  /** 4× oversampled peak estimate, dBTP. */
  truePeak: number;
  /** Seconds of signal analysed. */
  duration: number;
  /** NaN/Infinity samples found (must be 0). */
  nonFinite: number;
}

export interface LoudnessOptions {
  /** A mono signal played on both stereo channels (no panner): +3.01 dB. */
  dualMono?: boolean;
}

/** Loudness of planar PCM (one Float32Array per channel). */
export function measureLoudness(channels: Float32Array[], sampleRate: number, opts: LoudnessOptions = {}): LoudnessResult {
  const [shelf, hp] = kWeighting(sampleRate);
  const n = channels[0]?.length ?? 0;
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  const len = Math.max(n, block);
  const weight = opts.dualMono && channels.length === 1 ? 2 : 1;
  // per-channel cumulative sum of squared K-weighted samples
  const cums: Float64Array[] = [];
  let peak = 0;
  let nonFinite = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] as number;
      if (!Number.isFinite(v)) {
        nonFinite++;
        continue;
      }
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    const y = filter64(filter(ch, shelf), hp);
    const cum = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) {
      const s = i < y.length ? (y[i] as number) : 0;
      cum[i + 1] = (cum[i] as number) + (Number.isFinite(s) ? s * s : 0);
    }
    cums.push(cum);
  }
  const powers: number[] = [];
  for (let start = 0; start + block <= len; start += hop) {
    let p = 0;
    for (const cum of cums) p += ((cum[start + block] as number) - (cum[start] as number)) / block;
    powers.push(p * weight);
  }
  const toLufs = (p: number) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);
  let mMax = -Infinity;
  for (const p of powers) mMax = Math.max(mMax, toLufs(p));
  const abs = powers.filter((p) => toLufs(p) > -70);
  let integrated = -Infinity;
  if (abs.length) {
    const rel = toLufs(abs.reduce((s, p) => s + p, 0) / abs.length) - 10;
    const gated = abs.filter((p) => toLufs(p) > rel);
    if (gated.length) integrated = toLufs(gated.reduce((s, p) => s + p, 0) / gated.length);
  }
  return {
    integrated,
    momentaryMax: mMax,
    samplePeak: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    truePeak: truePeakDb(channels, peak),
    duration: n / sampleRate,
    nonFinite,
  };
}

/** 4× oversampled peak with a 48-tap windowed-sinc interpolator (good to ~0.2 dB). */
export function truePeakDb(channels: Float32Array[], samplePeak?: number): number {
  const taps = 12; // per side
  const kernel: number[][] = [];
  for (let phase = 1; phase < 4; phase++) {
    const frac = phase / 4;
    const k: number[] = [];
    for (let j = -taps + 1; j <= taps; j++) {
      const x = j - frac;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (taps + 1)); // Hann
      k.push(sinc * w);
    }
    kernel.push(k);
  }
  let peak = samplePeak ?? 0;
  for (const ch of channels) {
    if (samplePeak === undefined) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i] as number));
    for (let i = 0; i + 1 < ch.length; i++) {
      // only interpolate around loud samples (cheap and exact enough for a ceiling check)
      const a = Math.abs(ch[i] as number);
      if (a < peak * 0.5) continue;
      for (const k of kernel) {
        let s = 0;
        for (let j = -taps + 1, m = 0; j <= taps; j++, m++) {
          const idx = i + j;
          if (idx >= 0 && idx < ch.length) s += (ch[idx] as number) * (k[m] as number);
        }
        const v = Math.abs(s);
        if (v > peak) peak = v;
      }
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/** Scale planar PCM in place by `gainDb`. */
export function applyGainDb(channels: Float32Array[], gainDb: number): void {
  const g = 10 ** (gainDb / 20);
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] = (ch[i] as number) * g;
}
