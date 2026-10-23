// R&D actions shared by the R&D screen and the advisor's one-click fixes:
// "Research this" finds a free research unit in one of your R&D centres and
// points it at the product, or explains why it can't (UX §6.11).

import type { BuildingDetailDto, BuildingSummaryDto } from '@/bridge/protocol';
import { getEngine, useGameStore } from '@/state/gameStore';
import { engineMutate } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';

export type ResearchOutcome =
  | { kind: 'started'; buildingId: number; slotIndex: number }
  | { kind: 'noFreeUnit'; labs: number }
  | { kind: 'noLab' }
  | { kind: 'failed' };

/** The player's R&D buildings (research slot kind), from the store's building list. */
export function playerLabs(buildings: readonly BuildingSummaryDto[], playerId: number | null): BuildingSummaryDto[] {
  return buildings.filter((b) => b.slotKind === 'research' && (playerId === null || b.ownerId === playerId));
}

/** Points a free research unit at `productId` (the lab with the most free units first). */
export async function researchProduct(productId: string): Promise<ResearchOutcome> {
  const state = useGameStore.getState();
  const labs = playerLabs(state.buildings, state.hud?.player?.id ?? null);
  if (labs.length === 0) return { kind: 'noLab' };
  const candidates = labs.filter((b) => b.configuredSlots < b.capacity).sort((a, b) => b.capacity - b.configuredSlots - (a.capacity - a.configuredSlots));
  for (const lab of candidates) {
    let detail: BuildingDetailDto;
    try {
      detail = await getEngine().call('building', { buildingId: lab.id });
    } catch {
      continue;
    }
    if (detail.nextFreeSlotIndex < 0 || !detail.actions.eligibleProductIds.includes(productId)) continue;
    const result = await engineMutate('configureSlot', { buildingId: lab.id, slotIndex: detail.nextFreeSlotIndex, productId });
    if (!result) return { kind: 'failed' };
    await useGameStore.getState().refreshBuildings();
    return { kind: 'started', buildingId: lab.id, slotIndex: detail.nextFreeSlotIndex };
  }
  return { kind: 'noFreeUnit', labs: labs.length };
}

/** Opens Build with the R&D centre preselected (U2's build drawer reads `typeId` / `group`). */
export function openBuildLab(cityId?: string | null): void {
  useUiStore.getState().openPanel('build', { typeId: 'rd_center', group: 'research', ...(cityId ? { cityId } : {}) });
}
