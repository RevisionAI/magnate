// VO line registry (data/vo-lines.json): every line of the a2 voice-over batch — the 60 advisor and
// 13 anchor lines of audio-plan §5.2, the UX §9 lines, the templated lines and the legacy tutorial
// steps. A line is voiced when the audio manifest has its mastered take (asset id `vo.<line id>`,
// written by tools/audio/master.py from assets-src/vo/manifest.json); otherwise (held lines, or a
// manifest that failed to load) the queue shows its subtitle only.
//
// Old names resolve too: the UX ids that became aliases of §5.2 lines (`vo_first_sale` →
// `adv.sales.first`) and the ten legacy Godot names (`vo_welcome` → `adv.onboard.welcome`).

import data from '../data/vo-lines.json';
import type { AudioManifest } from '../assets/manifest';
import type { Priority, VoiceLine } from './VoiceQueue';

export interface VoLineDef {
  id: string;
  /** Subtitle text (the words of the take; identical to the VO manifest). */
  text: string;
  /** Spoken text when it differs from the subtitle (pronunciation respelling). */
  tts?: string;
  voice: 'advisor' | 'anchor';
  /** 0 critical · 1 important · 2 informative · 3 hint (audio-plan §4.11). */
  priority: number;
  /** P1·T: voiced even when advisor frequency is "important". */
  tutorial?: boolean;
  /** Spoken at most once per game (client latch; reset on new game / load). */
  oncePerGame?: boolean;
  /** Game months that must pass between two plays. */
  gameMonthCooldown?: number;
  /** The first N plays per game ignore `gameMonthCooldown` ("first 2 per game, then ≤ 1 per 12 months"). */
  firstFree?: number;
  /** After `firstFree`, only every Nth occurrence speaks ("first 3, then every 5th"). */
  every?: number;
  /** Priority when raised by Major news (anchor lines). */
  majorPriority?: number;
  /** The legacy Godot name this line replaces (vo_welcome …). */
  legacyAlias?: string;
  /** Superseded UX ids that resolve to this line. */
  aliases?: string[];
  /** Kept for the legacy names and the AudioLab; no event routes to it. */
  legacyOnly?: boolean;
  /** Not recorded yet (text not final): subtitle only. */
  held?: boolean;
  /** Override of the manifest asset id of the take (default `vo.<id>`). */
  take?: string;
  trigger?: string;
  limit?: string;
  delivery?: string;
}

export const VO_LINES: readonly VoLineDef[] = (data as { lines: VoLineDef[] }).lines;
const BY_ID = new Map(VO_LINES.map((l) => [l.id, l]));
const BY_ALIAS = new Map<string, string>();
for (const l of VO_LINES) {
  if (l.legacyAlias) BY_ALIAS.set(l.legacyAlias, l.id);
  for (const a of l.aliases ?? []) BY_ALIAS.set(a, l.id);
}

/** The canonical line id for an id, a superseded UX id or a legacy Godot name; undefined if unknown. */
export function canonicalLineId(name: string): string | undefined {
  if (BY_ID.has(name)) return name;
  return BY_ALIAS.get(name) ?? (name.startsWith('vo.') ? canonicalLineId(name.slice(3)) : undefined);
}

export function voLineDef(id: string): VoLineDef | undefined {
  const canonical = canonicalLineId(id);
  return canonical ? BY_ID.get(canonical) : undefined;
}

/** Manifest asset id of a line's take. */
export function takeAssetId(def: VoLineDef): string {
  return def.take ?? `vo.${def.id}`;
}

/** Real-time per-line cooldown: game-month limits are enforced by the router with the game clock. */
const REALTIME_COOLDOWN_MS = 30_000;

/** Resolve a line against the manifest (take present? which text?). */
export function resolveVoiceLine(id: string, manifest: AudioManifest): VoiceLine | undefined {
  const def = voLineDef(id);
  if (!def) return undefined;
  const takeId = takeAssetId(def);
  const take = def.held ? undefined : manifest.get(takeId);
  return {
    id: def.id,
    text: take?.variants[0]?.text ?? def.text,
    voice: def.voice,
    priority: Math.min(3, Math.max(0, def.priority)) as Priority,
    tutorial: def.tutorial,
    oncePerGame: def.oncePerGame,
    cooldownMs: REALTIME_COOLDOWN_MS,
    take: take ? takeId : undefined,
    durationSec: take?.variants[0]?.durationSec,
  };
}
