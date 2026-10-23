// Registry of every AssetFactory, keyed by id (a content building-type id such as
// "supermarket", or an ambient archetype id such as "ambient:house"). Owned by W4.
import type { AssetFactory } from './AssetFactory';
import * as familiesA from './familiesA';
import { FAMILIES_B, PROPS_B } from './familiesB';
import type { PropFamily } from './Instancing';

const { FAMILIES_A } = familiesA;
/** W3's instanced prop families, picked up automatically once familiesA.ts exports `PROPS_A` (optional export, so this
 *  file compiles before and after W3 adds it). */
const PROPS_A: readonly PropFamily[] = optionalExport<readonly PropFamily[]>(familiesA, 'PROPS_A') ?? [];

/** Read an export that may not exist yet without a static (bundler-checked) member access. */
function optionalExport<T>(ns: object, name: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(ns, name) ? (ns as Record<string, T>)[name] : undefined;
}

const byId = new Map<string, AssetFactory>();
for (const factory of [...FAMILIES_A, ...FAMILIES_B]) {
  if (byId.has(factory.id)) throw new Error(`duplicate asset factory id: ${factory.id}`);
  byId.set(factory.id, factory);
}

/** All factories in a stable order (by id). */
export function allFactories(): AssetFactory[] {
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Factory for an id, or undefined. */
export function factoryFor(id: string): AssetFactory | undefined {
  return byId.get(id);
}

// ---- Instanced prop families (W4 addition) ----------------------------------------------------------------------
// AssetOutput.props is keyed by family id; the renderer resolves each id to its geometry here. W3 adds its families by
// exporting `PROPS_A: readonly PropFamily[]` from familiesA.ts (read through the namespace import above).

const propsById = new Map<string, PropFamily>();
for (const family of [...PROPS_A, ...PROPS_B]) {
  if (propsById.has(family.id)) throw new Error(`duplicate prop family id: ${family.id}`);
  propsById.set(family.id, family);
}

/** All prop families in a stable order (by id). */
export function allPropFamilies(): PropFamily[] {
  return [...propsById.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Prop family for an id, or undefined (unknown ids should be skipped by renderers, not crash). */
export function propFamilyFor(id: string): PropFamily | undefined {
  return propsById.get(id);
}

/** Gallery / tooling group of a factory: its declared family, else the id prefix before ':' (ambient archetypes). */
export function familyOf(factory: AssetFactory): string {
  if (factory.family) return factory.family;
  const i = factory.id.indexOf(':');
  return i > 0 ? factory.id.slice(0, i) : 'other';
}
