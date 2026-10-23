import { describe, expect, it } from 'vitest';
import type { GameEventDto } from '@/bridge/protocol';
import { AlertPolicy, classifyEvent, dedupeKey, MAX_TOASTS_PER_CLOSE, TOAST_MS } from './alerts';
import { autoPauseDecision, AUTO_PAUSE_DEFAULTS } from './autopause';
import { EventDeduper, normalizeEvent } from './gameEvents';

// Fixtures are loose on purpose: they cover today's protocol (news severities
// 'notable'/'major') and bridge-spec §7.1 (UiSeverity + priority) alike.
const ev = (e: { kind: string; severity?: string } & Record<string, unknown>) =>
  normalizeEvent({ severity: 'info', message: '', ...e } as unknown as GameEventDto);

describe('event normalisation', () => {
  it('maps today’s news severities and defaults priorities', () => {
    const major = ev({ kind: 'news', severity: 'major', message: 'OPEC oversupply' });
    expect(major.newsSeverity).toBe('major');
    expect(major.severity).toBe('warning');
    expect(major.priority).toBe(2);
    const notable = ev({ kind: 'news', severity: 'notable' });
    expect(notable.newsSeverity).toBe('notable');
    expect(notable.severity).toBe('info');
    expect(ev({ kind: 'monthClosed', severity: 'success' }).priority).toBe(0);
    expect(ev({ kind: 'cashNegative', severity: 'danger' }).priority).toBe(3);
  });

  it('dedupes by bridge seq but lets seq-less events through', () => {
    const d = new EventDeduper(2);
    expect(d.accept(ev({ kind: 'news', seq: 5 }))).toBe(true);
    expect(d.accept(ev({ kind: 'news', seq: 5 }))).toBe(false);
    expect(d.accept(ev({ kind: 'news' }))).toBe(true);
    expect(d.accept(ev({ kind: 'news' }))).toBe(true);
    d.accept(ev({ kind: 'news', seq: 6 }));
    d.accept(ev({ kind: 'news', seq: 7 })); // evicts 5
    expect(d.accept(ev({ kind: 'news', seq: 5 }))).toBe(true);
  });
});

describe('alerts policy (UX §6.21)', () => {
  it('classifies by severity class', () => {
    expect(classifyEvent(ev({ kind: 'cashNegative', severity: 'danger' }))).toBe('critical');
    expect(classifyEvent(ev({ kind: 'rivalEnteredMarket', severity: 'warning' }))).toBe('warning');
    expect(classifyEvent(ev({ kind: 'recordMonth', severity: 'success' }))).toBe('opportunity');
    expect(classifyEvent(ev({ kind: 'goalAchieved', severity: 'success' }))).toBe('success');
    expect(classifyEvent(ev({ kind: 'news', severity: 'info' }))).toBe('info');
    expect(classifyEvent(ev({ kind: 'monthClosed', severity: 'success' }))).toBeNull();
    expect(classifyEvent(ev({ kind: 'netIncomeFlip', reason: 'toLoss' }))).toBe('warning');
    expect(classifyEvent(ev({ kind: 'netIncomeFlip', reason: 'toProfit' }))).toBe('success');
  });

  it('uses the documented toast lifetimes', () => {
    expect(TOAST_MS.critical).toBeNull();
    expect(TOAST_MS.warning).toBe(7000);
    expect(TOAST_MS.opportunity).toBe(6000);
    expect(TOAST_MS.success).toBe(5000);
    expect(TOAST_MS.info).toBe(0);
  });

  it('keeps criticals sticky with an acknowledge action', () => {
    const policy = new AlertPolicy();
    const { toasts } = policy.ingest([ev({ kind: 'cashNegative', severity: 'danger', message: 'Cash has gone negative.' })], {
      monthIndex: 10,
      speedMultiplier: 1,
      now: 0,
    });
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.sticky).toBe(true);
    expect(toasts[0]!.actions.some((a) => a.kind === 'ack')).toBe(true);
  });

  it('dedupes the same (kind, market) within 3 months', () => {
    const policy = new AlertPolicy();
    const rival = () => ev({ kind: 'rivalEnteredMarket', severity: 'warning', cityId: 'metropolis', productId: 'soft_drink' });
    expect(policy.ingest([rival()], { monthIndex: 1, speedMultiplier: 1, now: 0 }).alerts).toHaveLength(1);
    expect(policy.ingest([rival()], { monthIndex: 3, speedMultiplier: 1, now: 0 }).alerts).toHaveLength(0);
    expect(policy.ingest([rival()], { monthIndex: 4, speedMultiplier: 1, now: 0 }).alerts).toHaveLength(1);
    expect(dedupeKey(rival())).toBe('rivalEnteredMarket|metropolis:soft_drink|');
  });

  it('batches warnings and below at 4×/8× but never goals or criticals', () => {
    const policy = new AlertPolicy();
    const events = [
      ev({ kind: 'stockout', severity: 'warning', buildingId: 1 }),
      ev({ kind: 'belowCostPrice', severity: 'warning', buildingId: 2 }),
      ev({ kind: 'recordMonth', severity: 'success' }),
      ev({ kind: 'goalAchieved', severity: 'success', goalId: 'g1' }),
      ev({ kind: 'cashNegative', severity: 'danger' }),
    ];
    const fast = policy.ingest(events, { monthIndex: 5, speedMultiplier: 8, now: 0 });
    expect(fast.alerts).toHaveLength(5); // all persisted
    const kinds = fast.toasts.map((t) => t.kind);
    expect(kinds).toContain('batch');
    expect(kinds).toContain('goalAchieved');
    expect(kinds).toContain('cashNegative');
    expect(fast.toasts.find((t) => t.kind === 'batch')!.batchCount).toBe(3);

    const slow = new AlertPolicy().ingest(events, { monthIndex: 5, speedMultiplier: 1, now: 0 });
    expect(slow.toasts).toHaveLength(MAX_TOASTS_PER_CLOSE);
    expect(slow.toasts[0]!.kind).toBe('cashNegative'); // critical first
    expect(slow.toasts[1]!.kind).toBe('goalAchieved'); // then milestones
  });

  it('never toasts info or priority-0 events', () => {
    const policy = new AlertPolicy();
    const result = policy.ingest(
      [ev({ kind: 'news', severity: 'info', seq: 3 }), ev({ kind: 'buildingSales', severity: 'info', priority: 0 })],
      { monthIndex: 1, speedMultiplier: 1, now: 0 },
    );
    expect(result.toasts).toHaveLength(0);
    expect(result.alerts.map((a) => a.kind)).toEqual(['news']);
  });
});

describe('auto-pause triggers (UX §6.4)', () => {
  it('pauses on goals, cash and rivals by default, not on every month', () => {
    expect(autoPauseDecision([ev({ kind: 'goalAchieved' })], AUTO_PAUSE_DEFAULTS)?.trigger).toBe('goal');
    expect(autoPauseDecision([ev({ kind: 'cashNegative' })], AUTO_PAUSE_DEFAULTS)?.trigger).toBe('cash');
    expect(autoPauseDecision([ev({ kind: 'rivalEnteredMarket' })], AUTO_PAUSE_DEFAULTS)?.trigger).toBe('rival');
    expect(autoPauseDecision([ev({ kind: 'monthClosed' })], AUTO_PAUSE_DEFAULTS)).toBeNull();
    expect(autoPauseDecision([ev({ kind: 'news', severity: 'notable' })], AUTO_PAUSE_DEFAULTS)).toBeNull();
    expect(autoPauseDecision([ev({ kind: 'news', severity: 'major' })], AUTO_PAUSE_DEFAULTS)?.trigger).toBe('majorNews');
  });

  it('respects toggles and precedence', () => {
    const events = [ev({ kind: 'rivalEnteredMarket' }), ev({ kind: 'goalAchieved' })];
    expect(autoPauseDecision(events, AUTO_PAUSE_DEFAULTS)?.trigger).toBe('goal');
    expect(autoPauseDecision(events, { ...AUTO_PAUSE_DEFAULTS, goal: false })?.trigger).toBe('rival');
    expect(autoPauseDecision([ev({ kind: 'monthClosed' })], { ...AUTO_PAUSE_DEFAULTS, everyMonth: true })?.trigger).toBe('everyMonth');
    expect(autoPauseDecision([ev({ kind: 'lowRunway', months: 2 })], AUTO_PAUSE_DEFAULTS)).toBeNull();
    expect(autoPauseDecision([ev({ kind: 'lowRunway', months: 0.5 })], AUTO_PAUSE_DEFAULTS)?.trigger).toBe('cash');
  });
});

describe('UI notices (AlertPolicy.make)', () => {
  it('toasts info notices briefly instead of never', () => {
    const policy = new AlertPolicy();
    const info = policy.make({ kind: 'noQuicksave', severity: 'info', title: 'No quicksave yet', now: 0 });
    expect(info.sticky).toBe(false);
    expect(info.durationMs).toBe(4000);
    expect(info.actions).toEqual([]);
  });

  it('always gives a sticky notice a way to acknowledge it', () => {
    const policy = new AlertPolicy();
    const critical = policy.make({ kind: 'saveFailed', severity: 'critical', title: 'Save failed', now: 0 });
    expect(critical.sticky).toBe(true);
    expect(critical.actions.map((a) => a.kind)).toEqual(['ack']);
    const withAck = policy.make({ kind: 'x', severity: 'critical', title: 'X', now: 0, actions: [{ kind: 'ack', label: 'OK' }] });
    expect(withAck.actions).toHaveLength(1);
    expect(policy.make({ kind: 'w', severity: 'warning', title: 'W', now: 0 }).durationMs).toBe(TOAST_MS.warning);
  });
});
