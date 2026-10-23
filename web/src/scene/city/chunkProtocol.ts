// Messages between the ChunkManager (main thread) and chunk.worker.ts. Everything is plain data: typed arrays travel
// as transferables, the rest is structured-cloned. The same types drive the in-thread fallback builder (tests, and
// browsers without module workers).
import type { AnimatedPart, AssetActivity, Emitter, SignQuad, Stage } from '../assets/AssetFactory';
import type { BuiltArrays } from '../assets/GeoBuilder';
import type { CityLayoutWire } from './layout/types';

/** Chunk edge in plots (art §5.4: 10 × 10 plots = 240 m). */
export const CHUNK_PLOTS = 10;

/** A company building as the chunk builder needs it (derived from BuildingVisualDto + CityActivityDto). */
export interface CompanySpec {
  id: number;
  typeId: string;
  category: string;
  /** Owner colour index 0..7 (0 = player). */
  owner: number;
  /** Company id for sign slots. */
  companyId: string;
  level: 1 | 2 | 3;
  stage: Stage;
  /** Construction progress 0..1 (1 when complete). */
  progress: number;
  /** NW plot of the rotated footprint and its world-aligned size in plots. */
  px: number;
  pz: number;
  w: number;
  h: number;
  /** Street-facing side as quarter turns (0 S, 1 E, 2 N, 3 W). */
  turns: 0 | 1 | 2 | 3;
  /** Quantised utilization (0..1, steps of 0.25) so small swings never rebuild a chunk. */
  utilization: number;
  products: string[];
  activity?: AssetActivity;
  /** Final height hint for construction sites (m). */
  heightHint?: number;
}

/** World-aligned company footprint (plots) for ambient suppression and pads. */
export interface CompanyCover { id: number; px: number; pz: number; w: number; h: number }

export interface ChunkJob {
  /** Layout generation the job was cut for (ignored results when stale). */
  layoutKey: string;
  /** Monotonic job id per chunk; older results are dropped. */
  jobId: number;
  chunk: number;
  /** Game month 1..12 (crops, trees, seasons). */
  month: number;
  /** Company buildings whose footprint centre falls in this chunk. */
  companies: CompanySpec[];
  /** Every company footprint in the city (ambient lots under them are suppressed). */
  covers: CompanyCover[];
}

/** Packed props of one family: [x, y, z, rotY, scale, colorHex (−1 = none)] × count. */
export const PROP_STRIDE = 6;

export interface PickEntry {
  /** 'company' → building id; 'ambient' → parcel id. */
  kind: 'company' | 'ambient';
  id: number;
  box: [number, number, number, number, number, number];
}

/** Emitter of a built lot (world metres); `buildingId` is null for ambient lots. */
export interface ChunkEmitter extends Emitter { buildingId: number | null; owner: number }
export interface ChunkAnimatedPart extends AnimatedPart { buildingId: number | null }

export interface ChunkResult {
  layoutKey: string;
  jobId: number;
  chunk: number;
  lod0: BuiltArrays;
  lod1: BuiltArrays;
  props: Record<string, Float32Array>;
  signs: SignQuad[];
  /** Light pools: [x, y, z, radius, tone(0 warm, 1 cool)] × count. */
  pools: Float32Array;
  /** Street-lamp heads for the far-field lamp grid: [x, y, z] × count. */
  lampHeads: Float32Array;
  emitters: ChunkEmitter[];
  animated: ChunkAnimatedPart[];
  picks: PickEntry[];
  /** Plots whose content depends on the month (fields, farms): the chunk is rebuilt on month change. */
  monthly: boolean;
  buildMs: number;
}

export type WorkerRequest =
  | { kind: 'layout'; layoutKey: string; layout: CityLayoutWire }
  | { kind: 'build'; job: ChunkJob };

export type WorkerResponse =
  | { kind: 'built'; result: ChunkResult }
  | { kind: 'error'; layoutKey: string; jobId: number; chunk: number; message: string };
