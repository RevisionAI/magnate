import { describe, expect, it } from 'vitest';
import type { ExplainDto } from '@/bridge/protocol';
import { driverSteps, whySummary } from './why';

const names = { product: (id: string) => (id === 'cola' ? 'Cola' : id), building: (id: number) => `Store #${id}` };
const fmt = (v: number, signed?: boolean) => `${signed && v > 0 ? '+' : ''}${v}`;

function dto(amounts: number[]): ExplainDto {
  return {
    base: {} as ExplainDto['base'],
    compare: {} as ExplainDto['compare'],
    baseNetIncome: 100,
    compareNetIncome: 100 + amounts.reduce((s, a) => s + a, 0),
    drivers: amounts.map((amount, i) => ({ driver: i === 0 ? 'price' : 'volume', productId: i === 0 ? 'cola' : undefined, amount })),
  } as ExplainDto;
}

describe('why did net income change', () => {
  it('orders by size and folds the tail so steps still sum to ΔNI', () => {
    const d = dto([5, -50, 30, 1, -2, 3, 4, 6, 0]);
    const steps = driverSteps(d, names, 4);
    expect(steps).toHaveLength(4);
    expect(steps[0]!.amount).toBe(-50);
    expect(steps[3]!.label).toBe('5 smaller effects');
    expect(steps.reduce((s, x) => s + x.amount, 0)).toBe(d.compareNetIncome - d.baseNetIncome);
  });

  it('summarises the biggest driver', () => {
    expect(whySummary(dto([40, -5]), names, fmt)).toBe('Net income rose by 35, mostly from selling price · Cola (+40).');
    expect(whySummary(dto([]), names, fmt)).toBe('Net income did not change.');
  });
});
