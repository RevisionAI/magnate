// Rain streaks and snowflakes (art §5.18), drawn from W1's WeatherState (`rain`, `snowfall`, `wind`). New W5 file: W1's
// Weather.ts owns the episodes and every other weather effect (wetness, overcast, fog, snow cover, lightning).
//
// GPU-animated instanced quads with static per-instance seeds, so a frame uploads nothing but uniforms:
//  - drops live on a world-anchored periodic lattice (`mod` by the volume size) inside a volume that follows the camera
//    target, so moving the camera never pops the field; y = mod(y0 − fall·t, H) with a wind slant;
//  - rain: 4,000 (LOW) or 8,000 (MED+) streaks, 9 m/s; snow: 3,000 flakes at 1.2 m/s with a sinusoidal sway;
//  - the volume (300 × up to 200 × 300 m at street zoom, never above the camera) grows with the camera distance and
//    streaks keep ~2 px width.
// Intensity scales the drawn instance count (seeds are uniform, so the first N are an even subset).
import * as THREE from 'three';

export type PrecipKind = 'rain' | 'snow';

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;          // x, y, z in 0..1 of the lattice cell, speed jitter
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uSize;            // volume extents x, y, z (m)
uniform vec2 uWind;            // horizontal drift (m/s)
uniform float uFall;           // fall speed (m/s)
uniform float uLen;            // streak length (m); 0 = flake
uniform float uSnow;           // 1 = snow sway
varying vec2 vUv;
varying float vFade;
void main() {
  float fall = uFall * (0.85 + 0.3 * aSeed.w);
  vec3 lo = uCenter - vec3(uSize.x * 0.5, 0.0, uSize.z * 0.5);
  float y = mod(aSeed.y * uSize.y - fall * uTime, uSize.y);
  float tFall = (uSize.y - y) / fall;                     // seconds since this drop entered the volume
  vec3 w = vec3(aSeed.x * 977.0, y, aSeed.z * 977.0) + vec3(uWind.x, 0.0, uWind.y) * tFall;
  if (uSnow > 0.5) {
    w.x += sin(uTime * 0.9 + aSeed.w * 40.0) * 1.3;
    w.z += cos(uTime * 0.7 + aSeed.x * 40.0) * 1.3;
  }
  vec3 p = vec3(lo.x + mod(w.x - lo.x, uSize.x), uCenter.y + w.y, lo.z + mod(w.z - lo.z, uSize.z));
  vec3 vel = normalize(vec3(uWind.x, -fall, uWind.y));
  vec4 v0 = modelViewMatrix * vec4(p, 1.0);
  float width = max(0.02, -v0.z * 0.0017);              // ~2 px at any zoom (a real 2 cm drop is sub-pixel)
  vec4 mvPosition;
  if (uLen > 0.0) {
    vec4 v1 = modelViewMatrix * vec4(p - vel * uLen * (1.0 + 0.0006 * -v0.z), 1.0);
    vec2 dir = normalize(v1.xy - v0.xy + vec2(1e-5, 0.0));
    vec2 perp = vec2(-dir.y, dir.x);
    mvPosition = mix(v0, v1, position.y + 0.5);
    mvPosition.xy += perp * position.x * width;
  } else {
    mvPosition = v0;
    mvPosition.xy += position.xy * max(0.12, width * 2.4);
  }
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv;
  // fade near the volume's vertical ends and very close to the camera
  // (smoothstep needs edge0 < edge1: a reversed call is undefined in GLSL and returns 0 on ANGLE/Metal)
  float hy = y / uSize.y;
  vFade = smoothstep(0.0, 0.12, hy) * (1.0 - smoothstep(0.85, 1.0, hy)) * smoothstep(2.0, 12.0, -v0.z);
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSnow;
varying vec2 vUv;
varying float vFade;
void main() {
  float a;
  if (uSnow > 0.5) a = 1.0 - smoothstep(0.2, 0.5, length(vUv - 0.5));
  else a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.35, vUv.y);
  a *= uOpacity * vFade;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

export interface PrecipStyle {
  max: number;
  fall: number;
  len: number;
  color: string;
  opacity: number;
}

export const PRECIP: Readonly<Record<PrecipKind, PrecipStyle>> = {
  rain: { max: 8000, fall: 9, len: 1.8, color: '#CAD5E0', opacity: 0.5 },
  snow: { max: 3000, fall: 1.2, len: 0, color: '#F4F7FB', opacity: 0.9 },
};

/** Drawn instances for an intensity (0..1) and a tier budget. */
export function precipCount(kind: PrecipKind, intensity: number, budget: number): number {
  const i = Math.max(0, Math.min(1, intensity));
  return Math.round(Math.min(PRECIP[kind].max, budget) * i);
}

export class PrecipitationLayer {
  readonly mesh: THREE.Mesh;
  readonly kind: PrecipKind;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(kind: PrecipKind, seed = 1) {
    this.kind = kind;
    const st = PRECIP[kind];
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    const seeds = new Float32Array(st.max * 4);
    let s = seed >>> 0 || 1;
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    this.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      name: `Precipitation:${kind}`,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uSize: { value: new THREE.Vector3(300, 200, 300) },
        uWind: { value: new THREE.Vector2() }, uFall: { value: st.fall }, uLen: { value: st.len }, uSnow: { value: kind === 'snow' ? 1 : 0 },
        uColor: { value: new THREE.Color(st.color) }, uOpacity: { value: st.opacity },
      }]),
      transparent: true,
      depthWrite: false,
      // streak quads are built along the fall direction in view space; their winding flips with it
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = `precipitation:${kind}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
  }

  /**
   * Per frame: intensity 0..1, the camera orbit target and distance, wind 0..1 (drift direction fixed from the
   * south-west), the tier budget, a light factor (dimmer at night) and the camera height: the volume stops just
   * above the camera so no drops are spent where a downward-looking camera cannot see them.
   */
  update(time: number, intensity: number, target: THREE.Vector3, cameraDistance: number, wind: number, budget: number, light: number, cameraHeight = Infinity): void {
    const n = precipCount(this.kind, intensity, budget);
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    const u = this.material.uniforms;
    const k = Math.min(5, Math.max(1, cameraDistance / 320));
    u.uTime.value = time;
    (u.uCenter.value as THREE.Vector3).set(target.x, target.y, target.z);
    const height = Math.max(40, Math.min(200 * Math.min(k, 3), (cameraHeight - target.y) * 1.1));
    (u.uSize.value as THREE.Vector3).set(300 * k, height, 300 * k);
    const drift = (this.kind === 'snow' ? 1.5 : 3.5) * wind;
    (u.uWind.value as THREE.Vector2).set(0.78 * drift, -0.62 * drift);
    u.uLen.value = PRECIP[this.kind].len * k;
    (u.uColor.value as THREE.Color).set(PRECIP[this.kind].color).multiplyScalar(light);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
