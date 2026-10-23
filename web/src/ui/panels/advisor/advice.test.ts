import { describe, expect, it } from 'vitest';
import type { AdvisorDto, AdvisorItemDto } from '@/bridge/protocol';
import { adviceKey, adviceLinks, rankAdvice, totalAtStake } from './advice';
import { activeDismissals } from './dismissals';

const item = (over: Partial<AdvisorItemDto>): AdvisorItemDto => ({ code: 'idleBuilding', severity: 'warning', message: 'm', params: {}, ...over }) as AdvisorItemDto;

describe('advisor ranking', () => {
  const dto: AdvisorDto = {
    priority: item({ code: 'addResearch', severity: 'info' }),
    hints: [
      item({ code: 'losingBuilding', severity: 'warning', impactPerMonth: 5_000, buildingIds: [7], params: { buildingId: '7' } }),
      item({ code: 'lowRunway', severity: 'danger' }),
      item({ code: 'unservedOpportunity', severity: 'warning', impactPerMonth: 90_000, cityId: 'metro', productId: 'cola', params: { cityId: 'metro', productId: 'cola' } }),
      item({ code: 'sellingBelowCost', severity: 'warning', impactPerMonth: 12_000, fix: { method: 'setRetailPrice', argsJson: '{"buildingId":3,"slotIndex":0,"price":2}', label: 'Raise to $2' } }),
      item({ code: 'addResearch', severity: 'info' }),
    ],
  };

  it('orders by severity then $/month impact, without duplicates', () => {
    const list = rankAdvice(dto, new Set());
    expect(list.map((a) => a.item.code)).toEqual(['lowRunway', 'unservedOpportunity', 'sellingBelowCost', 'losingBuilding', 'addResearch']);
    expect(list.find((a) => a.item.code === 'sellingBelowCost')!.fix).toEqual({ method: 'setRetailPrice', args: { buildingId: 3, slotIndex: 0, price: 2 }, label: 'Raise to $2' });
    expect(list.find((a) => a.item.code === 'unservedOpportunity')!.kind).toBe('opportunity');
    expect(totalAtStake(list)).toEqual({ problems: 17_000, opportunities: 90_000 });
  });

  it('drops dismissed items until the dismissal runs out', () => {
    const key = adviceKey(dto.hints[0]!);
    expect(key).toBe('losingBuilding?buildingId=7');
    const dismissed = activeDismissals({ [key]: 5 }, 4);
    expect(rankAdvice(dto, dismissed).some((a) => a.key === key)).toBe(false);
    expect(activeDismissals({ [key]: 5 }, 5).size).toBe(0);
  });

  it('deep-links to the building first, then the screen that shows the problem', () => {
    const links = adviceLinks(dto.hints[0]!);
    expect(links[0]).toEqual({ label: 'Show building', buildingId: 7 });
    const opp = adviceLinks(dto.hints[2]!);
    expect(opp[0]).toMatchObject({ panel: 'build', params: { group: 'retail', cityId: 'metro', productId: 'cola' } });
    expect(opp[1]).toMatchObject({ panel: 'markets' });
    expect(adviceLinks(item({ code: 'lowRunway' })).map((l) => l.panel)).toEqual(['finance', 'reports']);
  });

  it('ignores a fix with malformed args', () => {
    const list = rankAdvice({ priority: item({ fix: { method: 'setRetailPrice', argsJson: '{bad', label: 'x' } }), hints: [] }, new Set());
    expect(list[0]!.fix).toBeNull();
  });
});
