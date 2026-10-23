// Scenario browser view-model (UX §6.2 briefing cards). Normalises
// ScenarioSummaryDto — today's shape and the additive fields of bridge-spec
// §5.3 (difficulty, durationMonths, isSandbox, goalDetails, sortKey).

import type { CatalogDto, DateDto, ScenarioSummaryDto } from '@/bridge/protocol';
import { SECONDS_PER_MONTH } from '@/game/clock';
import { monthsBetween } from '@/util/format';
import { goalLabel, nameLookup, shortenDescription, type GoalRule } from './hud';

export type AiArchetype = 'simple' | 'adaptive' | 'verticalIntegrator' | 'techLeader';
export type DifficultyBucket = 'easy' | 'normal' | 'hard';
export type Pillar = 'Tutorial' | 'Sandbox' | 'Retail' | 'Brand' | 'Integration' | 'Technology' | 'Exports' | 'Growth';

export interface RivalBrief {
  name: string;
  startingCash: number;
  archetype: AiArchetype;
  label: string;
  blurb: string;
}

export interface GoalPreview {
  id: string;
  label: string;
  description: string;
  rule: GoalRule;
}

export interface ScenarioCard {
  id: string;
  name: string;
  description: string;
  startDate: DateDto;
  endDate: DateDto | null;
  durationMonths: number | null;
  /** Uninterrupted real-time length at 1× (seconds), null without a deadline. */
  realSecondsAt1x: number | null;
  startingCash: number;
  playerName: string;
  rivals: RivalBrief[];
  goals: GoalPreview[];
  difficulty: 1 | 2 | 3 | 4 | 5;
  bucket: DifficultyBucket;
  /** True when difficulty came from the bridge (authored/computed engine-side). */
  difficultyFromBridge: boolean;
  isSandbox: boolean;
  isTutorial: boolean;
  pillar: Pillar;
  sortKey: number;
  /** The bridge's plain-words briefing (bridge-spec §5.3 `briefing`), when it sends one. */
  briefing: string | null;
  /** Suggested opening for the briefing (UX §6.16), by pillar. */
  opening: string;
}

/** Suggested openings per pillar (briefing "Opening" line, UX §6.2 wireframe). */
export const OPENINGS: Record<Pillar, string> = {
  Tutorial: 'Follow Morgan’s steps: open a store, stock its shelves, then let a few months pass and read the books.',
  Sandbox: 'No rules and no clock. Try a supermarket downtown, then integrate backwards into your own factory.',
  Retail: 'Take a busy downtown plot early — rivals open from month two. Keep the shelves full and price inside the band.',
  Brand: 'Pick one product and advertise it everywhere you sell it. Brand compounds month by month and fades when you stop.',
  Integration: 'Secure your raw materials first — farms or mines — then a factory, then the shelf. Margins stack at every step.',
  Technology: 'Build an R&D centre early. Better tech means better quality, and quality wins shoppers at the same price.',
  Exports: 'Produce what the world market pays well for and keep your factories running at capacity.',
  Growth: 'Profit compounds. Build what earns the most per dollar invested, then reinvest the cash.',
};

/** Plain-words rival archetypes (UX §6.13). */
export const ARCHETYPES: Record<AiArchetype, { label: string; blurb: string }> = {
  simple: {
    label: 'Discount retailer',
    blurb: 'Opens stores where demand is biggest and prices just under the cheapest seller.',
  },
  adaptive: {
    label: 'Adaptive',
    blurb: 'Undercuts the cheapest price by about 5% and advertises where it competes.',
  },
  verticalIntegrator: {
    label: 'Vertical integrator',
    blurb: 'Builds its own farms, factories and stores to control the whole supply chain.',
  },
  techLeader: {
    label: 'Tech leader',
    blurb: 'Pours R&D into a premium product and prices well above its rivals.',
  },
};

/** Canonical archetype id (bridge-spec §5.3 normalises retailer/vertical/tech the same way). */
export function normalizeArchetype(strategy: string | null | undefined): AiArchetype {
  const s = (strategy ?? '').toLowerCase();
  if (s.startsWith('vertical')) return 'verticalIntegrator';
  if (s.startsWith('tech')) return 'techLeader';
  if (s.startsWith('adaptive')) return 'adaptive';
  return 'simple';
}

export function bucketOf(difficulty: number): DifficultyBucket {
  return difficulty <= 2 ? 'easy' : difficulty === 3 ? 'normal' : 'hard';
}

interface LooseGoalDetail {
  id?: string;
  index?: number;
  kind?: string;
  metric?: string;
  description?: string;
  target?: number;
  unit?: string;
  productId?: string;
  cityId?: string;
  category?: string;
  mode?: string;
}

/** Today's ScenarioSummaryDto plus the optional §5.3 fields (typed loosely so both protocol versions fit). */
type LooseScenario = Omit<ScenarioSummaryDto, 'difficulty' | 'difficultyBucket' | 'durationMonths' | 'isSandbox' | 'goalDetails' | 'sortKey'> & {
  difficulty?: number;
  difficultyBucket?: string;
  durationMonths?: number | null;
  isSandbox?: boolean;
  goalDetails?: LooseGoalDetail[];
  sortKey?: number;
  briefing?: string | null;
};

/** The fields the difficulty heuristic reads (present in every protocol version). */
type DifficultyInput = Pick<ScenarioSummaryDto, 'startingCash' | 'competitors' | 'goals' | 'startDate' | 'endDate'>;

/**
 * Difficulty fallback while the bridge does not send `difficulty` yet — the same
 * heuristic as bridge-spec §4.6.7 (ScenarioDifficulty.Compute). Without goal
 * details the goal-toughness term is estimated from the goal text.
 */
export function estimateDifficulty(s: DifficultyInput): 1 | 2 | 3 | 4 | 5 {
  let score = 0;
  const ais = s.competitors ?? [];
  if (s.startingCash > 0 && ais.length > 0) {
    const ratio = ais.reduce((sum, a) => sum + a.startingCash, 0) / s.startingCash;
    score += ratio > 2.5 ? 3 : ratio >= 1.5 ? 2 : ratio > 1.0 ? 1 : 0;
  }
  const goals = s.goals?.length ?? 0;
  score += goals >= 6 ? 2 : goals >= 4 ? 1 : 0;
  score += ais.length === 0 ? -1 : ais.length === 2 ? 1 : ais.length >= 3 ? 2 : 0;
  if (s.endDate) {
    const months = monthsBetween(s.startDate, s.endDate);
    score += months <= 24 ? 1 : months >= 49 && months <= 72 ? -1 : 0;
  } else {
    score -= 1;
  }
  if (ais.some((a) => normalizeArchetype(a.strategy) === 'verticalIntegrator')) score += 1;
  const tough = (s.goals ?? []).filter((g) => /share|brand|export/i.test(g)).length;
  score += Math.min(2, tough);
  return Math.min(5, Math.max(1, score)) as 1 | 2 | 3 | 4 | 5;
}

function pillarOf(s: LooseScenario, isTutorial: boolean, isSandbox: boolean): Pillar {
  if (isTutorial) return 'Tutorial';
  if (isSandbox) return 'Sandbox';
  const kinds = new Set((s.goalDetails ?? []).map((g) => g.kind ?? ''));
  const text = `${s.description} ${(s.goals ?? []).join(' ')}`.toLowerCase();
  const archetypes = (s.competitors ?? []).map((c) => normalizeArchetype(c.strategy));
  if (kinds.has('exportRevenue') || /export/.test(text)) return 'Exports';
  if (archetypes.includes('techLeader') || /\b(tech|patent|r&d|research)/.test(text)) return 'Technology';
  if (/farm|factory|plantation|vertical|integrat|supply chain/.test(text)) return 'Integration';
  if (kinds.has('topBrand') || /brand/.test(text)) return 'Brand';
  if (kinds.has('marketShare') || /share|retail|store/.test(text)) return 'Retail';
  return 'Growth';
}

/** Card + briefing model for one scenario. */
export function toScenarioCard(dto: ScenarioSummaryDto, catalog?: CatalogDto | null): ScenarioCard {
  const s = dto as unknown as LooseScenario;
  const names = nameLookup(catalog);
  const isTutorial = s.id === 'tutorial' || s.id.startsWith('tutorial');
  const isSandbox = s.isSandbox ?? s.id === 'sandbox';
  const fromBridge = typeof s.difficulty === 'number' && s.difficulty >= 1 && s.difficulty <= 5;
  const difficulty = (fromBridge ? Math.round(s.difficulty as number) : estimateDifficulty(s)) as 1 | 2 | 3 | 4 | 5;
  const endDate = s.endDate ?? null;
  const durationMonths =
    typeof s.durationMonths === 'number' ? s.durationMonths : endDate ? monthsBetween(s.startDate, endDate) : null;
  const details = s.goalDetails ?? [];
  const goals: GoalPreview[] =
    details.length > 0
      ? details.map((g, i) => ({
          id: g.id ?? `g${i}`,
          label: goalLabel({ ...g, achieved: false, progress: 0 }, names),
          description: g.description ?? '',
          rule: g.mode === 'holdAtDeadline' ? 'holdAtDeadline' : 'reachOnce',
        }))
      : (s.goals ?? []).map((text, i) => ({ id: `g${i}`, label: shortenDescription(text), description: text, rule: 'reachOnce' }));
  const sortKey =
    typeof s.sortKey === 'number' ? s.sortKey : isTutorial ? 0 : isSandbox ? 1 : 10 + difficulty;
  const pillar = pillarOf(s, isTutorial, isSandbox);
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    startDate: s.startDate,
    endDate,
    durationMonths,
    realSecondsAt1x: durationMonths !== null ? durationMonths * SECONDS_PER_MONTH[1] : null,
    startingCash: s.startingCash,
    playerName: s.playerName,
    rivals: (s.competitors ?? []).map((c) => {
      const archetype = normalizeArchetype(c.strategy);
      return { name: c.name, startingCash: c.startingCash, archetype, ...ARCHETYPES[archetype] };
    }),
    goals,
    difficulty,
    bucket: s.difficultyBucket === 'easy' || s.difficultyBucket === 'normal' || s.difficultyBucket === 'hard'
      ? s.difficultyBucket
      : bucketOf(difficulty),
    difficultyFromBridge: fromBridge,
    isSandbox,
    isTutorial,
    pillar,
    sortKey,
    briefing: typeof s.briefing === 'string' && s.briefing.trim() ? s.briefing.trim() : null,
    opening: OPENINGS[pillar],
  };
}

/** Cards in browser order: tutorial, sandbox, then difficulty ascending, then name. */
export function sortScenarioCards(cards: ScenarioCard[]): ScenarioCard[] {
  return [...cards].sort((a, b) => a.sortKey - b.sortKey || a.difficulty - b.difficulty || a.name.localeCompare(b.name));
}

/** Display title without the "Tutorial — " style prefix duplication. */
export function scenarioTitle(card: Pick<ScenarioCard, 'name'>): string {
  return card.name.replace(/^tutorial\s*[—–-]\s*/i, '');
}
