// Positional building and vehicle loops (audio-plan §4.9). Every building can emit (rivals too, the
// player's +2 dB); every 250 ms the emitters are scored by activity and distance to the listener and
// the top N (8 desktop, 5 mobile) get real voices: equal-power panners into the three.js listener, so
// they follow the camera and duck under VO with the world bus. Voice swaps fade 0.4 s and start at a
// random offset so identical loops never phase-lock.

import { dbToGain, rand } from '../core/math';
import type { AudioEngine } from '../core/AudioEngine';
import type { Vec3 } from '../sfx/SfxPlayer';
import type { ProceduralBank } from '../synth/ProceduralBank';
import type { AudioFrame, NearbyCounts, OneShotRule } from '../ambience/ambienceModel';
import { dayAmount } from '../ambience/ambienceModel';
import { emitterScore, emitterSpec, refDistance, selectVoices, type EmitterSource, type EmitterSpec } from './emitterModel';

export interface TruckSource {
  id: number;
  x: number;
  y?: number;
  z: number;
}

interface VoiceSlot {
  key: string;
  loop: string;
  panner: PannerNode;
  gain: GainNode;
  src: AudioBufferSourceNode | null;
  pos: Vec3;
  /** Target gain (activity × day/night × player boost), applied once the buffer is ready. */
  want: number;
}

export interface EmitterDeps {
  engine: AudioEngine;
  bank: ProceduralBank;
  /** World position of the listener rig, or null when no scene is attached. */
  listener: () => Vec3 | null;
  /** Current time of day (hours) or null for fixed daylight. */
  timeOfDay: () => number | null;
  plotSize: number;
}

const FADE = 0.4;
const PLAYER_BOOST = dbToGain(2);

export class EmitterManager {
  private sources = new Map<number, EmitterSource>();
  private trucks: TruckSource[] = [];
  private readonly slots = new Map<string, VoiceSlot>();
  private readonly n: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled = true;
  /** Last scores for the AudioLab. */
  lastScores: { key: string; s: number; loop: string }[] = [];

  constructor(private readonly deps: EmitterDeps) {
    const mobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    this.n = mobile ? 5 : 8;
    this.timer = setInterval(() => this.update(), 250);
  }

  get voiceCount(): number {
    return this.slots.size;
  }

  /** Keys of the emitters currently holding a real voice ('b<buildingId>' / 't<truckId>'). */
  activeKeys(): string[] {
    return [...this.slots.keys()];
  }

  get maxVoices(): number {
    return this.n;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.update();
  }

  /** Replace the building list (call on city load and on cityView deltas). */
  setSources(list: EmitterSource[]): void {
    this.sources = new Map(list.map((s) => [s.id, s]));
  }

  upsertSources(list: EmitterSource[], removedIds: number[] = []): void {
    for (const s of list) this.sources.set(s.id, s);
    for (const id of removedIds) this.sources.delete(id);
  }

  sourceCount(): number {
    return this.sources.size;
  }

  getSource(id: number): EmitterSource | undefined {
    return this.sources.get(id);
  }

  /** Delivery trucks (renderer agents); the 3 nearest within 25 plots get the engine loop. */
  setTrucks(list: TruckSource[]): void {
    this.trucks = list;
  }

  /** Counts within radius R of the focus, for the ambience one-shots. */
  nearby(frame: AudioFrame, radius: number): NearbyCounts {
    const c: NearbyCounts = { warehouses: 0, factories: 0, operatingFactories: 0, constructionSites: 0, busyStores: 0 };
    for (const s of this.sources.values()) {
      if (Math.hypot(s.x - frame.focus.x, s.z - frame.focus.z) > radius) continue;
      if (s.status === 'underConstruction') c.constructionSites++;
      else if (s.category === 'warehouse' || s.category === 'seaport') c.warehouses++;
      else if (s.category === 'factory') {
        c.factories++;
        if ((s.status ?? 'operating') === 'operating') c.operatingFactories++;
      } else if (/store|supermarket|retail/.test(s.category) && (s.activity?.unitsSold ?? 0) > 1000) c.busyStores++;
    }
    return c;
  }

  /** A position for a world one-shot near the focus. */
  locate(where: OneShotRule['where'], frame: AudioFrame, radius: number): Vec3 | null {
    const near = (pred: (s: EmitterSource) => boolean): Vec3 | null => {
      const list = [...this.sources.values()].filter((s) => pred(s) && Math.hypot(s.x - frame.focus.x, s.z - frame.focus.z) <= radius);
      if (!list.length) return null;
      const s = list[Math.floor(Math.random() * list.length)] as EmitterSource;
      return { x: s.x, y: 4, z: s.z };
    };
    switch (where) {
      case 'warehouse':
        return near((s) => s.category === 'warehouse' || s.category === 'seaport');
      case 'factory':
        return near((s) => s.category === 'factory' && (s.status ?? 'operating') === 'operating');
      case 'construction':
        return near((s) => s.status === 'underConstruction');
      case 'store':
        return near((s) => /store|supermarket|retail/.test(s.category));
      case 'shore':
        return near((s) => s.category === 'seaport') ?? this.ring(frame, radius * 1.5);
      case 'road':
      case 'none':
      default:
        return this.ring(frame, where === 'road' ? radius * 0.8 : 350);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    for (const slot of this.slots.values()) this.release(slot, 0.2);
    this.slots.clear();
  }

  // ---------------------------------------------------------------------------------------------

  private ring(frame: AudioFrame, r: number): Vec3 {
    const a = rand(0, Math.PI * 2);
    const d = rand(0.4, 1) * r;
    return { x: frame.focus.x + Math.cos(a) * d, y: 2, z: frame.focus.z + Math.sin(a) * d };
  }

  update(): void {
    const ctx = this.deps.engine.ctx;
    const lis = this.deps.listener();
    if (!this.enabled || !lis || ctx.state !== 'running') {
      for (const slot of this.slots.values()) this.release(slot, FADE);
      this.slots.clear();
      return;
    }
    const day = dayAmount(this.deps.timeOfDay());
    const scored: { key: string; s: number; loop: string; gain: number; pos: Vec3; ref: number }[] = [];
    for (const src of this.sources.values()) {
      const spec: EmitterSpec | null = emitterSpec(src);
      if (!spec) continue;
      const base = (day * spec.day + (1 - day) * spec.night) * (src.isPlayer ? PLAYER_BOOST : 1);
      const ref = refDistance(src, this.deps.plotSize);
      const pos = { x: src.x, y: src.y ?? 6, z: src.z };
      const d = Math.hypot(pos.x - lis.x, pos.y - lis.y, pos.z - lis.z);
      scored.push({ key: `b${src.id}`, s: emitterScore(spec.a, base, ref, d), loop: spec.loop, gain: spec.a * base, pos, ref });
    }
    // trucks: 3 nearest within 25 plots
    const truckMax = 25 * this.deps.plotSize;
    const nearTrucks = this.trucks
      .map((t) => ({ t, d: Math.hypot(t.x - lis.x, (t.y ?? 1.5) - lis.y, t.z - lis.z) }))
      .filter((x) => x.d <= truckMax)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const { t, d } of nearTrucks) {
      const ref = 8;
      scored.push({ key: `t${t.id}`, s: emitterScore(1, 1, ref, d), loop: 'truck_engine_loop', gain: 1, pos: { x: t.x, y: t.y ?? 1.5, z: t.z }, ref });
    }
    this.lastScores = scored
      .slice()
      .sort((a, b) => b.s - a.s)
      .slice(0, 16)
      .map(({ key, s, loop }) => ({ key, s: Math.round(s * 1000) / 1000, loop }));
    const keep = selectVoices(scored, new Set(this.slots.keys()), this.n);
    for (const [key, slot] of this.slots) {
      if (!keep.has(key)) {
        this.release(slot, FADE);
        this.slots.delete(key);
      }
    }
    const t = ctx.currentTime;
    for (const item of scored) {
      if (!keep.has(item.key)) continue;
      let slot = this.slots.get(item.key);
      if (slot && slot.loop !== item.loop) {
        this.release(slot, FADE);
        this.slots.delete(item.key);
        slot = undefined;
      }
      if (!slot) {
        slot = this.acquire(item.key, item.loop, item.pos, item.ref);
        this.slots.set(item.key, slot);
      }
      slot.pos = item.pos;
      slot.panner.positionX.setTargetAtTime(item.pos.x, t, 0.1);
      slot.panner.positionY.setTargetAtTime(item.pos.y, t, 0.1);
      slot.panner.positionZ.setTargetAtTime(item.pos.z, t, 0.1);
      slot.want = item.gain;
      if (slot.src) slot.gain.gain.setTargetAtTime(item.gain, t, FADE / 3);
    }
  }

  private acquire(key: string, loop: string, pos: Vec3, ref: number): VoiceSlot {
    const { engine } = this.deps;
    const ctx = engine.ctx;
    const panner = new PannerNode(ctx, {
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: ref,
      rolloffFactor: 1.3,
      positionX: pos.x,
      positionY: pos.y,
      positionZ: pos.z,
    });
    const gain = new GainNode(ctx, { gain: 0 });
    gain.connect(panner).connect(engine.listener.getInput());
    const slot: VoiceSlot = { key, loop, panner, gain, src: null, pos, want: 0 };
    void this.deps.bank.buffer(loop).then((buffer) => {
      if (!buffer || this.slots.get(key) !== slot || slot.src) return;
      const src = new AudioBufferSourceNode(ctx, { buffer, loop: true, playbackRate: loop === 'truck_engine_loop' ? rand(0.9, 1.1) : 1 });
      src.connect(gain);
      const t = ctx.currentTime;
      src.start(t, rand(0, buffer.duration));
      slot.src = src;
      this.deps.bank.pin(loop);
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.setTargetAtTime(slot.want, t, FADE / 3);
    });
    return slot;
  }

  private release(slot: VoiceSlot, fade: number): void {
    const t = this.deps.engine.ctx.currentTime;
    slot.gain.gain.cancelScheduledValues(t);
    slot.gain.gain.setValueAtTime(slot.gain.gain.value, t);
    slot.gain.gain.linearRampToValueAtTime(0, t + fade);
    if (slot.src) {
      slot.src.stop(t + fade + 0.05);
      this.deps.bank.unpin(slot.loop);
    }
    const src = slot.src;
    slot.src = null;
    setTimeout(() => {
      try {
        src?.disconnect();
        slot.gain.disconnect();
        slot.panner.disconnect();
      } catch {
        // already gone
      }
    }, (fade + 0.2) * 1000);
  }
}
