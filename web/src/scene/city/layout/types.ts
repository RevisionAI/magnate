// City layout as it arrives on the wire (bridge `cityLayout`, E3a GameSession.CityLayout.cs) and as the renderer
// holds it after decoding (CityGrid). The wire type mirrors the C# CityLayoutDto exactly (status e3a-citygen §3);
// `protocol.ts` (B1) only types the bridge-spec §8.1 subset today, so the extensions are typed here and every
// optional part degrades gracefully (decode.ts derives the per-plot arrays from roads/parcels/water when `plots` is
// absent, e.g. an older engine build).
import type { CityClimate, CityLayoutDto } from '@/bridge/protocol';

// ------------------------------------------------------------------------------------------------ wire (E3a DTOs)

export interface LayoutRoadWire {
  id: number;
  kind: 'highway' | 'arterial' | 'street' | string;
  path: { px: number; pz: number }[];
  lanes: number;
  roadClass?: 'local' | 'collector' | 'arterial' | 'highway' | string;
  bridge?: boolean;
}

export interface LayoutParcelWire {
  id: number;
  px: number;
  pz: number;
  w: number;
  h: number;
  zone: string;
  landValuePerPlot: number;
  ownerId?: number;
  buildingId?: number;
  forSale: boolean;
  askingPrice?: number;
  traffic: number;
  district?: string;
  /** 0 S, 1 E, 2 N, 3 W (quarter turns, art §3.2). */
  facing?: number;
  frontage?: string;
  vacant?: boolean;
  depositId?: number;
  landmark?: string;
}

export interface LayoutWaterWire {
  px: number;
  pz: number;
  w: number;
  h: number;
  kind?: 'sea' | 'river' | 'lake' | string;
  shore?: 'beach' | 'quay' | string;
}

export interface LayoutAmbientWire {
  parcelId: number;
  kind: string;
  floors: number;
  variant: number;
}

export interface LayoutPlotsWire {
  /** One char per plot: p parcel, r road, b bridge, s sea, v river, l lake, h beach, o open land. */
  kinds: string;
  /** One char per plot: 0 none, 1 local, 2 collector, 3 arterial, 4 highway. */
  roads: string;
  /** One char per plot: . none, C cbd, c commercial, m mixed, a apartments, h houses, i industrial, p port, g rural, k park, v civic. */
  districts: string;
  landValue: number[];
  traffic: number[];
  /** One char per plot, 0–3 (hilly cities only). */
  slopes?: string;
}

export interface LayoutLandmarkWire { kind: string; parcelId: number; px: number; pz: number; w: number; h: number }
export interface LayoutDepositWire { id: number; resource: string; px: number; pz: number; w: number; h: number; quality: number; reserve: number; offshore: boolean }

/** Full E3a `CityLayoutDto` (superset of protocol.ts `CityLayoutDto`). */
export interface CityLayoutWire {
  cityId: string;
  layoutRev: number;
  gridW: number;
  gridH: number;
  roads: LayoutRoadWire[];
  parcels: LayoutParcelWire[];
  water: LayoutWaterWire[];
  ambient: LayoutAmbientWire[];
  seed?: number;
  climate?: CityClimate | string;
  terrain?: { heights: number[] };
  plots?: LayoutPlotsWire;
  landmarks?: LayoutLandmarkWire[];
  deposits?: LayoutDepositWire[];
  cbd?: { x: number; z: number };
  urbanRadius?: number;
  medianTraffic?: number;
  generatorVersion?: number;
  profile?: string;
  plotSize?: number;
}

/** Widen the protocol type (the bridge returns the E3a superset). */
export function asLayoutWire(dto: CityLayoutDto | CityLayoutWire): CityLayoutWire {
  return dto as unknown as CityLayoutWire;
}

// ------------------------------------------------------------------------------------------------ decoded grid

/** Plot kinds (`CityGrid.kind`). */
export const K_NONE = 0;
export const K_PARCEL = 1;
export const K_ROAD = 2;
export const K_BRIDGE = 3;
export const K_SEA = 4;
export const K_RIVER = 5;
export const K_LAKE = 6;
export const K_BEACH = 7;
export const K_OPEN = 8;

/** Road classes (`CityGrid.road`), ordered by rank. */
export const R_NONE = 0;
export const R_LOCAL = 1;
export const R_COLLECTOR = 2;
export const R_ARTERIAL = 3;
export const R_HIGHWAY = 4;

/** Districts (`CityGrid.district`). */
export const D_NONE = 0;
export const D_CBD = 1;
export const D_COMMERCIAL = 2;
export const D_MIXED = 3;
export const D_APARTMENTS = 4;
export const D_HOUSES = 5;
export const D_INDUSTRIAL = 6;
export const D_PORT = 7;
export const D_RURAL = 8;
export const D_PARK = 9;
export const D_CIVIC = 10;

/** Shore treatment of a water plot (`CityGrid.shore`). */
export const SHORE_NONE = 0;
export const SHORE_BEACH = 1;
export const SHORE_QUAY = 2;

export interface ParcelInfo {
  id: number;
  /** Index into `CityGrid.parcels`. */
  index: number;
  px: number;
  pz: number;
  w: number;
  h: number;
  zone: string;
  district: number;
  /** Quarter turns: 0 S, 1 E, 2 N, 3 W (the street-facing side). */
  facing: 0 | 1 | 2 | 3;
  vacant: boolean;
  landmark: string | null;
  depositId: number | null;
  /** Ambient development on the parcel (null = vacant lot). */
  ambient: { kind: string; floors: number; variant: number } | null;
  landValuePerPlot: number;
  traffic: number;
  forSale: boolean;
  ownerId: number | null;
  buildingId: number | null;
}

export interface CityGrid {
  cityId: string;
  layoutRev: number;
  seed: number;
  climate: CityClimate;
  gridW: number;
  gridH: number;
  /** K_* per plot (row-major, i = pz·gridW + px). */
  kind: Uint8Array;
  /** R_* per plot (roads and bridges only). */
  road: Uint8Array;
  /** 1 where a bridge carries the road (kind K_BRIDGE, or a road plot of a `bridge` road over water). */
  bridge: Uint8Array;
  district: Uint8Array;
  /** Slope class 0–3, or null on flat cities. */
  slope: Uint8Array | null;
  landValue: Float32Array;
  traffic: Float32Array;
  /** Parcel index per plot, −1 when the plot is not part of a parcel. */
  parcelAt: Int32Array;
  parcels: ParcelInfo[];
  parcelById: Map<number, ParcelInfo>;
  /** SHORE_* per water plot (from the water rects' shore kind). */
  shore: Uint8Array;
  /** (gridW+1)·(gridH+1) corner heights (m), or null when the city is flat. */
  heights: Float32Array | null;
  landmarks: LayoutLandmarkWire[];
  deposits: LayoutDepositWire[];
  /** CBD centre in plot space (plot centres at +0.5). */
  cbd: { x: number; z: number };
  urbanRadius: number;
  /** Lanes per road plot (max over the roads through it). */
  lanes: Uint8Array;
}

export function isWaterKind(k: number): boolean {
  return k === K_SEA || k === K_RIVER || k === K_LAKE;
}

export function isRoadKind(k: number): boolean {
  return k === K_ROAD || k === K_BRIDGE;
}
