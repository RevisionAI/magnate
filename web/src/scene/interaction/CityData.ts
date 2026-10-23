// Engine data the interaction layer reads: the decoded city layout (bridge `cityLayout`, E3a encodings) for overlays
// and the minimap, and a per-building model (owner, name, last month's KPIs, status class) for hover cards, badges,
// the Owners/Profit overlays and link arcs. Pure decoding helpers are unit-tested; fetching goes through the engine
// worker and degrades to null when a method is unavailable.
import type { BuildingSummaryDto, CityActivityDto, CityLayoutDto, CityViewDto, CompanySummaryDto, ParcelDto } from '@/bridge/protocol';

// -------------------------------------------------------------------------------------------- layout grid

/** Plot kinds (E3a `plots.kinds` characters). */
export const PLOT_OPEN = 0, PLOT_PARCEL = 1, PLOT_ROAD = 2, PLOT_BRIDGE = 3, PLOT_SEA = 4, PLOT_RIVER = 5, PLOT_LAKE = 6, PLOT_BEACH = 7;
const KIND_CODES: Record<string, number> = { o: PLOT_OPEN, p: PLOT_PARCEL, r: PLOT_ROAD, b: PLOT_BRIDGE, s: PLOT_SEA, v: PLOT_RIVER, l: PLOT_LAKE, h: PLOT_BEACH };

/** Districts (E3a `plots.districts` characters) in a stable numeric order. */
export const DISTRICTS = ['none', 'cbd', 'commercial', 'mixed', 'apartments', 'houses', 'industrial', 'port', 'rural', 'park', 'civic'] as const;
export type District = (typeof DISTRICTS)[number];
const DISTRICT_CODES: Record<string, number> = { '.': 0, C: 1, c: 2, m: 3, a: 4, h: 5, i: 6, p: 7, g: 8, k: 9, v: 10 };

export interface LayoutLandmark {
  kind: string;
  px: number;
  pz: number;
  w: number;
  h: number;
}

/** Decoded per-plot layout (row-major, i = pz · gridW + px). */
export interface LayoutGrid {
  cityId: string;
  gridW: number;
  gridH: number;
  layoutRev: number;
  kinds: Uint8Array;
  /** 0 none, 1 local, 2 collector, 3 arterial, 4 highway. */
  roads: Uint8Array;
  /** Index into DISTRICTS. */
  districts: Uint8Array;
  /** Whole $ per plot (0 on roads and water). */
  landValue: Float32Array;
  /** 0–100. */
  traffic: Float32Array;
  landmarks: LayoutLandmark[];
  /** CBD centre in plot space, if known. */
  cbd: { x: number; z: number } | null;
}

/** E3a additions on top of the bridge-spec DTO (not yet mirrored in protocol.ts). */
interface LayoutPlotsExt {
  plots?: { kinds?: string; roads?: string; districts?: string; landValue?: number[]; traffic?: number[] };
  landmarks?: { kind: string; px: number; pz: number; w: number; h: number }[];
  cbd?: { x: number; z: number };
}

const ZONE_DISTRICT: Record<string, number> = {
  residential: 5, commercial: 2, industrial: 6, agricultural: 8, port: 7, park: 9, civic: 10,
};

/** Decode a `cityLayout` result. Uses the per-plot `plots` strings when present, else rasterises the spec arrays. */
export function decodeLayout(dto: CityLayoutDto): LayoutGrid {
  const W = dto.gridW, H = dto.gridH, n = W * H;
  const ext = dto as CityLayoutDto & LayoutPlotsExt;
  const kinds = new Uint8Array(n), roads = new Uint8Array(n), districts = new Uint8Array(n);
  const landValue = new Float32Array(n), traffic = new Float32Array(n);
  const p = ext.plots;
  if (p?.kinds && p.kinds.length >= n) {
    for (let i = 0; i < n; i++) kinds[i] = KIND_CODES[p.kinds[i]] ?? PLOT_OPEN;
    if (p.roads) for (let i = 0; i < n; i++) roads[i] = Math.max(0, Math.min(4, p.roads.charCodeAt(i) - 48));
    if (p.districts) for (let i = 0; i < n; i++) districts[i] = DISTRICT_CODES[p.districts[i]] ?? 0;
    if (p.landValue) for (let i = 0; i < n; i++) landValue[i] = p.landValue[i] ?? 0;
    if (p.traffic) for (let i = 0; i < n; i++) traffic[i] = p.traffic[i] ?? 0;
  } else {
    rasterise(dto, kinds, roads, districts, landValue, traffic);
  }
  return {
    cityId: dto.cityId, gridW: W, gridH: H, layoutRev: dto.layoutRev, kinds, roads, districts, landValue, traffic,
    landmarks: (ext.landmarks ?? []).map((l) => ({ kind: l.kind, px: l.px, pz: l.pz, w: l.w, h: l.h })),
    cbd: ext.cbd ?? null,
  };
}

function rasterise(dto: CityLayoutDto, kinds: Uint8Array, roads: Uint8Array, districts: Uint8Array, landValue: Float32Array, traffic: Float32Array): void {
  const W = dto.gridW, H = dto.gridH;
  const at = (x: number, z: number) => (x >= 0 && z >= 0 && x < W && z < H ? z * W + x : -1);
  for (const parcel of dto.parcels as (ParcelDto & { district?: string })[]) {
    for (let z = parcel.pz; z < parcel.pz + parcel.h; z++) {
      for (let x = parcel.px; x < parcel.px + parcel.w; x++) {
        const i = at(x, z);
        if (i < 0) continue;
        kinds[i] = PLOT_PARCEL;
        districts[i] = ZONE_DISTRICT[parcel.zone] ?? 0;
        landValue[i] = parcel.landValuePerPlot;
        traffic[i] = parcel.traffic <= 1 ? parcel.traffic * 100 : parcel.traffic;
      }
    }
  }
  for (const w of dto.water) {
    const code = w.kind === 'river' ? PLOT_RIVER : w.kind === 'lake' ? PLOT_LAKE : PLOT_SEA;
    for (let z = w.pz; z < w.pz + w.h; z++) for (let x = w.px; x < w.px + w.w; x++) { const i = at(x, z); if (i >= 0) kinds[i] = code; }
  }
  const cls = { street: 1, arterial: 3, highway: 4 } as const;
  for (const r of dto.roads) {
    for (const pt of r.path) {
      const i = at(pt.px, pt.pz);
      if (i < 0) continue;
      kinds[i] = kinds[i] >= PLOT_SEA && kinds[i] <= PLOT_LAKE ? PLOT_BRIDGE : PLOT_ROAD;
      roads[i] = Math.max(roads[i], cls[r.kind] ?? 1);
      landValue[i] = 0;
    }
  }
}

export function isWater(kind: number): boolean {
  return kind === PLOT_SEA || kind === PLOT_RIVER || kind === PLOT_LAKE;
}

// ------------------------------------------------------------------------------------------ building model

/** Badge / status class of a building (art §3.4). */
export type StatusClass = 'profitable' | 'warning' | 'loss' | 'construction' | 'neutral';

export interface BuildingModel {
  id: number;
  typeId: string;
  typeName: string;
  category: string;
  name: string;
  cityId: string;
  ownerId: number;
  ownerName: string;
  colorIndex: number;
  isPlayer: boolean;
  level: number;
  status: string;
  products: string[];
  /** Last closed month (cityView activity) when known, else this month's running figures from `buildings`. */
  revenue: number;
  unitsSold: number;
  netIncome: number;
  utilization: number | null;
  transfersIn: number;
  transfersOut: number;
  statusClass: StatusClass;
  /** Unrotated footprint and placement, for proxies and arcs when the renderer has no box. */
  footprintW: number;
  footprintH: number;
  placement: { px: number; pz: number; rotation: number } | null;
  visualRev: number;
}

const WARNING_STATUSES = new Set(['starved', 'soldOut', 'idle', 'closed', 'forSale']);

/** Status class: construction first, then operating trouble (warning), then last month's profit sign. */
export function classifyStatus(status: string, netIncome: number): StatusClass {
  if (status === 'underConstruction') return 'construction';
  if (WARNING_STATUSES.has(status)) return 'warning';
  if (netIncome > 0.5) return 'profitable';
  if (netIncome < -0.5) return 'loss';
  return 'neutral';
}

interface TypeLike { id: string; name: string; footprintWidth: number; footprintHeight: number }

/** Merge the store's building list with the city view (visuals + last month's activity) and company names. */
export function buildModels(
  cityId: string,
  buildings: readonly BuildingSummaryDto[],
  view: CityViewDto | null,
  companies: readonly CompanySummaryDto[],
  types: readonly TypeLike[],
  playerId: number | null,
): Map<number, BuildingModel> {
  const out = new Map<number, BuildingModel>();
  const visual = new Map((view?.cityId === cityId ? view.buildings : []).map((b) => [b.id, b]));
  const act = activityIndex(view?.cityId === cityId ? view.activity : null);
  const company = new Map(companies.map((c) => [c.id, c]));
  const type = new Map(types.map((t) => [t.id, t]));
  for (const b of buildings) {
    if (b.cityId !== cityId) continue;
    const v = visual.get(b.id);
    const a = act.get(b.id);
    const c = company.get(b.ownerId);
    const t = type.get(b.typeId);
    const isPlayer = v?.isPlayer ?? c?.isPlayer ?? (playerId !== null && b.ownerId === playerId);
    const netIncome = a?.netIncome ?? b.netIncomeThisMonth;
    const status = v?.status ?? b.status;
    out.set(b.id, {
      id: b.id,
      typeId: b.typeId,
      typeName: t?.name ?? b.typeId,
      category: b.category,
      name: b.name,
      cityId: b.cityId,
      ownerId: b.ownerId,
      ownerName: c?.name ?? `Company ${b.ownerId}`,
      colorIndex: v?.colorIndex ?? b.colorIndex ?? c?.colorIndex ?? (isPlayer ? 0 : 7),
      isPlayer,
      level: v?.level ?? b.level,
      status,
      products: v?.products ?? b.products,
      revenue: a?.revenue ?? 0,
      unitsSold: a?.unitsSold ?? 0,
      netIncome,
      utilization: a?.utilization ?? null,
      transfersIn: a?.transfersIn ?? 0,
      transfersOut: a?.transfersOut ?? 0,
      statusClass: classifyStatus(status, netIncome),
      footprintW: v?.footprintW ?? t?.footprintWidth ?? 2,
      footprintH: v?.footprintH ?? t?.footprintHeight ?? 2,
      placement: v?.placement ?? b.placement ?? null,
      visualRev: v?.visualRev ?? 0,
    });
  }
  return out;
}

interface ActivityRow { revenue: number; unitsSold: number; netIncome: number; utilization: number | null; transfersIn: number; transfersOut: number }

function activityIndex(a: CityActivityDto | null): Map<number, ActivityRow> {
  const m = new Map<number, ActivityRow>();
  if (!a) return m;
  a.ids.forEach((id, i) => {
    m.set(id, {
      revenue: a.revenue[i] ?? 0,
      unitsSold: a.unitsSold[i] ?? 0,
      netIncome: a.netIncome[i] ?? 0,
      utilization: a.utilization[i] ?? null,
      transfersIn: a.transfersIn[i] ?? 0,
      transfersOut: a.transfersOut[i] ?? 0,
    });
  });
  return m;
}

/** Rotated footprint size for a bridge rotation. */
export function rotatedSize(w: number, h: number, rotation: number): { w: number; h: number } {
  return rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };
}
