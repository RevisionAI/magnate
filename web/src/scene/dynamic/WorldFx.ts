// World effects for game-feel events (art §5.21, UX §8): world popups rising over buildings ("+$412K"), grand-opening
// confetti in owner colours, construction dust bursts, the red beacon when a rival enters your market, owner beams for
// tech level-ups and revenue milestones, the gold ring shockwave for goals, a coin burst on the first sale and the 20 %
// city desaturation while the player is insolvent. Everything is short-lived, pooled and disposed here.
import * as THREE from 'three';
import type { FrameInfo, SceneContext, SceneModule } from '../SceneContext';
import type { GameEventDto } from '@/bridge/protocol';
import { bus, type PopupRequest } from '@/game/events';
import { useGameStore } from '@/state/gameStore';
import { useSettingsStore } from '@/state/settingsStore';
import { FONTS, OWNER_COLORS, PROFIT_LOSS, STATUS, UI } from '@/theme/tokens';
import { mulberry32 } from '../env/rng';
import { PLOT_SIZE } from '../units';
import type { LivingCity, LiveBuilding } from './LivingCity';
import { isRetail } from './source/types';

const GOLD = new THREE.Color(STATUS.ring);
const LOSS = new THREE.Color(STATUS.loss);
const DUST = new THREE.Color('#C9B79A');

/** Desaturation applied while the player's cash is negative (art §3.16, §5.21). */
export const INSOLVENT_DESATURATION = 0.2;

interface Burst {
  kind: 'confetti' | 'coins' | 'dust';
  t: number;
  life: number;
  n: number;
  pos: Float32Array;
  vel: Float32Array;
  spin: Float32Array;
  color: Float32Array;
  size: number;
}

interface Column {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  pulses: number;
  peak: number;
}

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  r0: number;
  r1: number;
}

interface Popup {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  t: number;
  life: number;
  delay: number;
  x: number;
  y: number;
  z: number;
  aspect: number;
}

interface Pending {
  buildingId: number;
  until: number;
  run: (b: LiveBuilding) => void;
}

const MAX_QUADS = 600;

export class WorldFxModule implements SceneModule {
  readonly name = 'living-city-fx';
  private ctx!: SceneContext;
  private readonly group = new THREE.Group();
  private readonly offs: Array<() => void> = [];
  private readonly rnd = mulberry32(0xf00d);
  private readonly bursts: Burst[] = [];
  private readonly columns: Column[] = [];
  private readonly rings: Ring[] = [];
  private readonly popups: Popup[] = [];
  private readonly pending: Pending[] = [];
  private quads!: THREE.InstancedMesh;
  private dust!: THREE.InstancedMesh;
  private readonly columnGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
  private readonly ringGeo = new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private time = 0;
  private desat = 0;
  private popupWindow: number[] = [];
  /** Effects started (diagnostics). */
  started = 0;

  constructor(private readonly hub: LivingCity) {}

  init(ctx: SceneContext): void {
    this.ctx = ctx;
    this.group.name = 'living-city-fx';
    ctx.scene.add(this.group);
    const quadMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: true });
    this.quads = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 0.6), quadMat, MAX_QUADS);
    this.quads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_QUADS * 3), 3);
    this.quads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.quads.frustumCulled = false;
    this.quads.count = 0;
    this.quads.name = 'fx:confetti';
    const dustMat = new THREE.MeshBasicMaterial({ map: softDiscTexture(), transparent: true, depthWrite: false, opacity: 0.55, color: DUST });
    this.dust = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), dustMat, 256);
    this.dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dust.frustumCulled = false;
    this.dust.count = 0;
    this.dust.name = 'fx:dust';
    this.group.add(this.quads, this.dust);
    this.offs.push(bus.on('gameEvent', (e) => this.onEvent(e)));
    if (this.hub.options.worldPopups !== false) {
      this.offs.push(bus.on('worldPopup', (p) => this.onPopup(p.buildingId, p.text, p.tone, p.delayMs ?? 0)));
    }
  }

  // ---- event routing (UX §8) ----------------------------------------------------------------------------------------

  private onEvent(e: GameEventDto): void {
    if (this.hub.reducedMotion && e.kind !== 'cashNegative') return;
    switch (e.kind) {
      case 'buildingConstructed':
      case 'constructionCompleted':
        if (e.buildingId !== undefined) this.whenBuilding(e.buildingId, (b) => { this.dustBurst(b, 18); this.confetti(b, 60); });
        break;
      case 'constructionStarted':
        if (e.buildingId !== undefined) this.whenBuilding(e.buildingId, (b) => this.dustBurst(b, 24));
        break;
      case 'buildingDemolished':
        if (e.buildingId !== undefined) this.whenBuilding(e.buildingId, (b) => this.dustBurst(b, 48));
        break;
      case 'buildingUpgraded':
        if (e.buildingId !== undefined) this.whenBuilding(e.buildingId, (b) => this.confetti(b, 30));
        break;
      case 'firstSale':
        if (e.buildingId !== undefined) this.whenBuilding(e.buildingId, (b) => this.coins(b, 28));
        break;
      case 'rivalEnteredMarket': {
        const store = this.rivalStore(e.companyId);
        if (store) this.column(store, LOSS, 1.5, 80, 6, 3, 0.85);
        break;
      }
      case 'techLevelUp':
        if (e.isPlayer) {
          const lab = this.playerBuilding((b) => b.typeId === 'rd_center') ?? this.home();
          if (lab) this.column(lab, new THREE.Color(OWNER_COLORS[lab.owner] ?? OWNER_COLORS[0]), 2.5, 220, 3, 1, 0.9);
        }
        break;
      case 'revenueMilestone': {
        const hq = this.home();
        if (hq) this.column(hq, GOLD, 3, 260, 3, 1, 0.9);
        break;
      }
      case 'goalAchieved': {
        const hq = this.home();
        if (hq) this.ring(hq, GOLD, 1.5);
        break;
      }
      case 'recordMonth': {
        const hq = this.home();
        if (hq) this.confetti(hq, 60);
        break;
      }
      case 'scenarioWon':
        for (const b of this.hub.buildings.values()) if (b.isPlayer) this.confetti(b, 40);
        break;
      default:
        break;
    }
  }

  /** Run an effect once the building is known to the city source (new buildings appear a frame later). */
  private whenBuilding(id: number, run: (b: LiveBuilding) => void): void {
    const b = this.hub.buildings.get(id);
    if (b) run(b);
    else this.pending.push({ buildingId: id, until: this.time + 4, run });
  }

  private home(): LiveBuilding | null {
    return this.playerBuilding((b) => b.typeId === 'headquarters') ?? this.playerBuilding(() => true);
  }

  private playerBuilding(pred: (b: LiveBuilding) => boolean): LiveBuilding | null {
    let best: LiveBuilding | null = null;
    for (const b of this.hub.buildings.values()) if (b.isPlayer && pred(b) && (!best || b.id < best.id)) best = b;
    return best;
  }

  private rivalStore(companyId: number | undefined): LiveBuilding | null {
    let best: LiveBuilding | null = null;
    for (const b of this.hub.buildings.values()) {
      if (b.isPlayer || (companyId !== undefined && b.ownerId !== companyId)) continue;
      if (isRetail(b) && (!best || b.id > best.id)) best = b;
    }
    return best;
  }

  private centre(b: LiveBuilding): THREE.Vector3 {
    const layout = this.hub.layout!;
    return new THREE.Vector3((b.px + b.w / 2 - layout.gridW / 2) * PLOT_SIZE, 0, (b.pz + b.h / 2 - layout.gridH / 2) * PLOT_SIZE);
  }

  // ---- effects --------------------------------------------------------------------------------------------------------

  /** Owner-colour confetti (60 quads, 2 s) over a building (art §4.1 "Opening"). */
  confetti(b: LiveBuilding, n: number): void {
    const c = this.centre(b);
    const owner = new THREE.Color(OWNER_COLORS[b.owner] ?? OWNER_COLORS[0]);
    const palette = [owner, owner, GOLD, new THREE.Color('#FFFFFF')];
    this.burst('confetti', c.x, b.height + 4, c.z, n, 2.2, 1.1, (i) => palette[i % palette.length], 9, 13);
  }

  coins(b: LiveBuilding, n: number): void {
    const c = this.centre(b);
    this.burst('coins', c.x, b.height + 3, c.z, n, 1.6, 1.4, () => GOLD, 6, 11);
  }

  dustBurst(b: LiveBuilding, n: number): void {
    const c = this.centre(b);
    const r = Math.max(b.w, b.h) * PLOT_SIZE * 0.4;
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, d = this.rnd() * r;
      pos[i * 3] = c.x + Math.cos(a) * d;
      pos[i * 3 + 1] = 1 + this.rnd() * 3;
      pos[i * 3 + 2] = c.z + Math.sin(a) * d;
      vel[i * 3] = Math.cos(a) * (2 + this.rnd() * 3);
      vel[i * 3 + 1] = 1 + this.rnd() * 2;
      vel[i * 3 + 2] = Math.sin(a) * (2 + this.rnd() * 3);
    }
    this.bursts.push({ kind: 'dust', t: 0, life: 2.6, n, pos, vel, spin: new Float32Array(n), color: new Float32Array(n * 3), size: 7 + r * 0.08 });
    this.started++;
  }

  private burst(kind: 'confetti' | 'coins', x: number, y: number, z: number, n: number, life: number, size: number, col: (i: number) => THREE.Color, vMin: number, vMax: number): void {
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), spin = new Float32Array(n), color = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, up = vMin + this.rnd() * (vMax - vMin), out = 2 + this.rnd() * 6;
      pos.set([x, y, z], i * 3);
      vel.set([Math.cos(a) * out, up, Math.sin(a) * out], i * 3);
      spin[i] = this.rnd() * 10;
      const c = col(i);
      color.set([c.r, c.g, c.b], i * 3);
    }
    this.bursts.push({ kind, t: 0, life, n, pos, vel, spin, color, size });
    this.started++;
  }

  /** Vertical additive column (rival beacon Ø3 × 80 m pulsing 6 s; tech beam). */
  private column(b: LiveBuilding, color: THREE.Color, radius: number, height: number, life: number, pulses: number, peak: number): void {
    const c = this.centre(b);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.columnGeo, mat);
    mesh.position.set(c.x, b.height * 0.5, c.z);
    mesh.scale.set(radius, height, radius);
    mesh.renderOrder = 6;
    this.group.add(mesh);
    this.columns.push({ mesh, t: 0, life, pulses, peak });
    this.started++;
  }

  /** Gold ring shockwave on the ground (expanding decal, 1.5 s). */
  private ring(b: LiveBuilding, color: THREE.Color, life: number): void {
    const c = this.centre(b);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(c.x, 0.4, c.z);
    mesh.renderOrder = 6;
    this.group.add(mesh);
    this.rings.push({ mesh, t: 0, life, r0: Math.max(b.w, b.h) * PLOT_SIZE * 0.6, r1: 260 });
    this.started++;
  }

  /** World-anchored popup over a building (UX §8 conventions: rise 60 px over 1.6 s, ease-out). */
  private onPopup(buildingId: number, text: string, tone: PopupRequest['tone'], delayMs: number): void {
    // at 4×/8× show at most 3 popups per close (UX §8)
    const speed = this.hub.frame?.speed ?? 1;
    this.popupWindow = this.popupWindow.filter((t) => this.time - t < 1.2);
    if (speed >= 4 && this.popupWindow.length >= 3) return;
    this.popupWindow.push(this.time);
    this.whenBuilding(buildingId, (b) => {
      const c = this.centre(b);
      const vision = useSettingsStore.getState().interface.colourVision;
      const color = tone === 'gain' ? OWNER_COLORS[0] : tone === 'loss' ? (PROFIT_LOSS[vision] ?? PROFIT_LOSS.off).neg : tone === 'gold' ? STATUS.ring : '#FFFFFF';
      const { texture, aspect } = popupTexture(text, color);
      const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 20;
      this.group.add(sprite);
      this.popups.push({ sprite, texture, t: 0, life: 1.6, delay: delayMs / 1000, x: c.x, y: b.height + 6, z: c.z, aspect });
      this.started++;
    });
  }

  // ---- per frame ------------------------------------------------------------------------------------------------------

  update(frame: FrameInfo): void {
    const dt = frame.dt;
    this.time += dt;
    this.updateDesaturation(dt);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      const b = this.hub.buildings.get(p.buildingId);
      if (b) { this.pending.splice(i, 1); p.run(b); }
      else if (this.time > p.until) this.pending.splice(i, 1);
    }
    this.updateBursts(dt);
    this.updateColumns(dt);
    this.updateRings(dt);
    this.updatePopups(dt, frame);
  }

  private updateDesaturation(dt: number): void {
    const cash = useGameStore.getState().hud?.player?.cash;
    const target = typeof cash === 'number' && cash < 0 ? INSOLVENT_DESATURATION : 0;
    this.desat += (target - this.desat) * Math.min(1, dt * 1.5);
    if (Math.abs(this.desat - target) < 1e-3) this.desat = target;
    const env = this.ctx.env as { cityDesaturation: number };
    if (Math.abs(env.cityDesaturation - this.desat) > 1e-4) env.cityDesaturation = this.desat;
  }

  private updateBursts(dt: number): void {
    const cam = this.ctx.camera;
    let quads = 0, dusts = 0;
    const Q = this.quads.instanceMatrix.array as Float32Array, C = this.quads.instanceColor!.array as Float32Array;
    for (let k = this.bursts.length - 1; k >= 0; k--) {
      const b = this.bursts[k];
      b.t += dt;
      if (b.t >= b.life) { this.bursts.splice(k, 1); continue; }
      const f = b.t / b.life;
      for (let i = 0; i < b.n; i++) {
        const o = i * 3;
        if (b.kind === 'dust') {
          b.vel[o] *= 1 - dt * 1.2;
          b.vel[o + 2] *= 1 - dt * 1.2;
          b.vel[o + 1] *= 1 - dt * 0.8;
        } else {
          b.vel[o + 1] -= (b.kind === 'coins' ? 14 : 9) * dt;
          const drag = b.kind === 'confetti' ? 1 - dt * 1.6 : 1 - dt * 0.4;
          b.vel[o] *= drag;
          b.vel[o + 2] *= drag;
          if (b.kind === 'confetti' && b.vel[o + 1] < -3) b.vel[o + 1] = -3;   // flutter
        }
        b.pos[o] += b.vel[o] * dt;
        b.pos[o + 1] = Math.max(0.3, b.pos[o + 1] + b.vel[o + 1] * dt);
        b.pos[o + 2] += b.vel[o + 2] * dt;
        if (b.kind === 'dust') {
          if (dusts >= this.dust.instanceMatrix.count) continue;
          const s = b.size * (0.6 + f * 1.4) * (1 - f * 0.3);
          this.m.compose(this.v.set(b.pos[o], b.pos[o + 1], b.pos[o + 2]), cam.quaternion, this.s.setScalar(s * (1 - f)));
          this.dust.setMatrixAt(dusts++, this.m);
        } else {
          if (quads >= MAX_QUADS) continue;
          const spin = b.spin[i] + b.t * 9;
          this.q.setFromEuler(this.euler.set(spin, spin * 0.7, spin * 0.3));
          const s = b.size * (f > 0.8 ? (1 - f) / 0.2 : 1);
          this.m.compose(this.v.set(b.pos[o], b.pos[o + 1], b.pos[o + 2]), this.q, this.s.setScalar(s));
          this.m.toArray(Q, quads * 16);
          C[quads * 3] = b.color[o];
          C[quads * 3 + 1] = b.color[o + 1];
          C[quads * 3 + 2] = b.color[o + 2];
          quads++;
        }
      }
    }
    this.quads.count = quads;
    this.quads.visible = quads > 0;
    if (quads) {
      this.quads.instanceMatrix.needsUpdate = true;
      this.quads.instanceColor!.needsUpdate = true;
    }
    this.dust.count = dusts;
    this.dust.visible = dusts > 0;
    if (dusts) this.dust.instanceMatrix.needsUpdate = true;
  }

  private updateColumns(dt: number): void {
    for (let k = this.columns.length - 1; k >= 0; k--) {
      const c = this.columns[k];
      c.t += dt;
      const mat = c.mesh.material as THREE.MeshBasicMaterial;
      if (c.t >= c.life) {
        c.mesh.removeFromParent();
        mat.dispose();
        this.columns.splice(k, 1);
        continue;
      }
      const f = c.t / c.life;
      const pulse = 0.55 + 0.45 * Math.cos(f * c.pulses * Math.PI * 2);
      const env = Math.min(1, c.t / 0.3) * Math.min(1, (c.life - c.t) / 0.6);
      mat.opacity = c.peak * pulse * env;
    }
  }

  private updateRings(dt: number): void {
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const r = this.rings[k];
      r.t += dt;
      const mat = r.mesh.material as THREE.MeshBasicMaterial;
      if (r.t >= r.life) {
        r.mesh.removeFromParent();
        mat.dispose();
        this.rings.splice(k, 1);
        continue;
      }
      const f = r.t / r.life;
      const e = 1 - (1 - f) * (1 - f);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      r.mesh.scale.set(rad, 1, rad);
      mat.opacity = 0.9 * (1 - f);
    }
  }

  private updatePopups(dt: number, frame: FrameInfo): void {
    const cam = this.ctx.camera;
    const vh = this.ctx.renderer.domElement.clientHeight || 1080;
    for (let k = this.popups.length - 1; k >= 0; k--) {
      const p = this.popups[k];
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.t += dt;
      const mat = p.sprite.material as THREE.SpriteMaterial;
      if (p.t >= p.life) {
        p.sprite.removeFromParent();
        mat.dispose();
        p.texture.dispose();
        this.popups.splice(k, 1);
        continue;
      }
      const f = p.t / p.life;
      const ease = 1 - (1 - f) ** 3;
      // world size of one screen pixel at the popup's distance
      const d = cam.position.distanceTo(this.v.set(p.x, p.y, p.z));
      const px = (2 * d * Math.tan(((cam as THREE.PerspectiveCamera).fov * Math.PI) / 360)) / vh;
      const h = 28 * px;
      p.sprite.position.set(p.x, p.y + ease * 60 * px, p.z);
      p.sprite.scale.set(h * p.aspect, h, 1);
      mat.opacity = Math.min(1, f / 0.12) * (f > 0.7 ? (1 - f) / 0.3 : 1);
    }
    void frame;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const c of this.columns) (c.mesh.material as THREE.Material).dispose();
    for (const r of this.rings) (r.mesh.material as THREE.Material).dispose();
    for (const p of this.popups) {
      (p.sprite.material as THREE.Material).dispose();
      p.texture.dispose();
    }
    this.quads.dispose();
    this.dust.dispose();
    (this.quads.material as THREE.Material).dispose();
    const dm = this.dust.material as THREE.MeshBasicMaterial;
    dm.map?.dispose();
    dm.dispose();
    this.columnGeo.dispose();
    this.ringGeo.dispose();
    this.group.removeFromParent();
    if (this.ctx) (this.ctx.env as { cityDesaturation: number }).cityDesaturation = 0;
  }
}

function softDiscTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Popup label: bold money text with a dark outline (readable over any roof). */
function popupTexture(text: string, color: string): { texture: THREE.CanvasTexture; aspect: number } {
  const h = 64;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  const font = `800 ${Math.round(h * 0.72)}px ${FONTS.ui}`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width + h * 0.6);
  canvas.width = w;
  canvas.height = h;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = h * 0.14;
  g.strokeStyle = UI.ink;
  g.strokeText(text, w / 2, h / 2 + 2);
  g.fillStyle = color;
  g.fillText(text, w / 2, h / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: w / h };
}
