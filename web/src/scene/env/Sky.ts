// Art-directed sky dome (art §3.7): gradient horizon → top, sun disc + glow by day, hashed stars at night, a band
// below the horizon that melts into the fog colour. Not the Preetham Sky add-on (physically based, and its uniforms
// changed in r183/r186).
//
// Drawn *last* among opaque objects (renderOrder 1e6, depth test on, depth write off, z pushed to the far plane):
// every pixel already covered by the city is rejected by early-z (−1.5 ms at close zoom on the UHD 630, art §1.3).
// With the gameplay tilt limits (elevation ≥ 35°, FOV 35°) the horizon is never on screen, so the sky matters mostly
// for glass/water reflections (it feeds the water PMREM) and photo/free cameras.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Rotation-only view transform: the dome is infinitely far away and follows the camera.
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uTop, uHorizon, uFog, uSunDir, uSunColor, uOvercast;
uniform float uSunVis, uNight, uDesat, uFlash;
varying vec3 vDir;
float skyHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uTop, pow(up, 0.45));
  if (d.y < 0.0) col = uHorizon * 0.85;
  // Blend the lowest band into the fog colour so distant terrain and sky meet without a seam.
  col = mix(uFog, col, smoothstep(-0.03, 0.12, d.y));
  // Overcast: desaturate towards the cloud grey.
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, uOvercast * (0.35 + 1.1 * l), uDesat);
  // Sun disc + glow (day only; fades under cloud).
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 18.0 + pow(sd, 12.0) * 0.35) * uSunVis * (1.0 - 0.85 * uDesat);
  // Stars: hashed cells, only once it is properly dark (not at sunset), above the horizon, hidden by clouds.
  float star = step(0.9975, skyHash(floor(d * 380.0)));
  col += vec3(star) * smoothstep(0.35, 0.9, uNight) * 1.6 * smoothstep(0.02, 0.2, d.y) * (1.0 - uDesat);
  col += vec3(0.75, 0.8, 1.0) * uFlash;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly uniforms = {
    uTop: { value: new THREE.Color('#4F8FD8') },
    uHorizon: { value: new THREE.Color('#D3E6F3') },
    uFog: { value: new THREE.Color('#D4E4EF') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color('#FFF6E8') },
    uOvercast: { value: new THREE.Color('#9AA6B1') },
    uSunVis: { value: 1 },
    uNight: { value: 0 },
    uDesat: { value: 0 },
    uFlash: { value: 0 },
  };
  private readonly geometry = new THREE.SphereGeometry(1, 32, 16);

  constructor() {
    this.material = new THREE.ShaderMaterial({
      name: 'MagnateSky',
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1e6;          // after every opaque object
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = false;
  }

  /** A second mesh sharing the material, for the water-reflection PMREM scene. */
  createProbeMesh(): THREE.Mesh {
    const m = new THREE.Mesh(this.geometry, this.material);
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    return m;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
