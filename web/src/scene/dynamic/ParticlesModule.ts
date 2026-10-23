// Scene module for building emitters (art §3.16 "Chimney smoke": puffs/s = 1.5 × utilization, colour by product family,
// none when idle or closed): collects every company building's emitters (and the dust of construction sites and
// world effects), rescales them with the live utilization (`rateAtFull × utilization`, because utilization is not part
// of visualRev), keeps the nearest emitters within the 2,600 m smoke range under the tier's particle cap, and hands
// them to one GPU ParticleLayer per kind. Attribute rewrites happen only when that set or a rate changes.
import * as THREE from 'three';
import type { FrameInfo, SceneContext, SceneModule } from '../SceneContext';
import type { Emitter } from '../assets/AssetFactory';
import { LOD_BANDS } from '../assets/Instancing';
import type { LivingCity, LiveBuilding } from './LivingCity';
import { PARTICLE_KINDS, PUFFS_PER_EMITTER, ParticleLayer, type LiveEmitter, type ParticleKind } from './Particles';

/** Live rate of a building emitter (art §3.16 + W4 `rateAtFull`). */
export function liveEmitterRate(e: Emitter, b: Pick<LiveBuilding, 'working' | 'utilization' | 'progress' | 'status'>): number {
  if (b.status === 'closed') return 0;
  if (b.progress !== undefined) return e.rate;                 // construction-site dust runs while building
  if (!b.working) return 0;
  if (e.rateAtFull !== undefined && b.utilization !== null) return e.rateAtFull * Math.max(0, Math.min(1, b.utilization));
  return e.rate;
}

/** Extra emitters other modules add (construction sites, world FX), keyed by owner. */
export interface ExtraEmitters {
  emitters(): readonly LiveEmitter[];
}

export class ParticlesModule implements SceneModule {
  readonly name = 'living-city-particles';
  private ctx!: SceneContext;
  private readonly group = new THREE.Group();
  private readonly layers = new Map<ParticleKind, ParticleLayer>();
  private readonly offs: Array<() => void> = [];
  private readonly extras: ExtraEmitters[] = [];
  private readonly wind = new THREE.Vector3();
  private readonly lastTarget = new THREE.Vector3(Infinity, 0, 0);
  private dirty = true;
  private sinceSelect = 0;
  private signature = '';
  /** Emitters drawn (diagnostics). */
  drawnEmitters = 0;

  constructor(private readonly hub: LivingCity) {}

  init(ctx: SceneContext): void {
    this.ctx = ctx;
    this.group.name = 'living-city-particles';
    for (const k of PARTICLE_KINDS) {
      const layer = new ParticleLayer(k);
      this.layers.set(k, layer);
      this.group.add(layer.mesh);
    }
    ctx.scene.add(this.group);
    const mark = () => { this.dirty = true; };
    this.offs.push(this.hub.on('buildings', mark), this.hub.on('layout', mark), this.hub.on('economy', mark));
    this.offs.push(ctx.onQualityChanged(mark));
  }

  /** Register a provider of extra emitters (polled when the selection is refreshed). */
  addExtras(extra: ExtraEmitters): void {
    this.extras.push(extra);
    this.dirty = true;
  }

  /** Force a re-selection (extras changed). */
  invalidate(): void {
    this.dirty = true;
  }

  update(frame: FrameInfo): void {
    this.sinceSelect += frame.dt;
    if (this.dirty || this.sinceSelect > 2 || frame.target.distanceToSquared(this.lastTarget) > 150 * 150) this.select(frame);
    const w = this.ctx.env.weatherState;
    // prevailing wind from the south-west; calm days still drift a little
    this.wind.set(0.78, 0, -0.62).multiplyScalar(0.7 + 5.5 * (w?.wind ?? 0));
    const light = 1 - 0.75 * frame.night;
    for (const layer of this.layers.values()) layer.update(frame.elapsed, this.wind, light);
  }

  private select(frame: FrameInfo): void {
    this.dirty = false;
    this.sinceSelect = 0;
    this.lastTarget.copy(frame.target);
    const cap = Math.max(0, Math.floor(this.ctx.quality.settings.caps.particles / PUFFS_PER_EMITTER));
    const cam = this.ctx.camera.position;
    const range2 = LOD_BANDS.smoke * LOD_BANDS.smoke;
    const all: Array<{ le: LiveEmitter; d: number; key: string }> = [];
    for (const b of this.hub.buildings.values()) {
      b.emitters.forEach((e, i) => {
        const rate = liveEmitterRate(e, b);
        if (!(rate > 0)) return;
        all.push({ le: { emitter: e, rate }, d: (e.x - cam.x) ** 2 + (e.z - cam.z) ** 2, key: `${b.id}.${i}:${rate.toFixed(2)}` });
      });
    }
    for (const extra of this.extras) {
      extra.emitters().forEach((le, i) => {
        if (!(le.rate > 0)) return;
        all.push({ le, d: (le.emitter.x - cam.x) ** 2 + (le.emitter.z - cam.z) ** 2, key: `x${i}:${le.emitter.x.toFixed(0)},${le.emitter.z.toFixed(0)}:${le.rate.toFixed(2)}` });
      });
    }
    const chosen = all.filter((a) => a.d <= range2).sort((a, b) => a.d - b.d).slice(0, cap);
    const sig = chosen.map((c) => c.key).sort().join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    const byKind = new Map<ParticleKind, LiveEmitter[]>(PARTICLE_KINDS.map((k) => [k, []]));
    // stable order inside each kind so puffs keep their phases when the set does not change
    chosen.sort((a, b) => (a.key < b.key ? -1 : 1));
    for (const c of chosen) byKind.get(c.le.emitter.kind)?.push(c.le);
    for (const [k, list] of byKind) this.layers.get(k)!.setEmitters(list);
    this.drawnEmitters = chosen.length;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const l of this.layers.values()) l.dispose();
    this.layers.clear();
    this.group.removeFromParent();
  }
}
