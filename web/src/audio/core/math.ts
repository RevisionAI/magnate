// Small numeric helpers shared by the audio modules. Pure functions only (unit-tested).

export const dbToGain = (db: number): number => 10 ** (db / 20);
export const gainToDb = (gain: number): number => (gain > 0 ? 20 * Math.log10(gain) : -Infinity);

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => clamp(x, 0, 1);

/** Hermite smoothstep: 0 below e0, 1 above e1. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Unnormalised gaussian bump with peak 1 at `mu`. */
export const gauss = (x: number, mu: number, sigma: number): number => Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));

/**
 * Volume slider (0–100) to linear gain. Linear amplitude above 10 % so the UX defaults land on the
 * audio-plan §2.3 mix; a quadratic tail below reaches true silence at 0 (audio-plan §4.4).
 */
export function sliderGain(v: number): number {
  const x = clamp01(v / 100);
  return x >= 0.1 ? x : 10 * x * x;
}

/**
 * Equal-power fade curve with `n` points for setValueCurveAtTime, from `from` to `to`: a sin shape for
 * a fade-in (`'in'`, rising), a cos shape for a fade-out (`'out'`, e.g. `equalPowerCurve(64, 'out', 1, 0)`).
 */
export function equalPowerCurve(n: number, direction: 'in' | 'out', from = 0, to = 1): Float32Array {
  const c = new Float32Array(Math.max(2, n));
  for (let k = 0; k < c.length; k++) {
    const x = k / (c.length - 1);
    const shape = direction === 'in' ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2);
    c[k] = direction === 'in' ? from + (to - from) * shape : to + (from - to) * shape;
  }
  return c;
}

/** Cents to a playback-rate ratio. */
export const centsToRatio = (cents: number): number => 2 ** (cents / 1200);

/** Uniform random in [lo, hi). Audio is presentation-only, so Math.random is fine (audio-plan §4.1). */
export const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

/** Pick one element uniformly. */
export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

/**
 * Shuffle bag: returns items in random order, refilling when empty, and never repeats the last
 * item across a refill boundary (audio-plan §4.10 variants).
 */
export class ShuffleBag<T> {
  private bag: T[] = [];
  private last: T | undefined;
  constructor(private readonly items: readonly T[], private readonly random: () => number = Math.random) {}

  next(): T {
    if (this.items.length === 1) return this.items[0] as T;
    if (this.bag.length === 0) {
      this.bag = [...this.items];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j] as T, this.bag[i] as T];
      }
      // never play the same variant twice in a row across refills
      if (this.bag[this.bag.length - 1] === this.last) {
        const end = this.bag.length - 1;
        [this.bag[0], this.bag[end]] = [this.bag[end] as T, this.bag[0] as T];
      }
    }
    const item = this.bag.pop() as T;
    this.last = item;
    return item;
  }
}

/** One-pole smoothing towards a target (for meter ballistics). */
export const approach = (current: number, target: number, coeff: number): number => current + (target - current) * coeff;
