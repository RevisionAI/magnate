// GPU particles (art §5.19): smoke, steam, dust and flare. One InstancedBufferGeometry per kind (a camera-facing quad)
// with STATIC per-instance attributes (emitter position, phase, seed, enabled, size); the vertex shader animates
//   age = fract(uTime / life + phase); pos = emitter + wind·age·life + up·rise·age·life + jitter(seed)
//   size = mix(s0, s1, age); alpha = sin(π·min(1, 1.3·age))·(1 − age)
// so a frame uploads nothing. Each emitter owns a pool of 16 puffs at fixed phases; its rate (puffs per second) only
// switches puffs on or off (an "enabled" attribute rewritten when activity changes, monthly), never per frame.
// Colour is multiplied by a day-light factor (0.25 at night); flares are additive and unaffected.
import * as THREE from 'three';
import type { Emitter } from '../assets/AssetFactory';

export type ParticleKind = 'smoke' | 'steam' | 'dust' | 'flare';
export const PARTICLE_KINDS: readonly ParticleKind[] = ['smoke', 'steam', 'dust', 'flare'];

/** Puffs per emitter (art §5.19: 14–18). */
export const PUFFS_PER_EMITTER = 16;

interface KindStyle {
  life: number;
  rise: number;
  s0: number;
  s1: number;
  spread: number;
  color: string;
  additive: boolean;
  opacity: number;
}

export const PARTICLE_STYLES: Readonly<Record<ParticleKind, KindStyle>> = {
  // opacities are high because the art-spec alpha curve peaks at ~0.64 and light smoke over a light city reads weakly
  smoke: { life: 9, rise: 3.0, s0: 3.2, s1: 15, spread: 4, color: '#ABAAA5', additive: false, opacity: 0.9 },
  steam: { life: 4.5, rise: 4.2, s0: 2.6, s1: 10, spread: 2.5, color: '#F4F6F8', additive: false, opacity: 0.85 },
  dust: { life: 5, rise: 0.9, s0: 3, s1: 11, spread: 8, color: '#BCA27E', additive: false, opacity: 0.65 },
  flare: { life: 0.9, rise: 2.2, s0: 2.4, s1: 1.2, spread: 0.6, color: '#FF9B3A', additive: true, opacity: 0.9 },
};

const TONE_COLOR = { light: new THREE.Color('#C4C2BB'), dark: new THREE.Color('#5E5C59') } as const;

/** A live emitter: an AssetFactory emitter plus the rate it runs at now. */
export interface LiveEmitter {
  emitter: Emitter;
  /** Current puffs per second (0 = off). */
  rate: number;
}

/** Number of puffs of a pool switched on for a rate: min(pool, round(rate × life)). */
export function enabledPuffs(kind: ParticleKind, rate: number, pool = PUFFS_PER_EMITTER): number {
  if (!(rate > 0)) return 0;
  return Math.min(pool, Math.max(1, Math.round(rate * PARTICLE_STYLES[kind].life)));
}

/** Which puffs of the pool are on: Bresenham spacing, so the enabled puffs stay evenly spread over the cycle. */
export function puffEnabled(i: number, enabled: number, pool = PUFFS_PER_EMITTER): boolean {
  if (enabled >= pool) return true;
  if (enabled <= 0) return false;
  return Math.floor(((i + 1) * enabled) / pool) > Math.floor((i * enabled) / pool);
}

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec3 aEmitter;
attribute vec4 aPuff;      // phase, seed, enabled, size
attribute vec3 aTint;
uniform float uTime;
uniform float uLife;
uniform float uRise;
uniform float uS0;
uniform float uS1;
uniform float uSpread;
uniform vec3 uWind;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vTint;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float age = fract(uTime / uLife + aPuff.x);
  float t = age * uLife;
  vec3 jitter = vec3(h1(aPuff.y * 12.9898) - 0.5, h1(aPuff.y * 78.233) * 0.5, h1(aPuff.y * 39.425) - 0.5);
  vec3 pos = aEmitter + uWind * t * (0.35 + age) + vec3(0.0, uRise * t, 0.0) + jitter * uSpread * (0.25 + age);
  float size = mix(uS0, uS1, age) * aPuff.w;
  vAlpha = sin(PI * min(1.0, 1.3 * age)) * (1.0 - age) * aPuff.z;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  float c = cos(aPuff.y * 6.2831), s = sin(aPuff.y * 6.2831);
  mvPosition.xy += mat2(c, s, -s, c) * position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv;
  vTint = aTint * (0.86 + 0.28 * h1(aPuff.y * 3.7));
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uOpacity;
uniform float uLight;
varying float vAlpha;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  float lobe = 0.75 + 0.25 * sin(atan(p.y, p.x) * 3.0 + vTint.r * 20.0);
  float a = (1.0 - smoothstep(0.35 * lobe, 1.0, d)) * vAlpha * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vTint * uLight, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

/** One particle kind: a pool of puffs over all its emitters. */
export class ParticleLayer {
  readonly mesh: THREE.Mesh;
  readonly kind: ParticleKind;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private capacity = 0;
  private aEmitter!: THREE.InstancedBufferAttribute;
  private aPuff!: THREE.InstancedBufferAttribute;
  private aTint!: THREE.InstancedBufferAttribute;
  /** Puffs currently switched on (diagnostics). */
  active = 0;

  constructor(kind: ParticleKind) {
    this.kind = kind;
    const st = PARTICLE_STYLES[kind];
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      name: `Particles:${kind}`,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uLife: { value: st.life }, uRise: { value: st.rise }, uS0: { value: st.s0 }, uS1: { value: st.s1 },
        uSpread: { value: st.spread }, uWind: { value: new THREE.Vector3() }, uOpacity: { value: st.opacity }, uLight: { value: 1 },
      }]),
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: st.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = `particles:${kind}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.ensure(64);
  }

  private ensure(puffs: number): void {
    if (puffs <= this.capacity) return;
    const cap = Math.max(64, 1 << Math.ceil(Math.log2(puffs)));
    this.capacity = cap;
    this.aEmitter = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.aPuff = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.geometry.setAttribute('aEmitter', this.aEmitter);
    this.geometry.setAttribute('aPuff', this.aPuff);
    this.geometry.setAttribute('aTint', this.aTint);
  }

  /** Rewrite the static attributes for this set of emitters (call on emitter or rate changes, not per frame). */
  setEmitters(list: readonly LiveEmitter[], seedBase = 0): void {
    const P = PUFFS_PER_EMITTER;
    this.ensure(list.length * P);
    const E = this.aEmitter.array as Float32Array, U = this.aPuff.array as Float32Array, T = this.aTint.array as Float32Array;
    const base = new THREE.Color(PARTICLE_STYLES[this.kind].color);
    let n = 0, active = 0;
    list.forEach((le, k) => {
      const e = le.emitter;
      const on = enabledPuffs(this.kind, le.rate, P);
      const tint = this.kind === 'smoke' && e.tone ? TONE_COLOR[e.tone] : base;
      const emitterPhase = ((Math.imul(k + seedBase + 1, 2654435761) >>> 0) % 1000) / 1000;
      for (let i = 0; i < P; i++) {
        E[n * 3] = e.x;
        E[n * 3 + 1] = e.y;
        E[n * 3 + 2] = e.z;
        const enabled = puffEnabled(i, on, P);
        if (enabled) active++;
        U[n * 4] = (i / P + emitterPhase) % 1;
        U[n * 4 + 1] = (k * 31 + i * 7 + seedBase) % 997 + 0.5;
        U[n * 4 + 2] = enabled ? 1 : 0;
        U[n * 4 + 3] = e.size ?? 1;
        T[n * 3] = tint.r;
        T[n * 3 + 1] = tint.g;
        T[n * 3 + 2] = tint.b;
        n++;
      }
    });
    this.geometry.instanceCount = n;
    this.active = active;
    this.aEmitter.needsUpdate = true;
    this.aPuff.needsUpdate = true;
    this.aTint.needsUpdate = true;
    this.mesh.visible = active > 0;
  }

  /** Per-frame uniforms only. */
  update(time: number, wind: THREE.Vector3, light: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    (u.uWind.value as THREE.Vector3).copy(wind);
    u.uLight.value = this.kind === 'flare' ? 1 : light;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
