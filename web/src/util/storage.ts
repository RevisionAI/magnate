// Safe wrappers around Web Storage. Private windows, blocked site data and
// thumbnail-capture previews can make localStorage throw or vanish; the game
// must keep working with in-memory fallbacks (settings are a convenience, not
// game state).

import type { StateStorage } from 'zustand/middleware';

const memory = new Map<string, string>();

export const safeStorage: StateStorage = {
  getItem(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  setItem(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* fall through to memory */
    }
    memory.set(key, value);
  },
  removeItem(key) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
    memory.delete(key);
  },
};

/** Reads and JSON-parses a key; returns `fallback` on any failure. */
export function readJson<T>(key: string, fallback: T): T {
  const raw = safeStorage.getItem(key);
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    void safeStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
