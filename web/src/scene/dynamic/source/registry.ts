// Where city modules publish their CitySource for the living city (keyed by the THREE.Scene so several CityScenes,
// e.g. the game and a dev lab, never mix). Registration may happen before or after the living city initialises.
import type * as THREE from 'three';
import type { CitySource } from './types';

const sources = new WeakMap<THREE.Scene, CitySource>();
const waiters = new WeakMap<THREE.Scene, Set<(source: CitySource | null) => void>>();

/** Publish (or clear with null) the city source of a scene. */
export function registerCitySource(ctx: { scene: THREE.Scene }, source: CitySource | null): void {
  if (source) sources.set(ctx.scene, source);
  else sources.delete(ctx.scene);
  for (const cb of [...(waiters.get(ctx.scene) ?? [])]) cb(source);
}

export function registeredCitySource(ctx: { scene: THREE.Scene }): CitySource | null {
  return sources.get(ctx.scene) ?? null;
}

/** Listen for (re-)registrations on a scene. */
export function onCitySource(ctx: { scene: THREE.Scene }, cb: (source: CitySource | null) => void): () => void {
  let set = waiters.get(ctx.scene);
  if (!set) {
    set = new Set();
    waiters.set(ctx.scene, set);
  }
  set.add(cb);
  return () => set!.delete(cb);
}
