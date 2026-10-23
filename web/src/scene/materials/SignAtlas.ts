// Reference implementation from docs/overhaul/research/art-rendering.md Appendix A (materials/SignAtlas.ts).
// Verified to type-check against three 0.186 / postprocessing 6.39.5 / camera-controls 3.1.2.
// Company wordmarks + ad billboards drawn once into a CanvasTexture atlas (sRGB, mipmapped, padded slots).
//
// W4 additions (backward compatible): the slot styles that AssetFactory SignQuads ask for (inverted wordmark, emblem
// only, grey "closed" board, literal text such as the seaport's "C"/"I"), uvFor() to resolve a SignQuad, font loading,
// slot reuse when the atlas is full, and buildSignGeometry() to turn SignQuads into one mesh for the sign material.
import * as THREE from 'three';
import type { SignQuad, SignStyle } from '../assets/AssetFactory';

export interface CompanyStyle { id: string; name: string; color: string; emblem: 'circle' | 'triangle' | 'square' | 'diamond' | 'star' | 'hexagon' | 'cross' | 'ring'; }
const W = 2048, H = 2048, SW = 512, SH = 128, PAD = 8, COLS = W / SW;   // 4 x 16 = 64 name slots
const SLOTS = COLS * (H / SH);
/** Sign font stack: the UI's self-hosted Inter (tokens.ts FONTS.ui) first. */
const SIGN_FONT = '700 64px "Inter Variable", "Inter Tight", "Inter", system-ui, sans-serif';
/** Grey of the "closed" board (art §4.1). */
export const CLOSED_SIGN_COLOR = '#9A9A9A';

export type UvRect = [number, number, number, number];

export class SignAtlas {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private readonly slots = new Map<string, number>();
  private readonly drawn = new Map<string, UvRect>();
  private next = 0;
  constructor(renderer: THREE.WebGLRenderer) {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    this.texture = new THREE.CanvasTexture(this.canvas as HTMLCanvasElement);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.texture.generateMipmaps = true; this.texture.minFilter = THREE.LinearMipmapLinearFilter;
  }

  /** Wait for the sign font so the first draw does not fall back (art §5.7). Safe to call without a document. */
  static async loadFonts(): Promise<void> {
    if (typeof document === 'undefined' || !document.fonts) return;
    try { await document.fonts.load(SIGN_FONT); } catch { /* fall back to system-ui */ }
  }

  /** Returns UV rect [u0, v0, u1, v1] for the company's wordmark slot (light-on-colour variant). */
  company(c: CompanyStyle): [number, number, number, number] {
    let slot = this.slots.get(c.id);
    if (slot === undefined) { slot = this.allocate(c.id); }
    const x = (slot % COLS) * SW, y = Math.floor(slot / COLS) * SH, g = this.ctx;
    g.clearRect(x, y, SW, SH);
    g.fillStyle = c.color; g.fillRect(x + PAD, y + PAD, SW - 2 * PAD, SH - 2 * PAD);
    g.fillStyle = '#FFFFFF'; this.emblem(c.emblem, x + PAD + 56, y + SH / 2, 34);
    this.text(c.name.toUpperCase(), x + PAD + 104, y + SH / 2 + 2, SW - 2 * PAD - 120, '#FFFFFF');
    this.texture.needsUpdate = true;
    return [x / W, 1 - (y + SH) / H, (x + SW) / W, 1 - y / H];      // flipY = true (CanvasTexture default)
  }

  /** Owner-colour wordmark on white (art §5.7 "inverted variant"). */
  companyInverted(c: CompanyStyle): UvRect {
    return this.cached(`inv:${c.id}:${c.color}:${c.name}`, (x, y, g) => {
      g.fillStyle = '#F4F2EC'; g.fillRect(x + PAD, y + PAD, SW - 2 * PAD, SH - 2 * PAD);
      g.fillStyle = c.color; this.emblem(c.emblem, x + PAD + 56, y + SH / 2, 34);
      this.text(c.name.toUpperCase(), x + PAD + 104, y + SH / 2 + 2, SW - 2 * PAD - 120, c.color);
      return [x, y, SW, SH];
    });
  }

  /** White emblem on the owner colour, square (water towers, roof logos, hoarding badges). */
  emblemOnly(c: CompanyStyle): UvRect {
    return this.cached(`emb:${c.id}:${c.color}:${c.emblem}`, (x, y, g) => {
      g.fillStyle = c.color; g.fillRect(x + PAD, y + PAD, SH - 2 * PAD, SH - 2 * PAD);
      g.fillStyle = '#FFFFFF'; this.emblem(c.emblem, x + SH / 2, y + SH / 2, 40);
      return [x, y, SH, SH];
    });
  }

  /** Grey blank board for closed / bankrupt firms (art §4.1). */
  closed(): UvRect {
    return this.cached('closed', (x, y, g) => {
      g.fillStyle = CLOSED_SIGN_COLOR; g.fillRect(x + PAD, y + PAD, SW - 2 * PAD, SH - 2 * PAD);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + PAD + 24, y + SH / 2 - 4, SW - 2 * PAD - 48, 8);
      return [x, y, SW, SH];
    });
  }

  /** Literal text slot, e.g. the seaport's customs letters (caplab §5.6). */
  label(text: string, bg = '#1F2A36', fg = '#FFFFFF'): UvRect {
    return this.cached(`txt:${text}:${bg}:${fg}`, (x, y, g) => {
      g.fillStyle = bg; g.fillRect(x + PAD, y + PAD, SW - 2 * PAD, SH - 2 * PAD);
      this.text(text.toUpperCase(), x + SW / 2, y + SH / 2 + 2, SW - 2 * PAD - 40, fg, true);
      return [x, y, SW, SH];
    });
  }

  /** UV rect for a SignQuad given the owning company's style (closed boards and text slots need no company). */
  uvFor(sign: Pick<SignQuad, 'style' | 'text'>, c: CompanyStyle): UvRect {
    const style: SignStyle = sign.style ?? 'wordmark';
    switch (style) {
      case 'inverted': return this.companyInverted(c);
      case 'emblem': return this.emblemOnly(c);
      case 'closed': return this.closed();
      case 'text': return this.label(sign.text ?? '');
      case 'wordmark':
      default: return this.cachedCompany(c);
    }
  }

  private cachedCompany(c: CompanyStyle): UvRect {
    const key = `wm:${c.id}:${c.color}:${c.name}:${c.emblem}`;
    const hit = this.drawn.get(key);
    if (hit) return hit;
    const uv = this.company(c);
    this.drawn.set(key, uv);
    return uv;
  }

  /** Draw once into a fresh slot; fn returns the used [x, y, w, h] in canvas pixels. */
  private cached(key: string, fn: (x: number, y: number, g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => [number, number, number, number]): UvRect {
    const hit = this.drawn.get(key);
    if (hit) return hit;
    const slot = this.allocate(key);
    const x = (slot % COLS) * SW, y = Math.floor(slot / COLS) * SH;
    this.ctx.clearRect(x, y, SW, SH);
    const [rx, ry, rw, rh] = fn(x, y, this.ctx);
    this.texture.needsUpdate = true;
    const uv: UvRect = [rx / W, 1 - (ry + rh) / H, (rx + rw) / W, 1 - ry / H];
    this.drawn.set(key, uv);
    return uv;
  }

  /** Next free slot; when all 64 are used the oldest is recycled (its cached UVs are dropped). */
  private allocate(key: string): number {
    const slot = this.next % SLOTS;
    this.next++;
    for (const [k, s] of this.slots) if (s === slot) { this.slots.delete(k); }
    for (const [k, uv] of this.drawn) if (Math.floor((1 - uv[3]) * H / SH) * COLS + Math.floor(uv[0] * W / SW) === slot) this.drawn.delete(k);
    this.slots.set(key, slot);
    return slot;
  }

  private text(text: string, x: number, y: number, maxW: number, color: string, centred = false): void {
    const g = this.ctx;
    g.font = SIGN_FONT; g.textBaseline = 'middle'; g.fillStyle = color;
    const m = g.measureText(text).width;
    g.save(); g.translate(x, y); if (m > maxW) g.scale(maxW / m, 1);
    if (centred) g.textAlign = 'center';
    g.fillText(text, 0, 0); g.restore();
  }

  private emblem(kind: CompanyStyle['emblem'], cx: number, cy: number, r: number): void {
    const g = this.ctx; g.beginPath();
    const poly = (n: number, rot: number, rr = r) => { for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; if (i) g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); };
    if (kind === 'circle' || kind === 'ring') g.arc(cx, cy, r, 0, Math.PI * 2);
    else if (kind === 'triangle') poly(3, -Math.PI / 2);
    else if (kind === 'square') poly(4, Math.PI / 4, r * 1.2);
    else if (kind === 'diamond') poly(4, 0);
    else if (kind === 'hexagon') poly(6, 0);
    else if (kind === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r; if (i) g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); }
    else { g.rect(cx - r, cy - r * 0.3, 2 * r, r * 0.6); g.rect(cx - r * 0.3, cy - r, r * 0.6, 2 * r); }
    if (kind === 'ring') { g.lineWidth = r * 0.35; g.strokeStyle = g.fillStyle as string; g.stroke(); } else g.fill();
  }
}

/** Sign material: unlit colour from the atlas by day, glowing at night (emissiveIntensity driven by DayNight). */
export function makeSignMaterial(atlas: SignAtlas): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ map: atlas.texture, emissive: new THREE.Color(1, 1, 1), emissiveMap: atlas.texture, emissiveIntensity: 0 });
}

/** One indexed BufferGeometry for many SignQuads (position, normal, uv): corners map to the atlas rect as
 *  bottom-left (u0,v0), bottom-right (u1,v0), top-right (u1,v1), top-left (u0,v1). Draw it with makeSignMaterial. */
export function buildSignGeometry(signs: readonly SignQuad[], uvFor: (s: SignQuad) => UvRect): THREE.BufferGeometry {
  const pos = new Float32Array(signs.length * 12), nrm = new Float32Array(signs.length * 12), uv = new Float32Array(signs.length * 8);
  const idx = new Uint32Array(signs.length * 6);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  signs.forEach((s, i) => {
    const [u0, v0, u1, v1] = uvFor(s);
    const q = s.corners;
    a.fromArray(q[0]); b.fromArray(q[1]); c.fromArray(q[2]);
    n.subVectors(b, a).cross(c.sub(a)).normalize();
    for (let k = 0; k < 4; k++) {
      pos.set(q[k], i * 12 + k * 3);
      nrm.set([n.x, n.y, n.z], i * 12 + k * 3);
    }
    uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}
