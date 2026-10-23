// Everything the chunk builder derives once per layout (decoded grid, road network, surface model) plus the per-job
// company coverage. The surface model answers "how high is the ground here?" for every plot so neighbouring pieces
// meet: terrain-following ("warped") plots — roads, bridges, beaches, open land — follow the corner heights; parcels
// and company lots sit on flat terraces; water sits at WATER_BANK_BOTTOM for bank skirts. Each surface draws the
// walls on its own sides where it is higher than its neighbour, so walls are drawn exactly once and never leave gaps.
import { PLOT_SIZE } from '../../units';
import { cornerHeight, decodeLayout, parcelTerrace, terrainHeightAt } from '../layout/decode';
import {
  K_BEACH, K_BRIDGE, K_PARCEL, K_ROAD, isWaterKind, type CityGrid, type CityLayoutWire, type ParcelInfo,
} from '../layout/types';
import { RoadNetwork } from '../RoadNetwork';
import { CHUNK_PLOTS, type CompanyCover } from '../chunkProtocol';

/** Bottom of bank skirts and quay walls under the water surface (W1 water plane at −0.35 m). */
export const WATER_BANK_BOTTOM = -2.6;
/** Beach corners touching water dip below the water line so the shore reads as a slope with foam. */
const BEACH_DIP = -0.9;

export type HeightFn = (x: number, z: number) => number;

/** Contiguous bridge run along one axis (for the deck arch). */
interface BridgeRun { axis: 'x' | 'z'; start: number; end: number /* world coords along the axis */; rise: number }

export class CityBuildContext {
  readonly grid: CityGrid;
  readonly net: RoadNetwork;
  readonly W: number;
  readonly H: number;
  readonly chunkCols: number;
  readonly chunkRows: number;
  /** Parcel terrace heights by parcel index. */
  readonly terrace: Float32Array;
  /** Beach dip per corner ((W+1)·(H+1)), 0 elsewhere. */
  private readonly beachDip: Float32Array;
  /** Bridge run per plot (undefined off bridges). */
  private readonly bridgeRun = new Map<number, BridgeRun>();
  readonly hilly: boolean;
  /** Company id per plot for the current job (−1 = none). */
  coverAt: Int32Array;
  /** Company terraces by id for the current job. */
  readonly companyTerrace = new Map<number, number>();
  private coverKey = '';

  readonly terrain: HeightFn;
  readonly beach: HeightFn;
  readonly bridge: HeightFn;

  constructor(readonly wire: CityLayoutWire) {
    const grid = decodeLayout(wire);
    this.grid = grid;
    this.W = grid.gridW;
    this.H = grid.gridH;
    this.chunkCols = Math.ceil(this.W / CHUNK_PLOTS);
    this.chunkRows = Math.ceil(this.H / CHUNK_PLOTS);
    this.net = new RoadNetwork(grid);
    this.hilly = grid.heights !== null;
    this.terrace = new Float32Array(grid.parcels.length);
    grid.parcels.forEach((p, k) => { this.terrace[k] = parcelTerrace(grid, p); });
    this.coverAt = new Int32Array(this.W * this.H).fill(-1);

    // Beach dips: a corner dips when any of its (up to) four plots is water and one is beach.
    this.beachDip = new Float32Array((this.W + 1) * (this.H + 1));
    for (let cz = 0; cz <= this.H; cz++) {
      for (let cx = 0; cx <= this.W; cx++) {
        let water = false, beach = false;
        for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
          const k = this.kindAt(cx + dx, cz + dz);
          if (k < 0) continue;
          if (isWaterKind(k)) water = true;
          if (k === K_BEACH) beach = true;
        }
        if (water && beach) this.beachDip[cz * (this.W + 1) + cx] = BEACH_DIP;
      }
    }

    // Bridge runs: contiguous bridge plots along the road axis get a shallow arch (higher for longer spans).
    for (let pz = 0; pz < this.H; pz++) {
      for (let px = 0; px < this.W; px++) {
        const i = pz * this.W + px;
        if (grid.kind[i] !== K_BRIDGE || this.bridgeRun.has(i)) continue;
        const alongX = this.isBridge(px - 1, pz) || this.isBridge(px + 1, pz) || (!this.isBridge(px, pz - 1) && !this.isBridge(px, pz + 1) && (this.isRoadish(px - 1, pz) || this.isRoadish(px + 1, pz)));
        let a = alongX ? px : pz, b = a;
        while (alongX ? this.isBridge(a - 1, pz) : this.isBridge(px, a - 1)) a--;
        while (alongX ? this.isBridge(b + 1, pz) : this.isBridge(px, b + 1)) b++;
        const span = b - a + 1;
        const run: BridgeRun = {
          axis: alongX ? 'x' : 'z',
          start: ((alongX ? a - this.W / 2 : a - this.H / 2)) * PLOT_SIZE,
          end: ((alongX ? b + 1 - this.W / 2 : b + 1 - this.H / 2)) * PLOT_SIZE,
          rise: span >= 3 ? 3.2 : span === 2 ? 1.8 : 1.0,
        };
        for (let k = a; k <= b; k++) this.bridgeRun.set(alongX ? pz * this.W + k : k * this.W + px, run);
      }
    }

    this.terrain = (x, z) => terrainHeightAt(grid, x, z);
    this.beach = (x, z) => terrainHeightAt(grid, x, z) + this.beachDipAt(x, z);
    this.bridge = (x, z) => {
      const base = terrainHeightAt(grid, x, z);
      const i = this.plotIndexAt(x, z);
      const run = i >= 0 ? this.bridgeRun.get(i) : undefined;
      if (!run) return base;
      const s = run.axis === 'x' ? x : z;
      const t = Math.min(1, Math.max(0, (s - run.start) / Math.max(1, run.end - run.start)));
      return base + run.rise * Math.sin(Math.PI * t);
    };
  }

  // ------------------------------------------------------------------------------------------- grid queries

  kindAt(px: number, pz: number): number {
    if (px < 0 || pz < 0 || px >= this.W || pz >= this.H) return -1;
    return this.grid.kind[pz * this.W + px];
  }

  isBridge(px: number, pz: number): boolean {
    return this.kindAt(px, pz) === K_BRIDGE;
  }

  isRoadish(px: number, pz: number): boolean {
    const k = this.kindAt(px, pz);
    return k === K_ROAD || k === K_BRIDGE;
  }

  /** Plot index under a world point (−1 outside). */
  plotIndexAt(x: number, z: number): number {
    const px = Math.floor(x / PLOT_SIZE + this.W / 2), pz = Math.floor(z / PLOT_SIZE + this.H / 2);
    return px < 0 || pz < 0 || px >= this.W || pz >= this.H ? -1 : pz * this.W + px;
  }

  /** World x of the west edge of column px / z of the north edge of row pz. */
  x0(px: number): number { return (px - this.W / 2) * PLOT_SIZE; }
  z0(pz: number): number { return (pz - this.H / 2) * PLOT_SIZE; }

  chunkOfPlot(px: number, pz: number): number {
    const cx = Math.min(this.chunkCols - 1, Math.max(0, Math.floor(px / CHUNK_PLOTS)));
    const cz = Math.min(this.chunkRows - 1, Math.max(0, Math.floor(pz / CHUNK_PLOTS)));
    return cz * this.chunkCols + cx;
  }

  /** Chunk that owns a footprint (by the plot under its centre). */
  chunkOfRect(px: number, pz: number, w: number, h: number): number {
    return this.chunkOfPlot(px + Math.floor((w - 1) / 2), pz + Math.floor((h - 1) / 2));
  }

  parcelOf(px: number, pz: number): ParcelInfo | null {
    if (px < 0 || pz < 0 || px >= this.W || pz >= this.H) return null;
    const k = this.grid.parcelAt[pz * this.W + px];
    return k < 0 ? null : this.grid.parcels[k];
  }

  private beachDipAt(x: number, z: number): number {
    const gx = x / PLOT_SIZE + this.W / 2, gz = z / PLOT_SIZE + this.H / 2;
    const cx = Math.min(this.W - 1, Math.max(0, Math.floor(gx))), cz = Math.min(this.H - 1, Math.max(0, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - cx)), fz = Math.min(1, Math.max(0, gz - cz));
    const d = this.beachDip, s = this.W + 1;
    const a = d[cz * s + cx], b = d[cz * s + cx + 1], c = d[(cz + 1) * s + cx], e = d[(cz + 1) * s + cx + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + e * fx) * fz;
  }

  // ------------------------------------------------------------------------------------------- per job

  /** Install the company footprints of a job (cached by content). */
  setCovers(covers: readonly CompanyCover[]): void {
    const key = covers.map((c) => `${c.id}:${c.px}:${c.pz}:${c.w}:${c.h}`).join('|');
    if (key === this.coverKey) return;
    this.coverKey = key;
    this.coverAt.fill(-1);
    this.companyTerrace.clear();
    for (const c of [...covers].sort((a, b) => a.id - b.id)) {
      for (let z = c.pz; z < c.pz + c.h; z++) {
        for (let x = c.px; x < c.px + c.w; x++) {
          if (x >= 0 && z >= 0 && x < this.W && z < this.H && this.coverAt[z * this.W + x] < 0) this.coverAt[z * this.W + x] = c.id;
        }
      }
      this.companyTerrace.set(c.id, parcelTerrace(this.grid, c));
    }
  }

  coveredBy(px: number, pz: number): number {
    if (px < 0 || pz < 0 || px >= this.W || pz >= this.H) return -1;
    return this.coverAt[pz * this.W + px];
  }

  /** True when any plot of the parcel is under a company footprint. */
  parcelCovered(p: ParcelInfo): boolean {
    for (let z = p.pz; z < p.pz + p.h; z++) for (let x = p.px; x < p.px + p.w; x++) if (this.coveredBy(x, z) >= 0) return true;
    return false;
  }

  // ------------------------------------------------------------------------------------------- surface model

  /** Height function of a warped plot's own geometry. */
  warpFn(px: number, pz: number): HeightFn {
    const k = this.kindAt(px, pz);
    if (k === K_BEACH) return this.beach;
    if (k === K_BRIDGE) return this.bridge;
    return this.terrain;
  }

  /**
   * Ground surface heights of plot (px, pz) at two world points on its boundary, or null outside the grid. Water
   * reports the bank bottom so land always draws a skirt into it.
   */
  surfaceAt(px: number, pz: number, xa: number, za: number, xb: number, zb: number): [number, number] | null {
    const k = this.kindAt(px, pz);
    if (k < 0) return null;
    if (isWaterKind(k)) return [WATER_BANK_BOTTOM, WATER_BANK_BOTTOM];
    const cover = this.coveredBy(px, pz);
    if (cover >= 0) {
      const t = this.companyTerrace.get(cover) ?? 0;
      return [t, t];
    }
    if (k === K_PARCEL) {
      const p = this.grid.parcelAt[pz * this.W + px];
      const t = p >= 0 ? this.terrace[p] : 0;
      return [t, t];
    }
    const fn = this.warpFn(px, pz);
    // Sample just inside the plot so a bridge or beach plot reports its own surface on a shared edge.
    const cxm = this.x0(px) + PLOT_SIZE / 2, czm = this.z0(pz) + PLOT_SIZE / 2;
    const pull = (v: number, c: number) => v + Math.sign(c - v) * 1e-3;
    return [fn(pull(xa, cxm), pull(za, czm)), fn(pull(xb, cxm), pull(zb, czm))];
  }

  /** The four sides of plot (px, pz): endpoints (in world metres), outward normal and neighbour plot. */
  sides(px: number, pz: number): Array<{ xa: number; za: number; xb: number; zb: number; n: [number, number]; nx: number; nz: number }> {
    const x0 = this.x0(px), z0 = this.z0(pz), x1 = x0 + PLOT_SIZE, z1 = z0 + PLOT_SIZE;
    return [
      { xa: x0, za: z0, xb: x1, zb: z0, n: [0, -1], nx: px, nz: pz - 1 },
      { xa: x1, za: z0, xb: x1, zb: z1, n: [1, 0], nx: px + 1, nz: pz },
      { xa: x0, za: z1, xb: x1, zb: z1, n: [0, 1], nx: px, nz: pz + 1 },
      { xa: x0, za: z0, xb: x0, zb: z1, n: [-1, 0], nx: px - 1, nz: pz },
    ];
  }

  /** Natural corner height (exposed for tests and the edge apron). */
  corner(cx: number, cz: number): number {
    return cornerHeight(this.grid, cx, cz);
  }
}
