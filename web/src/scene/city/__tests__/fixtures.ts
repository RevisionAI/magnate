// Engine layouts captured from the bridge `cityLayout` (E3a generator v1, seed 1): Hilltown (hilly, terrain heights,
// slopes) and Portbay (coastal: sea, quays, beaches, port, oil deposits). Regenerate from ?dev=city with
// `JSON.stringify(window.__cityPreview.city.layoutCache.get('<city>'))`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CityLayoutWire } from '../layout/types';

const here = dirname(fileURLToPath(import.meta.url));
const cache = new Map<string, string>();

/** A fresh deep copy of a fixture layout (tests may mutate it). */
export function loadLayout(city: 'hilltown' | 'portbay'): CityLayoutWire {
  let text = cache.get(city);
  if (!text) {
    text = readFileSync(join(here, 'fixtures', `${city}.layout.json`), 'utf8');
    cache.set(city, text);
  }
  return JSON.parse(text) as CityLayoutWire;
}
