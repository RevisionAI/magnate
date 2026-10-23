import { describe, expect, it } from 'vitest';
import type { BuildingSummaryDto, CatalogDto } from '@/bridge/protocol';
import { consequence, exposureTo, playerExposure } from './relevance';

const b = (ownerId: number, slotKind: string, products: string[]) => ({ ownerId, slotKind, products }) as unknown as BuildingSummaryDto;
const catalog = { products: [{ id: 'shirt', recipe: { inputs: [{ productId: 'cotton' }] } }, { id: 'cotton' }] } as unknown as CatalogDto;

describe('news relevance', () => {
  const ex = playerExposure([b(1, 'retail', ['shirt']), b(1, 'production', ['shirt']), b(1, 'extraction', ['oil']), b(2, 'retail', ['cola'])], 1, catalog);

  it('collects what you sell, make and buy', () => {
    expect([...ex.sold]).toEqual(['shirt']);
    expect([...ex.made].sort()).toEqual(['oil', 'shirt']);
    expect([...ex.inputs]).toEqual(['cotton']);
    expect(exposureTo({ kind: 'priceMultiplier', productId: 'cola', multiplier: 2 }, ex)).toEqual([]);
    expect(exposureTo({ kind: 'priceMultiplier', productId: 'shirt', multiplier: 2 }, ex)).toEqual(['sell', 'make']);
  });

  it('explains consequences in plain words', () => {
    expect(consequence({ kind: 'priceMultiplier', productId: 'cotton', multiplier: 1.3 }, 'input', 'Cotton')).toEqual({ text: 'Your factories pay more for Cotton.', good: false });
    expect(consequence({ kind: 'priceMultiplier', productId: 'oil', multiplier: 1.3 }, 'make', 'Oil').good).toBe(true);
    expect(consequence({ kind: 'brandShift', productId: 'shirt', delta: 3 }, 'sell', 'Shirt').good).toBeNull();
  });
});
