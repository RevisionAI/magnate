// Noise generators (pure; shared by the main thread and the DSP worker).

export type NoiseKind = 'white' | 'brown';

export function fillWhite(d: Float32Array): void {
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

/**
 * Brown-ish noise: leaky-integrated white noise normalised to an RMS of 0.25 (peaks ≈ 1). Normalising
 * by RMS rather than by the random peak keeps its level the same from one realisation to the next
 * (peak normalisation varied it by ±2 dB), so the calibrated levels hold.
 */
export function fillBrown(d: Float32Array): void {
  let y = 0;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    y = 0.995 * y + (Math.random() * 2 - 1) * 0.1;
    d[i] = y;
    sum += y * y;
  }
  const k = 0.25 / (Math.sqrt(sum / Math.max(1, d.length)) || 1);
  for (let i = 0; i < d.length; i++) d[i] = (d[i] as number) * k;
}

/** Two decorrelated channels of `frames` samples. */
export function makeNoise(kind: NoiseKind, frames: number): Float32Array<ArrayBuffer>[] {
  const fill = kind === 'brown' ? fillBrown : fillWhite;
  return [0, 1].map(() => {
    const d = new Float32Array(frames);
    fill(d);
    return d;
  });
}
