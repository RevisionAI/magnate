import { describe, expect, it } from 'vitest';
import { describeEffect, effectDirection, feedCategory, humanizeIds, kindsOf, prettyMemo } from './text';

const names = { product: (id: string) => ({ soft_drink: 'Soft Drink', cotton: 'Cotton' })[id] ?? id, city: (id: string) => ({ metropolis: 'Metropolis' })[id] ?? id };

describe('text helpers', () => {
  it('replaces whole-word engine ids only', () => {
    expect(humanizeIds('soft_drink in metropolis; soft_drinks stay', ['soft_drink', 'metropolis'], (id) => names.product(id) === id ? names.city(id) : names.product(id))).toBe(
      'Soft Drink in Metropolis; soft_drinks stay',
    );
  });

  it('describes news effects', () => {
    expect(describeEffect({ kind: 'priceMultiplier', productId: 'cotton', multiplier: 0.75, months: 8 }, names)).toBe('Cotton world price −25% for 8 months');
    expect(describeEffect({ kind: 'brandShift', productId: 'soft_drink', cityId: 'metropolis', delta: 5 }, names)).toBe('Soft Drink brand awareness +5 points in Metropolis');
    expect(describeEffect({ kind: 'headline' }, names)).toBe('Headline only — no market effect');
    expect(effectDirection({ kind: 'priceMultiplier', multiplier: 1.2 })).toBe('up');
    expect(effectDirection({ kind: 'brandShift', delta: -1 })).toBe('down');
  });

  it('files feed events under the business-log filters', () => {
    expect(feedCategory('recordMonth')).toBe('sales');
    expect(feedCategory('buildingConstructed', true)).toBe('construction');
    expect(feedCategory('buildingConstructed', false)).toBe('rivals');
    expect(feedCategory('buildingConstructed', null, 3, 1)).toBe('rivals');
    expect(feedCategory('somethingNew')).toBe('operations');
    expect(kindsOf('research')).toContain('patentGranted');
  });

  it('prettifies ledger memos', () => {
    const memo = prettyMemo('sell 40000.00 soft_drink @ B12', { ids: ['soft_drink'], name: names.product, building: (id) => `Supermarket #${id}` });
    expect(memo).toBe('sell 40,000 Soft Drink @ Supermarket #12');
    expect(prettyMemo('sell 250496.04 soft_drink @ B34 in 2027', { ids: ['soft_drink'], name: names.product, building: (id) => `Supermarket #${id}` })).toBe(
      'sell 250,496 Soft Drink @ Supermarket #34 in 2027',
    );
    expect(prettyMemo('loan 12.5 pct, 1500000 principal', { ids: [], name: String, building: String })).toBe('loan 12.5 pct, 1,500,000 principal');
    expect(prettyMemo('ad tv soft_drink in metropolis', { ids: ['soft_drink', 'metropolis'], name: (id) => (id === 'metropolis' ? 'Metropolis' : 'Soft Drink'), building: String })).toBe(
      'TV ad, Soft Drink in Metropolis',
    );
  });
});
