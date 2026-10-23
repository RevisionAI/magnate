// Auto-pause triggers (UX §6.4). Each can be toggled in Settings → Gameplay.
// Pure: given the events of one month close and the enabled triggers, returns
// the reason to pause (or null). The store applies it.

import type { UiEvent } from './gameEvents';

export type AutoPauseTrigger =
  | 'goal'
  | 'cash'
  | 'rival'
  | 'idleBuilding'
  | 'majorNews'
  | 'anyBuilding'
  | 'everyMonth'
  | 'finance';

export const AUTO_PAUSE_TRIGGERS: readonly { id: AutoPauseTrigger; label: string; description: string; default: boolean }[] = [
  { id: 'goal', label: 'Goal achieved, scenario won or lost', description: 'Stop to celebrate (or regroup).', default: true },
  { id: 'cash', label: 'Cash runway under 1 month, or cash below zero', description: 'Raises a critical alert and the insolvency countdown.', default: true },
  { id: 'rival', label: 'A rival enters a market you serve', description: 'First time per city and product.', default: true },
  { id: 'idleBuilding', label: 'A building completes without anything to do', description: 'Opens it so you can set it up.', default: true },
  { id: 'majorNews', label: 'Major news event', description: 'Commodity shocks and other big headlines.', default: true },
  { id: 'finance', label: 'Loan offer or covenant warning', description: 'Missed payments and credit-rating changes.', default: true },
  { id: 'anyBuilding', label: 'Any building completes', description: 'Otherwise a toast is shown.', default: false },
  { id: 'everyMonth', label: 'Every month close ("review mode")', description: 'For deliberate players who review every month.', default: false },
];

export const AUTO_PAUSE_DEFAULTS: Readonly<Record<AutoPauseTrigger, boolean>> = Object.fromEntries(
  AUTO_PAUSE_TRIGGERS.map((t) => [t.id, t.default]),
) as Record<AutoPauseTrigger, boolean>;

export interface AutoPauseDecision {
  trigger: AutoPauseTrigger;
  message: string;
  event: UiEvent | null;
}

/** Trigger an event maps to (null = never pauses). */
export function triggerFor(e: UiEvent): AutoPauseTrigger | null {
  switch (e.kind) {
    case 'goalAchieved':
    case 'scenarioWon':
    case 'scenarioLost':
      return 'goal';
    case 'cashNegative':
    case 'bankruptcyWarning':
      return 'cash';
    case 'lowRunway':
      return e.months !== null && e.months < 1 ? 'cash' : null;
    case 'rivalEnteredMarket':
      return 'rival';
    case 'constructionCompleted':
      return e.reason === 'unconfigured' ? 'idleBuilding' : 'anyBuilding';
    case 'news':
      return e.newsSeverity === 'major' ? 'majorNews' : null;
    case 'loanPaymentMissed':
    case 'creditRatingChanged':
      return 'finance';
    case 'monthClosed':
      return 'everyMonth';
    default:
      return null;
  }
}

const PRECEDENCE: AutoPauseTrigger[] = ['goal', 'cash', 'finance', 'rival', 'idleBuilding', 'majorNews', 'anyBuilding', 'everyMonth'];

function messageFor(trigger: AutoPauseTrigger, e: UiEvent | null): string {
  switch (trigger) {
    case 'goal':
      if (e?.kind === 'scenarioWon') return 'Scenario won';
      if (e?.kind === 'scenarioLost') return 'Scenario lost';
      return 'Goal achieved';
    case 'cash':
      return e?.kind === 'lowRunway' ? 'Cash runway under one month' : 'Cash is below zero';
    case 'rival':
      return 'A rival entered your market';
    case 'idleBuilding':
      return 'A building is ready to set up';
    case 'majorNews':
      return 'Major news';
    case 'finance':
      return 'Finance needs attention';
    case 'anyBuilding':
      return 'Construction complete';
    case 'everyMonth':
      return 'Month closed — review mode';
  }
}

/** The highest-precedence enabled trigger among a close's events, or null. */
export function autoPauseDecision(
  events: readonly UiEvent[],
  enabled: Readonly<Partial<Record<AutoPauseTrigger, boolean>>>,
): AutoPauseDecision | null {
  let best: { trigger: AutoPauseTrigger; event: UiEvent } | null = null;
  for (const e of events) {
    const trigger = triggerFor(e);
    if (!trigger || !(enabled[trigger] ?? AUTO_PAUSE_DEFAULTS[trigger])) continue;
    if (!best || PRECEDENCE.indexOf(trigger) < PRECEDENCE.indexOf(best.trigger)) best = { trigger, event: e };
  }
  if (!best) return null;
  return { trigger: best.trigger, message: messageFor(best.trigger, best.event), event: best.event };
}
