import { describe, expect, it } from 'vitest';
import type { MarketRowDto } from '@/bridge/protocol';
import { contestedMarkets, threatLevel } from './threat';

const row = (cityId: string, demand: number, top: number | null, share: number, mine: number, present = true) =>
  ({ cityId, productId: 'cola', playerPresent: present, potentialDemand: demand, topRival: top === null ? null : { companyId: top, share }, playerRealisedShare: mine }) as unknown as MarketRowDto;

describe('rival threat', () => {
  it('lists the markets you serve where this rival leads, biggest first', () => {
    const rows = [row('a', 100, 2, 0.5, 0.2), row('b', 300, 2, 0.8, 0.1), row('c', 500, 3, 0.9, 0), row('d', 900, 2, 0.9, 0, false)];
    const c = contestedMarkets(rows, 2);
    expect(c.map((m) => m.cityId)).toEqual(['b', 'a']);
  });

  it('scores demand-weighted share, scaled by exposure', () => {
    expect(threatLevel([])).toEqual({ score: 0, label: 'None' });
    const c = contestedMarkets([row('a', 100, 2, 0.9, 0.1)], 2);
    expect(threatLevel(c).label).toBe('High');
    // the same market is one small part of a big business → lower threat
    expect(threatLevel(c, 10_000).score).toBeCloseTo(0.9 * (0.5 + 0.5 * 0.01), 6);
    expect(threatLevel(c, 10_000).label).toBe('Medium');
  });
});
