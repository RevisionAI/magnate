// Buffers for loop-type content: the mastered file when the manifest has the id (generated beds and
// positional loops, later), else a procedural render (beds.ts) normalised to the class loudness.
// Renders run one at a time in OfflineAudioContexts (a separate rendering thread, so the main thread
// never blocks) and land in the shared byte-budgeted caches.

import type { AssetLoader } from '../assets/AssetLoader';
import { BEDS, LOOPS, type LoopDef } from './beds';
import { renderBuffer } from './offthread';
import { offlineAvailable } from './render';

/** Beds are low-passed by distance anyway: 32 kHz saves a third of the memory (audio-plan §4.6). */
const BED_RATE = 32000;
const LOOP_RATE = 32000;
const SEAM_SEC = 1.0;

export class ProceduralBank {
  private chain: Promise<unknown> = Promise.resolve();
  /** Render timings (ms) for the AudioLab. */
  readonly renderMs = new Map<string, number>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly assets: AssetLoader,
  ) {}

  static def(id: string): LoopDef | undefined {
    return BEDS[id] ?? LOOPS[id];
  }

  /** True if a buffer for `id` is already decoded/rendered (no work needed). */
  ready(id: string): boolean {
    const file = this.assets.manifest.get(id)?.variants[0];
    if (file) return !!this.assets.peek(file);
    const cache = BEDS[id] ? this.assets.caches.ambience : this.assets.caches.loops;
    return cache.has(`proc:${id}`);
  }

  async buffer(id: string): Promise<AudioBuffer | null> {
    const file = this.assets.manifest.get(id)?.variants[0];
    if (file) return this.assets.tryLoad(file);
    const def = ProceduralBank.def(id);
    if (!def || !offlineAvailable()) return null;
    const cache = BEDS[id] ? this.assets.caches.ambience : this.assets.caches.loops;
    return cache.get(`proc:${id}`, () => this.serial(() => this.render(id, def)));
  }

  pin(id: string): void {
    const file = this.assets.manifest.get(id)?.variants[0];
    if (file) this.assets.pin(file);
    else (BEDS[id] ? this.assets.caches.ambience : this.assets.caches.loops).pin(`proc:${id}`);
  }

  unpin(id: string): void {
    const file = this.assets.manifest.get(id)?.variants[0];
    if (file) this.assets.unpin(file);
    else (BEDS[id] ? this.assets.caches.ambience : this.assets.caches.loops).unpin(`proc:${id}`);
  }

  private async render(id: string, def: LoopDef): Promise<AudioBuffer> {
    const t0 = performance.now();
    const buf = await renderBuffer(this.ctx, def.build, {
      seconds: def.seconds,
      channels: def.channels,
      sampleRate: BEDS[id] ? BED_RATE : LOOP_RATE,
      targetLufs: def.lufs,
      loopSeam: SEAM_SEC,
    });
    this.renderMs.set(id, Math.round(performance.now() - t0));
    return buf;
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job, job);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
