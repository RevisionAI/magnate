// Messages exchanged between EngineClient (main thread) and engine.worker.ts
// (bridge-spec §6.3 "Worker protocol additions").
//
// Requests are processed strictly in order: the worker owns the .NET runtime
// (single-threaded) and the IndexedDB save store, and chains every request on
// the previous one, so a `load` that is still reading IndexedDB can never be
// overtaken by an `advance`.
//
// Every response to a save-store request carries a bridge-style envelope JSON in
// `payload` ({ok, result} or {ok:false, error:{code, message, details}}), so the
// client has one error path (EngineError with a typed code) for engine and
// storage failures alike. `extra` carries side data that is not part of the
// envelope (load: the slot record and the client document; boot: capabilities).

import type { SaveArgs, SaveMetaDto } from './protocol';

/** Worker request kinds (main → worker). */
export type WorkerRequest =
  | { id: number; kind: 'boot'; frameworkUrl: string }
  | { id: number; kind: 'call'; method: string; argsJson: string }
  /**
   * Serialise the game into a slot. Without `slotId`, a `manual` save gets a fresh
   * `m-<uuid>` slot, a `quicksave` the `quick` slot and an `autosave` the next of
   * `auto-1..3` (an unused one, else the oldest). → `StoredSlot`.
   */
  | { id: number; kind: 'save'; slotId?: string; args: SaveArgs; ui?: SlotUiInfo }
  /** Load a slot into the engine. → the bridge's `loadGame` envelope; `extra` = `LoadExtra`. */
  | { id: number; kind: 'load'; slotId: string; expectedGameId?: string }
  /** Every slot's listing record, newest first (never reads save bodies). → `SlotRecord[]`. */
  | { id: number; kind: 'listSaves' }
  | { id: number; kind: 'deleteSave'; slotId: string }
  /** → the updated `SlotRecord`. */
  | { id: number; kind: 'renameSave'; slotId: string; label: string | null }
  /** → `ExportResult` in `payload`, the file bytes in `binary` (transferred). */
  | { id: number; kind: 'exportSave'; slotId: string }
  /**
   * Store an exported or legacy file as a new manual slot (or `slotId`). Accepts the
   * gzip web envelope (`.magnate`), plain web-envelope JSON, a legacy engine save
   * (Godot schema v1–v9, `.json`), gzip of either (`.json.gz`), and the Wave-1 UI
   * export (`magnate.save` v1). → `StoredSlot`.
   */
  | { id: number; kind: 'importSave'; bytes: ArrayBuffer; fileName?: string; slotId?: string }
  /** → `StorageEstimateDto | null`. */
  | { id: number; kind: 'storageEstimate' }
  /**
   * Worker-driven autosave (§6.3): when on, an `advance` whose result says
   * `autosaveDue` is followed — before the next request — by an autosave into the
   * rotation, announced with an `autosaved` push. Off by default (the UI shell
   * schedules autosaves itself). → `{ autosaveOnDue }`.
   */
  | { id: number; kind: 'configureSaves'; autosaveOnDue: boolean };

/** Presentation bits the listing shows that the bridge does not know. */
export interface SlotUiInfo {
  /** Small data-URL image of the city at save time. */
  thumbnail?: string | null;
  /** Seconds of real play time in this game so far. */
  playTimeSec?: number;
}

/**
 * The record kept per slot in IndexedDB `saveMeta` (listing; no bodies). The bridge's
 * `SaveMetaDto` written at save time plus slot bookkeeping.
 */
export interface StoredSlot extends SaveMetaDto {
  slotId: string;
  /** Epoch ms of the last write (listing order; the oldest autosave is overwritten next). */
  updatedAt: number;
  playTimeSec: number;
  thumbnail: string | null;
  /** `binary`: gzip web envelope in `saveData` (a Blob). */
  storage: 'binary';
}

/**
 * A slot written by the Wave-1 main-thread store (`magnate.save` v1 records): the UI's
 * `SaveSlotMeta` in `saveMeta` and `{format, data, sidecar}` in `saveData`. The worker
 * still lists, loads, renames, deletes and exports them.
 */
export interface LegacySlot {
  slotId: string;
  slotKind: 'manual' | 'autosave' | 'quicksave';
  label: string | null;
  gameId: string;
  scenarioId: string | null;
  scenarioName: string | null;
  companyName: string;
  date: { year: number; month: number };
  elapsedMonths: number | null;
  cash: number;
  corporateValue: number;
  goalsAchieved: number;
  goalsTotal: number;
  outcomeStatus: 'playing' | 'won' | 'lost';
  createdAtIso: string;
  updatedAt: number;
  playTimeSec: number;
  rawBytes: number;
  compressedBytes: number;
  formatVersion: number;
  engineSchemaVersion: number;
  contentHash: string | null;
  thumbnail: string | null;
  storage?: undefined;
}

export type SlotRecord = StoredSlot | LegacySlot;

/** Side data of a `load` response. */
export interface LoadExtra {
  slot: SlotRecord;
  /** The client document saved with the slot (`ClientSaveDoc` JSON), if any. */
  client: string | null;
  /** The save was written against different content files (loaded anyway; ids were checked). */
  contentChanged: boolean;
}

/** Result of `exportSave` (the bytes travel in `binary`). */
export interface ExportResult {
  fileName: string;
  mimeType: string;
  bytes: number;
}

export interface StorageEstimateDto {
  usage: number;
  quota: number;
}

/** Capabilities the worker reports in the `boot` response's `extra`. */
export interface WorkerCapabilities {
  /** The engine build has the binary save exports and IndexedDB is usable in the worker. */
  binarySaves: boolean;
  indexedDb: boolean;
}

/**
 * The client document stored with a save (`SaveArgs.client`): presentation state the
 * engine does not own. The worker reads only `thumbnail` and `playTimeSec` (to fill the
 * listing of an imported file); everything else is the UI's.
 */
export interface ClientSaveDoc {
  version: 1;
  sidecar?: unknown;
  thumbnail?: string | null;
  playTimeSec?: number;
}

export type BootStage = 'runtime' | 'content' | 'scenarios' | 'ready';

export type WorkerResponse =
  | { id: number; ok: true; payload: string; elapsedMs?: number; binary?: ArrayBuffer; extra?: string }
  | { id: number; ok: false; error: string }
  /** Push: boot progress (bridge-spec §6.1). */
  | { id: 0; kind: 'bootProgress'; stage: BootStage }
  /** Push: a worker-driven autosave finished (`payload` = envelope of the `StoredSlot`, or the error). */
  | { id: 0; kind: 'autosaved'; payload: string };

/** Push messages carry id 0 and a `kind`. */
export function isPush(message: WorkerResponse): message is Extract<WorkerResponse, { kind: string }> {
  return message.id === 0 && 'kind' in message;
}
