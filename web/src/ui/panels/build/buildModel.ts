// Build palette model (pure): menu groups, ordering, one-line pitches and the
// reasons a card is unavailable. Affordability and geography verdicts come from
// the bridge's `previewBuild`; this file only words them.

import type { BuildMenuGroup, BuildPreviewDto, BuildingTypeDto, CityDto, StarterPlanDto } from '@/bridge/protocol';
import { money } from '@/util/format';

export interface GroupDef {
  id: BuildMenuGroup;
  label: string;
  hint: string;
}

export const GROUPS: readonly GroupDef[] = [
  { id: 'retail', label: 'Retail', hint: 'Busy streets near shoppers.' },
  { id: 'production', label: 'Factories', hint: 'Cheap land near suppliers and the port.' },
  { id: 'extraction', label: 'Farms & mines', hint: 'Needs farmland, deposits or oil.' },
  { id: 'logistics', label: 'Logistics', hint: 'Stock between factories and stores.' },
  { id: 'research', label: 'R&D', hint: 'Raises product tech, which shoppers value.' },
  { id: 'media', label: 'Media', hint: 'Cheaper, stronger ads on its channel.' },
];

const PITCH_BY_TYPE: Record<string, string> = {
  convenience_store: 'Small, cheap, local.',
  supermarket: 'Food and drink volume.',
  department_store: 'Apparel, electronics, big tickets.',
  factory_small: 'Turns inputs into goods.',
  factory_large: 'High-volume production.',
  small_farm: 'Crops on farmland.',
  large_farm: 'Crops at scale.',
  small_plantation: 'Cash crops: coffee, hops.',
  iron_mine: 'Iron ore from deposits.',
  oil_well: 'Crude oil from oil fields.',
  warehouse_small: 'Buffer stock for a few lines.',
  warehouse_large: 'Regional stock hub.',
  seaport: 'Imports and exports by sea.',
  rd_center: 'Research up to four products.',
  radio_station: 'Your own radio ads.',
  newspaper_publisher: 'Your own newspaper ads.',
  magazine_publisher: 'Your own magazine ads.',
  tv_station: 'Your own TV ads.',
};

const PITCH_BY_GROUP: Record<BuildMenuGroup, string> = {
  retail: 'Sells to shoppers.',
  production: 'Manufactures goods.',
  extraction: 'Produces raw materials.',
  logistics: 'Stores and moves goods.',
  research: 'Raises product technology.',
  media: 'Boosts your advertising.',
};

export function pitch(type: BuildingTypeDto): string {
  return PITCH_BY_TYPE[type.id] ?? PITCH_BY_GROUP[type.buildMenuGroup] ?? '';
}

/** Types by menu group, cheapest first (ties by name). */
export function groupTypes(types: readonly BuildingTypeDto[]): Map<BuildMenuGroup, BuildingTypeDto[]> {
  const map = new Map<BuildMenuGroup, BuildingTypeDto[]>();
  for (const t of types) {
    const g = GROUPS.some((x) => x.id === t.buildMenuGroup) ? t.buildMenuGroup : 'production';
    map.set(g, [...(map.get(g) ?? []), t]);
  }
  for (const list of map.values()) list.sort((a, b) => a.constructionCost - b.constructionCost || a.name.localeCompare(b.name));
  return map;
}

/** The highest unit capacity a type reaches across its level ladder. */
export function maxCapacity(type: BuildingTypeDto): number {
  return Math.max(type.maxUnits, ...type.levels.map((l) => l.capacity));
}

const GEO_WORD: Record<string, string> = { coastal: 'a coastal city', arable: 'farmland', mineralRich: 'mineral deposits', oilRich: 'oil fields' };

/** Requirement chips for a type (from content), e.g. ["Coastal city"]. */
export function requirements(type: BuildingTypeDto): string[] {
  const g = type.geography ?? {};
  const out: string[] = [];
  if (g.coastal) out.push('Coastal city');
  if (g.arable) out.push('Farmland');
  if (g.mineralRich) out.push('Mineral deposits');
  if (g.oilRich) out.push('Oil fields');
  return out;
}

export interface Availability {
  ok: boolean;
  /** Short reason for a disabled card. */
  reason: string | null;
  kind: 'ok' | 'geography' | 'cash' | 'placement' | 'product';
}

/** Why a card can't be built here (bridge verdicts, worded for players). */
export function availability(preview: BuildPreviewDto | undefined, opts: { productId?: string | null } = {}): Availability {
  if (!preview) return { ok: true, reason: null, kind: 'ok' };
  if (!preview.geographyOk) {
    const words = preview.geographyIssues.map((i) => GEO_WORD[i] ?? i);
    return { ok: false, reason: `Needs ${words.join(' and ')}`, kind: 'geography' };
  }
  if (opts.productId && !preview.eligibleProductIds.includes(opts.productId)) {
    return { ok: false, reason: 'Can’t handle that product', kind: 'product' };
  }
  if (!preview.affordable) return { ok: false, reason: `Cash short ${money(preview.shortfall)}`, kind: 'cash' };
  if (!preview.placementOk) return { ok: false, reason: 'No free site in this city', kind: 'placement' };
  return { ok: true, reason: null, kind: 'ok' };
}

export interface Suggestion {
  id: string;
  label: string;
  typeId: string;
  productId: string | null;
  cityId: string;
  /** Why it is suggested. */
  why: string;
  source: 'starter' | 'opportunity';
}

/** The city a starter plan resolves to (bridge rule: largest population, ties by id). */
export function starterCity(cities: readonly CityDto[]): CityDto | null {
  return [...cities].sort((a, b) => b.population - a.population || a.id.localeCompare(b.id))[0] ?? null;
}

/**
 * Starter suggestions for the palette: the curated starter plans (affordable
 * ones first), then the bridge's best unserved market if it is not already one
 * of them. Capped at `limit`.
 */
export function suggestions(opts: {
  plans: readonly StarterPlanDto[];
  types: ReadonlyMap<string, BuildingTypeDto>;
  cities: readonly CityDto[];
  cash: number;
  productName: (id: string) => string;
  cityName: (id: string) => string;
  opportunity?: { cityId: string; productId: string; potentialDemand: number; rivalCount: number } | null;
  limit?: number;
}): Suggestion[] {
  const city = starterCity(opts.cities);
  const out: Suggestion[] = [];
  const plans = [...opts.plans]
    .filter((p) => opts.types.has(p.typeId))
    .sort((a, b) => Number((opts.types.get(a.typeId)?.constructionCost ?? 0) > opts.cash) - Number((opts.types.get(b.typeId)?.constructionCost ?? 0) > opts.cash));
  for (const p of plans) {
    if (!city) break;
    out.push({ id: `starter:${p.id}`, label: p.label, typeId: p.typeId, productId: p.productId, cityId: city.id, why: `Proven starter in ${city.name}`, source: 'starter' });
  }
  const o = opts.opportunity;
  if (o) {
    const store = [...opts.types.values()]
      .filter((t) => t.buildMenuGroup === 'retail' && t.eligibleProductIds.includes(o.productId))
      .sort((a, b) => a.constructionCost - b.constructionCost)
      .find((t) => t.constructionCost <= opts.cash);
    if (store && !out.some((s) => s.typeId === store.id && s.productId === o.productId && s.cityId === o.cityId)) {
      out.unshift({
        id: `opp:${o.cityId}:${o.productId}`,
        label: `${store.name} selling ${opts.productName(o.productId).toLowerCase()} in ${opts.cityName(o.cityId)}`,
        typeId: store.id,
        productId: o.productId,
        cityId: o.cityId,
        why: o.rivalCount === 0 ? 'Nobody sells it there yet' : `Only ${o.rivalCount} rival${o.rivalCount === 1 ? '' : 's'}`,
        source: 'opportunity',
      });
    }
  }
  return out.slice(0, opts.limit ?? 3);
}

/** "Opens in 2 months" / "Opens next month" (constructionMonths is EXT; absent = instant). */
export function opensText(constructionMonths: number | undefined | null): string {
  if (constructionMonths === undefined || constructionMonths === null || constructionMonths <= 0) return 'Opens next month';
  return `Builds in ${constructionMonths} month${constructionMonths === 1 ? '' : 's'}`;
}
