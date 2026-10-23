// Save-store selection: the engine worker's binary IndexedDB store when the engine
// build supports it (B2, bridge-spec §6.3); else the Wave-1 main-thread IndexedDB
// store over the string saveGame/loadGame; else memory.

import type { SaveEngine, SaveStore } from './types';
import { IdbSaveStore, indexedDbAvailable } from './idbSaveStore';
import { MemorySaveStore } from './memorySaveStore';
import { WorkerSaveStore, workerSavesAvailable, type WorkerSaveBackend } from '../saveStoreWorker';

export * from './types';
export * from './meta';

export function createSaveStore(engine: SaveEngine & { worker?: Partial<WorkerSaveBackend> | null }): SaveStore {
  if (workerSavesAvailable(engine.worker)) return new WorkerSaveStore(engine.worker);
  return indexedDbAvailable() ? new IdbSaveStore(engine) : new MemorySaveStore(engine);
}
