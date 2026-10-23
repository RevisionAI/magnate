// Ground outlines drawn flat just above the lots: the player's gold ring decal (art §3.4), the selected building's
// dashed gold ring (art §5.13), the placement ghost's border and its catchment circle. One merged mesh per use;
// the ring width is a uniform (world metres) so it can grow with camera distance and stay visible at city zoom.
import * as THREE from 'three';
import { PLOT_SIZE } from '../units';

const VERT = /* glsl */ `
attribute vec2 aIn;
attribute float aDist;
uniform float uWidth;
uniform float uLift;
varying float vDist;
void main() {
  vec3 p = position + vec3(aIn.x, 0.0, aIn.y) * uWidth;
  p.y += uLift;
  vDist = aDist;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uDash;      // dash period in metres (0 = solid)
uniform float uTime;
varying float vDist;
void main() {
  float a = uOpacity;
  if (uDash > 0.0) {
    float f = fract(vDist / uDash - uTime);
    a *= smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.55, 0.63, f));
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

export interface RingRect {
  /** World rectangle (metres). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type RingMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uColor: THREE.IUniform<THREE.Color>; uOpacity: THREE.IUniform<number>; uWidth: THREE.IUniform<number>;
    uDash: THREE.IUniform<number>; uTime: THREE.IUniform<number>; uLift: THREE.IUniform<number>;
  };
};

export function makeRingMaterial(color: string, opts: { opacity?: number; width?: number; dash?: number; lift?: number } = {}): RingMaterial {
  return new THREE.ShaderMaterial({
    name: 'FootprintRing',
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opts.opacity ?? 1 },
      uWidth: { value: opts.width ?? 1.5 },
      uDash: { value: opts.dash ?? 0 },
      uTime: { value: 0 },
      uLift: { value: opts.lift ?? 0.3 },
    },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  }) as RingMaterial;
}

/** Rectangle outlines (inner offset grows inward with uWidth). Corners use diagonal offsets so edges meet cleanly. */
export function rectRingGeometry(rects: readonly RingRect[], inset = 0.4): THREE.BufferGeometry {
  const pos: number[] = [], inn: number[] = [], dist: number[] = [], idx: number[] = [];
  for (const r of rects) {
    const x0 = r.x0 + inset, z0 = r.z0 + inset, x1 = r.x1 - inset, z1 = r.z1 - inset;
    // corners clockwise from NW with their inward diagonal
    const c = [[x0, z0, 1, 1], [x1, z0, -1, 1], [x1, z1, -1, -1], [x0, z1, 1, -1]];
    let d = 0;
    for (let k = 0; k < 4; k++) {
      const a = c[k], b = c[(k + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const base = pos.length / 3;
      pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], 0, b[1], a[0], 0, a[1]);
      inn.push(0, 0, 0, 0, b[2], b[3], a[2], a[3]);
      dist.push(d, d + len, d + len, d);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      d += len;
    }
  }
  return finish(pos, inn, dist, idx);
}

/** Circle outline (catchment ring). */
export function circleRingGeometry(cx: number, cz: number, radius: number, segments = 96): THREE.BufferGeometry {
  const pos: number[] = [], inn: number[] = [], dist: number[] = [], idx: number[] = [];
  const circ = 2 * Math.PI * radius;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    pos.push(cx + x * radius, 0, cz + z * radius, cx + x * radius, 0, cz + z * radius);
    inn.push(0, 0, -x, -z);
    dist.push((i / segments) * circ, (i / segments) * circ);
    if (i < segments) {
      const b = i * 2;
      idx.push(b, b + 2, b + 3, b, b + 3, b + 1);
    }
  }
  return finish(pos, inn, dist, idx);
}

function finish(pos: number[], inn: number[], dist: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aIn', new THREE.Float32BufferAttribute(inn, 2));
  g.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** World rectangle of a rotated plot footprint. */
export function footprintRect(px: number, pz: number, w: number, h: number, gridW: number, gridH: number): RingRect {
  const ox = -(gridW * PLOT_SIZE) / 2, oz = -(gridH * PLOT_SIZE) / 2;
  return { x0: ox + px * PLOT_SIZE, z0: oz + pz * PLOT_SIZE, x1: ox + (px + w) * PLOT_SIZE, z1: oz + (pz + h) * PLOT_SIZE };
}

/** Ring width (m) that keeps about `px` pixels on screen at a camera distance (FOV 35°, 1080 px tall). */
export function ringWidthFor(distance: number, minM: number, px = 2.2): number {
  return Math.max(minM, distance * 0.000585 * px);
}
