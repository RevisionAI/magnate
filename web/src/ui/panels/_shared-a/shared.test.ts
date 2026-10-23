import { describe, expect, it } from 'vitest';
import type { BuildingDetailDto, SlotDetailDto } from '@/bridge/protocol';
import { friendlyError } from './errors';
import { expectedAt, openingPrice, priceRange, priceStep, priceTrack, priceWarnings } from './priceBands';
import { cashTiedUp, classifyPolicy, coverMonths, lineForecast, lostShare, unitsForCover } from './stockPolicy';
import { bandPlacement, linkWidth, shelfEmptied, unitCells, unitFlow, type FlowLink, type FlowNode } from './unitGrid';
import { normalizePlacement } from './placement';

const retail = (over: Partial<NonNullable<SlotDetailDto['retail']>> = {}): NonNullable<SlotDetailDto['retail']> => ({
  price: 2.25,
  restockTarget: 60000,
  onHand: 0,
  unitCost: 0,
  effectiveWorldPrice: 1.5,
  lastMonthUnits: 60000,
  lastMonthRevenue: 135000,
  rivalCount: 1,
  modelDemandUnits: 1_000_000,
  belowCost: false,
  ...over,
});

describe('stock policy (months of cover)', () => {
  it('forecasts from last month demand, then sold + lost, then the bridge model — never from capped sales alone', () => {
    expect(lineForecast(retail({ lastMonthDemand: 80000 }))).toEqual({ units: 80000, source: 'lastMonthDemand' });
    expect(lineForecast(retail({ lastMonthLostUnits: 20000 }))).toEqual({ units: 80000, source: 'soldPlusLost' });
    expect(lineForecast(retail())).toEqual({ units: 1_000_000, source: 'model' });
    expect(lineForecast(retail({ modelDemandUnits: 0, lastMonthUnits: 0 }))).toEqual({ units: 0, source: 'none' });
  });

  it('converts cover to units and back, and classifies presets', () => {
    expect(unitsForCover(1, 80000)).toBe(80000);
    expect(unitsForCover(0.5, 80001)).toBe(40001);
    expect(unitsForCover(1, 0)).toBe(1);
    expect(coverMonths(120000, 80000)).toBe(1.5);
    expect(coverMonths(1, 0)).toBeNull();
    expect(classifyPolicy(40000, 80000)).toBe('lean');
    expect(classifyPolicy(81000, 80000)).toBe('balanced');
    expect(classifyPolicy(120000, 80000)).toBe('deep');
    expect(classifyPolicy(250000, 80000)).toBe('custom');
    expect(classifyPolicy(250000, 0)).toBe('custom');
  });

  it('prices the shelf at unit cost, or the world price before the first delivery', () => {
    expect(cashTiedUp(1000, 1.2, 1.5)).toBe(1200);
    expect(cashTiedUp(1000, 0, 1.5)).toBe(1500);
  });

  it('reports lost share only when the engine records lost sales', () => {
    expect(lostShare(retail())).toBeNull();
    expect(lostShare(retail({ lastMonthLostUnits: 20000 }))).toBeCloseTo(0.25);
    expect(lostShare(retail({ lastMonthLostUnits: 0 }))).toBe(0);
  });
});

describe('price track (UX §6.7.3)', () => {
  const ctx = { unitCost: 1.52, worldPrice: 1.5, rivalMin: 1.71, rivalMedian: 1.8, suggested: 2.4, ceilings: [{ bracket: 'low' as const, price: 8 }, { bracket: 'middle' as const, price: 50 }] };

  it('spans half the unit cost to max(3 × world, 1.1 × top ceiling) with a 1%-of-world step', () => {
    expect(priceRange(ctx)).toEqual({ min: 0.76, max: 55 });
    expect(priceStep(1.5)).toBe(0.02);
    expect(priceStep(0.4)).toBe(0.01);
    expect(priceStep(18000)).toBe(180);
  });

  it('widens to keep the current price on the track', () => {
    const r = priceRange({ unitCost: 1, worldPrice: 1, current: 10 });
    expect(r.max).toBeGreaterThanOrEqual(10);
    const low = priceRange({ unitCost: 1, worldPrice: 1, current: 0.2 });
    expect(low.min).toBeLessThanOrEqual(0.2);
  });

  it('marks cost, world, rival, suggested and ceilings; bands below cost and above each ceiling', () => {
    const t = priceTrack(ctx);
    const labels = t.marks.map((m) => m.label);
    expect(labels).toEqual(expect.arrayContaining(['Cost', 'Rival', 'Rival median', 'Suggested', 'Low ceiling', 'Mid ceiling']));
    expect(t.marks.find((m) => m.label === 'Suggested')?.shape).toBe('diamond');
    expect(t.bands[0]).toMatchObject({ from: 0.76, to: 1.52, tone: 'danger' });
    expect(t.bands.filter((b) => b.tone === 'warning').map((b) => [b.from, b.to])).toEqual([
      [8, 50],
      [50, 55],
    ]);
    // World price within half a step of cost is not marked twice.
    expect(priceTrack({ ...ctx, unitCost: 1.5 }).marks.some((m) => m.label === 'World')).toBe(false);
    expect(priceTrack({ ...ctx, unitCost: 0 }).marks[0].label).toBe('Cost (est.)');
  });

  it('warns below cost and above ceilings with the excluded share of demand', () => {
    expect(priceWarnings(1.4, ctx)).toEqual([{ tone: 'danger', text: 'Selling at a loss of $0.12 per unit.' }]);
    const brackets = [
      { bracket: 'low' as const, population: 1, perCapita: 1, demand: 1125000, reservationPrice: 8, eligibleRetailers: 1 },
      { bracket: 'middle' as const, population: 1, perCapita: 1, demand: 1200000, reservationPrice: 50, eligibleRetailers: 1 },
      { bracket: 'high' as const, population: 1, perCapita: 1, demand: 300000, eligibleRetailers: 1 },
    ];
    const w = priceWarnings(9, ctx, brackets);
    expect(w).toHaveLength(1);
    expect(w[0].tone).toBe('warning');
    expect(w[0].text).toContain('low-income');
    expect(w[0].text).toContain('43%');
    expect(priceWarnings(2.4, ctx)).toEqual([]);
  });

  it('reads the bridge curve between evaluated points', () => {
    const pts = [
      { price: 2, units: 100, revenue: 200, grossProfit: 50 },
      { price: 3, units: 50, revenue: 150, grossProfit: 75 },
    ];
    expect(expectedAt(pts, 2.5)).toEqual({ units: 75, revenue: 175, grossProfit: 62.5, extrapolated: false });
    expect(expectedAt(pts, 1)).toMatchObject({ units: 100, extrapolated: true });
    expect(expectedAt(pts, 9)).toMatchObject({ units: 50, extrapolated: true });
    expect(expectedAt([], 2)).toBeNull();
  });

  it('opens a new line at the cheapest rival, a curated starter price, or a standard markup', () => {
    expect(openingPrice({ cheapestRivalPrice: 2.1375, worldPrice: 1.5 })).toBe(2.14);
    expect(openingPrice({ starterPrice: 4.25, worldPrice: 2.5 })).toBe(4.25);
    expect(openingPrice({ worldPrice: 1.5 })).toBe(2.25);
  });
});

const detail = (slots: SlotDetailDto[], over: Partial<BuildingDetailDto> = {}): BuildingDetailDto =>
  ({
    id: 1,
    typeId: 'supermarket',
    typeName: 'Supermarket',
    category: 'supermarket',
    slotKind: 'retail',
    ownerId: 1,
    ownerName: 'You',
    isPlayer: true,
    cityId: 'metropolis',
    cityName: 'Metropolis',
    level: 1,
    maxLevel: 3,
    capacity: 6,
    slotsUsed: slots.length,
    nextFreeSlotIndex: 1,
    monthlyOpex: 15000,
    constructionCost: 1_200_000,
    bookValue: 1_200_000,
    autoExport: false,
    autoExportApplies: false,
    slots,
    inventory: [],
    inventoryTotals: { raw: { units: 0, cost: 0 }, intermediate: { units: 0, cost: 0 }, finished: { units: 0, cost: 0 } },
    pnl: {} as BuildingDetailDto['pnl'],
    supply: { sources: [], destinations: [] },
    actions: { canUpgrade: true, canAddSlot: true, canConfigure: true, canToggleAutoExport: false, canDemolish: false, eligibleProductIds: [] },
    placement: { px: 0, pz: 0, rotation: 0, source: 'auto' },
    ...over,
  }) as BuildingDetailDto;

const levels = [
  { level: 1, capacity: 6, monthlyOperatingCost: 15000, upgradeCost: 0 },
  { level: 2, capacity: 9, monthlyOperatingCost: 12750, upgradeCost: 720000 },
  { level: 3, capacity: 12, monthlyOperatingCost: 12000, upgradeCost: 600000 },
];

describe('unit grid (UX §6.7.2)', () => {
  const soft: SlotDetailDto = { index: 0, kind: 'retail', productId: 'soft_drink', productName: 'Soft Drink', tier: 'finished', retail: retail() };

  it('lays out capacity as used/free cells plus the next level as locked, in rows of three', () => {
    const cells = unitCells(detail([soft]), levels);
    expect(cells).toHaveLength(9);
    expect(cells[0]).toMatchObject({ state: 'used', slot: soft });
    expect(cells.slice(1, 6).every((c) => c.state === 'free')).toBe(true);
    expect(cells.slice(6).map((c) => [c.state, c.unlockLevel])).toEqual([
      ['locked', 2],
      ['locked', 2],
      ['locked', 2],
    ]);
    const maxed = unitCells(detail([soft], { level: 3, capacity: 12 }), levels);
    expect(maxed).toHaveLength(12);
    expect(maxed.some((c) => c.state === 'locked')).toBe(false);
    const four = unitCells(detail([], { capacity: 4, level: 1 }), [{ level: 1, capacity: 4, monthlyOperatingCost: 1, upgradeCost: 0 }]);
    expect(four.map((c) => c.state)).toEqual(['free', 'free', 'free', 'free', 'void', 'void']);
  });

  it('links a retail line from its source to the shelf and flags an emptied shelf', () => {
    expect(shelfEmptied(soft)).toBe(true);
    const flow = unitFlow(detail([soft]), { productName: () => 'Soft Drink' });
    expect(flow.inputs).toHaveLength(1);
    expect(flow.inputs[0]).toMatchObject({ tone: 'world', starved: true, volume: 60000 });
    expect(flow.outputs[0]).toMatchObject({ tone: 'shoppers', volume: 60000 });
    expect(flow.links.map((l) => l.side)).toEqual(['input', 'output']);
    const stocked = { ...soft, retail: retail({ onHand: 500, lastMonthUnits: 30000 }) };
    expect(shelfEmptied(stocked)).toBe(false);
  });

  it('marks a production input starved when utilisation is low and stock is short', () => {
    const prod: SlotDetailDto = {
      index: 0,
      kind: 'production',
      productId: 'soft_drink',
      productName: 'Soft Drink',
      tier: 'finished',
      production: {
        cyclesPerMonth: 200,
        outputPerMonth: 200000,
        utilization: 0.4,
        effectiveWorldPrice: 1.5,
        exportsAtLoss: false,
        inputs: [
          { productId: 'sugar', perMonth: 4000, onHand: 100, source: 'worldMarket', effectiveWorldPrice: 2 },
          { productId: 'plastic', perMonth: 1000, onHand: 5000, source: 'own', sourceBuildingId: 4, effectiveWorldPrice: 3 },
        ],
      },
    };
    const flow = unitFlow(detail([prod], { slotKind: 'production', autoExport: true, autoExportApplies: true }), { productName: (id) => id, buildingLabel: (id) => `Plant ${id}` });
    expect(flow.inputs.map((n) => [n.productId, n.starved, n.tone, n.detail])).toEqual([
      ['sugar', true, 'world', 'World market · $2.00'],
      ['plastic', false, 'own', 'Own: Plant 4'],
    ]);
    expect(flow.outputs[0]).toMatchObject({ tone: 'export', volume: 200000 });
  });

  it('aligns band nodes over distinct unit columns, else orders them by the column they feed', () => {
    const node = (id: string): FlowNode => ({ id, side: 'input', productId: id, tone: 'world', title: id, detail: '', volume: 1, volumeIsMoney: false, starved: false });
    const link = (nodeId: string, cellIndex: number): FlowLink => ({ id: `${nodeId}>${cellIndex}`, nodeId, cellIndex, side: 'input', volume: 1, starved: false });
    const aligned = bandPlacement([node('b'), node('a')], [link('a', 0), link('b', 1)]);
    expect(aligned).toMatchObject({ columns: 3, aligned: true });
    expect(aligned.slots.map((x) => [x.node.id, x.column])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    // Two inputs feeding the same unit cannot both sit above it.
    const shared = bandPlacement([node('sugar'), node('plastic')], [link('sugar', 0), link('plastic', 0)]);
    expect(shared).toMatchObject({ columns: 2, aligned: false });
    expect(shared.slots.every((x) => x.column === undefined)).toBe(true);
    // One node keeps the full width; four spread over three columns.
    expect(bandPlacement([node('a')], [link('a', 4)])).toMatchObject({ columns: 1, aligned: false });
    const many = bandPlacement(['d', 'c', 'b', 'a'].map(node), [link('a', 0), link('b', 1), link('c', 2), link('d', 3)]);
    expect(many.columns).toBe(3);
    expect(many.slots.map((x) => x.node.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('scales link widths by the square root of volume', () => {
    expect(linkWidth(0, 100)).toBe(1.5);
    expect(linkWidth(100, 100)).toBe(6);
    expect(linkWidth(25, 100)).toBeCloseTo(3.75);
  });
});

describe('placement payloads (ghost → build panel)', () => {
  it('accepts at / plot / placement / flat shapes and rejects junk', () => {
    expect(normalizePlacement({ typeId: 'supermarket', at: { px: 3, pz: 4, rotation: 90 } })).toEqual({ at: { px: 3, pz: 4, rotation: 90 }, typeId: 'supermarket', cityId: undefined });
    expect(normalizePlacement({ plot: { px: 1, pz: 2 } })?.at).toEqual({ px: 1, pz: 2, rotation: 0 });
    expect(normalizePlacement({ placement: { px: 5, pz: 6, rotation: 180, source: 'bridge' }, cityId: 'riverside' })).toMatchObject({ at: { px: 5, pz: 6, rotation: 180 }, cityId: 'riverside' });
    expect(normalizePlacement({ px: 7, pz: 8, rotation: 45 })?.at).toEqual({ px: 7, pz: 8, rotation: 0 });
    expect(normalizePlacement({ px: 'x' })).toBeNull();
    expect(normalizePlacement(null)).toBeNull();
  });
});

describe('friendly errors', () => {
  it('renders from code + details', () => {
    expect(friendlyError({ code: 'insufficient_funds', details: { shortfall: 800000, available: 400000 } })).toBe('Not enough cash: you are $800K short (you have $400K).');
    expect(friendlyError({ code: 'geography_mismatch', details: { reason: 'coastal' } })).toContain('coastal');
    expect(friendlyError({ code: 'feature_unavailable', details: { feature: 'demolish' } })).toBe('Selling and demolishing buildings is not available in this version yet.');
    expect(friendlyError({ code: 'weird', message: 'raw' })).toBe('raw');
  });
});
