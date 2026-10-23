// Brand data shared by the marketing tabs: channel labels, the brand leader
// per (product, city) from the stats dashboard's top-5 boards, and the media
// buildings you own per channel.

import { Newspaper, Radio, Tv, BookOpen, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { AdChannelId, BrandBoardDto } from '@/bridge/protocol';
import { useEngineQuery } from '@/state/useEngineQuery';

export const CHANNEL: Record<AdChannelId, { label: string; icon: LucideIcon; blurb: string }> = {
  tv: { label: 'TV', icon: Tv, blurb: 'Widest reach' },
  radio: { label: 'Radio', icon: Radio, blurb: 'Cheap and steady' },
  newspaper: { label: 'Newspaper', icon: Newspaper, blurb: 'Local readers' },
  magazine: { label: 'Magazine', icon: BookOpen, blurb: 'Premium audience' },
};

export const CHANNEL_ORDER: AdChannelId[] = ['tv', 'radio', 'newspaper', 'magazine'];

export interface BrandCell {
  /** The player's brand when it is in the top five for that product. */
  you: number | null;
  /** Best rival in that city (null when none is in the top five). */
  leader: { companyId: number; brand: number } | null;
}

export const brandKey = (productId: string, cityId: string) => `${productId}|${cityId}`;

/** Indexes the dashboard's brand boards by (product, city). */
export function indexBrands(boards: readonly BrandBoardDto[], playerId: number | null): Map<string, BrandCell> {
  const out = new Map<string, BrandCell>();
  for (const b of boards) {
    for (const row of b.rows) {
      const key = brandKey(b.productId, row.cityId);
      const cell = out.get(key) ?? { you: null, leader: null };
      if (row.companyId === playerId) cell.you = Math.max(cell.you ?? 0, row.brand);
      else if (!cell.leader || row.brand > cell.leader.brand) cell.leader = { companyId: row.companyId, brand: row.brand };
      out.set(key, cell);
    }
  }
  return out;
}

export function useBrandIndex(playerId: number | null): Map<string, BrandCell> {
  const { data } = useEngineQuery('statsDashboard', {});
  return useMemo(() => indexBrands(data?.brandTop ?? [], playerId), [data, playerId]);
}
