// Main-thread client for the C# engine running in a Web Worker.
//
//   const { client, init } = await EngineClient.boot();
//   const snap = await client.call('newGame', { scenarioId: 'tutorial' });
//   const off = client.onEnvelope(({ hud, events }) => { … });   // HUD + events from every call
//
// Calls are strictly serialized in the worker (the .NET runtime is
// single-threaded), so results arrive in request order. Identical in-flight
// queries (same method + args, no mutation in between) share one request.

import {
  MUTATING_METHODS,
  PROTOCOL_VERSION,
  type BridgeErrorCode,
  type Envelope,
  type ErrorDetails,
  type GameEventDto,
  type InitResult,
  type MethodArgs,
  type MethodName,
  type MethodResult,
  type SnapshotDto,
  type TickResultDto,
} from './protocol';
import {
  isPush,
  type BootStage,
  type ExportResult,
  type LoadExtra,
  type SlotRecord,
  type SlotUiInfo,
  type StorageEstimateDto,
  type StoredSlot,
  type WorkerCapabilities,
  type WorkerRequest,
  type WorkerResponse,
} from './workerProtocol';
import type { SaveArgs } from './protocol';

export class EngineError extends Error {
  readonly code: BridgeErrorCode;
  readonly method: string;
  /** The offending argument path, when the bridge named one (e.g. `price`, `at.px`). */
  readonly field: string | undefined;
  /** Typed context (amounts, ids, reasons) to render a message from `code`. */
  readonly details: ErrorDetails | undefined;

  constructor(code: BridgeErrorCode, message: string, method: string, field?: string, details?: ErrorDetails) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.method = method;
    this.field = field;
    this.details = details;
  }
}

type OkResponse = Extract<WorkerResponse, { ok: true }>;

interface Pending {
  method: string;
  resolve: (response: OkResponse) => void;
  reject: (error: Error) => void;
}

/** A slot loaded into the engine (`loadSlot`). The HUD is also published to `onEnvelope` listeners. */
export interface LoadedSlot extends Omit<LoadExtra, 'slot'> {
  snapshot: SnapshotDto;
  slot: SlotRecord;
}

/** An exported slot: the file bytes and the name to download them as. */
export interface ExportedSave extends ExportResult {
  data: ArrayBuffer;
}

export interface BootOptions {
  /** Boot stages as the worker reaches them (bridge-spec §6.1): runtime → content → ready. */
  onProgress?: (stage: BootStage) => void;
}

/** A worker-driven autosave finished (see `configureSaves`): the slot written, or why it failed. */
export type AutosaveListener = (result: { slot: StoredSlot } | { error: EngineError }) => void;

export interface CallStats {
  method: string;
  elapsedMs: number;
}

/**
 * What a successful call told us besides its result. `hud` is the fresh HUD
 * (from the envelope, or the snapshot embedded in `advance` / `newGame` /
 * `loadGame` / `setAutopilot` / `snapshot` results); `events` are the call's
 * game events (an `advance`'s tick events included), stamped and ordered.
 */
export interface EnvelopeInfo {
  method: string;
  revision: number;
  hud?: SnapshotDto;
  events: GameEventDto[];
}

export type EnvelopeListener = (info: EnvelopeInfo) => void;

/** Methods whose result is itself the HUD snapshot. */
const SNAPSHOT_RESULT_METHODS: ReadonlySet<string> = new Set(['newGame', 'loadGame', 'setAutopilot', 'snapshot']);

export class EngineClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly inflight = new Map<string, { epoch: number; promise: Promise<unknown> }>();
  private readonly listeners = new Set<EnvelopeListener>();
  private readonly autosaveListeners = new Set<AutosaveListener>();
  private progressListener: ((stage: BootStage) => void) | null = null;
  private _capabilities: WorkerCapabilities = { binarySaves: false, indexedDb: false };
  private nextId = 1;
  private _revision = 0;
  private _hud: SnapshotDto | null = null;
  /** Bumped whenever a mutating request is sent; queries never coalesce across it. */
  private mutationEpoch = 0;
  /** Optional hook for perf overlays / logging. */
  onCall: ((stats: CallStats) => void) | null = null;

  private constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handle(event.data);
    this.worker.onerror = (event) => {
      const error = new EngineError('transport', event.message || 'engine worker crashed', 'worker');
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
      this.inflight.clear();
    };
  }

  /** Latest bridge revision seen (bumps after every mutating call). */
  get revision(): number {
    return this._revision;
  }

  /** Latest HUD seen in any envelope (null before a game starts). */
  get hud(): SnapshotDto | null {
    return this._hud;
  }

  /** What the worker can do: binary saves into its IndexedDB store (bridge-spec §6.3). */
  get capabilities(): WorkerCapabilities {
    return this._capabilities;
  }

  /** Spin up the worker, boot the .NET runtime and load content. */
  static async boot(options: BootOptions = {}): Promise<{ client: EngineClient; init: InitResult }> {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module', name: 'magnate-engine' });
    const client = new EngineClient(worker);
    client.progressListener = options.onProgress ?? null;
    const frameworkUrl = new URL('_framework/', document.baseURI).href;
    const response = await client.post({ id: client.nextId++, kind: 'boot', frameworkUrl }, 'boot');
    client.progressListener = null;
    if (response.extra) {
      try {
        client._capabilities = { ...client._capabilities, ...(JSON.parse(response.extra) as Partial<WorkerCapabilities>) };
      } catch {
        /* an older worker: no binary saves */
      }
    }
    const init = client.unwrap<InitResult>(response.payload, 'init');
    if (init.protocolVersion !== PROTOCOL_VERSION) {
      client.dispose();
      throw new EngineError(
        'transport',
        `engine protocol ${init.protocolVersion} does not match client protocol ${PROTOCOL_VERSION}`,
        'boot',
      );
    }
    return { client, init };
  }

  /** Invoke a typed bridge method. Rejects with EngineError on failure. */
  async call<M extends MethodName>(
    method: M,
    ...rest: keyof MethodArgs<M> extends never ? [args?: MethodArgs<M>] : [args: MethodArgs<M>]
  ): Promise<MethodResult<M>> {
    return this.request<MethodResult<M>>(method, rest[0] ?? {});
  }

  /** Untyped escape hatch for methods not yet in the `Methods` map. */
  async callRaw<T = unknown>(method: string, args: unknown = {}): Promise<T> {
    return this.request<T>(method, args);
  }

  /**
   * Subscribe to every successful envelope's HUD and events (mutations, ticks,
   * snapshot queries). Returns an unsubscribe function. Listener errors are
   * caught and logged so one bad subscriber cannot break a call.
   */
  onEnvelope(listener: EnvelopeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to HUD updates only. */
  onHud(listener: (hud: SnapshotDto, method: string) => void): () => void {
    return this.onEnvelope((info) => {
      if (info.hud) listener(info.hud, info.method);
    });
  }

  /** Subscribe to game events only (called once per envelope that carries any). */
  onEvents(listener: (events: GameEventDto[], method: string) => void): () => void {
    return this.onEnvelope((info) => {
      if (info.events.length > 0) listener(info.events, info.method);
    });
  }

  // ------------------------------------------------------------------ save store (worker, IndexedDB)

  /** Every slot's listing record, newest first (no save bodies are read). */
  listSaves(): Promise<SlotRecord[]> {
    return this.store<SlotRecord[]>({ id: 0, kind: 'listSaves' }, 'listSaves');
  }

  /**
   * Serialise the game into a slot (gzip in .NET, written by the worker). Without
   * `slotId` the worker picks it by kind: `m-<uuid>`, `quick`, or the autosave rotation.
   */
  saveToSlot(args: SaveArgs, options: { slotId?: string; ui?: SlotUiInfo } = {}): Promise<StoredSlot> {
    this.mutationEpoch++;
    return this.store<StoredSlot>({ id: 0, kind: 'save', args, ...(options.slotId ? { slotId: options.slotId } : {}), ...(options.ui ? { ui: options.ui } : {}) }, 'saveSlot');
  }

  /** Replace the game with a stored slot. The HUD reaches `onEnvelope` listeners as a `loadGame`. */
  async loadSlot(slotId: string, options: { expectedGameId?: string } = {}): Promise<LoadedSlot> {
    this.mutationEpoch++;
    const response = await this.post({ id: this.nextId++, kind: 'load', slotId, ...(options.expectedGameId ? { expectedGameId: options.expectedGameId } : {}) }, 'loadGame');
    const snapshot = this.unwrap<SnapshotDto>(response.payload, 'loadGame');
    let extra: LoadExtra | null = null;
    try {
      extra = response.extra ? (JSON.parse(response.extra) as LoadExtra) : null;
    } catch {
      extra = null;
    }
    if (!extra) throw new EngineError('transport', 'the worker sent no slot record with the load', 'loadGame');
    return { snapshot, slot: extra.slot, client: extra.client, contentChanged: extra.contentChanged };
  }

  deleteSave(slotId: string): Promise<null> {
    return this.store<null>({ id: 0, kind: 'deleteSave', slotId }, 'deleteSave');
  }

  renameSave(slotId: string, label: string | null): Promise<SlotRecord> {
    return this.store<SlotRecord>({ id: 0, kind: 'renameSave', slotId, label }, 'renameSave');
  }

  /** The slot as a downloadable `.magnate` file (gzip web save). */
  async exportSave(slotId: string): Promise<ExportedSave> {
    const response = await this.post({ id: this.nextId++, kind: 'exportSave', slotId }, 'exportSave');
    const result = this.unwrap<ExportResult>(response.payload, 'exportSave');
    if (!response.binary) throw new EngineError('transport', 'the worker sent no file bytes', 'exportSave');
    return { ...result, data: response.binary };
  }

  /**
   * Store a file as a new manual slot: a `.magnate` export, plain or gzipped JSON
   * (web save or legacy engine save v1–v9), or a Wave-1 `magnate.save` export. The
   * buffer is transferred to the worker (it is unusable afterwards).
   */
  importSave(bytes: ArrayBuffer, fileName?: string): Promise<StoredSlot> {
    return this.store<StoredSlot>({ id: 0, kind: 'importSave', bytes, ...(fileName ? { fileName } : {}) }, 'importSave', [bytes]);
  }

  storageEstimate(): Promise<StorageEstimateDto | null> {
    return this.store<StorageEstimateDto | null>({ id: 0, kind: 'storageEstimate' }, 'storageEstimate');
  }

  /** Let the worker autosave on its own after an `advance` reports `autosaveDue` (off by default). */
  configureSaves(options: { autosaveOnDue: boolean }): Promise<{ autosaveOnDue: boolean }> {
    return this.store<{ autosaveOnDue: boolean }>({ id: 0, kind: 'configureSaves', autosaveOnDue: options.autosaveOnDue }, 'configureSaves');
  }

  /** Worker-driven autosaves (see `configureSaves`). Returns an unsubscribe function. */
  onAutosave(listener: AutosaveListener): () => void {
    this.autosaveListeners.add(listener);
    return () => this.autosaveListeners.delete(listener);
  }

  private async store<T>(request: WorkerRequest, method: string, transfer: Transferable[] = []): Promise<T> {
    const response = await this.post({ ...request, id: this.nextId++ } as WorkerRequest, method, transfer);
    return this.unwrap<T>(response.payload, method);
  }

  dispose(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new EngineError('transport', 'engine disposed', p.method));
    this.pending.clear();
    this.inflight.clear();
    this.listeners.clear();
    this.autosaveListeners.clear();
  }

  private request<T>(method: string, args: unknown): Promise<T> {
    const argsJson = JSON.stringify(args ?? {});
    const mutating = MUTATING_METHODS.has(method as MethodName);
    if (mutating) {
      this.mutationEpoch++;
      return this.send<T>(method, argsJson);
    }
    const key = `${method}\u0000${argsJson}`;
    const existing = this.inflight.get(key);
    if (existing && existing.epoch === this.mutationEpoch) return existing.promise as Promise<T>;
    const promise = this.send<T>(method, argsJson).finally(() => {
      if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, { epoch: this.mutationEpoch, promise });
    return promise;
  }

  private async send<T>(method: string, argsJson: string): Promise<T> {
    const response = await this.post({ id: this.nextId++, kind: 'call', method, argsJson }, method);
    return this.unwrap<T>(response.payload, method);
  }

  private post(request: WorkerRequest, method: string, transfer: Transferable[] = []): Promise<OkResponse> {
    return new Promise<OkResponse>((resolve, reject) => {
      this.pending.set(request.id, { method, resolve, reject });
      this.worker.postMessage(request, transfer);
    });
  }

  private handle(response: WorkerResponse): void {
    if (isPush(response)) {
      this.handlePush(response);
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) {
      if (response.elapsedMs !== undefined) this.onCall?.({ method: pending.method, elapsedMs: response.elapsedMs });
      pending.resolve(response);
    } else {
      pending.reject(new EngineError('transport', response.error, pending.method));
    }
  }

  private handlePush(message: Extract<WorkerResponse, { kind: string }>): void {
    if (message.kind === 'bootProgress') {
      try {
        this.progressListener?.(message.stage);
      } catch (error) {
        console.error('[engine] boot progress listener failed', error);
      }
      return;
    }
    let result: { slot: StoredSlot } | { error: EngineError };
    try {
      result = { slot: this.unwrap<StoredSlot>(message.payload, 'autosave') };
    } catch (error) {
      result = { error: error instanceof EngineError ? error : new EngineError('transport', String(error), 'autosave') };
    }
    for (const listener of [...this.autosaveListeners]) {
      try {
        listener(result);
      } catch (error) {
        console.error('[engine] autosave listener failed', error);
      }
    }
  }

  private unwrap<T>(payload: string, method: string): T {
    let envelope: Envelope<T>;
    try {
      envelope = JSON.parse(payload) as Envelope<T>;
    } catch {
      throw new EngineError('transport', 'malformed engine response', method);
    }
    this._revision = Math.max(this._revision, envelope.revision ?? 0);
    if (!envelope.ok) {
      const { code, message, field, details } = envelope.error;
      throw new EngineError(code, message, method, field, details);
    }
    this.publish(method, envelope.revision ?? this._revision, envelope.result, envelope.hud, envelope.events);
    return envelope.result;
  }

  private publish(method: string, revision: number, result: unknown, hud?: SnapshotDto, events?: GameEventDto[]): void {
    let snapshot = hud;
    let tickEvents = events;
    if (method === 'advance' && result && typeof result === 'object') {
      const tick = result as TickResultDto;
      snapshot ??= tick.snapshot;
      tickEvents ??= tick.events;
    } else if (!snapshot && SNAPSHOT_RESULT_METHODS.has(method) && result && typeof result === 'object') {
      snapshot = result as SnapshotDto;
    }
    if (snapshot) this._hud = snapshot;
    if (!snapshot && !tickEvents?.length) return;
    const info: EnvelopeInfo = { method, revision, hud: snapshot, events: tickEvents ?? [] };
    for (const listener of [...this.listeners]) {
      try {
        listener(info);
      } catch (error) {
        console.error('[engine] envelope listener failed', error);
      }
    }
  }
}
