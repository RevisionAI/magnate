import { describe, expect, it } from 'vitest';
import type { CatalogDto, ScenarioSummaryDto, SnapshotDto } from '@/bridge/protocol';
import { OWNER_COLORS } from '@/theme/tokens';
import { appendRecord, historyFromDto, profitStreak, type MonthRecord } from './history';
import { goalLabel, nameLookup, shortenDescription, toHudModel } from './hud';
import { estimateDifficulty, normalizeArchetype, sortScenarioCards, toScenarioCard } from './scenarios';

const catalog = {
  products: [{ id: 'soft_drink', name: 'Soft Drink' }],
  buildingTypes: [{ id: 'supermarket', name: 'Supermarket' }],
  cities: [{ id: 'metropolis', name: 'Metropolis' }],
} as unknown as CatalogDto;

const baseSnapshot = {
  date: { year: 2026, month: 3 },
  monthIndex: 2,
  playerId: 1,
  revision: 7,
  companies: [
    { id: 1, name: 'Your Corp', isPlayer: true, cash: 13_940_000, totalAssets: 15_140_000, equity: 15_000_000, revenueThisMonth: 2_310_000, netIncomeThisMonth: 412_000, buildingCount: 1, color: '#2f7de1' },
    { id: 2, name: 'LocalCo', isPlayer: false, cash: 9_000_000, totalAssets: 10_000_000, equity: 10_000_000, revenueThisMonth: 0, netIncomeThisMonth: -5_000, buildingCount: 2, color: '#e0493e' },
  ],
  scenario: {
    id: 'tutorial',
    name: 'Tutorial — Your First Company',
    goals: [
      { description: 'Step 1 — Open Manage (in-game button). Go to the Build tab.', achieved: true, progress: 1, detail: '1/1' },
      { description: 'Step 5 — Grow your company to $20M corporate value (cash + inventory + buildings).', achieved: false, progress: 0.75, detail: '$15.1M / $20.0M' },
    ],
  },
} as unknown as SnapshotDto;

describe('HUD adapter', () => {
  it('reads today’s snapshot with fallbacks', () => {
    const hud = toHudModel(baseSnapshot, catalog);
    expect(hud.player?.name).toBe('Your Corp');
    expect(hud.player?.colorIndex).toBe(0);
    expect(hud.player?.color).toBe(OWNER_COLORS[0]);
    expect(hud.player?.value).toBe(15_140_000); // total assets until corporateValue exists
    expect(hud.player?.valueIsFallback).toBe(true);
    expect(hud.player?.cashFlow).toBeNull();
    expect(hud.rivals.map((r) => r.colorIndex)).toEqual([1]);
    expect(hud.scenario?.goals[0]?.label).toBe('Open Manage (in-game button)');
    expect(hud.scenario?.goalsAchieved).toBe(1);
    expect(hud.scenario?.nextGoalId).toBe('g1');
    expect(hud.scenario?.monthsRemaining).toBeNull();
    expect(hud.outcome.status).toBe('playing');
  });

  it('prefers the additive bridge fields when present', () => {
    const snapshot = {
      ...baseSnapshot,
      gameId: 'game-42',
      player: { companyId: 1, cashFlowThisMonth: 135_000, corporateValue: 16_000_000, cashRunwayMonths: 2.5 },
      outcome: { status: 'won', reason: 'allGoals' },
      alerts: { lowCash: false, negativeCashMonths: 1, bankruptcyInMonths: 5, bankruptcyGraceMonths: 6 },
      companies: baseSnapshot.companies.map((c) => ({ ...c, colorIndex: c.id === 1 ? 0 : 4, corporateValue: c.totalAssets + 1 })),
      scenario: {
        ...baseSnapshot.scenario!,
        endDate: { year: 2030, month: 12 },
        goals: [
          { achieved: false, progress: 0.5, id: 'value', index: 0, kind: 'corporateValue', metric: 'totalAssets', current: 10e6, target: 20e6, unit: 'usd', achievedAt: { year: 2026, month: 2 } },
          { achieved: false, progress: 0.2, id: 'share', index: 1, kind: 'marketShare', current: 0.1, target: 0.55, unit: 'ratio', productId: 'soft_drink', cityId: 'metropolis', mode: 'holdAtDeadline' },
        ],
      },
    } as unknown as SnapshotDto;
    const hud = toHudModel(snapshot, catalog);
    expect(hud.gameId).toBe('game-42');
    expect(hud.player?.value).toBe(16_000_000);
    expect(hud.player?.cashFlow).toBe(135_000);
    expect(hud.player?.runwayMonths).toBe(2.5);
    expect(hud.rivals[0]?.colorIndex).toBe(4);
    expect(hud.outcome).toEqual({ status: 'won', reason: 'allGoals', at: null });
    expect(hud.insolvency.bankruptcyInMonths).toBe(5);
    expect(hud.scenario?.monthsRemaining).toBe(57);
    const [value, share] = hud.scenario!.goals;
    expect(value?.label).toBe('Company value ≥ $20M');
    expect(value?.latched).toBe(true); // reach-once latch via achievedAt
    expect(share?.label).toBe('Soft Drink share in Metropolis ≥ 55%');
    expect(share?.rule).toBe('holdAtDeadline');
    expect(share?.latched).toBe(false);
  });

  it('labels goals from structured fields', () => {
    const names = nameLookup(catalog);
    expect(goalLabel({ achieved: false, progress: 0, kind: 'ownsBuilding', category: 'supermarket', target: 1 }, names)).toBe('Own a Supermarket');
    expect(goalLabel({ achieved: false, progress: 0, kind: 'consecutiveProfitable', target: 12 }, names)).toBe('12 profitable months in a row');
    expect(shortenDescription('Step 3 — Go back to the main HUD and click Play. The sim ticks.')).toBe('Go back to the main HUD and click Play');
  });
});

const scenario = (over: Record<string, unknown> = {}): ScenarioSummaryDto =>
  ({
    id: 'soft_drink_war',
    name: 'Soft Drink War',
    description: 'Capture the Metropolis soft-drink market.',
    startDate: { year: 2026, month: 1 },
    endDate: { year: 2030, month: 12 },
    playerName: 'You',
    startingCash: 30_000_000,
    competitors: [
      { name: 'RivalCo', startingCash: 25_000_000, strategy: 'adaptive' },
      { name: 'MegaMart', startingCash: 20_000_000, strategy: 'simple' },
    ],
    goals: ['Soft drink share in Metropolis ≥ 55%', 'Company value ≥ $60M'],
    ...over,
  }) as unknown as ScenarioSummaryDto;

describe('scenario cards', () => {
  it('estimates difficulty like ScenarioDifficulty.Compute when the bridge does not send it', () => {
    // ratio 45/30 = 1.5 → +2; 2 goals → 0; 2 AIs → +1; 59 months → −1; share goal → +1  ⇒ 3
    expect(estimateDifficulty(scenario())).toBe(3);
    // tutorial: ratio 10/15 → 0; 5 goals → +1; 1 AI → 0; no deadline → −1; 0 tough ⇒ clamp 1
    expect(estimateDifficulty(scenario({ startingCash: 15e6, endDate: undefined, competitors: [{ name: 'LocalCo', startingCash: 10e6, strategy: 'simple' }], goals: ['a', 'b', 'c', 'd', 'e'] }))).toBe(1);
  });

  it('builds a briefing card with archetypes, duration and real time', () => {
    const card = toScenarioCard(scenario(), catalog);
    expect(card.durationMonths).toBe(59);
    expect(card.realSecondsAt1x).toBe(59 * 12);
    expect(card.rivals.map((r) => r.label)).toEqual(['Adaptive', 'Discount retailer']);
    expect(card.bucket).toBe('normal');
    expect(card.difficultyFromBridge).toBe(false);
    expect(card.pillar).toBe('Retail');
    expect(card.opening).toMatch(/downtown/);
    expect(card.briefing).toBeNull();
    expect(toScenarioCard(scenario({ briefing: '  Start with $30M.  ' })).briefing).toBe('Start with $30M.');
  });

  it('prefers bridge difficulty and goal details', () => {
    const card = toScenarioCard(
      scenario({
        difficulty: 5,
        difficultyBucket: 'hard',
        goalDetails: [{ id: 'g0', index: 0, kind: 'marketShare', metric: 'share', description: 'x', target: 0.55, unit: 'ratio', productId: 'soft_drink', cityId: 'metropolis' }],
      }),
      catalog,
    );
    expect(card.difficulty).toBe(5);
    expect(card.bucket).toBe('hard');
    expect(card.goals[0]?.label).toBe('Soft Drink share in Metropolis ≥ 55%');
  });

  it('sorts tutorial, sandbox, then by difficulty', () => {
    const cards = sortScenarioCards([
      toScenarioCard(scenario({ id: 'hard_one', name: 'Hard', difficulty: 5 })),
      toScenarioCard(scenario({ id: 'sandbox', name: 'Sandbox', endDate: undefined })),
      toScenarioCard(scenario({ id: 'tutorial', name: 'Tutorial — Your First Company' })),
      toScenarioCard(scenario({ id: 'easy_one', name: 'Easy', difficulty: 1 })),
    ]);
    expect(cards.map((c) => c.id)).toEqual(['tutorial', 'sandbox', 'easy_one', 'hard_one']);
    expect(normalizeArchetype('vertical')).toBe('verticalIntegrator');
    expect(normalizeArchetype('TechLeader')).toBe('techLeader');
  });
});

describe('metric history', () => {
  const rec = (monthIndex: number, netIncome: number): MonthRecord => ({
    monthIndex,
    date: { year: 2026, month: monthIndex + 1 },
    cash: 1,
    value: 1,
    revenue: 1,
    netIncome,
  });

  it('appends in order, replaces a month and counts the profit streak', () => {
    let h = appendRecord([], rec(0, -1));
    h = appendRecord(h, rec(2, 5));
    h = appendRecord(h, rec(1, 3));
    h = appendRecord(h, rec(2, 4));
    expect(h.map((r) => r.monthIndex)).toEqual([0, 1, 2]);
    expect(h[2]?.netIncome).toBe(4);
    expect(profitStreak(h)).toBe(2);
  });

  it('reads the bridge history DTO', () => {
    const rows = historyFromDto(
      { start: { year: 2026, month: 11 }, months: 3, companies: [{ companyId: 1, series: { cash: [1, 2, 3], netIncome: [0, 1, -1], revenue: [5, 6, 7] } }] },
      1,
      10,
    );
    expect(rows.map((r) => r.date)).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
    expect(rows[2]?.monthIndex).toBe(12);
    expect(rows[1]?.value).toBe(2); // falls back to cash without value series
  });
});
