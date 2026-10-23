// Pure helpers shared by every SaveStore backend: slot ids, metadata, the
// autosave rotation and the import/export file format.

import type { SaveGameResult } from '@/bridge/protocol';
import { uuid } from '@/util/random';
import {
  SaveError,
  UI_SAVE_FORMAT,
  UI_SAVE_FORMAT_VERSION,
  type SaveContext,
  type SaveSlotMeta,
  type StoredSave,
  type UiSidecar,
} from './types';

/** Autosaves rotate through this many slots (D17). */
export const AUTOSAVE_SLOTS = 3;

export const slotIds = {
  manual: () => `m-${uuid()}`,
  /** Each game has its own quick slot — quick-save never overwrites another game (UX §6.19). */
  quick: (gameId: string) => `quick-${gameId}`,
  auto: (n: number) => `auto-${n}`,
};

export function slotKindOf(slotId: string): SaveSlotMeta['slotKind'] {
  if (slotId.startsWith('auto-')) return 'autosave';
  if (slotId.startsWith('quick')) return 'quicksave';
  return 'manual';
}

/** The autosave slot to write next: an unused one, else the oldest. */
export function nextAutosaveSlot(existing: readonly SaveSlotMeta[]): string {
  const autos = new Map(existing.filter((m) => m.slotKind === 'autosave').map((m) => [m.slotId, m]));
  for (let n = 1; n <= AUTOSAVE_SLOTS; n++) if (!autos.has(slotIds.auto(n))) return slotIds.auto(n);
  let oldest = slotIds.auto(1);
  let oldestAt = Infinity;
  for (let n = 1; n <= AUTOSAVE_SLOTS; n++) {
    const at = autos.get(slotIds.auto(n))?.updatedAt ?? 0;
    if (at < oldestAt) {
      oldest = slotIds.auto(n);
      oldestAt = at;
    }
  }
  return oldest;
}

/** UTF-16 → UTF-8 byte length (what the save costs on disk before compression). */
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Listing metadata from the bridge save result and the HUD at save time. */
export function buildMeta(slotId: string, result: SaveGameResult, ctx: SaveContext, nowMs: number = Date.now()): SaveSlotMeta {
  const hud = ctx.hud;
  const goals = hud.scenario?.goals ?? [];
  const raw = utf8Length(result.data);
  return {
    slotId,
    slotKind: ctx.slotKind,
    label: ctx.label ?? null,
    gameId: ctx.gameId,
    scenarioId: result.scenarioId ?? hud.scenario?.id ?? null,
    scenarioName: result.scenarioName ?? hud.scenario?.name ?? null,
    companyName: result.companyName || hud.player?.name || 'Company',
    date: result.date ?? hud.date,
    elapsedMonths: hud.elapsedMonths,
    cash: Number.isFinite(result.cash) ? result.cash : (hud.player?.cash ?? 0),
    corporateValue: hud.player?.value ?? 0,
    goalsAchieved: goals.filter((g) => g.latched).length,
    goalsTotal: goals.length,
    outcomeStatus: hud.outcome.status,
    createdAtIso: new Date(nowMs).toISOString(),
    updatedAt: nowMs,
    playTimeSec: Math.max(0, Math.round(ctx.playTimeSec ?? 0)),
    rawBytes: raw,
    compressedBytes: raw,
    formatVersion: UI_SAVE_FORMAT_VERSION,
    engineSchemaVersion: result.schemaVersion,
    contentHash: null,
    thumbnail: ctx.thumbnail ?? null,
  };
}

/** Serialises a stored save for download. */
export function toExportFile(save: StoredSave): { blob: Blob; fileName: string } {
  const json = JSON.stringify(save);
  const company = save.meta.companyName.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'magnate';
  const ym = `${save.meta.date.year}-${String(save.meta.date.month).padStart(2, '0')}`;
  return { blob: new Blob([json], { type: 'application/json' }), fileName: `${company}-${ym}.magnate.json` };
}

interface LegacyEngineSave {
  schemaVersion?: number;
  clock?: { year?: number; month?: number };
  scenarioId?: string | null;
  playerId?: number | null;
  companies?: { id?: number; name?: string; cash?: number }[];
}

/**
 * Parses an imported file: our export format, or a legacy engine save (any Godot
 * save v1–v9, detected by a root `schemaVersion`). Throws SaveError('corrupt').
 */
export function parseImport(text: string, fileName = 'imported save', nowMs: number = Date.now()): StoredSave {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveError('corrupt', 'This file is not a Magnate save (it is not valid JSON).');
  }
  const obj = parsed as Partial<StoredSave> & LegacyEngineSave;
  if (obj && obj.format === UI_SAVE_FORMAT && typeof obj.data === 'string' && obj.meta) {
    if ((obj.formatVersion ?? 0) > UI_SAVE_FORMAT_VERSION) {
      throw new SaveError('corrupt', 'This save was made by a newer version of Magnate.');
    }
    return { format: UI_SAVE_FORMAT, formatVersion: UI_SAVE_FORMAT_VERSION, meta: obj.meta, data: obj.data, sidecar: obj.sidecar ?? null };
  }
  if (obj && typeof obj.schemaVersion === 'number') {
    const player = obj.companies?.find((c) => c.id === (obj.playerId ?? 1)) ?? obj.companies?.[0];
    const gameId = `import-${uuid()}`;
    const meta: SaveSlotMeta = {
      slotId: '',
      slotKind: 'manual',
      label: fileName.replace(/\.(magnate\.)?json$/i, ''),
      gameId,
      scenarioId: obj.scenarioId ?? null,
      scenarioName: null,
      companyName: player?.name ?? 'Imported company',
      date: { year: obj.clock?.year ?? 2026, month: obj.clock?.month ?? 1 },
      elapsedMonths: null,
      cash: player?.cash ?? 0,
      corporateValue: 0,
      goalsAchieved: 0,
      goalsTotal: 0,
      outcomeStatus: 'playing',
      createdAtIso: new Date(nowMs).toISOString(),
      updatedAt: nowMs,
      playTimeSec: 0,
      rawBytes: utf8Length(text),
      compressedBytes: utf8Length(text),
      formatVersion: UI_SAVE_FORMAT_VERSION,
      engineSchemaVersion: obj.schemaVersion,
      contentHash: null,
      thumbnail: null,
    };
    return { format: UI_SAVE_FORMAT, formatVersion: UI_SAVE_FORMAT_VERSION, meta, data: text, sidecar: null };
  }
  throw new SaveError('corrupt', 'This file is not a Magnate save.');
}

/** Sorts slots newest first. */
export function sortSlots(slots: SaveSlotMeta[]): SaveSlotMeta[] {
  return [...slots].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Display name of a slot. */
export function slotTitle(meta: Pick<SaveSlotMeta, 'slotKind' | 'label' | 'companyName' | 'scenarioName'>): string {
  if (meta.label) return meta.label;
  if (meta.slotKind === 'quicksave') return 'Quicksave';
  if (meta.slotKind === 'autosave') return 'Autosave';
  return meta.scenarioName ? `${meta.companyName} · ${meta.scenarioName}` : meta.companyName;
}

export function emptySidecar(): UiSidecar {
  return { version: 1 };
}
