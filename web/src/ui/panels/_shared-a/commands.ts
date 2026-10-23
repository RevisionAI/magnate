// Mutating bridge calls for the U2 panels. Like `engineMutate` (state/useEngineQuery)
// they bump the store revision so every useEngineQuery refreshes, but they hand
// the typed error back to the caller (inline messages, feature_unavailable
// fallbacks) and word toasts from `code` + `details` (errors.ts).

import type { BuildingSummaryDto, ConstructArgs, MethodArgs, MethodName, MethodResult } from '@/bridge/protocol';
import { EngineError } from '@/bridge/engine';
import { audio } from '@/audio';
import { bus } from '@/game/events';
import { fx } from '@/game/fx';
import { useAlertsStore } from '@/state/alertsStore';
import { getEngine, useGameStore } from '@/state/gameStore';
import { useTutorialStore } from '@/state/tutorialStore';
import { signedMoney } from '@/util/format';
import { friendlyError } from './errors';

export type CommandResult<T> = { ok: true; result: T } | { ok: false; error: EngineError | Error; message: string };

export interface CommandOptions {
  /** Do not toast the error (the caller shows it inline). */
  quiet?: boolean;
}

export async function runCommand<M extends MethodName>(method: M, args: MethodArgs<M>, options: CommandOptions = {}): Promise<CommandResult<MethodResult<M>>> {
  try {
    const result = await getEngine().callRaw<MethodResult<M>>(method, args);
    await useGameStore.getState().syncAfterMutation();
    return { ok: true, result };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    const message = error instanceof EngineError ? friendlyError(error) : error.message;
    if (!options.quiet) {
      audio.ui('error');
      useAlertsStore.getState().notify({ kind: `command.${method}`, severity: 'warning', title: 'That didn’t work', body: message, record: false });
    }
    return { ok: false, error, message };
  }
}

/** True when an error is the bridge's "not in this build yet" answer. */
export function isFeatureUnavailable(error: unknown): boolean {
  return error instanceof EngineError && error.code === 'feature_unavailable';
}

/**
 * Construct for the player with the same side effects as the shell's quick
 * build: the `buildingPlaced` bus beat (audio, scene FX), the cash popups, the
 * tutorial action and a success toast (the alert policy leaves the player's own
 * construction to the build UI).
 */
export async function constructBuilding(args: ConstructArgs, cost: number, label: string, options: CommandOptions = {}): Promise<CommandResult<BuildingSummaryDto>> {
  const res = await runCommand('construct', args, options);
  if (!res.ok) return res;
  const building = res.result;
  bus.emit('buildingPlaced', { buildingId: building.id, typeId: args.typeId, cityId: args.cityId });
  if (cost > 0) {
    fx.popup({ text: signedMoney(-cost), tone: 'loss', anchor: 'topbar.cash' });
    fx.worldPopup(building.id, signedMoney(-cost), 'loss', -cost);
  }
  audio.ui('placeOk');
  const tutorial = useTutorialStore.getState();
  tutorial.notifyAction(`construct:${args.typeId}`);
  if (args.initialSlot) tutorial.notifyAction(`configure:${args.initialSlot.productId}`);
  tutorial.evaluate({ hud: useGameStore.getState().hud, events: [] });
  useAlertsStore.getState().notify({
    kind: 'construct',
    severity: 'success',
    title: label,
    body: building.status === 'underConstruction' ? 'Construction has started.' : 'Open for business at the next month close.',
    record: false,
  });
  return res;
}
