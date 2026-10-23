import { describe, expect, it } from 'vitest';
import type { BuildPreviewDto, BuildingDetailDto, BuildingSummaryDto, BuildingTypeDto, CityDto, MarketRowDto, SlotDetailDto } from '@/bridge/protocol';
import { availability, groupTypes, maxCapacity, opensText, requirements, starterCity, suggestions } from '../build/buildModel';
import { attentionReason, attentionSummary, groupByCity, needsAttention, portfolioTotals } from '../company/companyModel';
import { buildingAlerts, lineRow, upgradeSummary } from '../inspector/inspectorModel';
import { buildMatrix, filterRows, metricFill, metricText, playerShare, unservedMarkets } from '../markets/marketsModel';
import { qty } from './numbers';

const type = (over: Partial<BuildingTypeDto>): BuildingTypeDto =>
  ({
    id: 't',
    name: 'T',
    category: 'c',
    constructionCost: 100,
    monthlyOperatingCost: 1,
    footprintWidth: 1,
    footprintHeight: 1,
    maxUnits: 3,
    retail: false,
    producibleTiers: [],
    maxLevel: 1,
    slotKind: 'retail',
    eligibleProductIds: [],
    levels: [],
    buildMenuGroup: 'retail',
    ...over,
  }) as BuildingTypeDto;

const city = (id: string, population: number): CityDto => ({ id, name: id[0].toUpperCase() + id.slice(1), population }) as CityDto;

const preview = (over: Partial<BuildPreviewDto> = {}): BuildPreviewDto =>
  ({
    typeId: 't',
    cityId: 'c',
    constructionCost: 100,
    totalCost: 100,
    monthlyOpex: 1,
    capacity: 3,
    affordable: true,
    shortfall: 0,
    cashAfter: 0,
    geographyOk: true,
    geographyIssues: [],
    eligibleProductIds: ['soft_drink'],
    footprintW: 1,
    footprintH: 1,
    placementOk: true,
    ...over,
  }) as BuildPreviewDto;

describe('build palette model', () => {
  it('groups by menu group, cheapest first', () => {
    const g = groupTypes([type({ id: 'b', constructionCost: 5 }), type({ id: 'a', constructionCost: 1 }), type({ id: 'f', buildMenuGroup: 'production' })]);
    expect(g.get('retail')!.map((t) => t.id)).toEqual(['a', 'b']);
    expect(g.get('production')!.map((t) => t.id)).toEqual(['f']);
  });

  it('words the bridge verdicts: geography, product, cash, placement', () => {
    expect(availability(undefined)).toMatchObject({ ok: true });
    expect(availability(preview({ geographyOk: false, geographyIssues: ['coastal'] }))).toMatchObject({ ok: false, kind: 'geography', reason: 'Needs a coastal city' });
    expect(availability(preview(), { productId: 'car' })).toMatchObject({ ok: false, kind: 'product' });
    expect(availability(preview({ affordable: false, shortfall: 800000 }))).toMatchObject({ ok: false, kind: 'cash', reason: 'Cash short $800K' });
    expect(availability(preview({ placementOk: false }))).toMatchObject({ ok: false, kind: 'placement' });
  });

  it('reads requirements, max capacity and timing from content', () => {
    expect(requirements(type({ geography: { coastal: true, arable: true } }))).toEqual(['Coastal city', 'Farmland']);
    expect(maxCapacity(type({ maxUnits: 6, levels: [{ level: 1, capacity: 6, monthlyOperatingCost: 1, upgradeCost: 0 }, { level: 3, capacity: 12, monthlyOperatingCost: 1, upgradeCost: 1 }] }))).toBe(12);
    expect(opensText(undefined)).toBe('Opens next month');
    expect(opensText(2)).toBe('Builds in 2 months');
    expect(opensText(1)).toBe('Builds in 1 month');
  });

  it('suggests affordable starter plans in the largest city, led by the best unserved market', () => {
    const cities = [city('riverside', 2), city('metropolis', 5)];
    expect(starterCity(cities)?.id).toBe('metropolis');
    const types = new Map([
      ['convenience_store', type({ id: 'convenience_store', name: 'Convenience Store', constructionCost: 200, eligibleProductIds: ['bread', 'soft_drink'] })],
      ['supermarket', type({ id: 'supermarket', name: 'Supermarket', constructionCost: 1200, eligibleProductIds: ['bread'] })],
    ]);
    const out = suggestions({
      plans: [
        { id: 'big', label: 'Supermarket selling bread', typeId: 'supermarket', productId: 'bread', citySelector: 'largestPopulation' },
        { id: 'small', label: 'Corner store', typeId: 'convenience_store', productId: 'soft_drink', citySelector: 'largestPopulation' },
      ],
      types,
      cities,
      cash: 500,
      productName: (id) => (id === 'bread' ? 'Bread' : id),
      cityName: (id) => id,
      opportunity: { cityId: 'riverside', productId: 'bread', potentialDemand: 10, rivalCount: 0 },
    });
    expect(out.map((s) => s.id)).toEqual(['opp:riverside:bread', 'starter:small', 'starter:big']);
    expect(out[0]).toMatchObject({ typeId: 'convenience_store', why: 'Nobody sells it there yet' });
    expect(out[1].cityId).toBe('metropolis');
  });
});

const row = (over: Partial<MarketRowDto>): MarketRowDto =>
  ({ cityId: 'm', cityName: 'M', productId: 'p', productName: 'P', potentialDemand: 100, retailerCount: 1, playerPresent: false, playerModelShare: 0, rivalCount: 1, ...over }) as MarketRowDto;

describe('markets model', () => {
  const rows = [
    row({ cityId: 'm', cityName: 'Metro', productId: 'bread', productName: 'Bread', potentialDemand: 300, retailerCount: 0, rivalCount: 0 }),
    row({ cityId: 'm', cityName: 'Metro', productId: 'soda', productName: 'Soda', potentialDemand: 200, playerPresent: true, playerRealisedShare: 0.4, playerPrice: 2.25 }),
    row({ cityId: 'r', cityName: 'River', productId: 'soda', productName: 'Soda', potentialDemand: 150, cheapestRivalPrice: 2 }),
    row({ cityId: 'r', cityName: 'River', productId: 'bread', productName: 'Bread', potentialDemand: 0, retailerCount: 0, rivalCount: 0 }),
  ];

  it('builds the matrix with cities in bridge order and products by total demand', () => {
    const m = buildMatrix(rows);
    expect(m.cities.map((c) => c.id)).toEqual(['m', 'r']);
    expect(m.products.map((p) => p.id)).toEqual(['soda', 'bread']);
    expect(m.cell.get('r|soda')?.potentialDemand).toBe(150);
  });

  it('reads realised share, metric text and fill', () => {
    expect(playerShare(rows[1])).toBe(0.4);
    expect(playerShare(rows[0])).toBeNull();
    expect(playerShare(row({ playerPresent: true }))).toBe(0);
    expect(metricText(rows[1], 'share')).toBe('40%');
    expect(metricText(rows[0], 'competition')).toBe('none');
    expect(metricText(rows[2], 'price')).toBe('$2.00');
    expect(metricText(rows[0], 'price')).toBe('no offers');
    expect(metricFill(rows[0], 'demand', 300)).toBe(1);
    expect(metricFill(rows[1], 'share', 999)).toBe(0.4);
  });

  it('filters to mine / contested and lists unserved markets with demand', () => {
    expect(filterRows(rows, { onlyMine: true, contested: false })).toHaveLength(1);
    expect(filterRows(rows, { onlyMine: false, contested: true }).map((r) => r.productId)).toEqual(['soda']);
    expect(unservedMarkets(rows).map((r) => `${r.cityId}|${r.productId}`)).toEqual(['m|bread']);
  });
});

const summary = (over: Partial<BuildingSummaryDto>): BuildingSummaryDto =>
  ({ id: 1, typeId: 't', category: 'c', ownerId: 1, cityId: 'metropolis', level: 1, configuredSlots: 1, capacity: 3, name: 'B', slotKind: 'retail', status: 'operating', products: [], monthlyOpex: 10, cashFlowThisMonth: 0, netIncomeThisMonth: 5, topStock: [], ...over }) as BuildingSummaryDto;

describe('company model', () => {
  const list = [
    summary({ id: 1, cityId: 'metropolis', netIncomeThisMonth: 50 }),
    summary({ id: 2, cityId: 'riverside', status: 'idle', configuredSlots: 0, netIncomeThisMonth: -10 }),
    summary({ id: 3, cityId: 'metropolis', netIncomeThisMonth: -4 }),
    summary({ id: 4, cityId: 'metropolis', status: 'underConstruction', netIncomeThisMonth: -1 }),
    summary({ id: 5, cityId: 'riverside', slotKind: 'none', status: 'passive', capacity: 1, configuredSlots: 0, netIncomeThisMonth: -3 }),
  ];
  const cities = [city('riverside', 2), city('metropolis', 5)];

  it('flags idle, starved, sold-out and loss-making buildings (not construction or media)', () => {
    expect(list.map(needsAttention)).toEqual([false, true, true, false, false]);
  });

  it('groups by city (largest first) with totals, and filters to attention', () => {
    const g = groupByCity(list, cities);
    expect(g.map((x) => [x.cityId, x.buildings.length, x.netIncome, x.problems])).toEqual([
      ['metropolis', 3, 45, 1],
      ['riverside', 2, -13, 1],
    ]);
    expect(groupByCity(list, cities, 'attention').map((x) => x.buildings.map((b) => b.id))).toEqual([[3], [2]]);
  });

  it('says why a building needs attention, and summarises the reasons', () => {
    expect(list.map(attentionReason)).toEqual([null, 'Idle: nothing set up', 'Lost money last month', null, null]);
    expect(attentionSummary(list)).toBe('1 idle · 1 losing money');
    expect(attentionSummary([list[0]])).toBe('all good');
  });

  it('totals the portfolio (media have no units)', () => {
    expect(portfolioTotals(list)).toMatchObject({ count: 5, netIncome: 32, problems: 2, idle: 1, unitsUsed: 3, unitsTotal: 12 });
  });
});

const retailSlot = (over: Partial<NonNullable<SlotDetailDto['retail']>> = {}): SlotDetailDto => ({
  index: 0,
  kind: 'retail',
  productId: 'soft_drink',
  productName: 'Soft Drink',
  tier: 'finished',
  retail: { price: 2.25, restockTarget: 100, onHand: 10, unitCost: 1.5, effectiveWorldPrice: 1.5, lastMonthUnits: 90, lastMonthRevenue: 200, rivalCount: 0, modelDemandUnits: 100, belowCost: false, ...over },
});

const detail = (over: Partial<BuildingDetailDto>): BuildingDetailDto =>
  ({
    id: 1,
    typeId: 'supermarket',
    typeName: 'Supermarket',
    slotKind: 'retail',
    isPlayer: true,
    cityId: 'm',
    level: 1,
    maxLevel: 3,
    capacity: 6,
    slotsUsed: 0,
    nextFreeSlotIndex: 0,
    monthlyOpex: 15000,
    slots: [],
    supply: { sources: [], destinations: [] },
    actions: { canUpgrade: true, canAddSlot: true, canConfigure: true, canToggleAutoExport: false, canDemolish: false, eligibleProductIds: [] },
    ...over,
  }) as BuildingDetailDto;

describe('inspector model', () => {
  const names = { productName: (id: string) => (id === 'soft_drink' ? 'Soft Drink' : id), cash: 0 };

  it('warns idle buildings and below-cost, sold-out and lost-sales lines', () => {
    expect(buildingAlerts(detail({}), names).map((a) => a.id)).toEqual(['idle']);
    expect(buildingAlerts(detail({ slots: [retailSlot({ belowCost: true, price: 1 })] }), names).map((a) => a.id)).toEqual(['below:0']);
    expect(buildingAlerts(detail({ slots: [retailSlot({ onHand: 0, lastMonthUnits: 100 })] }), names).map((a) => a.id)).toEqual(['empty:0']);
    const lost = buildingAlerts(detail({ slots: [retailSlot({ lastMonthLostUnits: 30 })] }), names);
    expect(lost.map((a) => a.id)).toEqual(['lost:0']);
    expect(lost[0].action).toMatchObject({ tab: 'setup', slotIndex: 0 });
    expect(buildingAlerts(detail({ isPlayer: false }), names)).toEqual([]);
  });

  it('suggests an upgrade when every unit is in use and it is affordable', () => {
    const full = detail({ capacity: 1, slots: [retailSlot()], upgrade: { toLevel: 2, cost: 720000, capacity: 9, monthlyOpex: 12750, affordable: true } });
    expect(buildingAlerts(full, names).some((a) => a.id === 'upgrade')).toBe(true);
    expect(upgradeSummary(full)).toEqual({ opexDelta: -2250, extraUnits: 8, paybackMonths: 320 });
    expect(upgradeSummary(detail({}))).toBeNull();
  });

  it('summarises a retail line as sold vs forecast with cover', () => {
    const r = lineRow(retailSlot());
    expect(r.primary).toBe('$2.25');
    expect(r.volume).toBe('90 sold · 100 forecast');
    expect(r.stock).toBe('1.0 mo cover');
    expect(r.fill).toBeCloseTo(0.9);
    const withDemand = lineRow(retailSlot({ lastMonthDemand: 120, lastMonthLostUnits: 30 }));
    expect(withDemand.volume).toBe('90 / 120 sold');
    expect(withDemand.fillTone).toBe('warn');
  });

  it('formats small quantities as whole numbers', () => {
    expect(qty(0)).toBe('0');
    expect(qty(812.4)).toBe('812');
    expect(qty(1_300_000)).toBe('1.3M');
    expect(qty(640_000)).toBe('640K');
    expect(qty(1_000_000)).toBe('1M');
  });
});
