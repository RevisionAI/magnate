// Status badges and the gold ring decal (art §3.4).
//   • Badges: instanced camera-facing quads of a constant 28 px from a small icon atlas, 6 m above the roof, over
//     YOUR buildings at district and city zoom: green ▲ profitable, amber ! warning, red ▼ loss, blue ⧗ under
//     construction. A rival's emblem badge appears only on hover (and over every rival in the Owners overlay).
//   • Gold ring: a flat outline on the lot of every one of your buildings, at every zoom (width grows with distance).
// One draw call each. Colours follow the colour-vision setting (PROFIT_LOSS remap).
import * as THREE from 'three';
import { OWNER_COLORS, OWNER_EMBLEMS, PROFIT_LOSS, STATUS, type ColourVisionMode, type OwnerEmblem } from '@/theme/tokens';
import type { StatusClass } from './CityData';
import { footprintRect, makeRingMaterial, rectRingGeometry, ringWidthFor, type RingMaterial } from './FootprintRing';

const TILE = 64, COLS = 4, ROWS = 4, ATLAS = TILE * COLS;
/** Atlas tiles: 0 profitable, 1 warning, 2 loss, 3 construction, 4..11 rival emblems by colorIndex. */
export const TILE_OF_STATUS: Readonly<Record<Exclude<StatusClass, 'neutral'>, number>> = { profitable: 0, warning: 1, loss: 2, construction: 3 };
export const EMBLEM_TILE0 = 4;

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute float aTile;
attribute float aScale;
uniform vec2 uViewport;
uniform float uSizePx;
varying vec2 vUv;
void main() {
  vec4 c = projectionMatrix * viewMatrix * vec4(aPos, 1.0);
  vec2 offset = position.xy * uSizePx * aScale * 2.0 / uViewport;
  c.xy += offset * c.w;
  float col = mod(aTile, ${COLS}.0), row = floor(aTile / ${COLS}.0);
  vUv = (vec2(col, ${ROWS - 1}.0 - row) + position.xy + 0.5) / vec2(${COLS}.0, ${ROWS}.0);
  gl_Position = c;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  if (t.a < 0.02) discard;
  gl_FragColor = vec4(t.rgb, t.a * uOpacity);
  #include <colorspace_fragment>
}
`;

export interface BadgeInstance {
  /** World position of the badge centre. */
  x: number;
  y: number;
  z: number;
  tile: number;
  scale?: number;
}

/** Draw the icon atlas (profit / warning / loss / construction + 8 emblems) into a canvas. */
function drawAtlas(canvas: HTMLCanvasElement | OffscreenCanvas, vision: ColourVisionMode): void {
  const g = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!g) return;
  g.clearRect(0, 0, ATLAS, ATLAS);
  const pl = PROFIT_LOSS[vision] ?? PROFIT_LOSS.off;
  const disc = (i: number, fill: string, ring = 'rgba(255,255,255,0.92)') => {
    const x = (i % COLS) * TILE + TILE / 2, y = Math.floor(i / COLS) * TILE + TILE / 2;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 5;
    g.shadowOffsetY = 1.5;
    g.beginPath();
    g.arc(x, y, 23, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
    g.restore();
    g.lineWidth = 3.5;
    g.strokeStyle = ring;
    g.beginPath();
    g.arc(x, y, 23, 0, Math.PI * 2);
    g.stroke();
    return { x, y };
  };
  const tri = (x: number, y: number, up: boolean, color: string) => {
    g.fillStyle = color;
    g.beginPath();
    const s = up ? -1 : 1;
    g.moveTo(x, y + s * 11);
    g.lineTo(x + 11, y - s * 7);
    g.lineTo(x - 11, y - s * 7);
    g.closePath();
    g.fill();
  };
  let p = disc(0, vision === 'off' ? STATUS.profitable : pl.pos);
  tri(p.x, p.y + 1, true, '#FFFFFF');
  p = disc(1, STATUS.warning);
  g.fillStyle = '#2A1E05';
  g.fillRect(p.x - 3, p.y - 13, 6, 16);
  g.beginPath();
  g.arc(p.x, p.y + 9, 3.6, 0, Math.PI * 2);
  g.fill();
  p = disc(2, vision === 'off' ? STATUS.loss : pl.neg);
  tri(p.x, p.y - 1, false, '#FFFFFF');
  p = disc(3, '#4F86B8');
  g.fillStyle = '#FFFFFF';
  g.beginPath();                                   // hourglass: under construction
  g.moveTo(p.x - 9, p.y - 12); g.lineTo(p.x + 9, p.y - 12); g.lineTo(p.x, p.y); g.closePath();
  g.moveTo(p.x - 9, p.y + 12); g.lineTo(p.x + 9, p.y + 12); g.lineTo(p.x, p.y); g.closePath();
  g.fill();
  OWNER_EMBLEMS.forEach((emblem, i) => {
    const q = disc(EMBLEM_TILE0 + i, 'rgba(14,22,30,0.92)', OWNER_COLORS[i]);
    drawEmblem(g, emblem, q.x, q.y, 12, OWNER_COLORS[i]);
  });
}

function drawEmblem(g: CanvasRenderingContext2D, kind: OwnerEmblem, cx: number, cy: number, r: number, color: string): void {
  g.fillStyle = color;
  g.strokeStyle = color;
  g.beginPath();
  const poly = (n: number, rot: number, rr = r) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      if (i) g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      else g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
  };
  if (kind === 'circle' || kind === 'ring') g.arc(cx, cy, kind === 'ring' ? r * 0.8 : r, 0, Math.PI * 2);
  else if (kind === 'triangle') poly(3, -Math.PI / 2, r * 1.15);
  else if (kind === 'square') poly(4, Math.PI / 4, r * 1.2);
  else if (kind === 'diamond') poly(4, -Math.PI / 2, r * 1.15);
  else if (kind === 'hexagon') poly(6, 0);
  else if (kind === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r * 1.1;
      if (i) g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      else g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
  } else {
    g.rect(cx - r, cy - r * 0.32, 2 * r, r * 0.64);
    g.rect(cx - r * 0.32, cy - r, r * 0.64, 2 * r);
  }
  if (kind === 'ring') {
    g.lineWidth = r * 0.45;
    g.stroke();
  } else g.fill();
}

/** Instanced billboard badges (one draw call). */
export class BadgeLayer {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private capacity = 0;
  private vision: ColourVisionMode = 'off';

  constructor() {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(ATLAS, ATLAS) : Object.assign(document.createElement('canvas'), { width: ATLAS, height: ATLAS });
    drawAtlas(this.canvas, this.vision);
    this.texture = new THREE.CanvasTexture(this.canvas as HTMLCanvasElement);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.material = new THREE.ShaderMaterial({
      name: 'StatusBadge',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uAtlas: { value: this.texture }, uViewport: { value: new THREE.Vector2(1920, 1080) }, uSizePx: { value: 28 }, uOpacity: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'status-badges';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.ensure(16);
  }

  private ensure(n: number): void {
    if (n <= this.capacity) return;
    this.capacity = Math.max(n, this.capacity * 2);
    this.geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1).setUsage(THREE.DynamicDrawUsage));
  }

  setVision(mode: ColourVisionMode): void {
    if (mode === this.vision) return;
    this.vision = mode;
    drawAtlas(this.canvas, mode);
    this.texture.needsUpdate = true;
  }

  set(badges: readonly BadgeInstance[]): void {
    this.ensure(badges.length);
    const pos = this.geometry.getAttribute('aPos') as THREE.InstancedBufferAttribute;
    const tile = this.geometry.getAttribute('aTile') as THREE.InstancedBufferAttribute;
    const scale = this.geometry.getAttribute('aScale') as THREE.InstancedBufferAttribute;
    badges.forEach((b, i) => {
      pos.setXYZ(i, b.x, b.y, b.z);
      tile.setX(i, b.tile);
      scale.setX(i, b.scale ?? 1);
    });
    pos.needsUpdate = tile.needsUpdate = scale.needsUpdate = true;
    this.geometry.instanceCount = badges.length;
    this.mesh.visible = badges.length > 0;
  }

  /** Viewport in CSS pixels (the badge size is in CSS pixels too). */
  resize(width: number, height: number): void {
    (this.material.uniforms.uViewport.value as THREE.Vector2).set(width, height);
  }

  set opacity(v: number) {
    this.material.uniforms.uOpacity.value = v;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

/** The gold ring decal under every player building (one merged mesh, rebuilt when the set changes). */
export class GoldRings {
  readonly mesh: THREE.Mesh;
  private readonly material: RingMaterial;
  private signature = '';

  constructor() {
    this.material = makeRingMaterial(STATUS.ring, { width: 1.5, opacity: 0.95, lift: 0.35 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.name = 'gold-rings';
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
  }

  set(footprints: readonly { px: number; pz: number; w: number; h: number }[], gridW: number, gridH: number): void {
    const signature = `${gridW}x${gridH}|` + footprints.map((f) => `${f.px},${f.pz},${f.w},${f.h}`).join(';');
    if (signature === this.signature) return;
    this.signature = signature;
    this.mesh.geometry.dispose();
    this.mesh.geometry = rectRingGeometry(footprints.map((f) => footprintRect(f.px, f.pz, f.w, f.h, gridW, gridH)), 0.6);
    this.mesh.visible = footprints.length > 0;
  }

  update(distance: number): void {
    this.material.uniforms.uWidth.value = ringWidthFor(distance, 1.5, 2.6);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
