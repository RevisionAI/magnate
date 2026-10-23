// Alerts and notifications policy (UX §6.21) as pure logic, so it is testable
// without React. The store (alertsStore.ts) owns the state; this module decides
// what becomes an alert, which alerts toast, how they dedupe and batch.
//
// | Severity    | Toast                 | Persist in Alerts |
// |-------------|-----------------------|-------------------|
// | critical    | sticky until ack      | yes               |
// | warning     | 7 s                   | yes               |
// | opportunity | 6 s                   | yes               |
// | success     | 5 s                   | yes               |
// | info        | ticker only (no toast)| news log          |
//
// Rate limits: ≤ 3 toasts on screen (newer ones queue); dedupe by
// (kind, building | market) within 3 in-game months; at 4×/8× warnings and below
// are batched into one "N things need attention" toast per close.

import type { UiEvent } from './gameEvents';

export type AlertSeverity = 'critical' | 'warning' | 'opportunity' | 'success' | 'info';

export const SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> = {
  critical: 4,
  warning: 3,
  opportunity: 2,
  success: 1,
  info: 0,
};

/** Toast lifetime per severity (ms); null = sticky until acknowledged, 0 = never toasts. */
export const TOAST_MS: Readonly<Record<AlertSeverity, number | null>> = {
  critical: null,
  warning: 7000,
  opportunity: 6000,
  success: 5000,
  info: 0,
};

export const MAX_VISIBLE_TOASTS = 3;
/** Lifetime of UI-originated info notices ("No quicksave yet"), which event-driven info never toasts. */
export const UI_INFO_TOAST_MS = 4000;
export const DEDUPE_MONTHS = 3;
export const MAX_TOASTS_PER_CLOSE = 3;

export interface AlertAction {
  kind: 'locate' | 'open' | 'ack';
  label: string;
  /** Panel to open (registry id) for kind 'open'. */
  panel?: string;
  params?: Record<string, unknown>;
}

export interface Alert {
  id: number;
  key: string;
  kind: string;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  monthIndex: number;
  createdAt: number;
  sticky: boolean;
  durationMs: number;
  buildingId: number | null;
  cityId: string | null;
  productId: string | null;
  actions: AlertAction[];
  read: boolean;
  /** For batched summary toasts: how many alerts it stands for. */
  batchCount?: number;
}

/** Events that never batch (milestones the player must see individually). */
const NEVER_BATCH = new Set(['goalAchieved', 'scenarioWon', 'scenarioLost']);
/** Events that update in place instead of deduping (countdowns). */
const REPLACE_IN_PLACE = new Set(['bankruptcyWarning']);

/** Which alert class an event belongs to (null = not an alert). */
export function classifyEvent(e: UiEvent): AlertSeverity | null {
  switch (e.kind) {
    case 'monthClosed':
    case 'buildingSales':
    case 'exportSales':
    case 'priceEffectEnded':
    case 'slotConfigured':
    case 'slotCleared':
    case 'priceChanged':
    case 'brandFading':
    case 'autosaved':
      return null;
    case 'cashNegative':
    case 'bankruptcyWarning':
    case 'scenarioLost':
    case 'loanPaymentMissed':
      return 'critical';
    case 'lossStreak':
    case 'cashLow':
    case 'lowRunway':
    case 'belowCostPrice':
    case 'rivalEnteredMarket':
    case 'rivalUndercut':
    case 'stockout':
    case 'overstock':
    case 'inputShortage':
    case 'patentBlocked':
    case 'goalLost':
      return 'warning';
    case 'netIncomeFlip':
      return e.reason === 'toProfit' ? 'success' : 'warning';
    case 'recordMonth':
    case 'revenueMilestone':
      return 'opportunity';
    case 'patentGranted':
      return e.isPlayer === false ? 'warning' : 'opportunity';
    case 'goalAchieved':
    case 'scenarioWon':
    case 'firstSale':
    case 'constructionCompleted':
    case 'brandMilestone':
    case 'shareMilestone':
    case 'shareRankFirst':
    case 'loanTaken':
    case 'buildingUpgraded':
      return 'success';
    case 'techLevelUp':
      return e.isPlayer === false ? 'info' : 'success';
    case 'buildingConstructed':
      // The player's own construction is confirmed by the build UI; rivals' openings are news.
      return 'info';
    case 'news':
      return e.newsSeverity === 'major' ? 'warning' : 'info';
    default:
      if (e.priority === 0) return null;
      return e.severity === 'danger' ? 'critical' : e.severity === 'warning' ? 'warning' : e.severity === 'success' ? 'success' : 'info';
  }
}

const TITLES: Record<string, string> = {
  cashNegative: 'Cash below zero',
  bankruptcyWarning: 'Insolvency countdown',
  scenarioLost: 'Scenario lost',
  loanPaymentMissed: 'Loan payment missed',
  lossStreak: 'Losing money',
  cashLow: 'Cash running low',
  lowRunway: 'Low cash runway',
  belowCostPrice: 'Selling below cost',
  rivalEnteredMarket: 'Rival entered your market',
  rivalUndercut: 'Rival undercut your price',
  stockout: 'Stock-out',
  overstock: 'Overstock',
  inputShortage: 'Input shortage',
  patentBlocked: 'Research blocked by a patent',
  goalLost: 'Goal slipped',
  recordMonth: 'Record month',
  revenueMilestone: 'Revenue milestone',
  patentGranted: 'Patent granted',
  goalAchieved: 'Goal achieved',
  scenarioWon: 'Victory',
  firstSale: 'First sale',
  constructionCompleted: 'Construction complete',
  brandMilestone: 'Brand milestone',
  shareMilestone: 'Market share milestone',
  shareRankFirst: 'Market leader',
  loanTaken: 'Loan approved',
  buildingUpgraded: 'Upgrade complete',
  techLevelUp: 'Technology improved',
  news: 'Breaking news',
};

export function alertTitle(e: UiEvent): string {
  if (e.kind === 'netIncomeFlip') return e.reason === 'toProfit' ? 'Back in profit' : 'Net income turned negative';
  if (e.kind === 'patentGranted' && e.isPlayer === false) return 'Rival patent granted';
  return TITLES[e.kind] ?? (e.kind.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim() || 'Notice');
}

/** Dedupe identity: (kind, building | market | goal). */
export function dedupeKey(e: UiEvent): string {
  if (e.kind === 'news') return `news|${e.seq || e.message}`;
  if (e.kind === 'goalAchieved' || e.kind === 'goalLost') return `${e.kind}|${e.goalId ?? e.message}`;
  const target = e.buildingId !== null ? `b${e.buildingId}` : `${e.cityId ?? ''}:${e.productId ?? ''}`;
  return `${e.kind}|${target}|${e.companyId ?? ''}`;
}

function actionsFor(e: UiEvent): AlertAction[] {
  const actions: AlertAction[] = [];
  if (e.buildingId !== null || e.cityId !== null) actions.push({ kind: 'locate', label: 'Locate' });
  switch (e.kind) {
    case 'cashNegative':
    case 'bankruptcyWarning':
    case 'lowRunway':
    case 'cashLow':
    case 'loanPaymentMissed':
      actions.push({ kind: 'open', label: 'Finance', panel: 'finance' });
      break;
    case 'lossStreak':
    case 'netIncomeFlip':
    case 'recordMonth':
      actions.push({ kind: 'open', label: 'Why?', panel: 'reports', params: { tab: 'pnl' } });
      break;
    case 'rivalEnteredMarket':
    case 'rivalUndercut':
      actions.push({ kind: 'open', label: 'Markets', panel: 'markets', params: { cityId: e.cityId, productId: e.productId } });
      break;
    case 'goalAchieved':
    case 'goalLost':
      actions.push({ kind: 'open', label: 'Goals', panel: 'goals' });
      break;
    case 'patentGranted':
    case 'patentBlocked':
    case 'techLevelUp':
      actions.push({ kind: 'open', label: 'R&D', panel: 'rnd' });
      break;
    case 'news':
      actions.push({ kind: 'open', label: 'News', panel: 'news' });
      break;
    default:
      break;
  }
  return actions;
}

export interface IngestContext {
  /** In-game month index of the close (snapshot.monthIndex). */
  monthIndex: number;
  /** Playback multiplier at the time of the close (1, 2, 4, 8; 0 when stepping). */
  speedMultiplier: number;
  /** Wall-clock ms (performance.now()). */
  now: number;
}

export interface IngestResult {
  /** Every new alert, for the Alerts history (newest last). */
  alerts: Alert[];
  /** Alerts to toast, in display order (may include a batched summary not present in `alerts`). */
  toasts: Alert[];
  /** Keys whose visible toast should be replaced in place (countdowns). */
  replaceKeys: string[];
}

/** The stateful part of the policy: dedupe memory and ids. One per game. */
export class AlertPolicy {
  private readonly lastSeen = new Map<string, number>();
  private nextId = 1;

  reset(): void {
    this.lastSeen.clear();
  }

  /** Builds an alert directly (UI-originated notices such as "Game saved"). */
  make(input: {
    kind: string;
    severity: AlertSeverity;
    title: string;
    body?: string | null;
    monthIndex?: number;
    now: number;
    actions?: AlertAction[];
    sticky?: boolean;
  }): Alert {
    // UI notices answer something the player just did, so even 'info' toasts briefly.
    const duration = input.severity === 'info' ? UI_INFO_TOAST_MS : TOAST_MS[input.severity];
    const sticky = input.sticky ?? duration === null;
    const actions = input.actions ?? [];
    return {
      id: this.nextId++,
      key: `${input.kind}|ui|${this.nextId}`,
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      body: input.body ?? null,
      monthIndex: input.monthIndex ?? 0,
      createdAt: input.now,
      sticky,
      durationMs: duration ?? 0,
      buildingId: null,
      cityId: null,
      productId: null,
      // A sticky toast always offers a way to acknowledge it.
      actions: sticky && !actions.some((a) => a.kind === 'ack') ? [...actions, { kind: 'ack', label: 'Dismiss' }] : actions,
      read: false,
    };
  }

  ingest(events: readonly UiEvent[], ctx: IngestContext): IngestResult {
    const alerts: Alert[] = [];
    const replaceKeys: string[] = [];
    for (const e of events) {
      const severity = classifyEvent(e);
      if (severity === null) continue;
      if (e.priority === 0 && severity !== 'critical') continue;
      const key = dedupeKey(e);
      const replace = REPLACE_IN_PLACE.has(e.kind);
      const last = this.lastSeen.get(key);
      if (!replace && last !== undefined && ctx.monthIndex - last < DEDUPE_MONTHS) continue;
      this.lastSeen.set(key, ctx.monthIndex);
      if (replace) replaceKeys.push(key);
      const duration = TOAST_MS[severity];
      alerts.push({
        id: this.nextId++,
        key,
        kind: e.kind,
        severity,
        title: alertTitle(e),
        body: e.message || null,
        monthIndex: ctx.monthIndex,
        createdAt: ctx.now,
        sticky: duration === null,
        durationMs: duration ?? 0,
        buildingId: e.buildingId,
        cityId: e.cityId,
        productId: e.productId,
        actions: duration === null ? [...actionsFor(e), { kind: 'ack', label: 'Acknowledge' }] : actionsFor(e),
        read: false,
      });
    }

    let candidates = alerts.filter((a) => TOAST_MS[a.severity] !== 0);
    if (ctx.speedMultiplier >= 4) {
      const batchable = candidates.filter((a) => a.severity !== 'critical' && !NEVER_BATCH.has(a.kind));
      if (batchable.length >= 2) {
        const top = batchable.reduce((best, a) => (SEVERITY_RANK[a.severity] > SEVERITY_RANK[best.severity] ? a : best));
        const summary: Alert = {
          id: this.nextId++,
          key: `batch|${ctx.monthIndex}`,
          kind: 'batch',
          severity: top.severity,
          title: `${batchable.length} things need attention`,
          body: batchable
            .slice(0, 3)
            .map((a) => a.title)
            .join(' · '),
          monthIndex: ctx.monthIndex,
          createdAt: ctx.now,
          sticky: false,
          durationMs: TOAST_MS[top.severity] ?? 7000,
          buildingId: null,
          cityId: null,
          productId: null,
          actions: [{ kind: 'open', label: 'View alerts', panel: 'alerts' }],
          read: false,
          batchCount: batchable.length,
        };
        const batched = new Set(batchable.map((a) => a.id));
        candidates = [...candidates.filter((a) => !batched.has(a.id)), summary];
      }
    }

    // Criticals first, then milestones (goals, outcome), then by severity; ties keep arrival order.
    const rank = (a: Alert) => (a.severity === 'critical' ? 10 : NEVER_BATCH.has(a.kind) ? 9 : SEVERITY_RANK[a.severity]);
    const toasts = [...candidates].sort((a, b) => rank(b) - rank(a) || a.id - b.id).slice(0, MAX_TOASTS_PER_CLOSE);
    return { alerts, toasts, replaceKeys };
  }
}
