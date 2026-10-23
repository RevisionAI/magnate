// Deterministic randomness for asset factories (art §4.1 / §5.4): mulberry32 streams derived from the lot seed.
// Factories never touch Math.random or the clock, so the same (seed, variant, lot, params) yields identical arrays.

/** 32-bit integer mix (murmur3 finaliser) of a seed and a salt. */
export function mixSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Seeded PRNG (mulberry32) with the small helpers factories need. */
export class Rng {
  private state: number;
  constructor(readonly seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  f(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.f();
  }

  /** Integer in [a, b] (inclusive). */
  int(a: number, b: number): number {
    return a + Math.floor(this.f() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.f() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.f() * items.length) % items.length];
  }

  /** Weighted pick from [item, weight] pairs. */
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = this.f() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    return items[items.length - 1][0];
  }

  /** Independent sub-stream: decisions in one concern (colours, props…) never shift another's. */
  fork(salt: number): Rng {
    return new Rng(mixSeed(this.seed, salt));
  }
}
