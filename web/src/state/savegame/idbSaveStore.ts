// Main-thread SaveStore over IndexedDB (Wave 1). Uses the bridge's string
// saveGame/loadGame; Wave 2 replaces this with the worker-side binary store
// (bridge-spec §6.3) behind the same `SaveStore` interface.
//
// Database layout matches bridge-spec §6.3 so the worker can take it over:
//   DB `magnate`:  saveMeta (keyPath slotId) → SaveSlotMeta (listing, no bodies)
//                  saveData (key slotId)     → { format, formatVersion, data, sidecar }
//                  prefs    (reserved for client prefs)

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
  type UiSidecar,
} from './types';

const DB_NAME = 'magnate';
const META = 'saveMeta';
const DATA = 'saveData';
const PREFS = 'prefs';
const STORES = [META, DATA, PREFS] as const;

interface DataRecord {
  format: typeof UI_SAVE_FORMAT;
  formatVersion: number;
  data: string;
  sidecar: UiSidecar | null;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

function openAt(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'slotId' });
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA);
      if (!db.objectStoreNames.contains(PREFS)) db.createObjectStore(PREFS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new SaveError('unavailable', 'Close other Magnate tabs to update the save database.'));
  });
}

/** Opens the database at its current version, adding any missing stores (never downgrades). */
async function openDb(): Promise<IDBDatabase> {
  const db = await openAt();
  if (STORES.every((s) => db.objectStoreNames.contains(s))) return db;
  const next = db.version + 1;
  db.close();
  return openAt(next);
}

export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export class IdbSaveStore implements SaveStore {
  readonly backend = 'indexeddb' as const;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private persistRequested = false;

  constructor(private readonly engine: SaveEngine) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDb().then((db) => {
        // Another tab (or the worker) upgrading the schema: drop our handle and reopen next time.
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        return db;
      });
      this.dbPromise.catch(() => (this.dbPromise = null));
    }
    return this.dbPromise;
  }

  async list(): Promise<SaveSlotMeta[]> {
    const db = await this.db();
    const tx = db.transaction(META, 'readonly');
    const all = await request(tx.objectStore(META).getAll() as IDBRequest<SaveSlotMeta[]>);
    return sortSlots(all);
  }

  async save(slotId: string, ctx: SaveContext): Promise<SaveSlotMeta> {
    let result;
    try {
      result = await this.engine.saveGame();
    } catch (error) {
      throw new SaveError('engine', `The engine could not serialise the game: ${error instanceof Error ? error.message : String(error)}`);
    }
    const meta = buildMeta(slotId, result, ctx);
    await this.ensureRoom(meta.rawBytes);
    const record: DataRecord = { format: UI_SAVE_FORMAT, formatVersion: UI_SAVE_FORMAT_VERSION, data: result.data, sidecar: ctx.sidecar ?? null };
    await this.write(meta, record);
    this.requestPersistence();
    return meta;
  }

  async load(slotId: string): Promise<LoadedGame> {
    const db = await this.db();
    const tx = db.transaction([META, DATA], 'readonly');
    const [meta, record] = await Promise.all([
      request(tx.objectStore(META).get(slotId) as IDBRequest<SaveSlotMeta | undefined>),
      request(tx.objectStore(DATA).get(slotId) as IDBRequest<DataRecord | Blob | undefined>),
    ]);
    if (!meta || !record) throw new SaveError('not_found', 'That save no longer exists.');
    if (record instanceof Blob) {
      // A worker-written binary save (Wave 2) — only the worker store can read it.
      throw new SaveError('unavailable', 'This save was written by a newer storage format.');
    }
    if (typeof record.data !== 'string' || record.data.length === 0) throw new SaveError('corrupt', 'This save is empty or damaged.');
    let snapshot;
    try {
      snapshot = await this.engine.loadGame(record.data);
    } catch (error) {
      throw new SaveError('corrupt', `This save could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { snapshot, meta, sidecar: record.sidecar ?? null };
  }

  async remove(slotId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([META, DATA], 'readwrite');
    tx.objectStore(META).delete(slotId);
    tx.objectStore(DATA).delete(slotId);
    await done(tx);
  }

  async rename(slotId: string, label: string): Promise<SaveSlotMeta> {
    const db = await this.db();
    const tx = db.transaction(META, 'readwrite');
    const store = tx.objectStore(META);
    const meta = await request(store.get(slotId) as IDBRequest<SaveSlotMeta | undefined>);
    if (!meta) throw new SaveError('not_found', 'That save no longer exists.');
    const next = { ...meta, label: label.trim() || null };
    store.put(next);
    await done(tx);
    return next;
  }

  async exportSlot(slotId: string): Promise<{ blob: Blob; fileName: string }> {
    const db = await this.db();
    const tx = db.transaction([META, DATA], 'readonly');
    const [meta, record] = await Promise.all([
      request(tx.objectStore(META).get(slotId) as IDBRequest<SaveSlotMeta | undefined>),
      request(tx.objectStore(DATA).get(slotId) as IDBRequest<DataRecord | undefined>),
    ]);
    if (!meta || !record || typeof record.data !== 'string') throw new SaveError('not_found', 'That save no longer exists.');
    const stored: StoredSave = { format: UI_SAVE_FORMAT, formatVersion: UI_SAVE_FORMAT_VERSION, meta, data: record.data, sidecar: record.sidecar ?? null };
    return toExportFile(stored);
  }

  async importFile(file: Blob, fileName?: string): Promise<SaveSlotMeta> {
    const parsed = parseImport(await file.text(), fileName);
    const meta: SaveSlotMeta = { ...parsed.meta, slotId: slotIds.manual(), slotKind: 'manual', updatedAt: Date.now() };
    await this.ensureRoom(meta.rawBytes);
    await this.write(meta, { format: UI_SAVE_FORMAT, formatVersion: UI_SAVE_FORMAT_VERSION, data: parsed.data, sidecar: parsed.sidecar });
    return meta;
  }

  async estimate(): Promise<StorageEstimate | null> {
    try {
      const est = await navigator.storage?.estimate?.();
      if (!est) return null;
      return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
    } catch {
      return null;
    }
  }

  private async write(meta: SaveSlotMeta, record: DataRecord): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([META, DATA], 'readwrite');
    tx.objectStore(META).put(meta);
    tx.objectStore(DATA).put(record, meta.slotId);
    try {
      await done(tx);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'QuotaExceededError') throw new SaveError('quota', 'Not enough browser storage for this save. Delete old saves and try again.');
      throw error;
    }
  }

  /** bridge-spec §6.3: fail early when free space < 3 × the save size. */
  private async ensureRoom(bytes: number): Promise<void> {
    const est = await this.estimate();
    if (!est || !Number.isFinite(est.quota) || est.quota <= 0) return;
    if (est.quota - est.usage < bytes * 3) {
      throw new SaveError('quota', 'Not enough browser storage for this save. Delete old saves and try again.');
    }
  }

  private requestPersistence(): void {
    if (this.persistRequested) return;
    this.persistRequested = true;
    try {
      void navigator.storage?.persist?.();
    } catch {
      /* best effort */
    }
  }
}
