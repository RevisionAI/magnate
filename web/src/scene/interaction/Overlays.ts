// Data overlays in "clay mode" (art §5.14, Appendix A.11): one R8 texel per plot, sampled by CityMaterial at
// world.xz / uCitySize + 0.5 (row 0 = north). The pure builders below turn layout / building data into bytes plus a
// legend; OverlayController owns the DataTexture and the uOverlay fade (0 → 1 in 0.3 s), the ramp mode and the
// zone palette (zones reuse the categorical path by swapping uOwnerColors while they are shown).
import * as THREE from 'three';
import {
  CityUniforms, OVERLAY_BINNED, OVERLAY_CATEGORICAL, OVERLAY_DIVERGING, OVERLAY_SEQUENTIAL, setOwnerColors,
} from '../materials/CityMaterial';
import { NEUTRAL_OWNER, OWNER_COLORS, STATUS } from '@/theme/tokens';
import { money, percent } from '@/util/format';
import type { OverlayId, OverlayLegend } from './interactionStore';
import { PLOT_BRIDGE, PLOT_PARCEL, PLOT_ROAD, type LayoutGrid } from './CityData';

/** Byte for "no category" in categorical overlays (CityMaterial draws uNeutralOwner). */
export const CAT_NONE = 255;
/** Neutral byte of the diverging ramp (0.5). */
export const DIVERGING_MID = 128;

// ------------------------------------------------------------------------------------------- palettes

/** The shader's sequential ramp stops (linear RGB, CityMaterial m_ramp), as sRGB hex for legends. */
export const RAMP_STOPS: readonly string[] = [
  [0.10, 0.16, 0.42], [0.07, 0.45, 0.55], [0.28, 0.70, 0.38], [0.98, 0.82, 0.25], [0.95, 0.38, 0.16],
].map(([r, g, b]) => `#${new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace).getHexString()}`);

/** Ramp colour at t ∈ [0, 1] as sRGB bytes (minimap, legends). */
export function rampColor(t: number): [number, number, number] {
  const stops = [[0.10, 0.16, 0.42], [0.07, 0.45, 0.55], [0.28, 0.70, 0.38], [0.98, 0.82, 0.25], [0.95, 0.38, 0.16]];
  const x = Math.min(1, Math.max(0, t)) * 4;
  const i = Math.min(3, Math.floor(x)), f = x - i;
  const hex = new THREE.Color().setRGB(
    stops[i][0] + (stops[i + 1][0] - stops[i][0]) * f,
    stops[i][1] + (stops[i + 1][1] - stops[i][1]) * f,
    stops[i][2] + (stops[i + 1][2] - stops[i][2]) * f,
    THREE.LinearSRGBColorSpace,
  ).getHex(THREE.SRGBColorSpace);
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Zone classes of the Zones overlay (8 slots of the categorical path). */
export const ZONE_CLASSES = [
  { label: 'Downtown', color: '#B8577E' },
  { label: 'Commercial', color: '#E27D4F' },
  { label: 'Apartments', color: '#E9B949' },
  { label: 'Houses', color: '#F1E2A0' },
  { label: 'Industrial', color: '#8E7CC3' },
  { label: 'Port', color: '#4A8FC4' },
  { label: 'Farmland', color: '#A4C46B' },
  { label: 'Parks & civic', color: '#3E9C6E' },
] as const;

/** District index (CityData.DISTRICTS) → zone class (255 = none). */
const DISTRICT_ZONE = [CAT_NONE, 0, 1, 1, 2, 3, 4, 5, 6, 7, 7];

// ------------------------------------------------------------------------------------------- builders

export interface OverlayBytes {
  bytes: Uint8Array;
  mode: number;
  /** Linear filtering for continuous fields; nearest for per-plot categories and footprints. */
  smooth: boolean;
  /** Zones swap the categorical palette. */
  palette: 'owners' | 'zones';
  legend: OverlayLegend;
}

/** Land value: log scale between the 5th and 98th percentile of priced plots, 5 bins (CapLab style). */
export function landValueOverlay(grid: LayoutGrid): OverlayBytes {
  const n = grid.gridW * grid.gridH;
  const bytes = new Uint8Array(n);
  const priced: number[] = [];
  for (let i = 0; i < n; i++) if (grid.landValue[i] > 0) priced.push(grid.landValue[i]);
  const values = fillRoads(grid.landValue, grid.kinds, grid.gridW, grid.gridH, (k) => k === PLOT_ROAD || k === PLOT_BRIDGE);
  priced.sort((a, b) => a - b);
  const legend: OverlayLegend = { overlay: 'landValue', title: 'Land value', subtitle: 'per plot', kind: 'bins', colors: binColors(), labels: [] };
  if (priced.length === 0) return { bytes, mode: OVERLAY_BINNED, smooth: false, palette: 'owners', legend: { ...legend, empty: 'No land prices for this city' } };
  const lo = Math.log(Math.max(1, quantile(priced, 0.05))), hi = Math.log(Math.max(2, quantile(priced, 0.98)));
  const span = Math.max(1e-6, hi - lo);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    bytes[i] = v > 0 ? clampByte(((Math.log(v) - lo) / span) * 255) : 0;
  }
  // Bin k covers [edge k, edge k+1); label each swatch with its lower edge (the first with "<" its upper edge).
  legend.labels = [0, 1, 2, 3, 4].map((k) => (k === 0 ? `<${shortMoney(Math.exp(lo + span * 0.2))}` : shortMoney(Math.exp(lo + (span * k) / 5)) + (k === 4 ? '+' : '')));
  return { bytes, mode: OVERLAY_BINNED, smooth: false, palette: 'owners', legend };
}

/** Traffic 0–100 on the sequential ramp. */
export function trafficOverlay(grid: LayoutGrid): OverlayBytes {
  const n = grid.gridW * grid.gridH;
  const bytes = new Uint8Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, grid.traffic[i]);
  for (let i = 0; i < n; i++) bytes[i] = clampByte((grid.traffic[i] / 100) * 255);
  const legend: OverlayLegend = { overlay: 'traffic', title: 'Traffic', subtitle: 'customer footfall', kind: 'ramp', colors: [...RAMP_STOPS], labels: ['Quiet', 'Busy'] };
  if (max <= 0) legend.empty = 'No traffic data for this city';
  return { bytes, mode: OVERLAY_SEQUENTIAL, smooth: true, palette: 'owners', legend };
}

/** Zones: districts grouped into 8 classes; roads, water and open land neutral. */
export function zonesOverlay(grid: LayoutGrid): OverlayBytes {
  const n = grid.gridW * grid.gridH;
  const bytes = new Uint8Array(n).fill(CAT_NONE);
  const present = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (grid.kinds[i] !== PLOT_PARCEL) continue;
    const z = DISTRICT_ZONE[grid.districts[i]] ?? CAT_NONE;
    bytes[i] = z;
    if (z !== CAT_NONE) present.add(z);
  }
  const shown = ZONE_CLASSES.map((z, i) => ({ ...z, i })).filter((z) => present.has(z.i));
  const legend: OverlayLegend = {
    overlay: 'zones', title: 'Zones', kind: 'categories', colors: shown.map((z) => z.color), labels: shown.map((z) => z.label),
  };
  if (shown.length === 0) legend.empty = 'No zoning data for this city';
  return { bytes, mode: OVERLAY_CATEGORICAL, smooth: false, palette: 'zones', legend };
}

/** Footprint of a building on the overlay grid (rotated plots). */
export interface OverlayFootprint {
  id: number;
  px: number;
  pz: number;
  w: number;
  h: number;
}

function fill(bytes: Uint8Array, W: number, H: number, f: OverlayFootprint, value: number): void {
  for (let z = Math.max(0, f.pz); z < Math.min(H, f.pz + f.h); z++) {
    for (let x = Math.max(0, f.px); x < Math.min(W, f.px + f.w); x++) bytes[z * W + x] = value;
  }
}

/** Owners: company footprints in owner colours (D15: index 0 = you); everything else neutral. */
export function ownersOverlay(W: number, H: number, footprints: readonly (OverlayFootprint & { colorIndex: number; ownerName: string; isPlayer: boolean })[]): OverlayBytes {
  const bytes = new Uint8Array(W * H).fill(CAT_NONE);
  const owners = new Map<number, string>();
  for (const f of footprints) {
    const idx = f.colorIndex >= 0 && f.colorIndex < 8 ? f.colorIndex : CAT_NONE;
    fill(bytes, W, H, f, idx);
    if (idx !== CAT_NONE && !owners.has(idx)) owners.set(idx, f.isPlayer ? 'You' : f.ownerName);
  }
  const order = [...owners.keys()].sort((a, b) => a - b);
  const legend: OverlayLegend = {
    overlay: 'owners', title: 'Owners', kind: 'categories',
    colors: [...order.map((i) => OWNER_COLORS[i]), NEUTRAL_OWNER], labels: [...order.map((i) => owners.get(i)!), 'Local & civic'],
  };
  if (order.length === 0) legend.empty = 'No company buildings in this city yet';
  return { bytes, mode: OVERLAY_CATEGORICAL, smooth: false, palette: 'owners', legend };
}

/** Profit: your buildings red → neutral → green by last month's net income (symmetric scale). */
export function profitOverlay(W: number, H: number, footprints: readonly (OverlayFootprint & { netIncome: number })[]): OverlayBytes {
  const bytes = new Uint8Array(W * H).fill(DIVERGING_MID);
  const scale = Math.max(1, ...footprints.map((f) => Math.abs(f.netIncome)));
  for (const f of footprints) fill(bytes, W, H, f, clampByte(127.5 + 127.5 * Math.max(-1, Math.min(1, f.netIncome / scale))));
  const legend: OverlayLegend = {
    overlay: 'profit', title: 'Profit', subtitle: 'your buildings, last month', kind: 'ramp',
    colors: [STATUS.loss, '#E8E4DC', STATUS.profitable], labels: [`−${money(scale, 1).replace('-', '')}`, `+${money(scale, 1)}`],
  };
  if (footprints.length === 0) legend.empty = 'You have no buildings in this city';
  return { bytes, mode: OVERLAY_DIVERGING, smooth: false, palette: 'owners', legend };
}

/**
 * Market share for one product: each store's realised share of last month's sales, spread as a halo over its
 * catchment (radius in plots). Diverging: your stores push towards green, rivals' (incl. local incumbents) towards
 * red, so the map shows who owns which neighbourhood; untouched land stays neutral clay.
 */
export function shareOverlay(
  W: number,
  H: number,
  stores: readonly (OverlayFootprint & { share: number; mine: boolean })[],
  productName: string,
  radius = 6,
): OverlayBytes {
  const bytes = new Uint8Array(W * H).fill(DIVERGING_MID);
  const max = Math.max(0, ...stores.map((s) => s.share));
  const mine = Math.max(0, ...stores.filter((s) => s.mine).map((s) => s.share));
  const rivals = Math.max(0, ...stores.filter((s) => !s.mine).map((s) => s.share));
  const legend: OverlayLegend = {
    overlay: 'share', title: 'Market share', subtitle: productName, kind: 'ramp',
    colors: [STATUS.loss, '#E8E4DC', STATUS.profitable], labels: [`Rivals ${percent(rivals, 0)}`, `You ${percent(mine, 0)}`],
  };
  if (stores.length === 0 || max <= 0) {
    legend.empty = `No store sold ${productName} here last month`;
    return { bytes, mode: OVERLAY_DIVERGING, smooth: true, palette: 'owners', legend };
  }
  const you = new Float32Array(W * H), them = new Float32Array(W * H);
  for (const s of stores) {
    const target = s.mine ? you : them;
    const cx = s.px + s.w / 2, cz = s.pz + s.h / 2, r = radius + Math.max(s.w, s.h) / 2;
    for (let z = Math.max(0, Math.floor(cz - r)); z < Math.min(H, Math.ceil(cz + r)); z++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(W, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / r;
        if (d >= 1) continue;
        const k = 1 - d * d * (3 - 2 * d);
        target[z * W + x] = Math.max(target[z * W + x], (s.share / max) * k);
      }
    }
  }
  for (let i = 0; i < bytes.length; i++) bytes[i] = clampByte(127.5 + 127.5 * Math.max(-1, Math.min(1, you[i] - them[i])));
  return { bytes, mode: OVERLAY_DIVERGING, smooth: true, palette: 'owners', legend };
}

/** Give road plots the mean of their priced neighbours (two passes), so per-plot land maps read as areas. */
export function fillRoads(values: Float32Array, kinds: Uint8Array, W: number, H: number, isFill: (kind: number) => boolean): Float32Array {
  let cur = values;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(cur);
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const i = z * W + x;
        if (!isFill(kinds[i]) || cur[i] > 0) continue;
        let sum = 0, n = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
          const v = cur[zz * W + xx];
          if (v > 0) { sum += v; n++; }
        }
        if (n > 0) next[i] = sum / n;
      }
    }
    cur = next;
  }
  return cur;
}

/** Nearest resample of a per-plot byte grid (layout and renderer grids normally match). */
export function resampleBytes(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  if (sw === dw && sh === dh) return src;
  const out = new Uint8Array(dw * dh);
  for (let z = 0; z < dh; z++) {
    const sz = Math.min(sh - 1, Math.floor(((z + 0.5) * sh) / dh));
    for (let x = 0; x < dw; x++) out[z * dw + x] = src[sz * sw + Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw))];
  }
  return out;
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/** "$14K", "$204K", "$1.2M" — two significant figures for legends. */
export function shortMoney(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K`;
  return `$${Math.round(v)}`;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function binColors(): string[] {
  return [0.1, 0.3, 0.5, 0.7, 0.9].map((t) => {
    const [r, g, b] = rampColor(t);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  });
}

/** Legend for the Links overlay (arcs, not clay). */
export function linksLegend(count: number): OverlayLegend {
  return {
    overlay: 'links', title: 'Supply links', subtitle: 'last month', kind: 'categories',
    colors: [OWNER_COLORS[0], '#F4F1E6'], labels: ['Your transfers', 'Imports & exports'],
    empty: count === 0 ? 'No supply flows in this city last month' : undefined,
  };
}

// ------------------------------------------------------------------------------------------- controller

/** Owns the overlay texture and the clay-mode uniforms. */
export class OverlayController {
  private texture: THREE.DataTexture | null = null;
  private data: Uint8Array | null = null;
  private w = 0;
  private h = 0;
  private target = 0;
  private palette: 'owners' | 'zones' = 'owners';

  /** Show `bytes` (w × h plots) with the given ramp. */
  show(overlay: OverlayBytes, w: number, h: number): void {
    if (!this.texture || this.w !== w || this.h !== h) {
      this.texture?.dispose();
      this.data = new Uint8Array(w * h);
      this.texture = new THREE.DataTexture(this.data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
      this.texture.colorSpace = THREE.NoColorSpace;
      this.texture.unpackAlignment = 1;        // odd grid widths would shear otherwise (w1-render §2.3)
      this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
      this.w = w;
      this.h = h;
    }
    if (overlay.bytes.length !== w * h) throw new Error(`overlay is ${overlay.bytes.length} bytes for a ${w}×${h} grid`);
    this.data!.set(overlay.bytes);
    const filter = overlay.smooth ? THREE.LinearFilter : THREE.NearestFilter;
    if (this.texture.magFilter !== filter) {
      this.texture.magFilter = filter;
      this.texture.minFilter = filter;
    }
    this.texture.needsUpdate = true;
    CityUniforms.uOverlayTex.value = this.texture;
    CityUniforms.uOverlayMode.value = overlay.mode;
    this.setPalette(overlay.palette);
    this.target = 1;
  }

  /** Fade clay mode out (the texture stays bound until fully faded). */
  hide(): void {
    this.target = 0;
  }

  get active(): boolean {
    return this.target > 0;
  }

  /** Advance the 0.3 s fade. */
  update(dt: number, reducedMotion: boolean): void {
    const u = CityUniforms.uOverlay;
    if (u.value === this.target) return;
    const step = reducedMotion ? 1 : dt / 0.3;
    u.value = this.target > u.value ? Math.min(this.target, u.value + step) : Math.max(this.target, u.value - step);
    if (u.value === 0) this.setPalette('owners');
  }

  private setPalette(p: 'owners' | 'zones'): void {
    if (p === this.palette) return;
    this.palette = p;
    setOwnerColors(p === 'zones' ? ZONE_CLASSES.map((z) => z.color) : OWNER_COLORS);
  }

  dispose(): void {
    CityUniforms.uOverlay.value = 0;
    if (CityUniforms.uOverlayTex.value === this.texture) CityUniforms.uOverlayTex.value = null;
    this.setPalette('owners');
    this.texture?.dispose();
    this.texture = null;
  }
}

/** UX §6.6: the overlay a building type wants while placing it. */
export function autoOverlayFor(type: { retail: boolean; category: string }): OverlayId {
  if (type.retail) return 'traffic';
  switch (type.category) {
    case 'farm':
    case 'plantation':
    case 'mine':
    case 'oil_well':
      return 'zones';
    default:
      return 'landValue';
  }
}

/** Per-overlay ramp mode constants re-exported for tests. */
export const OVERLAY_MODES = { OVERLAY_SEQUENTIAL, OVERLAY_DIVERGING, OVERLAY_CATEGORICAL, OVERLAY_BINNED } as const;
export type { OverlayId };
