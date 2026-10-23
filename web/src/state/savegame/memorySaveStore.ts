// In-memory SaveStore: the fallback when IndexedDB is unavailable (some private
// windows) and the backend for unit tests. Same semantics as the IndexedDB one.

import { buildMeta, parseImport, slotIds, sortSlots, toExportFile } from './meta';
import {
  SaveError,
  UI_SAVE_FORMAT,
  UI_SAVE_FORMAT_VERSION,
  type LoadedGame,
  type SaveContext,
  type SaveEngine,
  type SaveSlotMeta,
  type SaveStore,
  type StorageEstimate,
  type StoredSave,
} from './types';

export class MemorySaveStore implements SaveStore {
  readonly backend = 'memory' as const;
  private readonly saves = new Map<string, StoredSave>();

  constructor(private readonly engine: SaveEngine) {}

  async list(): Promise<SaveSlotMeta[]> {
    return sortSlots([...this.saves.values()].map((s) => s.meta));
  }

  async save(slotId: string, ctx: SaveContext): Promise<SaveSlotMeta> {
    const result = await this.engine.saveGame();
    const meta = buildMeta(slotId, result, ctx);
    this.saves.set(slotId, { format: UI_SAVE_FORMAT, formatVersion: UI_SAVE_FORMAT_VERSION, meta, data: result.data, sidecar: ctx.sidecar ?? null });
    return meta;
  }

  async load(slotId: string): Promise<LoadedGame> {
    const stored = this.saves.get(slotId);
    if (!stored) throw new SaveError('not_found', 'That save no longer exists.');
    const snapshot = await this.engine.loadGame(stored.data);
    return { snapshot, meta: stored.meta, sidecar: stored.sidecar };
  }

  async remove(slotId: string): Promise<void> {
    this.saves.delete(slotId);
  }

  async rename(slotId: string, label: string): Promise<SaveSlotMeta> {
    const stored = this.saves.get(slotId);
    if (!stored) throw new SaveError('not_found', 'That save no longer exists.');
    const meta = { ...stored.meta, label: label.trim() || null };
    this.saves.set(slotId, { ...stored, meta });
    return meta;
  }

  async exportSlot(slotId: string): Promise<{ blob: Blob; fileName: string }> {
    const stored = this.saves.get(slotId);
    if (!stored) throw new SaveError('not_found', 'That save no longer exists.');
    return toExportFile(stored);
  }

  async importFile(file: Blob, fileName?: string): Promise<SaveSlotMeta> {
    const parsed = parseImport(await file.text(), fileName);
    const slotId = slotIds.manual();
    const meta: SaveSlotMeta = { ...parsed.meta, slotId, slotKind: 'manual', updatedAt: Date.now() };
    this.saves.set(slotId, { ...parsed, meta });
    return meta;
  }

  async estimate(): Promise<StorageEstimate | null> {
    let usage = 0;
    for (const s of this.saves.values()) usage += s.data.length * 2;
    return { usage, quota: Infinity };
  }
}
