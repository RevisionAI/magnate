// City ambience (audio-plan §4.8): 12 looping beds mixed from the AudioFrame (zoom band, land use
// around the focus, city preset, time of day, season, weather) plus Poisson-timed world one-shots.
// Beds are the mastered `amb_*` files when they exist, procedural renders until then.

import { dbToGain, rand } from '../core/math';
import type { AudioEngine } from '../core/AudioEngine';
import type { SfxPlayer, Vec3 } from '../sfx/SfxPlayer';
import type { ProceduralBank } from '../synth/ProceduralBank';
import {
  BED_IDS,
  bedGains,
  defaultFrame,
  oneShotRules,
  poissonFireProbability,
  type AudioFrame,
  type BedId,
  type NearbyCounts,
  type OneShotRule,
} from './ambienceModel';

const SILENT = 0.001; // −60 dB
const STOP_AFTER_MS = 5000;
const TAU = 0.8;

interface Bed {
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  loading: boolean;
  belowSince: number | null;
  target: number;
}

export interface AmbienceDeps {
  engine: AudioEngine;
  bank: ProceduralBank;
  sfx: SfxPlayer;
  fast: () => boolean;
  /** Nearby building counts and positions for one-shots (from the emitter list). */
  nearby?: (frame: AudioFrame) => NearbyCounts;
  /** A world position for a one-shot of the given kind, or null. */
  locate?: (where: OneShotRule['where'], frame: AudioFrame) => Vec3 | null;
}

export class AmbienceDirector {
  private readonly beds = new Map<BedId, Bed>();
  private readonly out: GainNode;
  private frame: AudioFrame = defaultFrame();
  private active = false;
  private oneShotsOn = true;
  private lastZoom = 0.5;
  private lastUpdate = 0;
  private readonly lastOneShot = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  /** Bed gains (linear, before the bus) from the last update, for the AudioLab. */
  lastGains: Partial<Record<BedId, number>> = {};

  constructor(private readonly deps: AmbienceDeps) {
    this.out = new GainNode(deps.engine.ctx, { gain: 1 });
    this.out.connect(deps.engine.ambientIn);
    for (const id of BED_IDS) {
      const gain = new GainNode(deps.engine.ctx, { gain: 0 });
      gain.connect(this.out);
      this.beds.set(id, { gain, src: null, loading: false, belowSince: null, target: 0 });
    }
    this.timer = setInterval(() => this.update(), 100);
  }

  /** Beds play only while a city is on screen. */
  setActive(on: boolean): void {
    this.active = on;
    if (!on) for (const [id, bed] of this.beds) this.fadeBed(id, bed, 0);
  }

  get isActive(): boolean {
    return this.active;
  }

  setOneShots(on: boolean): void {
    this.oneShotsOn = on;
  }

  setFrame(frame: Partial<AudioFrame>): void {
    this.frame = { ...this.frame, ...frame, area: { ...this.frame.area, ...(frame.area ?? {}) } };
  }

  getFrame(): Readonly<AudioFrame> {
    return this.frame;
  }

  /** Dim the whole ambience (defeat: −6 dB; 0 restores). */
  dim(db: number): void {
    const t = this.deps.engine.ctx.currentTime;
    this.out.gain.setTargetAtTime(dbToGain(db), t, 0.8);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    const t = this.deps.engine.ctx.currentTime;
    for (const [id, bed] of this.beds) {
      bed.src?.stop(t + 0.3);
      if (bed.src) this.deps.bank.unpin(id);
    }
    this.out.disconnect();
  }

  /** 10 Hz: bed targets, start/stop, air filter, one-shots. */
  update(): void {
    if (this.disposed) return;
    const { engine } = this.deps;
    const ctx = engine.ctx;
    const nowMs = performance.now();
    const dt = this.lastUpdate ? Math.min(1, (nowMs - this.lastUpdate) / 1000) : 0.1;
    this.lastUpdate = nowMs;
    const zoomSpeed = dt > 0 ? (this.frame.zoom01 - this.lastZoom) / dt : 0;
    this.lastZoom = this.frame.zoom01;
    engine.setAmbientAir(this.frame.zoom01);
    const gains = bedGains(this.frame, zoomSpeed);
    this.lastGains = gains;
    for (const [id, bed] of this.beds) {
      const target = this.active ? Math.min(1.5, Math.max(0, gains[id])) : 0;
      bed.target = target;
      if (target > SILENT) {
        bed.belowSince = null;
        if (!bed.src && !bed.loading && ctx.state === 'running') void this.startBed(id, bed);
      } else if (bed.src) {
        bed.belowSince ??= nowMs;
        if (nowMs - bed.belowSince > STOP_AFTER_MS) this.stopBed(id, bed);
      }
      if (bed.src) bed.gain.gain.setTargetAtTime(target, ctx.currentTime, TAU);
    }
    if (this.active && this.oneShotsOn && ctx.state === 'running') this.oneShots(dt);
  }

  private async startBed(id: BedId, bed: Bed): Promise<void> {
    bed.loading = true;
    const buffer = await this.deps.bank.buffer(id).catch(() => null);
    bed.loading = false;
    if (!buffer || this.disposed || bed.src || bed.target <= SILENT) return;
    const ctx = this.deps.engine.ctx;
    const src = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    src.connect(bed.gain);
    bed.gain.gain.cancelScheduledValues(ctx.currentTime);
    bed.gain.gain.setValueAtTime(0, ctx.currentTime);
    bed.gain.gain.setTargetAtTime(bed.target, ctx.currentTime, TAU);
    src.start(ctx.currentTime, rand(0, buffer.duration)); // random offset: no phase-locked beds
    bed.src = src;
    this.deps.bank.pin(id);
  }

  private stopBed(id: BedId, bed: Bed): void {
    const t = this.deps.engine.ctx.currentTime;
    bed.gain.gain.setTargetAtTime(0, t, 0.1);
    bed.src?.stop(t + 0.6);
    bed.src = null;
    bed.belowSince = null;
    this.deps.bank.unpin(id);
  }

  private fadeBed(_id: BedId, bed: Bed, target: number): void {
    bed.target = target;
    bed.gain.gain.setTargetAtTime(target, this.deps.engine.ctx.currentTime, TAU);
  }

  private oneShots(dt: number): void {
    const f = this.frame;
    const counts = this.deps.nearby?.(f) ?? { warehouses: 0, factories: 0, operatingFactories: 0, constructionSites: 0, busyStores: 0 };
    const nowMs = performance.now();
    for (const rule of oneShotRules(f, counts, this.deps.fast())) {
      if (rule.rate <= 0) continue;
      if (nowMs - (this.lastOneShot.get(rule.id) ?? -1e12) < rule.minGapSec * 1000) continue;
      if (Math.random() >= poissonFireProbability(rule.rate, dt)) continue;
      const at = this.deps.locate?.(rule.where, f) ?? null;
      if (rule.where !== 'none' && rule.where !== 'road' && !at) continue; // nothing of that kind nearby
      this.lastOneShot.set(rule.id, nowMs);
      // positional where the scene can place it; otherwise (siren, thunder) panned within ±0.6
      this.deps.sfx.play(rule.id, at ? { at, refDistance: rule.id === 'ship_horn' || rule.id === 'thunder' ? 120 : 40 } : { pan: rand(-0.6, 0.6) });
    }
  }
}
