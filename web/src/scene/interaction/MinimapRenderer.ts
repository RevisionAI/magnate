// Minimap (UX §6.3/§6.20): a 2D canvas of the active city — districts, roads and water from the engine layout (or the
// active overlay's colours), company footprints in owner colours with the gold ring on yours, the selection, and the
// camera's ground footprint. Pure functions build the per-plot base image and map between plot and canvas space; the
// HUD component (ui/hud/Minimap.tsx) owns the canvas and input.
import { OWNER_COLORS, STATUS, UI } from '@/theme/tokens';
import { isWater, PLOT_BEACH, PLOT_BRIDGE, PLOT_PARCEL, PLOT_RIVER, PLOT_ROAD, type LayoutGrid } from './CityData';
import type { MinimapBuilding, MinimapModel, MinimapView } from './interactionStore';
import { CAT_NONE, rampColor, ZONE_CLASSES } from './Overlays';
import { OVERLAY_BINNED, OVERLAY_CATEGORICAL, OVERLAY_DIVERGING } from '../materials/CityMaterial';

type RGB = readonly [number, number, number];

function hex(h: string): RGB {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Map palette: muted districts on a dark ground so owner colours and the gold ring pop. */
const GROUND: RGB = hex('#2E3F31');
const DISTRICT_RGB: readonly RGB[] = [
  hex('#3A4C38'), // none
  hex('#7C7166'), // cbd
  hex('#6C6259'), // commercial
  hex('#655D55'), // mixed
  hex('#5D5A55'), // apartments
  hex('#4C5B45'), // houses
  hex('#545064'), // industrial
  hex('#4A5A6E'), // port
  hex('#45583A'), // rural
  hex('#3F6E47'), // park
  hex('#5C6C7A'), // civic
];
const ROAD_RGB: readonly RGB[] = [hex('#8E959C'), hex('#8E959C'), hex('#A9AFB5'), hex('#CFCAB9'), hex('#E2D3A0')];
const SEA: RGB = hex('#1E4C6B'), RIVER: RGB = hex('#28627F'), BEACH: RGB = hex('#A8976C');

/** Per-plot overlay colouring for the minimap (same bytes the city shader samples). */
export interface MinimapOverlay {
  bytes: Uint8Array;
  mode: number;
  palette: 'owners' | 'zones';
}

/** RGBA bytes, one pixel per plot (row 0 = north). Roads and water stay visible under an overlay. */
export function minimapBase(gridW: number, gridH: number, grid: LayoutGrid | null, overlay: MinimapOverlay | null): Uint8ClampedArray {
  const n = gridW * gridH;
  const out = new Uint8ClampedArray(n * 4);
  const usable = grid && grid.gridW === gridW && grid.gridH === gridH ? grid : null;
  const zone = ZONE_CLASSES.map((z) => hex(z.color));
  const owners = OWNER_COLORS.map(hex);
  for (let i = 0; i < n; i++) {
    let c: RGB = GROUND;
    const kind = usable ? usable.kinds[i] : PLOT_PARCEL;
    if (usable) {
      if (kind === PLOT_ROAD || kind === PLOT_BRIDGE) c = ROAD_RGB[usable.roads[i]] ?? ROAD_RGB[1];
      else if (isWater(kind)) c = kind === PLOT_RIVER ? RIVER : SEA;
      else if (kind === PLOT_BEACH) c = BEACH;
      else if (kind === PLOT_PARCEL) c = DISTRICT_RGB[usable.districts[i]] ?? GROUND;
    }
    const roadOrWater = usable !== null && (kind === PLOT_ROAD || kind === PLOT_BRIDGE || isWater(kind));
    if (overlay && !roadOrWater && overlay.bytes.length === n) {
      const v = overlay.bytes[i];
      if (overlay.mode === OVERLAY_CATEGORICAL) {
        if (v !== CAT_NONE) c = (overlay.palette === 'zones' ? zone : owners)[v] ?? c;
        else c = mix(c, GROUND, 0.4);
      } else if (overlay.mode === OVERLAY_DIVERGING) {
        const t = v / 255;
        c = t < 0.5 ? mix(hex(STATUS.loss), hex('#5C5A55'), t * 2) : mix(hex('#5C5A55'), hex(STATUS.profitable), t * 2 - 1);
      } else {
        const t = overlay.mode === OVERLAY_BINNED ? (Math.floor(Math.min(0.999, v / 255) * 5) + 0.5) / 5 : v / 255;
        c = mix(rampColor(t), GROUND, 0.12);
      }
    }
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Fit of the plot grid into a canvas (letterboxed, centred, uniform scale). */
export interface MinimapFit {
  scale: number;
  ox: number;
  oy: number;
}

export function fitGrid(gridW: number, gridH: number, width: number, height: number, pad = 4): MinimapFit {
  const scale = Math.max(0.01, Math.min((width - 2 * pad) / gridW, (height - 2 * pad) / gridH));
  return { scale, ox: (width - gridW * scale) / 2, oy: (height - gridH * scale) / 2 };
}

/** Canvas (CSS px) → plot space. */
export function canvasToPlot(fit: MinimapFit, x: number, y: number): [number, number] {
  return [(x - fit.ox) / fit.scale, (y - fit.oy) / fit.scale];
}

/** The building under a plot-space point (topmost = last). */
export function buildingAt(buildings: readonly MinimapBuilding[], px: number, pz: number, slack = 0.6): MinimapBuilding | null {
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    if (px >= b.px - slack && px <= b.px + b.w + slack && pz >= b.pz - slack && pz <= b.pz + b.h + slack) return b;
  }
  return null;
}

/** Cached per-plot image (rebuilt when the model revision changes). */
export class MinimapRenderer {
  private image: HTMLCanvasElement | OffscreenCanvas | null = null;
  private imageRev = -1;
  private imageKey = '';

  private baseImage(model: MinimapModel): CanvasImageSource | null {
    const key = `${model.cityId}:${model.gridW}x${model.gridH}`;
    if (this.image && this.imageRev === model.rev && this.imageKey === key) return this.image as CanvasImageSource;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(model.gridW, model.gridH) : Object.assign(document.createElement('canvas'), { width: model.gridW, height: model.gridH });
    const g = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!g) return null;
    const data = new ImageData(model.gridW, model.gridH);
    data.data.set(model.base);
    g.putImageData(data, 0, 0);
    this.image = canvas;
    this.imageRev = model.rev;
    this.imageKey = key;
    return canvas as CanvasImageSource;
  }

  /** Draw everything into a 2D context whose CSS size is width × height (already scaled for DPR). */
  draw(g: CanvasRenderingContext2D, width: number, height: number, model: MinimapModel | null, view: MinimapView | null, selectedId: number | null, hoveredId: number | null): MinimapFit | null {
    g.clearRect(0, 0, width, height);
    if (!model) return null;
    const fit = fitGrid(model.gridW, model.gridH, width, height);
    const { scale, ox, oy } = fit;
    const img = this.baseImage(model);
    g.save();
    g.beginPath();
    roundRect(g, ox, oy, model.gridW * scale, model.gridH * scale, 3);
    g.clip();
    if (img) {
      g.imageSmoothingEnabled = false;
      g.drawImage(img, ox, oy, model.gridW * scale, model.gridH * scale);
    }
    // Company footprints: rivals first, yours on top with the gold ring.
    const ordered = [...model.buildings].sort((a, b) => Number(a.mine) - Number(b.mine));
    for (const b of ordered) {
      const x = ox + b.px * scale, y = oy + b.pz * scale, w = b.w * scale, h = b.h * scale;
      g.fillStyle = b.color;
      g.fillRect(x, y, w, h);
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
      if (b.mine) {
        g.lineWidth = 1.5;
        g.strokeStyle = STATUS.ring;
        const m = Math.max(1.5, scale * 0.6);
        g.strokeRect(x - m, y - m, w + 2 * m, h + 2 * m);
      }
      if (b.id === selectedId || b.id === hoveredId) {
        g.lineWidth = b.id === selectedId ? 2 : 1.25;
        g.strokeStyle = b.id === selectedId ? UI.goldBright : 'rgba(255,255,255,0.85)';
        const m = Math.max(2.5, scale * 1.2);
        g.strokeRect(x - m, y - m, w + 2 * m, h + 2 * m);
      }
    }
    // Camera footprint.
    if (view && view.corners.length === 4) {
      g.beginPath();
      view.corners.forEach(([px, pz], i) => {
        const x = ox + px * scale, y = oy + pz * scale;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
      g.fillStyle = 'rgba(234, 241, 245, 0.10)';
      g.fill();
      g.lineWidth = 1.25;
      g.strokeStyle = 'rgba(234, 241, 245, 0.85)';
      g.stroke();
      const [tx, tz] = view.target;
      g.fillStyle = UI.goldBright;
      g.beginPath();
      g.arc(ox + tx * scale, oy + tz * scale, 2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(160, 196, 218, 0.28)';
    g.beginPath();
    roundRect(g, ox + 0.5, oy + 0.5, model.gridW * scale - 1, model.gridH * scale - 1, 3);
    g.stroke();
    return fit;
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
