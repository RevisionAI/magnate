// Client-side randomness for presentation and new-game seeds. Never reaches the
// engine's RNG streams (determinism lives in the engine, D18).

/** A fresh 31-bit game seed (bridge-spec §5.3: the client must send a random seed). */
export function randomSeed(): number {
  try {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return (buf[0] ?? 1) & 0x7fffffff || 1;
  } catch {
    return (Math.floor(Math.random() * 0x7fffffff) || 1) >>> 0;
  }
}

/** RFC 4122 v4 id (crypto.randomUUID when available). */
export function uuid(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    /* fall through */
  }
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${((8 + Math.random() * 4) | 0).toString(16)}${hex(3)}-${hex(12)}`;
}

/** Small deterministic PRNG (mulberry32) for procedural decoration (title skyline, placeholders). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
