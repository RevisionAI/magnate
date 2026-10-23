import { describe, expect, it } from 'vitest';
import type { GoalDto } from '@/bridge/protocol';
import { formatGoalValue, goalSeries, goalState, howTo, stateText } from './goalText';

const goal = (over: Partial<GoalDto>): GoalDto => ({ id: 'g', index: 0, kind: 'corporateValue', metric: 'corporateValue', current: 0, target: 1, unit: 'usd', progress: 0, achieved: false, mode: 'reachOnce', ...over }) as GoalDto;

describe('goal presentation', () => {
  it('formats by unit', () => {
    expect(formatGoalValue('usd', 40_000_000)).toBe('$40.0M');
    expect(formatGoalValue('ratio', 0.25)).toBe('25%');
    expect(formatGoalValue('ratio', 0.05)).toBe('5.0%');
    expect(formatGoalValue('flag', 1)).toBe('Yes');
    expect(formatGoalValue('months', 17.6)).toBe('18 mo');
    // E2: rating goals count notches above D.
    expect(formatGoalValue('rating' as GoalDto['unit'], 9)).toBe('BBB');
    expect(formatGoalValue('rating' as GoalDto['unit'], 14)).toBe('AAA');
    expect(formatGoalValue('rating' as GoalDto['unit'], 0)).toBe('D');
  });

  it('links E2 finance goals to the bank and the balance sheet', () => {
    expect(howTo(goal({ kind: 'creditRating' as GoalDto['kind'] }))!.panel).toBe('finance');
    expect(howTo(goal({ kind: 'loanTaken' as GoalDto['kind'] }))!.params).toEqual({ tab: 'bank' });
    expect(goalSeries(goal({ kind: 'corporateValue', metric: 'companyValue' }))).toBe('corporateValue');
    expect(goalSeries(goal({ kind: 'netWorth' as GoalDto['kind'], metric: 'bookEquity' }))).toBe('equity');
  });

  it('latches reach-once goals and holds hold-at-deadline goals (D11)', () => {
    const at = { year: 2027, month: 3 };
    expect(goalState(goal({ achievedAt: at, achieved: false }), false)).toBe('latched');
    expect(stateText(goal({ achievedAt: at, achieved: false }), 'latched')).toBe('Reached Mar 2027 · locked in');
    expect(goalState(goal({ mode: 'holdAtDeadline', achievedAt: at, achieved: false }), false)).toBe('open');
    expect(goalState(goal({ mode: 'holdAtDeadline', achieved: true }), false)).toBe('met');
    expect(goalState(goal({}), true)).toBe('missed');
  });

  it('links each goal kind to where it is won', () => {
    expect(howTo(goal({ kind: 'marketShare', productId: 'cola', cityId: 'metro' }))).toEqual({ label: 'Open the market', panel: 'markets', params: { productId: 'cola', cityId: 'metro' } });
    expect(howTo(goal({ kind: 'exportRevenue' }))!.params).toEqual({ tab: 'exports' });
  });

  it('only sparklines a brand goal with the company-wide brand series when it names no product', () => {
    expect(goalSeries(goal({ kind: 'topBrand', metric: 'brand', productId: 'cola', cityId: 'metro' }))).toBeNull();
    expect(goalSeries(goal({ kind: 'topBrand', metric: 'brand' }))).toBe('topBrand');
    expect(goalSeries(goal({}))).toBe('corporateValue');
  });
});
