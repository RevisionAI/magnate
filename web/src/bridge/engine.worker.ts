/// <reference lib="webworker" />
// Hosts the .NET WebAssembly runtime (C# engine + bridge) off the main thread so
// month ticks, AI planning and saves never stall rendering, and owns the
// IndexedDB save store (bridge-spec §6.3): a 10-year game is serialised, gzipped
// (inside .NET) and written to IndexedDB without ever crossing to the main thread,
// which only receives the slot's listing record.
//
// Protocol: see workerProtocol.ts. Requests are handled strictly one after another
// (each waits for the previous, including its IndexedDB work), so the main thread
// sees results in request order.

import { uuid } from '@/util/random';
import type { InspectResultDto } from './protocol';
import {
  SaveDb,
  StoreError,
  bodyBytes,
  clientInfo,
  estimateStorage,
  exportFileName,
  gzip,
  hasRoom,
  indexedDbAvailable,
  isGzip,
  isStoredSlot,
  labelFromFileName,
  legacyClient,
  nextAutosaveSlot,
  parseUiExport,
  resolveSlotId,
  sniffImport,
} from './saveDb';
import type {
  BootStage,
  ExportResult,
  LoadExtra,
  SlotUiInfo,
  StoredSlot,
  WorkerCapabilities,
  WorkerRequest,
  WorkerResponse,
} from './workerProtocol';
import type { LoadArgs, SaveArgs, SaveMetaDto } from './protocol';

/** The [JSExport]s of web/engine-host/Program.cs. */
interface MagnateInterop {
  Boot(): string;
  Call(method: string, argsJson: string): string;
  /** gzip(web save envelope) for SaveArgs JSON; empty on failure (see LastError). */
  SaveBinary(argsJson: string): Uint8Array;
  /** SaveMetaDto envelope for the save SaveBinary would write. */
  SaveMeta(argsJson: string): string;
  /** loadGame envelope (SnapshotDto) for gzip or plain save bytes. */
  LoadBinary(data: Uint8Array, argsJson: string): string;
  /** InspectResultDto envelope. */
  InspectSave(data: Uint8Array): string;
  /** Error envelope of the last failed SaveBinary, or "null". */
  LastError(): string;
  /** SaveMetaDto JSON of the last successful SaveBinary, or "null" (absent on pre-B2 engine builds). */
  LastSaveMeta?(): string;
}

declare const self: DedicatedWorkerGlobalScope;

let interop: MagnateInterop | null = null;
let contentHash = '';
let autosaveOnDue = false;
const db = new SaveDb();

function reply(message: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function progress(stage: BootStage): void {
  reply({ id: 0, kind: 'bootProgress', stage });
}

/** `{ok:true,result}` — the envelope shape EngineClient unwraps (no revision: storage does not change the game). */
function ok(result: unknown): string {
  return JSON.stringify({ ok: true, result: result ?? null });
}

function fail(code: string, message: string): string {
  return JSON.stringify({ ok: false, error: { code, message } });
}

function capabilities(): WorkerCapabilities {
  const idb = indexedDbAvailable();
  return {
    indexedDb: idb,
    binarySaves: !!interop && idb && typeof interop.SaveBinary === 'function' && typeof interop.LastSaveMeta === 'function',
  };
}

async function boot(frameworkUrl: string): Promise<string> {
  progress('runtime');
  // The main thread resolves _framework/ against the *page* URL (the worker's
  // own URL lives under assets/), so the build works from any sub-path.
  const dotnetUrl = new URL('dotnet.js', frameworkUrl).href;
  const { dotnet } = (await import(/* @vite-ignore */ dotnetUrl)) as {
    dotnet: {
      withDiagnosticTracing(on: boolean): typeof dotnet;
      create(): Promise<{
        getConfig(): { mainAssemblyName: string };
        getAssemblyExports(name: string): Promise<{ MagnateInterop: MagnateInterop }>;
      }>;
    };
  };
  const runtime = await dotnet.withDiagnosticTracing(false).create();
  const exports = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);
  interop = exports.MagnateInterop;
  progress('content');
  const payload = interop.Boot();
  try {
    const envelope = JSON.parse(payload) as { ok: boolean; result?: { contentHash?: string } };
    contentHash = envelope.result?.contentHash ?? '';
  } catch {
    /* the client reports a malformed init */
  }
  progress('ready');
  return payload;
}

function engine(): MagnateInterop {
  if (!interop) throw new Error('engine not booted');
  return interop;
}

function requireBinarySaves(): MagnateInterop {
  const api = engine();
  if (!capabilities().binarySaves) {
    throw new StoreError('storage_unavailable', indexedDbAvailable() ? 'This engine build cannot write binary saves.' : 'Browser storage is unavailable, so games cannot be saved.');
  }
  return api;
}

async function ensureRoom(bytes: number): Promise<void> {
  if (!hasRoom(await estimateStorage(), bytes)) {
    throw new StoreError('storage_quota', 'Not enough browser storage for this save. Delete old saves and try again.');
  }
}

/**
 * Serialise the game (gzip in .NET) into a slot. Returns the envelope payload: the
 * `StoredSlot` on success, the bridge's error envelope when the engine refused.
 */
async function saveToSlot(requestedSlot: string | undefined, args: SaveArgs, ui: SlotUiInfo | undefined): Promise<string> {
  const api = requireBinarySaves();
  const records = args.slotKind === 'autosave' && !requestedSlot ? await db.list() : [];
  const slotId = resolveSlotId(args.slotKind, requestedSlot, records, uuid);
  const bytes = api.SaveBinary(JSON.stringify(args));
  if (!bytes || bytes.length === 0) return api.LastError();
  const meta = JSON.parse(api.LastSaveMeta!()) as SaveMetaDto | null;
  if (!meta) throw new Error('the engine returned no save metadata');
  const fromClient = clientInfo(args.client);
  const record: StoredSlot = {
    ...meta,
    slotId,
    updatedAt: Date.now(),
    playTimeSec: Math.max(0, Math.round(ui?.playTimeSec ?? fromClient.playTimeSec)),
    thumbnail: ui?.thumbnail ?? fromClient.thumbnail,
    storage: 'binary',
  };
  await ensureRoom(bytes.length);
  // Copy out of the .NET-marshalled view before the next engine call can reuse its memory.
  await db.put(record, bytes.slice(), args.client ?? null);
  return ok(record);
}

async function load(slotId: string, expectedGameId: string | undefined): Promise<{ payload: string; extra?: string }> {
  const api = engine();
  const { record, data, client } = await db.get(slotId);
  const bytes = await bodyBytes(data);
  // Slots in this store were written by the bridge or checked by InspectSave on import.
  const args: LoadArgs = { trustContent: true, ...(expectedGameId ? { expectedGameId } : {}) };
  const payload = api.LoadBinary(bytes, JSON.stringify(args));
  const extra: LoadExtra = {
    slot: record,
    client: isStoredSlot(record) ? client : legacyClient(record, data),
    contentChanged: !!record.contentHash && !!contentHash && record.contentHash !== contentHash,
  };
  if (extra.contentChanged) console.warn(`[saves] ${slotId} was written against other content files; ids were checked and it loaded`);
  return { payload, extra: JSON.stringify(extra) };
}

async function exportSlot(slotId: string): Promise<{ payload: string; binary: ArrayBuffer }> {
  const { record, data } = await db.get(slotId);
  let bytes = await bodyBytes(data);
  let fileName = exportFileName(record);
  if (!isGzip(bytes)) {
    // A Wave-1 slot holds plain JSON: ship it gzipped like every other export when possible.
    const packed = await gzip(bytes);
    if (packed) bytes = packed;
    else fileName = fileName.replace(/\.magnate$/, '.json');
  }
  const binary = bytes.buffer.byteLength === bytes.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
  const result: ExportResult = { fileName, mimeType: isGzip(bytes) ? 'application/gzip' : 'application/json', bytes: bytes.byteLength };
  return { payload: ok(result), binary };
}

async function importFile(buffer: ArrayBuffer, fileName: string | undefined, requestedSlot: string | undefined): Promise<string> {
  const api = requireBinarySaves();
  let bytes: Uint8Array = new Uint8Array(buffer);
  let client: string | null = null;
  // Label precedence: the Wave-1 export's own label, then the save's, then the file name.
  let wrapperLabel: string | null = null;
  switch (sniffImport(bytes)) {
    case 'unknown':
      throw new StoreError('save_corrupt', 'This file is not a Magnate save.');
    case 'uiExport': {
      const parsed = parseUiExport(new TextDecoder().decode(bytes));
      bytes = new TextEncoder().encode(parsed.data);
      client = JSON.stringify(parsed.client);
      wrapperLabel = parsed.label;
      break;
    }
    default:
      break;
  }
  const envelope = api.InspectSave(bytes);
  const inspected = JSON.parse(envelope) as { ok: boolean; result?: InspectResultDto };
  if (!inspected.ok || !inspected.result) return envelope;
  const { meta, loadable, problem } = inspected.result;
  if (!loadable) {
    return problem === 'save_version_unsupported'
      ? fail('save_version_unsupported', 'This save was made by an incompatible version of Magnate.')
      : fail(problem ?? 'save_content_mismatch', 'This save uses content that is not installed.');
  }
  client ??= inspected.result.client ?? null;
  const stored = isGzip(bytes) ? bytes : ((await gzip(bytes)) ?? bytes);
  const info = clientInfo(client);
  const now = Date.now();
  const record: StoredSlot = {
    ...meta,
    slotId: requestedSlot?.trim() || `m-${uuid()}`,
    // An imported autosave or quicksave must not join this browser's rotation.
    slotKind: 'manual',
    label: wrapperLabel ?? meta.label ?? labelFromFileName(fileName) ?? undefined,
    createdAtIso: meta.createdAtIso ?? new Date(now).toISOString(),
    compressedBytes: stored.byteLength,
    updatedAt: now,
    playTimeSec: Math.round(info.playTimeSec),
    thumbnail: info.thumbnail,
    storage: 'binary',
  };
  if (record.label === undefined) delete record.label;
  await ensureRoom(stored.byteLength);
  await db.put(record, stored, client);
  return ok(record);
}

/** Worker-driven autosave after an `advance` that reported `autosaveDue` (opt-in, §6.3). */
async function autosave(): Promise<void> {
  let payload: string;
  try {
    const records = await db.list();
    payload = await saveToSlot(nextAutosaveSlot(records), { slotKind: 'autosave', createdAtIso: new Date().toISOString() }, undefined);
  } catch (error) {
    payload = error instanceof StoreError ? fail(error.code, error.message) : fail('internal', describe(error));
  }
  reply({ id: 0, kind: 'autosaved', payload });
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function handle(request: WorkerRequest): Promise<void> {
  const started = performance.now();
  const answer = (payload: string, more: { binary?: ArrayBuffer; extra?: string } = {}) =>
    reply(
      { id: request.id, ok: true, payload, elapsedMs: performance.now() - started, ...(more.binary ? { binary: more.binary } : {}), ...(more.extra ? { extra: more.extra } : {}) },
      more.binary ? [more.binary] : [],
    );
  try {
    switch (request.kind) {
      case 'boot': {
        const payload = await boot(request.frameworkUrl);
        answer(payload, { extra: JSON.stringify(capabilities()) });
        return;
      }
      case 'call': {
        const payload = engine().Call(request.method, request.argsJson);
        answer(payload);
        if (autosaveOnDue && request.method === 'advance' && payload.includes('"autosaveDue":true')) await autosave();
        return;
      }
      case 'save':
        answer(await saveToSlot(request.slotId, request.args ?? {}, request.ui));
        return;
      case 'load': {
        const { payload, extra } = await load(request.slotId, request.expectedGameId);
        answer(payload, extra ? { extra } : {});
        return;
      }
      case 'listSaves':
        answer(ok(indexedDbAvailable() ? await db.list() : []));
        return;
      case 'deleteSave':
        await db.remove(request.slotId);
        answer(ok(null));
        return;
      case 'renameSave':
        answer(ok(await db.rename(request.slotId, request.label)));
        return;
      case 'exportSave': {
        const { payload, binary } = await exportSlot(request.slotId);
        answer(payload, { binary });
        return;
      }
      case 'importSave':
        answer(await importFile(request.bytes, request.fileName, request.slotId));
        return;
      case 'storageEstimate':
        answer(ok(await estimateStorage()));
        return;
      case 'configureSaves':
        autosaveOnDue = !!request.autosaveOnDue;
        answer(ok({ autosaveOnDue }));
        return;
    }
  } catch (error) {
    if (error instanceof StoreError) {
      answer(fail(error.code, error.message));
      return;
    }
    reply({ id: request.id, ok: false, error: describe(error) });
  }
}

// One request at a time, in arrival order (see the header).
let queue: Promise<void> = Promise.resolve();
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  queue = queue.then(() => handle(request)).catch((error) => console.error('[engine worker] request failed', error));
};
