// Placement-ghost hologram (art §5.13): the factory's LOD0 geometry drawn unlit and translucent with its own vertex
// colours, tinted towards the validity colour, plus a rising scanline (0.15 · step(0.9, fract(worldY · 0.5 − t))) and
// a soft fresnel rim. Reads GeoBuilder's packed attributes (colour = sRGB bytes + tint weight) directly, so it never
// enables three's vertexAlphas path (which would treat the tint weight as alpha).
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec4 color;
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vNormalW;
vec3 h_srgb2lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
void main() {
  vColor = h_srgb2lin(color.rgb);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uTintMix;
uniform float uOpacity;
uniform float uTime;
uniform float uFlash;
varying vec3 vColor;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec3 base = mix(vColor, uTint, uTintMix);
  vec3 v = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - abs(dot(normalize(vNormalW), v)), 2.0);
  float scan = 0.15 * step(0.9, fract(vWorld.y * 0.5 - uTime));
  float lambert = 0.75 + 0.25 * max(dot(normalize(vNormalW), normalize(vec3(0.4, 0.8, 0.3))), 0.0);
  vec3 col = base * lambert + uTint * (0.35 * rim + scan) + vec3(uFlash);
  gl_FragColor = vec4(col, uOpacity * (0.85 + 0.15 * rim));
  #include <colorspace_fragment>
}
`;

export interface HologramUniforms {
  [uniform: string]: THREE.IUniform;
  uTint: THREE.IUniform<THREE.Color>;
  uTintMix: THREE.IUniform<number>;
  uOpacity: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uFlash: THREE.IUniform<number>;
}

export type HologramMaterial = THREE.ShaderMaterial & { uniforms: HologramUniforms };

/** One material per ghost: tint = validity colour (sRGB hex), opacity 0.55 by default. */
export function makeHologramMaterial(tint = '#61C28F', opacity = 0.55): HologramMaterial {
  const uniforms: HologramUniforms = {
    uTint: { value: new THREE.Color(tint) },
    uTintMix: { value: 0.35 },
    uOpacity: { value: opacity },
    uTime: { value: 0 },
    uFlash: { value: 0 },
  };
  const m = new THREE.ShaderMaterial({
    name: 'Hologram',
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  return m as HologramMaterial;
}
