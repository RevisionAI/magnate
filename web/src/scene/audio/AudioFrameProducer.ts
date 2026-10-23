// AudioFrame producer (art §5.22, audio-plan §4.8): ten times a second the renderer publishes where the listener is,
// how far out the camera is, the visual time of day, the season and the weather, plus the land-use mix around the
// focus point, so the ambience director can mix its beds without touching the scene.
//
// Land-use shares come from an `AudioAreaSource`. `LandUseGrid` implements it with one summed-area table per
// category over the plot grid (O(1) window queries) and a BFS distance-to-water field; the city layer builds it
// from its layout (W2: `cityLayout` + `cityView`; interim: the synthetic city) and hands it to
// `ctx.setAudioAreaSource()`. Without a source the area shares are 0 and the beds fall back to their city presets.
import * as THREE from 'three';
import { PLOT_SIZE } from '../units';
import type { ZoomBand } from '../interaction/CameraRig';

/** Land-use shares 0–1 within radius R of the focus (audio §4.8). */
export interface AudioArea {
  road: number;
  traffic: number;
  green: number;
  industrial: number;
  commercial: number;
  residential: number;
  construction: number;
  water: number;
}

/** audio-plan §4.8 `AudioFrame`, plus additive fields (listener, cameraDistance, zoomBand, speed, lightning, t). */
export interface AudioFrame {
  /** 0 = street band … 1 = city band (camera distance, log scale). */
  zoom01: number;
  /** Camera target on the ground (world metres). */
  focus: { x: number; z: number };
  cityId: string;
  coastal: boolean;
  /** Plots from the focus to the nearest water plot (999 when the city has no water). */
  distToWaterPlots: number;
  /** Visual hour 0–24 from the renderer's sun; null = fixed daylight (ambience uses day = 1). */
  timeOfDay: number | null;
  /** Game month 0–11 (season curves). */
  month: number;
  /** 0–1 cosmetic weather. */
  rain: number;
  wind: number;
  area: AudioArea;
  // ---- additive ----
  /** Listener rig position: target + (camera − target) × 0.35 (audio §4.3). */
  listener: { x: number; y: number; z: number };
  /** Camera-to-target distance (m). */
  cameraDistance: number;
  zoomBand: ZoomBand;
  /** Game speed (0 = paused). */
  speed: number;
  /** 0–1 lightning flash this frame (thunder one-shots can sync to its rising edge). */
  lightning: number;
  /** Scene time in seconds. */
  t: number;
}

export interface AudioAreaSource {
  readonly cityId: string;
  readonly coastal: boolean;
  /** Shares of each land use in a square window of half-size `radiusM` around (x, z). */
  area(x: number, z: number, radiusM: number, out: AudioArea): AudioArea;
  /** Distance in plots from (x, z) to the nearest water plot (999 if none). */
  distToWaterPlots(x: number, z: number): number;
}

/** Land-use codes for `LandUseGrid` (one byte per plot). */
export const LANDUSE_NONE = 0;
export const LANDUSE_ROAD = 1;
export const LANDUSE_GREEN = 2;
export const LANDUSE_INDUSTRIAL = 3;
export const LANDUSE_COMMERCIAL = 4;
export const LANDUSE_RESIDENTIAL = 5;
export const LANDUSE_CONSTRUCTION = 6;
export const LANDUSE_WATER = 7;
const CATEGORIES = 8;

export function emptyArea(): AudioArea {
  return { road: 0, traffic: 0, green: 0, industrial: 0, commercial: 0, residential: 0, construction: 0, water: 0 };
}

/** Summed-area tables per land use over the plot grid + BFS distance to water. */
export class LandUseGrid implements AudioAreaSource {
  private readonly sat: Int32Array[] = [];
  private readonly waterDist: Uint16Array;
  /** Ambient vehicle density relative to Metropolis (∝ √population, as the renderer's traffic). */
  readonly vehicleDensity: number;

  constructor(readonly cityId: string, readonly gridW: number, readonly gridH: number, private readonly landUse: Uint8Array, opts: { coastal?: boolean; population?: number } = {}) {
    if (landUse.length !== gridW * gridH) throw new Error(`LandUseGrid: expected ${gridW * gridH} plots, got ${landUse.length}`);
    this.coastal = opts.coastal ?? false;
    this.vehicleDensity = THREE.MathUtils.clamp(Math.sqrt(opts.population ?? 250000) / Math.sqrt(500000), 0.25, 1);
    this.waterDist = new Uint16Array(gridW * gridH);
    this.rebuild();
  }

  readonly coastal: boolean;

  /** Change one plot (e.g. a construction site opened or finished); call `rebuild()` after a batch of edits. */
  setLandUse(px: number, pz: number, kind: number): void {
    if (px >= 0 && pz >= 0 && px < this.gridW && pz < this.gridH) this.landUse[pz * this.gridW + px] = kind;
  }

  /** Recompute the summed-area tables and the water distance field (O(plots)). */
  rebuild(): void {
    const { gridW: w, gridH: h, landUse } = this;
    this.sat.length = 0;
    for (let k = 0; k < CATEGORIES; k++) {
      const s = new Int32Array((w + 1) * (h + 1));
      for (let z = 0; z < h; z++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
          row += landUse[z * w + x] === k ? 1 : 0;
          s[(z + 1) * (w + 1) + (x + 1)] = s[z * (w + 1) + (x + 1)] + row;
        }
      }
      this.sat.push(s);
    }
    // Multi-source BFS from every water plot (4-neighbourhood).
    const dist = this.waterDist;
    dist.fill(65535);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    for (let i = 0; i < landUse.length; i++) if (landUse[i] === LANDUSE_WATER) { dist[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++], x = i % w, z = (i - x) / w, nd = dist[i] + 1;
      if (x > 0 && dist[i - 1] > nd) { dist[i - 1] = nd; queue[tail++] = i - 1; }
      if (x < w - 1 && dist[i + 1] > nd) { dist[i + 1] = nd; queue[tail++] = i + 1; }
      if (z > 0 && dist[i - w] > nd) { dist[i - w] = nd; queue[tail++] = i - w; }
      if (z < h - 1 && dist[i + w] > nd) { dist[i + w] = nd; queue[tail++] = i + w; }
    }
  }

  private count(k: number, x0: number, z0: number, x1: number, z1: number): number {
    const s = this.sat[k], W = this.gridW + 1;
    return s[z1 * W + x1] - s[z0 * W + x1] - s[z1 * W + x0] + s[z0 * W + x0];
  }

  area(x: number, z: number, radiusM: number, out: AudioArea): AudioArea {
    const { gridW: w, gridH: h } = this;
    const cx = x / PLOT_SIZE + w / 2, cz = z / PLOT_SIZE + h / 2, r = radiusM / PLOT_SIZE;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(h, Math.ceil(cz + r));
    const cells = Math.max(0, x1 - x0) * Math.max(0, z1 - z0);
    if (cells === 0) { Object.assign(out, emptyArea()); return out; }
    const f = (k: number) => this.count(k, x0, z0, x1, z1) / cells;
    out.road = f(LANDUSE_ROAD);
    out.traffic = out.road * this.vehicleDensity;
    out.green = f(LANDUSE_GREEN);
    out.industrial = f(LANDUSE_INDUSTRIAL);
    out.commercial = f(LANDUSE_COMMERCIAL);
    out.residential = f(LANDUSE_RESIDENTIAL);
    out.construction = f(LANDUSE_CONSTRUCTION);
    out.water = f(LANDUSE_WATER);
    return out;
  }

  distToWaterPlots(x: number, z: number): number {
    const { gridW: w, gridH: h } = this;
    const fx = x / PLOT_SIZE + w / 2, fz = z / PLOT_SIZE + h / 2;
    const px = THREE.MathUtils.clamp(Math.floor(fx), 0, w - 1), pz = THREE.MathUtils.clamp(Math.floor(fz), 0, h - 1);
    const outside = Math.max(0, -fx, fx - w) + Math.max(0, -fz, fz - h);
    const d = this.waterDist[pz * w + px];
    return d === 65535 ? 999 : d + outside;
  }
}

export interface AudioFrameInputs {
  dt: number;
  time: number;
  camera: THREE.Camera;
  target: THREE.Vector3;
  distance: number;
  zoom01: number;
  zoomBand: ZoomBand;
  timeOfDay: number | null;
  month: number;
  rain: number;
  wind: number;
  lightning: number;
  speed: number;
}

/** Builds the AudioFrame at `hz` (default 10 Hz) and notifies subscribers. */
export class AudioFrameProducer {
  readonly frame: AudioFrame;
  hz = 10;
  source: AudioAreaSource | null = null;
  /** Fallbacks while no area source is set (from the world). */
  cityId = '';
  coastal = false;
  private acc = Infinity;
  private readonly listeners = new Set<(frame: AudioFrame) => void>();

  constructor() {
    this.frame = {
      zoom01: 0, focus: { x: 0, z: 0 }, cityId: '', coastal: false, distToWaterPlots: 999, timeOfDay: null, month: 0,
      rain: 0, wind: 0, area: emptyArea(), listener: { x: 0, y: 0, z: 0 }, cameraDistance: 0, zoomBand: 'district', speed: 0,
      lightning: 0, t: 0,
    };
  }

  subscribe(listener: (frame: AudioFrame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Call every frame; recomputes and publishes at `hz`. Returns true when a frame was published. */
  update(i: AudioFrameInputs): boolean {
    this.acc += i.dt;
    const period = 1 / this.hz;
    if (this.acc < period - 1e-6) return false;
    this.acc = this.acc >= 2 * period ? 0 : this.acc - period;   // keep the cadence; resync after a stall

    const f = this.frame, cam = i.camera.position;
    f.zoom01 = i.zoom01;
    f.focus.x = i.target.x;
    f.focus.z = i.target.z;
    f.listener.x = i.target.x + (cam.x - i.target.x) * 0.35;
    f.listener.y = i.target.y + (cam.y - i.target.y) * 0.35;
    f.listener.z = i.target.z + (cam.z - i.target.z) * 0.35;
    f.cameraDistance = i.distance;
    f.zoomBand = i.zoomBand;
    f.timeOfDay = i.timeOfDay;
    f.month = i.month;
    f.rain = i.rain;
    f.wind = i.wind;
    f.lightning = i.lightning;
    f.speed = i.speed;
    f.t = i.time;
    const src = this.source;
    f.cityId = src?.cityId ?? this.cityId;
    f.coastal = src?.coastal ?? this.coastal;
    if (src) {
      // R = max(6 plots, 0.8 × camera height in plots), audio §4.8.
      const radius = Math.max(6 * PLOT_SIZE, 0.8 * Math.max(0, cam.y));
      src.area(i.target.x, i.target.z, radius, f.area);
      f.distToWaterPlots = src.distToWaterPlots(i.target.x, i.target.z);
    } else {
      Object.assign(f.area, emptyArea());
      f.distToWaterPlots = 999;
    }
    for (const l of this.listeners) {
      try { l(f); } catch (error) { console.error('[audio-frame] listener failed', error); }
    }
    return true;
  }

  dispose(): void {
    this.listeners.clear();
  }
}
