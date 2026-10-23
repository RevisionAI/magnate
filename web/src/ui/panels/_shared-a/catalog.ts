// Catalog lookups shared by the U2 panels (build, inspector, markets, company).
// Display names always come from the engine catalog; ids are only a fallback.

import { useMemo } from 'react';
import type { BuildingTypeDto, CatalogDto, CityDto, FeatureName, ProductDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { humanizeId } from '@/util/format';

export interface CatalogIndex {
  catalog: CatalogDto | null;
  products: Map<string, ProductDto>;
  types: Map<string, BuildingTypeDto>;
  cities: Map<string, CityDto>;
  productName(id: string): string;
  typeName(id: string): string;
  cityName(id: string): string;
}

export function indexCatalog(catalog: CatalogDto | null): CatalogIndex {
  const products = new Map((catalog?.products ?? []).map((p) => [p.id, p]));
  const types = new Map((catalog?.buildingTypes ?? []).map((t) => [t.id, t]));
  const cities = new Map((catalog?.cities ?? []).map((c) => [c.id, c]));
  return {
    catalog,
    products,
    types,
    cities,
    productName: (id) => products.get(id)?.name ?? humanizeId(id),
    typeName: (id) => types.get(id)?.name ?? humanizeId(id),
    cityName: (id) => cities.get(id)?.name ?? humanizeId(id),
  };
}

/** Memoised catalog index (stable for the session). */
export function useCatalogIndex(): CatalogIndex {
  const catalog = useGameStore((s) => s.catalog);
  return useMemo(() => indexCatalog(catalog), [catalog]);
}

/** True when the engine build reports the EXT feature (bridge `init.features`). */
export function useFeature(name: FeatureName): boolean {
  return useGameStore((s) => Boolean(s.init?.features?.[name]));
}

/** True when the engine build registers a bridge method (older prebuilt engines may lack some). */
export function useHasMethod(method: string): boolean {
  return useGameStore((s) => (s.init?.methods ? s.init.methods.includes(method) : true));
}

/** The player's company id (null before a game starts). */
export function usePlayerId(): number | null {
  return useGameStore((s) => s.hud?.player?.id ?? s.snapshot?.playerId ?? null);
}

/** The player's cash (0 before a game starts). */
export function usePlayerCash(): number {
  return useGameStore((s) => s.hud?.player?.cash ?? 0);
}
