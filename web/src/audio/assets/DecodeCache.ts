// Byte-budgeted LRU of decoded AudioBuffers (audio-plan §2.6, §4.6). One instance per asset class
// (music, ambience, positional loops, sfx+vo). Requests for the same key share one in-flight decode;
// pinned entries (playing now / next) are never evicted, so the budget is soft while they play.

export interface BufferLike {
  readonly length: number;
  readonly numberOfChannels: number;
}

interface Entry<B> {
  buf: B;
  bytes: number;
  pins: number;
}

export class DecodeCache<B extends BufferLike = AudioBuffer> {
  private readonly map = new Map<string, Entry<B>>(); // Map iteration order = LRU order
  private readonly inflight = new Map<string, Promise<B>>();
  private used = 0;

  constructor(
    readonly name: string,
    private budgetBytes: number,
  ) {}

  /** Bytes held by decoded buffers (Float32 PCM: frames × channels × 4). */
  get bytes(): number {
    return this.used;
  }

  get budget(): number {
    return this.budgetBytes;
  }

  get size(): number {
    return this.map.size;
  }

  setBudget(bytes: number): void {
    this.budgetBytes = bytes;
    this.evict();
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** Synchronous lookup (touches LRU order). */
  peek(key: string): B | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.buf;
  }

  /** Return the cached buffer or run `produce` once (concurrent callers share the promise). */
  async get(key: string, produce: () => Promise<B>): Promise<B> {
    const hit = this.peek(key);
    if (hit) return hit;
    let p = this.inflight.get(key);
    if (!p) {
      p = produce();
      this.inflight.set(key, p);
      p.then(
        () => this.inflight.delete(key),
        () => this.inflight.delete(key),
      );
    }
    const buf = await p;
    if (!this.map.has(key)) {
      const bytes = buf.length * buf.numberOfChannels * 4;
      this.map.set(key, { buf, bytes, pins: 0 });
      this.used += bytes;
      this.evict();
    }
    return buf;
  }

  pin(key: string): void {
    const e = this.map.get(key);
    if (e) e.pins += 1;
  }

  unpin(key: string): void {
    const e = this.map.get(key);
    if (e && e.pins > 0) e.pins -= 1;
    this.evict();
  }

  delete(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    this.map.delete(key);
    this.used -= e.bytes;
  }

  clear(): void {
    this.map.clear();
    this.used = 0;
  }

  private evict(): void {
    if (this.used <= this.budgetBytes) return;
    for (const [k, v] of this.map) {
      if (this.used <= this.budgetBytes) break;
      if (v.pins > 0) continue;
      this.map.delete(k);
      this.used -= v.bytes;
    }
  }
}

/** Budgets by class (audio-plan §2.6). Mobile / deviceMemory ≤ 4 GB gets half. */
export function cacheBudgets(): { music: number; ambience: number; loops: number; sfx: number } {
  const MB = 1024 * 1024;
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { deviceMemory?: number }) | undefined;
  const small =
    (nav?.deviceMemory !== undefined && nav.deviceMemory <= 4) || /Mobi|Android|iPhone|iPad/i.test(nav?.userAgent ?? '');
  const k = small ? 0.5 : 1;
  return { music: 64 * MB * k, ambience: 48 * MB * k, loops: 32 * MB * k, sfx: 24 * MB * k };
}
