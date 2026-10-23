// Placement payload normalisation (pure, so it is unit-tested without the stores).
// See buildFlow.ts for the ghost → build panel contract.

import type { PlacementDto, PlotRefDto, Rotation } from '@/bridge/protocol';

export interface PlacementPayload {
  typeId?: string;
  cityId?: string;
  at?: Partial<PlotRefDto>;
  plot?: Partial<PlotRefDto>;
  placement?: Partial<PlacementDto>;
  px?: number;
  pz?: number;
  rotation?: number;
}

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/** Normalises the shapes a ghost might send into a PlotRef (null when it carries no plot). */
export function normalizePlacement(payload: unknown): { at: PlotRefDto; typeId?: string; cityId?: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as PlacementPayload;
  const src = p.at ?? p.plot ?? p.placement ?? p;
  const px = Number(src.px);
  const pz = Number(src.pz);
  if (!Number.isInteger(px) || !Number.isInteger(pz)) return null;
  const rot = Number(src.rotation ?? 0);
  const rotation: Rotation = (ROTATIONS as readonly number[]).includes(rot) ? (rot as Rotation) : 0;
  return { at: { px, pz, rotation }, typeId: typeof p.typeId === 'string' ? p.typeId : undefined, cityId: typeof p.cityId === 'string' ? p.cityId : undefined };
}

