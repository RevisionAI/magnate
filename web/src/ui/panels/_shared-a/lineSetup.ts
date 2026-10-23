// Setting up a unit with sensible opening values. A new retail line needs a
// price and a restock target before the slot exists; we open at the market's
// reference price and a provisional shelf, then size the shelf from the
// bridge's own forecast for the new slot (`modelDemandUnits`) — the same two
// steps the build confirm card uses.

import type { SlotKind } from '@/bridge/protocol';
import { getEngine, useGameStore } from '@/state/gameStore';
import { useTutorialStore } from '@/state/tutorialStore';
import { runCommand, type CommandResult } from './commands';
import { openingPrice } from './priceBands';
import { DEFAULT_POLICY, unitsForCover } from './stockPolicy';

export interface LineSetupArgs {
  buildingId: number;
  cityId: string;
  slotIndex: number;
  productId: string;
  kind: SlotKind;
  /** Months of cover for a retail shelf (default Balanced). */
  coverMonths?: number;
  /** Warehouse target stock (units). */
  targetStock?: number;
}

export async function setUpLine(args: LineSetupArgs): Promise<CommandResult<unknown>> {
  const months = args.coverMonths ?? DEFAULT_POLICY.months;
  let price: number | undefined;
  let restockTarget: number | undefined;
  if (args.kind === 'retail') {
    const product = useGameStore.getState().catalog?.products.find((p) => p.id === args.productId);
    let cheapest: number | undefined;
    let provisional = 1000;
    try {
      const intel = await getEngine().call('marketIntel', { cityId: args.cityId, productId: args.productId });
      const row = intel.rows[0];
      cheapest = row?.cheapestRivalPrice;
      if (row) provisional = unitsForCover(months, row.potentialDemand / (row.retailerCount + 1));
    } catch {
      // keep the defaults
    }
    const starter = useGameStore.getState().catalog?.starterPlans.find((s) => s.productId === args.productId && s.price !== undefined);
    price = openingPrice({ cheapestRivalPrice: cheapest, starterPrice: starter?.price, worldPrice: product?.baseWorldMarketPrice ?? 1 });
    restockTarget = provisional;
  }
  const res = await runCommand('configureSlot', {
    buildingId: args.buildingId,
    slotIndex: args.slotIndex,
    productId: args.productId,
    ...(price !== undefined ? { price } : {}),
    ...(restockTarget !== undefined ? { restockTarget } : {}),
    ...(args.kind === 'warehouse' ? { targetStock: Math.max(1, Math.round(args.targetStock ?? 100_000)) } : {}),
  });
  if (!res.ok) return res;
  useTutorialStore.getState().notifyAction(`configure:${args.productId}`);
  if (args.kind === 'retail') await sizeShelf(args.buildingId, args.slotIndex, months);
  return res;
}

/** Resize a retail shelf to `months` of the bridge's forecast for that slot. */
export async function sizeShelf(buildingId: number, slotIndex: number, months: number): Promise<void> {
  try {
    const detail = await getEngine().call('building', { buildingId });
    const r = detail.slots.find((s) => s.index === slotIndex)?.retail;
    const forecast = r ? (r.lastMonthDemand ?? r.modelDemandUnits) : 0;
    if (r && forecast > 0) await runCommand('setRestockTarget', { buildingId, slotIndex, restockTarget: unitsForCover(months, forecast) }, { quiet: true });
  } catch {
    // The provisional shelf stays; the Setup tab shows the cover and lets the player adjust it.
  }
}
