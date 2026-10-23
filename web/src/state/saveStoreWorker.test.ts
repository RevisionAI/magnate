import { describe, expect, it } from 'vitest';
import { EngineError, type ExportedSave, type LoadedSlot } from '@/bridge/engine';
import type { SaveArgs, SnapshotDto } from '@/bridge/protocol';
import type { LegacySlot, SlotRecord, SlotUiInfo, StoredSlot } from '@/bridge/workerProtocol';
import { toHudModel } from './hud';
import { createSaveStore } from './savegame';
import { SaveError } from './savegame/types';
import { WorkerSaveStore, sidecarOf, toSaveError, toSlotMeta, workerSavesAvailable, type WorkerSaveBackend } from './saveStoreWorker';

const snapshot = { date: { year: 2027, month: 4 }, monthIndex: 15, playerId: 1, revision: 3, companies: [] } as unknown as SnapshotDto;

function stored(over: Partial<StoredSlot> = {}): StoredSlot {
  return {
    formatVersion: 1,
    engineSchemaVersion: 10,
    gameId: 'g1',
    scenarioId: 'tutorial',
    scenarioName: 'Tutorial',
    companyName: 'Acme',
    date: { year: 2027, month: 4 },
    elapsedMonths: 15,
    cash: 9e6,
    startingCapital: 15e6,
    corporateValue: 12e6,
    buildingsByCategory: [],
    topProducts: [],
    goalsAchieved: 1,
    goalsTotal: 5,
    outcomeStatus: 'playing',
    contentHash: 'abc',
    slotKind: 'manual',
    rawBytes: 1000,
    compressedBytes: 200,
    slotId: 'm-1',
    updatedAt: 1_700_000_000_000,
    playTimeSec: 60,
    thumbnail: null,
    storage: 'binary',
    ...over,
  };
}

/** An in-memory stand-in for EngineClient's save API. */
function fakeBackend() {
  const slots = new Map<string, { record: StoredSlot; client: string | null }>();
  const calls: { args: SaveArgs; options: { slotId?: string; ui?: SlotUiInfo } | undefined }[] = [];
  const backend: WorkerSaveBackend = {
    capabilities: { binarySaves: true, indexedDb: true },
    async listSaves() {
      return [...slots.values()].map((s) => s.record);
    },
    async saveToSlot(args, options) {
      calls.push({ args, options });
      if (args.label === 'full') throw new EngineError('storage_quota', 'no room', 'saveSlot');
      const record = stored({ slotId: options?.slotId ?? 'm-new', slotKind: args.slotKind ?? 'manual', label: args.label, thumbnail: options?.ui?.thumbnail ?? null, playTimeSec: options?.ui?.playTimeSec ?? 0 });
      slots.set(record.slotId, { record, client: args.client ?? null });
      return record;
    },
    async loadSlot(slotId): Promise<LoadedSlot> {
      const slot = slots.get(slotId);
      if (!slot) throw new EngineError('save_not_found', 'gone', 'loadGame');
      return { snapshot, slot: slot.record, client: slot.client, contentChanged: false };
    },
    async deleteSave(slotId) {
      slots.delete(slotId);
      return null;
    },
    async renameSave(slotId, label): Promise<SlotRecord> {
      const slot = slots.get(slotId)!;
      slot.record = { ...slot.record, label: label ?? undefined };
      return slot.record;
    },
    async exportSave(): Promise<ExportedSave> {
      return { fileName: 'acme-2027-04.magnate', mimeType: 'application/gzip', bytes: 3, data: new Uint8Array([0x1f, 0x8b, 0]).buffer };
    },
    async importSave(bytes, fileName) {
      if (bytes.byteLength === 0) throw new EngineError('save_content_mismatch', 'missing', 'importSave', undefined, { missing: ['product:nope'] });
      const record = stored({ slotId: 'm-imported', label: fileName });
      slots.set(record.slotId, { record, client: null });
      return record;
    },
    async storageEstimate() {
      return { usage: 10, quota: 100 };
    },
  };
  return { backend, slots, calls };
}

describe('WorkerSaveStore', () => {
  it('is selected only when the worker has binary saves', () => {
    const { backend } = fakeBackend();
    const engine = { saveGame: async () => ({}) as never, loadGame: async () => snapshot };
    expect(createSaveStore({ ...engine, worker: backend }).backend).toBe('worker');
    expect(workerSavesAvailable({ ...backend, capabilities: { binarySaves: false, indexedDb: true } })).toBe(false);
    expect(createSaveStore({ ...engine, worker: { ...backend, capabilities: { binarySaves: false, indexedDb: true } } }).backend).not.toBe('worker');
    expect(createSaveStore(engine).backend).not.toBe('worker');
  });

  it('saves the UI sidecar, thumbnail and play time as the client document and restores the sidecar on load', async () => {
    const { backend, calls } = fakeBackend();
    const store = new WorkerSaveStore(backend);
    const meta = await store.save('quick-g1', {
      slotKind: 'quicksave',
      label: '  Q  ',
      gameId: 'g1',
      hud: toHudModel(snapshot),
      thumbnail: 'data:image/webp;base64,AA',
      playTimeSec: 125.4,
      sidecar: { version: 1, cityId: 'hilltown' },
    });
    expect(calls[0].options).toEqual({ slotId: 'quick-g1', ui: { thumbnail: 'data:image/webp;base64,AA', playTimeSec: 125.4 } });
    expect(calls[0].args.slotKind).toBe('quicksave');
    expect(calls[0].args.label).toBe('Q');
    expect(JSON.parse(calls[0].args.client!)).toEqual({ version: 1, sidecar: { version: 1, cityId: 'hilltown' }, thumbnail: 'data:image/webp;base64,AA', playTimeSec: 125 });
    expect(meta.slotId).toBe('quick-g1');
    expect(meta.slotKind).toBe('quicksave');
    expect(meta.thumbnail).toBe('data:image/webp;base64,AA');

    const loaded = await store.load('quick-g1');
    expect(loaded.snapshot).toBe(snapshot);
    expect(loaded.sidecar).toEqual({ version: 1, cityId: 'hilltown' });
    expect(loaded.meta.label).toBe('Q');
  });

  it('lists, renames, deletes, exports and imports through the worker', async () => {
    const { backend } = fakeBackend();
    const store = new WorkerSaveStore(backend);
    await store.save('m-a', { slotKind: 'manual', gameId: 'g1', hud: toHudModel(snapshot) });
    expect((await store.list()).map((m) => m.slotId)).toEqual(['m-a']);
    expect((await store.rename('m-a', '  Big plans ')).label).toBe('Big plans');
    const file = await store.exportSlot('m-a');
    expect(file.fileName).toBe('acme-2027-04.magnate');
    expect(file.blob.type).toBe('application/gzip');
    expect(file.blob.size).toBe(3);
    const imported = await store.importFile(new Blob([new Uint8Array([1, 2, 3])]), 'old.json');
    expect(imported.slotId).toBe('m-imported');
    await store.remove('m-a');
    expect((await store.list()).map((m) => m.slotId)).toEqual(['m-imported']);
    expect(await store.estimate()).toEqual({ usage: 10, quota: 100 });
  });

  it('turns engine and storage failures into player-facing SaveErrors', async () => {
    const { backend } = fakeBackend();
    const store = new WorkerSaveStore(backend);
    await expect(store.load('nope')).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.save('m-x', { slotKind: 'manual', label: 'full', gameId: 'g', hud: toHudModel(snapshot) })).rejects.toMatchObject({ code: 'quota' });
    const error = await store.importFile(new Blob([]), 'empty.magnate').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SaveError);
    expect((error as SaveError).code).toBe('corrupt');
    expect((error as SaveError).message).toContain('product:nope');
    expect(toSaveError(new EngineError('save_version_unsupported', 'newer', 'loadGame'), 'load').code).toBe('corrupt');
    expect(toSaveError(new EngineError('storage_unavailable', 'no idb', 'listSaves'), 'other').code).toBe('unavailable');
    expect(toSaveError(new Error('boom'), 'other').code).toBe('engine');
  });
});

describe('record mapping', () => {
  it('maps binary records and Wave-1 records to the UI listing', () => {
    const meta = toSlotMeta(stored({ label: undefined, scenarioId: undefined, contentHash: '', createdAtIso: undefined }));
    expect(meta.label).toBeNull();
    expect(meta.scenarioId).toBeNull();
    expect(meta.contentHash).toBeNull();
    expect(meta.createdAtIso).toBe(new Date(1_700_000_000_000).toISOString());

    const legacy: LegacySlot = {
      slotId: 'm-old',
      slotKind: 'manual',
      label: 'Old',
      gameId: 'g0',
      scenarioId: null,
      scenarioName: null,
      companyName: 'Acme',
      date: { year: 2026, month: 3 },
      elapsedMonths: null,
      cash: 1,
      corporateValue: 0,
      goalsAchieved: 0,
      goalsTotal: 0,
      outcomeStatus: 'playing',
      createdAtIso: '2026-10-01T00:00:00.000Z',
      updatedAt: 5,
      playTimeSec: 3,
      rawBytes: 10,
      compressedBytes: 10,
      formatVersion: 1,
      engineSchemaVersion: 9,
      contentHash: null,
      thumbnail: null,
    };
    expect(toSlotMeta(legacy)).toEqual(legacy);
  });

  it('reads the UI sidecar out of a client document', () => {
    expect(sidecarOf('{"version":1,"sidecar":{"version":1,"cityId":"a"}}')).toEqual({ version: 1, cityId: 'a' });
    expect(sidecarOf('{"version":1,"sidecar":null}')).toBeNull();
    expect(sidecarOf('{"version":1,"sidecar":{"version":2}}')).toBeNull();
    expect(sidecarOf('garbage')).toBeNull();
    expect(sidecarOf(null)).toBeNull();
  });
});
