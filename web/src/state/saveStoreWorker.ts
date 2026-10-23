// SaveStore over the engine worker (bridge-spec §6.3, D17): the game is
// serialised and gzipped inside .NET and written to IndexedDB by the worker, so a
// save never crosses to the main thread — only its listing record does. The UI's
// presentation state (UiSidecar, thumbnail, play time) travels as the save's
// client document, so exported `.magnate` files round-trip it too.
//
// Slots written by the Wave-1 main-thread store stay listable, loadable,
// renamable, deletable and exportable (the worker reads both record shapes).

import { EngineError, type ExportedSave, type LoadedSlot } from '@/bridge/engine';
import type { SaveArgs } from '@/bridge/protocol';
import type { ClientSaveDoc, SlotRecord, SlotUiInfo, StorageEstimateDto, StoredSlot, WorkerCapabilities } from '@/bridge/workerProtocol';
import { SaveError, type LoadedGame, type SaveContext, type SaveSlotMeta, type SaveStore, type StorageEstimate, type UiSidecar } from './savegame/types';

/** The part of EngineClient this store needs (an interface, so tests can fake it). */
export interface WorkerSaveBackend {
  readonly capabilities: WorkerCapabilities;
  listSaves(): Promise<SlotRecord[]>;
  saveToSlot(args: SaveArgs, options?: { slotId?: string; ui?: SlotUiInfo }): Promise<StoredSlot>;
  loadSlot(slotId: string, options?: { expectedGameId?: string }): Promise<LoadedSlot>;
  deleteSave(slotId: string): Promise<null>;
  renameSave(slotId: string, label: string | null): Promise<SlotRecord>;
  exportSave(slotId: string): Promise<ExportedSave>;
  importSave(bytes: ArrayBuffer, fileName?: string): Promise<StoredSlot>;
  storageEstimate(): Promise<StorageEstimateDto | null>;
}

/** True when the client can back a WorkerSaveStore (binary save exports + IndexedDB in the worker). */
export function workerSavesAvailable(backend: Partial<WorkerSaveBackend> | null | undefined): backend is WorkerSaveBackend {
  return !!backend?.capabilities?.binarySaves && typeof backend.saveToSlot === 'function';
}

/** The UI listing record for either stored shape. */
export function toSlotMeta(record: SlotRecord): SaveSlotMeta {
  if (record.storage === 'binary') {
    return {
      slotId: record.slotId,
      slotKind: record.slotKind,
      label: record.label ?? null,
      gameId: record.gameId,
      scenarioId: record.scenarioId ?? null,
      scenarioName: record.scenarioName ?? null,
      companyName: record.companyName || 'Company',
      date: record.date,
      elapsedMonths: record.elapsedMonths,
      cash: record.cash,
      corporateValue: record.corporateValue,
      goalsAchieved: record.goalsAchieved,
      goalsTotal: record.goalsTotal,
      outcomeStatus: record.outcomeStatus,
      createdAtIso: record.createdAtIso ?? new Date(record.updatedAt).toISOString(),
      updatedAt: record.updatedAt,
      playTimeSec: record.playTimeSec ?? 0,
      rawBytes: record.rawBytes,
      compressedBytes: record.compressedBytes,
      formatVersion: record.formatVersion,
      engineSchemaVersion: record.engineSchemaVersion,
      contentHash: record.contentHash || null,
      thumbnail: record.thumbnail ?? null,
    };
  }
  const { storage: _storage, ...meta } = record;
  return { ...meta, label: meta.label ?? null, thumbnail: meta.thumbnail ?? null, playTimeSec: meta.playTimeSec ?? 0 };
}

/** The client document stored with a save. */
export function clientDoc(ctx: Pick<SaveContext, 'sidecar' | 'thumbnail' | 'playTimeSec'>): ClientSaveDoc {
  return { version: 1, sidecar: ctx.sidecar ?? null, thumbnail: ctx.thumbnail ?? null, playTimeSec: Math.max(0, Math.round(ctx.playTimeSec ?? 0)) };
}

/** The UI sidecar inside a stored client document (null when absent or unreadable). */
export function sidecarOf(client: string | null | undefined): UiSidecar | null {
  if (!client) return null;
  try {
    const doc = JSON.parse(client) as Partial<ClientSaveDoc> | null;
    const sidecar = doc?.sidecar as Partial<UiSidecar> | null | undefined;
    return sidecar && typeof sidecar === 'object' && sidecar.version === 1 ? (sidecar as UiSidecar) : null;
  } catch {
    return null;
  }
}

/** A player-facing SaveError for an engine or storage failure. */
export function toSaveError(error: unknown, action: 'save' | 'load' | 'import' | 'other'): SaveError {
  if (error instanceof SaveError) return error;
  if (!(error instanceof EngineError)) {
    return new SaveError('engine', error instanceof Error ? error.message : String(error));
  }
  switch (error.code) {
    case 'save_not_found':
      return new SaveError('not_found', 'That save no longer exists.');
    case 'storage_quota':
      return new SaveError('quota', 'Not enough browser storage for this save. Delete old saves and try again.');
    case 'storage_unavailable':
      return new SaveError('unavailable', error.message || 'Browser storage is unavailable.');
    case 'save_content_mismatch': {
      const missing = error.details?.missing ?? [];
      return new SaveError(
        'corrupt',
        missing.length > 0
          ? `This save needs game content that is not installed (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}).`
          : 'This save needs game content that is not installed.',
      );
    }
    case 'save_version_unsupported':
      return new SaveError('corrupt', error.message || 'This save was made by an incompatible version of Magnate.');
    case 'save_corrupt':
      return new SaveError('corrupt', action === 'import' ? `That file could not be read: ${error.message}` : `This save is damaged: ${error.message}`);
    case 'no_game':
      return new SaveError('engine', 'There is no game in progress to save.');
    default:
      return new SaveError('engine', action === 'save' ? `The engine could not save the game: ${error.message}` : error.message);
  }
}

export class WorkerSaveStore implements SaveStore {
  readonly backend = 'worker' as const;
  private persistRequested = false;

  constructor(private readonly client: WorkerSaveBackend) {}

  async list(): Promise<SaveSlotMeta[]> {
    try {
      return (await this.client.listSaves()).map(toSlotMeta);
    } catch (error) {
      throw toSaveError(error, 'other');
    }
  }

  async save(slotId: string, ctx: SaveContext): Promise<SaveSlotMeta> {
    const args: SaveArgs = {
      slotKind: ctx.slotKind,
      createdAtIso: new Date().toISOString(),
      client: JSON.stringify(clientDoc(ctx)),
      ...(ctx.label?.trim() ? { label: ctx.label.trim() } : {}),
    };
    let stored: StoredSlot;
    try {
      stored = await this.client.saveToSlot(args, { slotId, ui: { thumbnail: ctx.thumbnail ?? null, playTimeSec: ctx.playTimeSec ?? 0 } });
    } catch (error) {
      throw toSaveError(error, 'save');
    }
    this.requestPersistence();
    return toSlotMeta(stored);
  }

  async load(slotId: string): Promise<LoadedGame> {
    let loaded: LoadedSlot;
    try {
      loaded = await this.client.loadSlot(slotId);
    } catch (error) {
      throw toSaveError(error, 'load');
    }
    return { snapshot: loaded.snapshot, meta: toSlotMeta(loaded.slot), sidecar: sidecarOf(loaded.client) };
  }

  async remove(slotId: string): Promise<void> {
    try {
      await this.client.deleteSave(slotId);
    } catch (error) {
      throw toSaveError(error, 'other');
    }
  }

  async rename(slotId: string, label: string): Promise<SaveSlotMeta> {
    try {
      return toSlotMeta(await this.client.renameSave(slotId, label.trim() || null));
    } catch (error) {
      throw toSaveError(error, 'other');
    }
  }

  async exportSlot(slotId: string): Promise<{ blob: Blob; fileName: string }> {
    try {
      const file = await this.client.exportSave(slotId);
      return { blob: new Blob([file.data], { type: file.mimeType }), fileName: file.fileName };
    } catch (error) {
      throw toSaveError(error, 'other');
    }
  }

  async importFile(file: Blob, fileName?: string): Promise<SaveSlotMeta> {
    const name = fileName ?? (typeof File !== 'undefined' && file instanceof File ? file.name : undefined);
    try {
      return toSlotMeta(await this.client.importSave(await file.arrayBuffer(), name));
    } catch (error) {
      throw toSaveError(error, 'import');
    }
  }

  async estimate(): Promise<StorageEstimate | null> {
    try {
      return await this.client.storageEstimate();
    } catch {
      return null;
    }
  }

  /** bridge-spec §6.3: ask for persistent storage on the first save (`persist()` is window-only). */
  private requestPersistence(): void {
    if (this.persistRequested) return;
    this.persistRequested = true;
    try {
      void globalThis.navigator?.storage?.persist?.().catch(() => undefined);
    } catch {
      /* best effort */
    }
  }
}
