// Normalises GameEventDto (today's 7-field shape and bridge-spec §7.1's flat
// additive shape) into one UI event type, and keeps the event-kind vocabulary
// the alerts policy, auto-pause rules and ticker share.

import type { DateDto, GameEventDto } from '@/bridge/protocol';

export type UiSeverity = 'info' | 'success' | 'warning' | 'danger';
export type NewsSeverity = 'info' | 'notable' | 'major';

export interface UiEvent {
  kind: string;
  severity: UiSeverity;
  /** News severity (news events only). */
  newsSeverity: NewsSeverity | null;
  message: string;
  /** Bridge sequence number (0 when the bridge does not send one yet). */
  seq: number;
  month: DateDto | null;
  /** 0 = ambient only, 1 = feed, 2 = toast-worthy, 3 = must interrupt (bridge-spec §7.1). */
  priority: 0 | 1 | 2 | 3;
  amount: number | null;
  buildingId: number | null;
  cityId: string | null;
  productId: string | null;
  companyId: number | null;
  isPlayer: boolean | null;
  goalId: string | null;
  reason: string | null;
  months: number | null;
  threshold: number | null;
  oldValue: number | null;
  newValue: number | null;
  typeId: string | null;
  raw: GameEventDto;
}

interface LooseEvent {
  kind: string;
  severity?: string;
  message?: string;
  amount?: number | null;
  buildingId?: number | null;
  cityId?: string | null;
  productId?: string | null;
  seq?: number;
  month?: DateDto | null;
  priority?: number;
  companyId?: number | null;
  isPlayer?: boolean | null;
  goalId?: string | null;
  reason?: string | null;
  months?: number | null;
  threshold?: number | null;
  oldValue?: number | null;
  newValue?: number | null;
  typeId?: string | null;
}

/** Default priority by kind when the bridge does not send one (bridge-spec §7.2 table). */
const DEFAULT_PRIORITY: Record<string, 0 | 1 | 2 | 3> = {
  monthClosed: 0,
  buildingSales: 0,
  exportSales: 0,
  priceEffectEnded: 0,
  brandFading: 0,
  slotConfigured: 0,
  slotCleared: 0,
  priceChanged: 0,
  firstSale: 2,
  recordMonth: 2,
  netIncomeFlip: 2,
  lossStreak: 2,
  cashLow: 2,
  lowRunway: 2,
  cashNegative: 3,
  bankruptcyWarning: 3,
  goalAchieved: 3,
  goalLost: 1,
  scenarioWon: 3,
  scenarioLost: 3,
  news: 1,
  buildingConstructed: 1,
  buildingUpgraded: 1,
  techLevelUp: 2,
  patentGranted: 2,
  patentExpired: 1,
  patentBlocked: 2,
  revenueMilestone: 2,
  rivalEnteredMarket: 2,
  rivalUndercut: 1,
  shareRankFirst: 2,
  shareMilestone: 1,
  campaignStarted: 1,
  campaignChanged: 1,
  campaignCancelled: 1,
  brandMilestone: 1,
  belowCostPrice: 2,
  autosaved: 1,
  stockout: 2,
  overstock: 1,
  inputShortage: 2,
  constructionStarted: 1,
  constructionCompleted: 2,
  loanTaken: 2,
  loanPaymentMissed: 3,
  creditRatingChanged: 2,
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Normalise one bridge event. */
export function normalizeEvent(dto: GameEventDto): UiEvent {
  const e = dto as unknown as LooseEvent;
  const rawSeverity = (e.severity ?? 'info').toLowerCase();
  const isNews = e.kind === 'news';
  // Today's bridge sends news severities (info/notable/major) in `severity`; §7.2 maps major → warning.
  const newsSeverity: NewsSeverity | null = isNews
    ? rawSeverity === 'major' || (rawSeverity === 'warning' && isNews)
      ? 'major'
      : rawSeverity === 'notable'
        ? 'notable'
        : 'info'
    : null;
  const severity: UiSeverity =
    rawSeverity === 'success' || rawSeverity === 'warning' || rawSeverity === 'danger'
      ? rawSeverity
      : rawSeverity === 'major'
        ? 'warning'
        : 'info';
  const priority = (num(e.priority) ?? DEFAULT_PRIORITY[e.kind] ?? 1) as 0 | 1 | 2 | 3;
  return {
    kind: e.kind,
    severity,
    newsSeverity,
    message: e.message ?? '',
    seq: num(e.seq) ?? 0,
    month: e.month ?? null,
    priority: (isNews && newsSeverity === 'major' && priority < 2 ? 2 : priority) as 0 | 1 | 2 | 3,
    amount: num(e.amount),
    buildingId: num(e.buildingId),
    cityId: str(e.cityId),
    productId: str(e.productId),
    companyId: num(e.companyId),
    isPlayer: typeof e.isPlayer === 'boolean' ? e.isPlayer : null,
    goalId: str(e.goalId),
    reason: str(e.reason),
    months: num(e.months),
    threshold: num(e.threshold),
    oldValue: num(e.oldValue),
    newValue: num(e.newValue),
    typeId: str(e.typeId),
    raw: dto,
  };
}

/**
 * Drops events already seen (by bridge `seq`) so an event delivered both in a
 * tick result and an envelope is processed once. Events without a seq (today's
 * bridge) always pass. Bounded memory.
 */
export class EventDeduper {
  private readonly seen = new Set<number>();
  private readonly order: number[] = [];

  constructor(private readonly capacity = 1024) {}

  accept(event: UiEvent): boolean {
    if (event.seq <= 0) return true;
    if (this.seen.has(event.seq)) return false;
    this.seen.add(event.seq);
    this.order.push(event.seq);
    if (this.order.length > this.capacity) this.seen.delete(this.order.shift()!);
    return true;
  }

  reset(): void {
    this.seen.clear();
    this.order.length = 0;
  }
}
