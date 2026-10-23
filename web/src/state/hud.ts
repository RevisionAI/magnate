// HUD view-model: normalises the bridge's SnapshotDto (today's shape and the
// additive fields of bridge-spec §5.3 / §5.11) into one stable shape the HUD
// renders. Every "is this field there yet?" question lives here, so the rest
// of the UI never touches raw DTOs and keeps compiling while the bridge grows.
//
// No game logic is derived here (bridge-spec §3): values are read, labelled and
// formatted, never recomputed — except presentation fallbacks that are clearly
// marked (goal labels from content fields, colour index from the company id).

import type { CatalogDto, DateDto, SnapshotDto } from '@/bridge/protocol';
import { ownerColor, ownerEmblem, type OwnerEmblem } from '@/theme/tokens';
import { humanizeId, money, monthsBetween, percent } from '@/util/format';

export interface CompanyView {
  id: number;
  name: string;
  isPlayer: boolean;
  colorIndex: number;
  color: string;
  emblem: OwnerEmblem;
  cash: number;
  /** Unified Company Value (D10); falls back to total assets until the bridge exposes corporateValue. */
  value: number;
  valueIsFallback: boolean;
  totalAssets: number;
  equity: number;
  revenue: number;
  netIncome: number;
  netIncomeLast12: number | null;
  buildings: number;
  strategy: string | null;
}

export interface PlayerView extends CompanyView {
  /** Last month's net cash flow (PlayerHudDto.cashFlowThisMonth), null until the bridge sends it. */
  cashFlow: number | null;
  /** Cash runway in months; null = not reported or infinite. */
  runwayMonths: number | null;
  idleBuildings: number | null;
  activeCampaigns: number | null;
  /** Reported credit rating ("NR" while unrated; E2 SnapshotDto.player.creditRating), null under Classic rules. */
  creditRating: string | null;
}

export type GoalRule = 'reachOnce' | 'holdAtDeadline';

export interface GoalView {
  id: string;
  index: number;
  /** Short label for chips ("Company value ≥ $20M"). */
  label: string;
  /** Full description from content. */
  description: string;
  achieved: boolean;
  /** Latched milestone (reach-once goals stay ✓ once met; D11). */
  latched: boolean;
  progress: number;
  current: number | null;
  target: number | null;
  unit: string | null;
  kind: string | null;
  detail: string | null;
  achievedAt: DateDto | null;
  rule: GoalRule;
}

export interface ScenarioView {
  id: string;
  name: string;
  endDate: DateDto | null;
  monthsRemaining: number | null;
  goals: GoalView[];
  goalsAchieved: number;
  nextGoalId: string | null;
}

export interface OutcomeView {
  status: 'playing' | 'won' | 'lost';
  reason: string | null;
  at: DateDto | null;
}

export interface InsolvencyView {
  lowCash: boolean;
  negativeCashMonths: number;
  /** "INSOLVENT IN N MONTHS" when cash < 0 (UX §6.16); null when solvent or unknown. */
  bankruptcyInMonths: number | null;
  graceMonths: number;
}

export interface HudModel {
  revision: number;
  gameId: string | null;
  date: DateDto;
  monthIndex: number;
  startDate: DateDto | null;
  elapsedMonths: number | null;
  player: PlayerView | null;
  companies: CompanyView[];
  rivals: CompanyView[];
  scenario: ScenarioView | null;
  outcome: OutcomeView;
  insolvency: InsolvencyView;
  faulted: boolean;
  autopilot: string | null;
}

// ------------------------------------------------------------------ loose DTO views
// The additive fields of bridge-spec §5.3/§5.11, all optional so today's bridge parses.

interface LooseCompany {
  id: number;
  name: string;
  isPlayer: boolean;
  cash: number;
  totalAssets: number;
  equity: number;
  revenueThisMonth: number;
  netIncomeThisMonth: number;
  buildingCount: number;
  color?: string;
  corporateValue?: number;
  netIncomeLast12?: number;
  colorIndex?: number;
  aiStrategy?: string | null;
}

interface LoosePlayerHud {
  companyId?: number;
  cashFlowThisMonth?: number;
  corporateValue?: number;
  netIncomeLast12?: number;
  buildings?: number;
  idleBuildings?: number;
  activeCampaigns?: number;
  cashRunwayMonths?: number | null;
  creditRating?: string | null;
}

interface LooseGoal {
  description?: string | null;
  achieved: boolean;
  progress: number;
  detail?: string | null;
  id?: string;
  index?: number;
  kind?: string;
  metric?: string;
  current?: number;
  target?: number;
  unit?: string;
  achievedAt?: DateDto | null;
  productId?: string | null;
  cityId?: string | null;
  category?: string | null;
  mode?: string | null;
  rule?: string | null;
}

interface LooseScenario {
  id: string;
  name: string;
  endDate?: DateDto | null;
  goals: LooseGoal[];
  monthsRemaining?: number | null;
  goalsAchieved?: number;
  nextGoalId?: string | null;
}

interface LooseSnapshot {
  date: DateDto;
  monthIndex: number;
  playerId: number;
  companies: LooseCompany[];
  scenario?: LooseScenario | null;
  revision: number;
  gameId?: string;
  startDate?: DateDto;
  elapsedMonths?: number;
  player?: LoosePlayerHud;
  outcome?: { status?: string; reason?: string | null; at?: DateDto | null };
  alerts?: { lowCash?: boolean; negativeCashMonths?: number; bankruptcyInMonths?: number | null; bankruptcyGraceMonths?: number };
  autopilot?: string | null;
  faulted?: boolean;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function companyView(c: LooseCompany): CompanyView {
  // Presentation fallback until the bridge sends colorIndex (D15: index 0 is always the
  // player); rivals cycle through 1..7 by id so they never take the player's colour.
  const colorIndex = finite(c.colorIndex) ? c.colorIndex : c.isPlayer ? 0 : 1 + ((((c.id - 2) % 7) + 7) % 7);
  const hasValue = finite(c.corporateValue);
  return {
    id: c.id,
    name: c.name,
    isPlayer: c.isPlayer,
    colorIndex,
    color: ownerColor(colorIndex),
    emblem: ownerEmblem(colorIndex),
    cash: c.cash,
    value: hasValue ? (c.corporateValue as number) : c.totalAssets,
    valueIsFallback: !hasValue,
    totalAssets: c.totalAssets,
    equity: c.equity,
    revenue: c.revenueThisMonth,
    netIncome: c.netIncomeThisMonth,
    netIncomeLast12: finite(c.netIncomeLast12) ? c.netIncomeLast12 : null,
    buildings: c.buildingCount,
    strategy: c.aiStrategy ?? null,
  };
}

export interface NameLookup {
  product(id: string): string;
  city(id: string): string;
  buildingCategory(id: string): string;
}

/** Display names from the catalog, with id-humanising fallbacks. */
export function nameLookup(catalog: CatalogDto | null | undefined): NameLookup {
  const products = new Map(catalog?.products.map((p) => [p.id, p.name]) ?? []);
  const cities = new Map(catalog?.cities.map((c) => [c.id, c.name]) ?? []);
  const types = new Map(catalog?.buildingTypes.map((t) => [t.id, t.name]) ?? []);
  return {
    product: (id) => products.get(id) ?? humanizeId(id),
    city: (id) => cities.get(id) ?? humanizeId(id),
    buildingCategory: (id) => types.get(id) ?? humanizeId(id),
  };
}

/** First sentence of a content description, without the tutorial's "Step N —" prefix. */
export function shortenDescription(text: string, max = 64): string {
  let s = text.replace(/^\s*step\s*\d+\s*[—–-]\s*/i, '').trim();
  const stop = s.search(/[.!?](\s|$)/);
  if (stop > 0) s = s.slice(0, stop);
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  return s;
}

/** A concise goal label from the structured goal fields (falls back to the description). */
export function goalLabel(goal: LooseGoal, names: NameLookup): string {
  const t = finite(goal.target) ? goal.target : null;
  const product = goal.productId ? names.product(goal.productId) : null;
  const city = goal.cityId ? names.city(goal.cityId) : null;
  switch (goal.kind) {
    case 'corporateValue':
      if (t !== null) return `Company value ≥ ${money(t, t >= 1e6 ? 0 : 2)}`;
      break;
    case 'marketShare':
      if (t !== null) return `${product ?? 'Market'} share${city ? ` in ${city}` : ''} ≥ ${percent(t, 0)}`;
      break;
    case 'ownsBuilding': {
      const what = goal.category ? names.buildingCategory(goal.category) : 'building';
      return t !== null && t > 1 ? `Own ${t} × ${what}` : `Own a ${what}`;
    }
    case 'productRetailed':
      if (product) return `Sell ${product} in a store`;
      break;
    case 'adCampaignActive':
      if (product) return `Advertise ${product}`;
      break;
    case 'elapsedMonths':
      if (t !== null) return `Stay in business ${t} months`;
      break;
    case 'netIncome':
      if (t !== null) return `Earn ${money(t, 0)} net income`;
      break;
    case 'topBrand':
      if (t !== null) return `${product ?? 'Brand'} awareness ≥ ${t}${city ? ` in ${city}` : ''}`;
      break;
    case 'exportRevenue':
      if (t !== null) return `Export ${money(t, 0)} of goods`;
      break;
    case 'consecutiveProfitable':
      if (t !== null) return `${t} profitable months in a row`;
      break;
    default:
      break;
  }
  return shortenDescription(goal.description ?? goal.detail ?? 'Goal');
}

function goalView(goal: LooseGoal, index: number, names: NameLookup): GoalView {
  const rule: GoalRule = goal.mode === 'holdAtDeadline' || goal.rule === 'holdAtDeadline' ? 'holdAtDeadline' : 'reachOnce';
  const achievedAt = goal.achievedAt ?? null;
  return {
    id: goal.id ?? `g${index}`,
    index: finite(goal.index) ? goal.index : index,
    label: goalLabel(goal, names),
    description: goal.description ?? goal.detail ?? '',
    achieved: goal.achieved,
    latched: rule === 'reachOnce' ? goal.achieved || achievedAt !== null : goal.achieved,
    progress: Math.min(1, Math.max(0, finite(goal.progress) ? goal.progress : 0)),
    current: finite(goal.current) ? goal.current : null,
    target: finite(goal.target) ? goal.target : null,
    unit: goal.unit ?? null,
    kind: goal.kind ?? null,
    detail: goal.detail ?? null,
    achievedAt,
    rule,
  };
}

/** Normalises a snapshot into the HUD view-model. */
export function toHudModel(snapshot: SnapshotDto, catalog?: CatalogDto | null): HudModel {
  const s = snapshot as unknown as LooseSnapshot;
  const names = nameLookup(catalog);
  const companies = (s.companies ?? []).map(companyView);
  const playerCompany = companies.find((c) => c.id === s.playerId) ?? companies.find((c) => c.isPlayer) ?? null;
  const hud = s.player;
  const player: PlayerView | null = playerCompany
    ? {
        ...playerCompany,
        value: finite(hud?.corporateValue) ? hud!.corporateValue! : playerCompany.value,
        valueIsFallback: finite(hud?.corporateValue) ? false : playerCompany.valueIsFallback,
        netIncomeLast12: finite(hud?.netIncomeLast12) ? hud!.netIncomeLast12! : playerCompany.netIncomeLast12,
        cashFlow: finite(hud?.cashFlowThisMonth) ? hud!.cashFlowThisMonth! : null,
        runwayMonths: finite(hud?.cashRunwayMonths) ? hud!.cashRunwayMonths! : null,
        idleBuildings: finite(hud?.idleBuildings) ? hud!.idleBuildings! : null,
        activeCampaigns: finite(hud?.activeCampaigns) ? hud!.activeCampaigns! : null,
        creditRating: typeof hud?.creditRating === 'string' && hud.creditRating ? hud.creditRating : null,
      }
    : null;

  let scenario: ScenarioView | null = null;
  if (s.scenario) {
    const goals = (s.scenario.goals ?? []).map((g, i) => goalView(g, i, names));
    const endDate = s.scenario.endDate ?? null;
    const monthsRemaining = finite(s.scenario.monthsRemaining)
      ? s.scenario.monthsRemaining
      : endDate
        ? Math.max(0, monthsBetween(s.date, endDate))
        : null;
    const next = s.scenario.nextGoalId ?? goals.find((g) => !g.latched)?.id ?? null;
    scenario = {
      id: s.scenario.id,
      name: s.scenario.name,
      endDate,
      monthsRemaining,
      goals,
      goalsAchieved: finite(s.scenario.goalsAchieved) ? s.scenario.goalsAchieved : goals.filter((g) => g.latched).length,
      nextGoalId: next,
    };
  }

  const status = s.outcome?.status === 'won' || s.outcome?.status === 'lost' ? s.outcome.status : 'playing';
  return {
    revision: s.revision,
    gameId: s.gameId ?? null,
    date: s.date,
    monthIndex: s.monthIndex,
    startDate: s.startDate ?? null,
    elapsedMonths: finite(s.elapsedMonths) ? s.elapsedMonths : null,
    player,
    companies,
    rivals: companies.filter((c) => c !== playerCompany),
    scenario,
    outcome: { status, reason: s.outcome?.reason ?? null, at: s.outcome?.at ?? null },
    insolvency: {
      lowCash: s.alerts?.lowCash ?? false,
      negativeCashMonths: s.alerts?.negativeCashMonths ?? 0,
      bankruptcyInMonths: finite(s.alerts?.bankruptcyInMonths) ? s.alerts!.bankruptcyInMonths! : null,
      graceMonths: s.alerts?.bankruptcyGraceMonths ?? 3, // the engine's cure window (E2 FinanceRules.CureMonths)
    },
    faulted: s.faulted ?? false,
    autopilot: s.autopilot ?? null,
  };
}
