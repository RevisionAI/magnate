// Positional building/vehicle emitters (audio-plan §4.9): which loop a building plays, how active it
// sounds, and which emitters get one of the N real voices. Pure functions, unit-tested.

import { clamp01 } from '../core/math';

/** What the city/scene layer tells audio about one building (world metres, footprint in plots). */
export interface EmitterSource {
  id: number;
  /** Content category: factory, mine, oil_well, farm, plantation, warehouse, seaport, convenience_store, supermarket, department_store, rd_center, media … */
  category: string;
  typeId?: string;
  /** cityView status: operating | idle | passive | starved | soldOut | underConstruction. */
  status?: string;
  isPlayer?: boolean;
  x: number;
  y?: number;
  z: number;
  footprintW: number;
  footprintH: number;
  activity?: { utilization?: number | null; unitsSold?: number; transfersIn?: number; transfersOut?: number; hasResearch?: boolean };
}

export interface EmitterSpec {
  loop: string;
  /** Activity a ∈ [0, 1]. */
  a: number;
  /** Day / night multipliers. */
  day: number;
  night: number;
}

const RETAIL = new Set(['convenience_store', 'supermarket', 'department_store', 'retail']);
const PRESS = new Set(['newspaper_publisher', 'magazine_publisher', 'newspaper', 'magazine']);
const BROADCAST = new Set(['tv_station', 'radio_station', 'tv', 'radio']);

const logAct = (n: number, div: number) => clamp01(Math.log10(1 + Math.max(0, n)) / div);

/** Deterministic construct-loop pick per building (hash(id) mod 3). */
export function constructLoopFor(id: number): string {
  const h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return ['construct_loop.hammer', 'construct_loop.mixer', 'construct_loop.crane'][h % 3] as string;
}

/** §4.9 table: category/status/activity → loop and activity. Null = silent. */
export function emitterSpec(src: EmitterSource): EmitterSpec | null {
  const st = src.status ?? 'operating';
  const act = src.activity ?? {};
  if (st === 'underConstruction') return { loop: constructLoopFor(src.id), a: 1, day: 1, night: 0.2 };
  const util = act.utilization ?? 0.6;
  const transfers = (act.transfersIn ?? 0) + (act.transfersOut ?? 0);
  const cat = src.category;
  switch (cat) {
    case 'factory':
    case 'mine': {
      const a = st === 'idle' ? 0.1 : st === 'starved' ? 0.3 : 0.25 + 0.75 * clamp01(util);
      return { loop: cat === 'mine' ? 'loop_mine' : 'loop_factory', a, day: 1, night: cat === 'mine' ? 0.8 : 1 };
    }
    case 'oil_well':
      return st === 'idle' ? null : { loop: 'loop_pumpjack', a: 1, day: 1, night: 1 };
    case 'farm':
    case 'plantation':
      return { loop: 'loop_farm', a: st === 'idle' ? 0.1 : 0.3 + 0.7 * clamp01(util), day: 1, night: 0.2 };
    case 'warehouse':
      return { loop: 'loop_warehouse', a: Math.max(st === 'idle' ? 0.05 : 0.15, logAct(transfers, 6)), day: 1, night: 0.4 };
    case 'seaport':
      return { loop: 'loop_seaport', a: 0.4 + 0.6 * logAct(transfers, 6), day: 1, night: 0.7 };
    case 'rd_center':
      return { loop: 'loop_lab', a: act.hasResearch === false ? 0.2 : 0.6, day: 1, night: 1 };
    case 'media': {
      const t = src.typeId ?? '';
      if (BROADCAST.has(t)) return { loop: 'loop_broadcast', a: 0.5, day: 1, night: 1 };
      return { loop: 'loop_press', a: 0.7, day: 1, night: 1 };
    }
    default:
      if (RETAIL.has(cat)) {
        let a = st === 'idle' ? 0.1 : Math.max(0.15, logAct(act.unitsSold ?? 0, 6.5));
        if (st === 'soldOut') a *= 0.5;
        return { loop: 'loop_retail', a, day: 1, night: 0.15 };
      }
      if (PRESS.has(cat)) return { loop: 'loop_press', a: 0.7, day: 1, night: 1 };
      if (BROADCAST.has(cat)) return { loop: 'loop_broadcast', a: 0.5, day: 1, night: 1 };
      return null;
  }
}

/** Reference distance: 1.2 × the larger footprint side × plot size (metres). */
export function refDistance(src: EmitterSource, plotSize: number): number {
  return 1.2 * Math.max(1, src.footprintW, src.footprintH) * plotSize;
}

/** §4.9 score: s = a · base · ref / (ref + 1.3 · max(0, d − ref)). */
export function emitterScore(a: number, base: number, ref: number, distance: number): number {
  return (a * base * ref) / (ref + 1.3 * Math.max(0, distance - ref));
}

/**
 * Choose which emitters hold the N real voices. Current holders keep their voice unless a newcomer
 * scores > 1.25 × the weakest holder (hysteresis against flapping). Returns the new holder set.
 */
export function selectVoices(scores: ReadonlyArray<{ key: string; s: number }>, current: ReadonlySet<string>, n: number): Set<string> {
  const valid = scores.filter((x) => x.s > 1e-4);
  const byKey = new Map(valid.map((x) => [x.key, x.s]));
  const holders = [...current].filter((k) => byKey.has(k)).map((k) => ({ key: k, s: byKey.get(k) as number }));
  holders.sort((a, b) => b.s - a.s);
  while (holders.length > n) holders.pop();
  const candidates = valid.filter((x) => !current.has(x.key)).sort((a, b) => b.s - a.s);
  for (const c of candidates) {
    if (holders.length < n) {
      holders.push(c);
      continue;
    }
    holders.sort((a, b) => b.s - a.s);
    const weakest = holders[holders.length - 1] as { key: string; s: number };
    if (c.s > 1.25 * weakest.s) holders[holders.length - 1] = c;
    else break; // candidates are sorted: nobody further down can beat it either
  }
  return new Set(holders.map((h) => h.key));
}
