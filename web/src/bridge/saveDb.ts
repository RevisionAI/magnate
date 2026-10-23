// The worker-owned IndexedDB save store (bridge-spec §6.3, D17). Imported by
// engine.worker.ts only; the pure helpers at the top are unit-tested.
//
//   DB `magnate`:  saveMeta   (keyPath slotId) → StoredSlot | LegacySlot   listing records, no bodies
//                  saveData   (key slotId)     → Blob (gzip web envelope) | Wave-1 {format, data, sidecar}
//                  saveClient (key slotId)     → string (ClientSaveDoc JSON)
//                  prefs      (reserved for client prefs)
//
// The layout is a superset of the Wave-1 main-thread store (state/savegame/
// idbSaveStore.ts), whose slots stay readable: the database is opened at its
// current version and only missing stores are added.

import type { ClientSaveDoc, LegacySlot, SlotRecord, StorageEstimateDto, StoredSlot } from './workerProtocol';

export const DB_NAME = 'magnate';
export const META = 'saveMeta';
export const DATA = 'saveData';
export const CLIENT = 'saveClient';
export const PREFS = 'prefs';
const STORES = [META, DATA, CLIENT, PREFS] as const;

/** Autosaves rotate through `auto-1..AUTOSAVE_SLOTS` (D17). */
export const AUTOSAVE_SLOTS = 3;
export const QUICK_SLOT = 'quick';

/** A storage-level failure, reported to the client as an error envelope with `code`. */
export class StoreError extends Error {
  constructor(
    readonly code: 'save_not_found' | 'storage_quota' | 'storage_unavailable' | 'save_corrupt' | 'save_content_mismatch' | 'invalid_argument',
    message: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

// ------------------------------------------------------------------ pure helpers

export function isStoredSlot(record: SlotRecord): record is StoredSlot {
  return record.storage === 'binary';
}

/** Newest first; ties by slot id so the order is stable. */
export function sortRecords<T extends { updatedAt: number; slotId: string }>(records: readonly T[]): T[] {
  return [...records].sort((a, b) => b.updatedAt - a.updatedAt || (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
}

/** The autosave slot to write next: the first unused `auto-N`, else the least recently written. */
export function nextAutosaveSlot(records: readonly Pick<SlotRecord, 'slotId' | 'updatedAt'>[]): string {
  const written = new Map(records.filter((r) => /^auto-\d+$/.test(r.slotId)).map((r) => [r.slotId, r.updatedAt]));
  let oldest = 'auto-1';
  let oldestAt = Infinity;
  for (let n = 1; n <= AUTOSAVE_SLOTS; n++) {
    const id = `auto-${n}`;
    const at = written.get(id);
    if (at === undefined) return id;
    if (at < oldestAt) {
      oldest = id;
      oldestAt = at;
    }
  }
  return oldest;
}

/** The slot a `save` request writes: the requested id, else one chosen by kind. */
export function resolveSlotId(
  slotKind: string | undefined,
  requested: string | undefined,
  records: readonly Pick<SlotRecord, 'slotId' | 'updatedAt'>[],
  newId: () => string,
): string {
  if (requested && requested.trim()) return requested.trim();
  if (slotKind === 'autosave') return nextAutosaveSlot(records);
  if (slotKind === 'quicksave') return QUICK_SLOT;
  return `m-${newId()}`;
}

/** `<company>-<YYYY-MM>.magnate` (bridge-spec §6.3 export). */
export function exportFileName(record: Pick<SlotRecord, 'companyName' | 'date'>): string {
  const company =
    record.companyName
      .normalize('NFKD')
      .replace(/[^\w-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'magnate';
  return `${company}-${record.date.year}-${String(record.date.month).padStart(2, '0')}.magnate`;
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * What an imported file is, from its first bytes: gzip (a `.magnate` web save or a
 * `.json.gz`), the Wave-1 UI export (`{"format":"magnate.save",…}` with the engine
 * save as a string), or plain JSON for the bridge (web envelope or legacy engine save).
 */
export function sniffImport(bytes: Uint8Array): 'gzip' | 'uiExport' | 'json' | 'unknown' {
  if (isGzip(bytes)) return 'gzip';
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3; // UTF-8 BOM
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++;
  if (bytes[i] !== 0x7b /* { */) return 'unknown';
  const head = new TextDecoder().decode(bytes.subarray(i, Math.min(bytes.length, i + 512)));
  return /"format"\s*:\s*"magnate\.save"/.test(head) ? 'uiExport' : 'json';
}

/** The engine-save text and client document inside a Wave-1 UI export (`magnate.save` v1). */
export function parseUiExport(text: string): { data: string; client: ClientSaveDoc; label: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StoreError('save_corrupt', 'This file is not a Magnate save (it is not valid JSON).');
  }
  const obj = parsed as { format?: string; formatVersion?: number; data?: unknown; sidecar?: unknown; meta?: { thumbnail?: unknown; playTimeSec?: unknown; label?: unknown } };
  if (obj?.format !== 'magnate.save' || typeof obj.data !== 'string' || obj.data.length === 0) {
    throw new StoreError('save_corrupt', 'This file is not a Magnate save.');
  }
  if ((obj.formatVersion ?? 1) > 1) throw new StoreError('save_corrupt', 'This save was made by a newer version of Magnate.');
  const meta = obj.meta ?? {};
  return {
    data: obj.data,
    client: {
      version: 1,
      sidecar: obj.sidecar ?? null,
      thumbnail: typeof meta.thumbnail === 'string' ? meta.thumbnail : null,
      playTimeSec: typeof meta.playTimeSec === 'number' && Number.isFinite(meta.playTimeSec) ? meta.playTimeSec : 0,
    },
    label: typeof meta.label === 'string' && meta.label.trim() ? meta.label.trim() : null,
  };
}

/** The listing bits of a client document (tolerant: anything malformed reads as absent). */
export function clientInfo(clientJson: string | null | undefined): { thumbnail: string | null; playTimeSec: number } {
  if (!clientJson) return { thumbnail: null, playTimeSec: 0 };
  try {
    const doc = JSON.parse(clientJson) as Partial<ClientSaveDoc> | null;
    return {
      thumbnail: typeof doc?.thumbnail === 'string' ? doc.thumbnail : null,
      playTimeSec: typeof doc?.playTimeSec === 'number' && Number.isFinite(doc.playTimeSec) ? Math.max(0, doc.playTimeSec) : 0,
    };
  } catch {
    return { thumbnail: null, playTimeSec: 0 };
  }
}

/** bridge-spec §6.3: refuse a write unless free space ≥ 3 × its size. Unknown quota passes. */
export function hasRoom(estimate: StorageEstimateDto | null, bytes: number): boolean {
  if (!estimate || !Number.isFinite(estimate.quota) || estimate.quota <= 0) return true;
  return estimate.quota - estimate.usage >= bytes * 3;
}

/** A file name without its save extensions, as an import label. */
export function labelFromFileName(fileName: string | undefined): string | null {
  if (!fileName) return null;
  const base = fileName.replace(/^.*[\\/]/, '').replace(/(\.magnate)?(\.json)?(\.gz)?$/i, '').trim();
  return base || null;
}

// ------------------------------------------------------------------ gzip (Compression Streams API)

/** gzip in the worker (native, off the .NET heap); null when the API is missing. */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ------------------------------------------------------------------ IndexedDB

/** What `saveData` holds for one slot. */
export type DataRecord = Blob | { format: string; formatVersion?: number; data: string; sidecar?: unknown };

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
      if (!db.objectStoreNames.contains(CLIENT)) db.createObjectStore(CLIENT);
      if (!db.objectStoreNames.contains(PREFS)) db.createObjectStore(PREFS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new StoreError('storage_unavailable', 'Close other Magnate tabs to update the save database.'));
  });
}

export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function asQuota(error: unknown): unknown {
  const name = error instanceof DOMException ? error.name : '';
  return name === 'QuotaExceededError'
    ? new StoreError('storage_quota', 'Not enough browser storage for this save. Delete old saves and try again.')
    : error;
}

/** The save database, opened lazily and reopened after another tab upgrades it. */
export class SaveDb {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      const opening = (async () => {
        if (!indexedDbAvailable()) throw new StoreError('storage_unavailable', 'Browser storage is unavailable, so games cannot be saved.');
        let db = await openAt();
        if (!STORES.every((s) => db.objectStoreNames.contains(s))) {
          const next = db.version + 1;
          db.close();
          db = await openAt(next);
        }
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        return db;
      })();
      this.dbPromise = opening;
      opening.catch(() => {
        if (this.dbPromise === opening) this.dbPromise = null;
      });
    }
    return this.dbPromise;
  }

  async list(): Promise<SlotRecord[]> {
    const db = await this.db();
    const all = await request(db.transaction(META, 'readonly').objectStore(META).getAll() as IDBRequest<SlotRecord[]>);
    return sortRecords(all.filter((r) => r && typeof r.slotId === 'string'));
  }

  async get(slotId: string): Promise<{ record: SlotRecord; data: DataRecord; client: string | null }> {
    const db = await this.db();
    const tx = db.transaction([META, DATA, CLIENT], 'readonly');
    const [record, data, client] = await Promise.all([
      request(tx.objectStore(META).get(slotId) as IDBRequest<SlotRecord | undefined>),
      request(tx.objectStore(DATA).get(slotId) as IDBRequest<DataRecord | undefined>),
      request(tx.objectStore(CLIENT).get(slotId) as IDBRequest<string | undefined>),
    ]);
    if (!record || !data) throw new StoreError('save_not_found', 'That save no longer exists.');
    return { record, data, client: typeof client === 'string' ? client : null };
  }

  async getRecord(slotId: string): Promise<SlotRecord | undefined> {
    const db = await this.db();
    return request(db.transaction(META, 'readonly').objectStore(META).get(slotId) as IDBRequest<SlotRecord | undefined>);
  }

  /** Write one slot atomically (listing record, body, client document). */
  async put(record: StoredSlot, body: Uint8Array, client: string | null): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([META, DATA, CLIENT], 'readwrite');
    tx.objectStore(META).put(record);
    tx.objectStore(DATA).put(new Blob([body as BlobPart], { type: 'application/gzip' }), record.slotId);
    if (client) tx.objectStore(CLIENT).put(client, record.slotId);
    else tx.objectStore(CLIENT).delete(record.slotId);
    try {
      await done(tx);
    } catch (error) {
      throw asQuota(error);
    }
  }

  async remove(slotId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([META, DATA, CLIENT], 'readwrite');
    tx.objectStore(META).delete(slotId);
    tx.objectStore(DATA).delete(slotId);
    tx.objectStore(CLIENT).delete(slotId);
    await done(tx);
  }

  async rename(slotId: string, label: string | null): Promise<SlotRecord> {
    const db = await this.db();
    const tx = db.transaction(META, 'readwrite');
    const store = tx.objectStore(META);
    const record = await request(store.get(slotId) as IDBRequest<SlotRecord | undefined>);
    if (!record) throw new StoreError('save_not_found', 'That save no longer exists.');
    const trimmed = label?.trim() ? label.trim().slice(0, 80) : null;
    let next: SlotRecord;
    if (isStoredSlot(record)) {
      const { label: _previous, ...rest } = record;
      next = trimmed ? { ...rest, label: trimmed } : rest;
    } else {
      next = { ...record, label: trimmed };
    }
    store.put(next);
    await done(tx);
    return next;
  }
}

/** Quota as the worker sees it (`navigator.storage.estimate` is exposed to workers). */
export async function estimateStorage(): Promise<StorageEstimateDto | null> {
  try {
    const est = await (globalThis.navigator as Navigator | undefined)?.storage?.estimate?.();
    if (!est) return null;
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Body bytes of a stored slot: the gzip Blob, or the Wave-1 JSON string. */
export async function bodyBytes(data: DataRecord): Promise<Uint8Array> {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data && typeof data === 'object' && typeof data.data === 'string' && data.data.length > 0) return new TextEncoder().encode(data.data);
  throw new StoreError('save_corrupt', 'This save is empty or damaged.');
}

/** The client document of a Wave-1 slot (its UI sidecar and listing bits). */
export function legacyClient(record: LegacySlot, data: DataRecord): string | null {
  if (data instanceof Blob) return null;
  const doc: ClientSaveDoc = { version: 1, sidecar: data.sidecar ?? null, thumbnail: record.thumbnail ?? null, playTimeSec: record.playTimeSec ?? 0 };
  return JSON.stringify(doc);
}
