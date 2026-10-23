// Display names for engine ids (products, cities, building types, companies,
// buildings) from the catalog and the HUD snapshot already in the game store.
// Panels never show raw ids (UX §6.16: "product/city names, not ids").

import { useMemo } from 'react';
import type { CatalogDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import type { CompanyView } from '@/state/hud';
import { NEUTRAL_OWNER, ownerColor, ownerEmblem, type OwnerEmblem } from '@/theme/tokens';
import { humanizeId } from '@/util/format';

export interface CompanyRef {
  id: number;
  name: string;
  color: string;
  emblem: OwnerEmblem;
  isPlayer: boolean;
  colorIndex: number;
}

export interface Names {
  catalog: CatalogDto | null;
  product: (id: string | null | undefined) => string;
  city: (id: string | null | undefined) => string;
  buildingType: (id: string | null | undefined) => string;
  company: (id: number | null | undefined) => CompanyRef;
  /** "Supermarket #4" for the player's buildings; "Building #4" otherwise. */
  building: (id: number | null | undefined) => string;
  productIds: string[];
  cityIds: string[];
  playerId: number | null;
  companies: CompanyView[];
}

export function useNames(): Names {
  const catalog = useGameStore((s) => s.catalog);
  const companies = useGameStore((s) => s.hud?.companies);
  const buildings = useGameStore((s) => s.buildings);
  const playerId = useGameStore((s) => s.hud?.player?.id ?? null);
  return useMemo(() => {
    const products = new Map(catalog?.products.map((p) => [p.id, p.name]) ?? []);
    const cities = new Map(catalog?.cities.map((c) => [c.id, c.name]) ?? []);
    const types = new Map(catalog?.buildingTypes.map((t) => [t.id, t.name]) ?? []);
    const byId = new Map((companies ?? []).map((c) => [c.id, c]));
    const bNames = new Map(buildings.map((b) => [b.id, b.name]));
    return {
      catalog,
      product: (id) => (id ? (products.get(id) ?? humanizeId(id)) : '—'),
      city: (id) => (id ? (cities.get(id) ?? humanizeId(id)) : '—'),
      buildingType: (id) => (id ? (types.get(id) ?? humanizeId(id)) : '—'),
      company: (id) => {
        const c = id !== null && id !== undefined ? byId.get(id) : undefined;
        if (!c) return { id: id ?? -1, name: id !== null && id !== undefined ? `Company ${id}` : 'Local competitors', color: NEUTRAL_OWNER, emblem: 'circle', isPlayer: false, colorIndex: -1 };
        return { id: c.id, name: c.name, color: c.color ?? ownerColor(c.colorIndex), emblem: c.emblem ?? ownerEmblem(c.colorIndex), isPlayer: c.isPlayer, colorIndex: c.colorIndex };
      },
      building: (id) => (id === null || id === undefined ? '—' : (bNames.get(id) ?? `Building #${id}`)),
      productIds: [...products.keys()],
      cityIds: [...cities.keys()],
      playerId,
      companies: companies ?? [],
    };
  }, [catalog, companies, buildings, playerId]);
}
