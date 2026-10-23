// Save-slot listing state for the Save/Load screen and the title's "Continue".
// The SaveStore instance is created after the engine boots (gameStore owns the
// save/load flows that touch the engine; this store owns the list).

import { create } from 'zustand';
import type { SaveSlotMeta, SaveStore, StorageEstimate } from './savegame';

let instance: SaveStore | null = null;

/** Installed by gameStore.boot() once the engine is up. */
export function setSaveStore(store: SaveStore | null): void {
  instance = store;
}

export function getSaveStore(): SaveStore | null {
  return instance;
}

interface SavesState {
  slots: SaveSlotMeta[];
  loaded: boolean;
  busy: boolean;
  error: string | null;
  estimate: StorageEstimate | null;
  backend: SaveStore['backend'] | null;

  refresh(): Promise<void>;
  remove(slotId: string): Promise<void>;
  rename(slotId: string, label: string): Promise<void>;
  exportSlot(slotId: string): Promise<void>;
  importFile(file: File): Promise<SaveSlotMeta | null>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useSavesStore = create<SavesState>()((set, get) => ({
  slots: [],
  loaded: false,
  busy: false,
  error: null,
  estimate: null,
  backend: null,

  async refresh() {
    const store = instance;
    if (!store) return;
    try {
      const [slots, estimate] = await Promise.all([store.list(), store.estimate()]);
      set({ slots, estimate, loaded: true, error: null, backend: store.backend });
    } catch (error) {
      set({ loaded: true, error: describe(error), backend: store.backend });
    }
  },

  async remove(slotId) {
    if (!instance) return;
    set({ busy: true });
    try {
      await instance.remove(slotId);
      await get().refresh();
    } catch (error) {
      set({ error: describe(error) });
    } finally {
      set({ busy: false });
    }
  },

  async rename(slotId, label) {
    if (!instance) return;
    try {
      const meta = await instance.rename(slotId, label);
      set((s) => ({ slots: s.slots.map((m) => (m.slotId === slotId ? meta : m)) }));
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  async exportSlot(slotId) {
    if (!instance) return;
    try {
      const { blob, fileName } = await instance.exportSlot(slotId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  async importFile(file) {
    if (!instance) return null;
    set({ busy: true });
    try {
      const meta = await instance.importFile(file, file.name);
      await get().refresh();
      return meta;
    } catch (error) {
      set({ error: describe(error) });
      return null;
    } finally {
      set({ busy: false });
    }
  },
}));

/** The newest slot (title "Continue"). */
export function latestSlot(slots: readonly SaveSlotMeta[]): SaveSlotMeta | null {
  return slots.reduce<SaveSlotMeta | null>((best, s) => (!best || s.updatedAt > best.updatedAt ? s : best), null);
}
