// SaveStore contract (UX §6.19, D17, bridge-spec §6.3).
//
// Wave 1 implements it on the main thread over IndexedDB with the bridge's
// string saveGame/loadGame (idbSaveStore.ts). Wave 2 (B2) moves storage into
// the engine worker (binary gzip saves, SaveMetaDto from the bridge) behind the
// same interface — UI code only ever talks to `SaveStore`.

import type { DateDto, SaveGameResult, SnapshotDto } from '@/bridge/protocol';
import type { HudModel } from '../hud';
import type { MonthRecord } from '../history';
import type { TutorialPersisted } from '../tutorialStore';

export type SlotKind = 'manual' | 'autosave' | 'quicksave';

/** Listing metadata — mirrors bridge-spec §5.12 SaveMetaDto plus slot bookkeeping. */
export interface SaveSlotMeta {
  slotId: string;
  slotKind: SlotKind;
  label: string | null;
  gameId: string;
  scenarioId: string | null;
  scenarioName: string | null;
  companyName: string;
  date: DateDto;
  elapsedMonths: number | null;
  cash: number;
  corporateValue: number;
  goalsAchieved: number;
  goalsTotal: number;
  outcomeStatus: 'playing' | 'won' | 'lost';
  createdAtIso: string;
  /** Epoch ms of the last write (listing order). */
  updatedAt: number;
  playTimeSec: number;
  rawBytes: number;
  compressedBytes: number;
  formatVersion: number;
  engineSchemaVersion: number;
  contentHash: string | null;
  /** 320×180 WebP/JPEG data URL of the city at save time (may be null). */
  thumbnail: string | null;
}

/** Presentation state stored next to the engine data (not part of the engine save). */
export interface UiSidecar {
  version: 1;
  history?: MonthRecord[];
  tutorial?: TutorialPersisted;
  /** Active city in the view when saved. */
  cityId?: string | null;
}

export interface SaveContext {
  slotKind: SlotKind;
  label?: string | null;
  gameId: string;
  hud: HudModel;
  thumbnail?: string | null;
  playTimeSec?: number;
  sidecar?: UiSidecar;
}

export interface LoadedGame {
  snapshot: SnapshotDto;
  meta: SaveSlotMeta;
  sidecar: UiSidecar | null;
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}

export interface SaveStore {
  readonly backend: 'indexeddb' | 'memory' | 'worker';
  /** All slots, newest first. Never parses save bodies. */
  list(): Promise<SaveSlotMeta[]>;
  /** Serialises the current game into a slot (overwrites it). */
  save(slotId: string, ctx: SaveContext): Promise<SaveSlotMeta>;
  /** Loads a slot into the engine; resolves with the new HUD snapshot. */
  load(slotId: string): Promise<LoadedGame>;
  remove(slotId: string): Promise<void>;
  rename(slotId: string, label: string): Promise<SaveSlotMeta>;
  /** A downloadable file for the slot (`.magnate.json`). */
  exportSlot(slotId: string): Promise<{ blob: Blob; fileName: string }>;
  /** Imports an exported file (or a legacy engine JSON save) as a new manual slot. */
  importFile(file: Blob, fileName?: string): Promise<SaveSlotMeta>;
  estimate(): Promise<StorageEstimate | null>;
}

/** What a SaveStore needs from the engine (the bridge's string persistence, bridge-spec §5.12). */
export interface SaveEngine {
  saveGame(): Promise<SaveGameResult>;
  loadGame(data: string): Promise<SnapshotDto>;
}

export class SaveError extends Error {
  constructor(
    readonly code: 'not_found' | 'corrupt' | 'quota' | 'unavailable' | 'engine',
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

export const UI_SAVE_FORMAT = 'magnate.save';
export const UI_SAVE_FORMAT_VERSION = 1;

/** On-disk export / stored record body. */
export interface StoredSave {
  format: typeof UI_SAVE_FORMAT;
  formatVersion: number;
  meta: SaveSlotMeta;
  /** Engine save JSON (WorldSaveFile) as produced by the bridge `saveGame`. */
  data: string;
  sidecar: UiSidecar | null;
}
