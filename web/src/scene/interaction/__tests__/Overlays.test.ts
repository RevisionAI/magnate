import { describe, expect, it } from 'vitest';
import type { BuildingSummaryDto, CityLayoutDto, CityViewDto, CompanySummaryDto } from '@/bridge/protocol';
import { OVERLAY_BINNED, OVERLAY_CATEGORICAL, OVERLAY_DIVERGING, OVERLAY_SEQUENTIAL } from '../../materials/CityMaterial';
import { buildModels, classifyStatus, decodeLayout, PLOT_PARCEL, PLOT_RIVER, PLOT_ROAD, type LayoutGrid } from '../CityData';
import {
  CAT_NONE, DIVERGING_MID, fillRoads, landValueOverlay, ownersOverlay, profitOverlay, resampleBytes, shareOverlay, shortMoney,
  trafficOverlay, zonesOverlay,
} from '../Overlays';
import { nextOverlay } from '../interactionStore';

function grid(W: number, H: number, fill: (i: number, x: number, z: number) => Partial<{ kind: number; district: number; lv: number; traffic: number }>): LayoutGrid {
  const n = W * H;
  const g: LayoutGrid = {
    cityId: 'test', gridW: W, gridH: H, layoutRev: 1, kinds: new Uint8Array(n), roads: new Uint8Array(n), districts: new Uint8Array(n),
    landValue: new Float32Array(n), traffic: new Float32Array(n), landmarks: [], cbd: null,
  };
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x, v = fill(i, x, z);
      g.kinds[i] = v.kind ?? PLOT_PARCEL;
      g.districts[i] = v.district ?? 5;
      g.landValue[i] = v.lv ?? 0;
      g.traffic[i] = v.traffic ?? 0;
    }
  }
  return g;
}

describe('layout decoding', () => {
  it('decodes the E3a per-plot strings', () => {
    const dto = {
      cityId: 'x', layoutRev: 3, gridW: 3, gridH: 2, roads: [], parcels: [], water: [], ambient: [],
      plots: { kinds: 'prvphs', roads: '030000', districts: 'C.ihgk', landValue: [5, 0, 0, 9, 1, 2], traffic: [10, 90, 0, 1, 2, 3] },
      landmarks: [{ kind: 'cityHall', px: 0, pz: 0, w: 1, h: 1 }],
      cbd: { x: 1.5, z: 1 },
    } as unknown as CityLayoutDto;
    const g = decodeLayout(dto);
    expect([...g.kinds]).toEqual([PLOT_PARCEL, PLOT_ROAD, PLOT_RIVER, PLOT_PARCEL, 7, 4]);
    expect(g.roads[1]).toBe(3);
    expect([...g.districts]).toEqual([1, 0, 6, 5, 8, 9]);
    expect(g.landValue[3]).toBe(9);
    expect(g.traffic[1]).toBe(90);
    expect(g.landmarks[0].kind).toBe('cityHall');
    expect(g.cbd).toEqual({ x: 1.5, z: 1 });
  });

  it('rasterises the spec arrays when the per-plot strings are absent', () => {
    // A degraded payload: only the bridge-spec arrays (no E3a per-plot strings or extras).
    const dto = {
      cityId: 'x', layoutRev: 1, gridW: 4, gridH: 4,
      roads: [{ id: 1, kind: 'arterial', roadClass: 'arterial', lanes: 4, path: [{ px: 0, pz: 2 }, { px: 1, pz: 2 }, { px: 2, pz: 2 }, { px: 3, pz: 2 }] }],
      parcels: [{ id: 1, px: 0, pz: 0, w: 4, h: 2, zone: 'commercial', district: 'commercial', facing: 0, vacant: false, landValuePerPlot: 400_000, forSale: false, traffic: 0.5 }],
      water: [{ px: 0, pz: 3, w: 4, h: 1, kind: 'river' }],
      ambient: [],
    } as unknown as CityLayoutDto;
    const g = decodeLayout(dto);
    expect(g.kinds[0]).toBe(PLOT_PARCEL);
    expect(g.districts[0]).toBe(2);
    expect(g.landValue[5]).toBe(400_000);
    expect(g.traffic[5]).toBe(50);
    expect(g.kinds[2 * 4 + 1]).toBe(PLOT_ROAD);
    expect(g.roads[2 * 4 + 1]).toBe(3);
    expect(g.kinds[3 * 4]).toBe(PLOT_RIVER);
  });
});

describe('overlay builders', () => {
  it('land value: log bins over priced plots, roads take their neighbours', () => {
    const g = grid(10, 1, (_i, x) => (x === 5 ? { kind: PLOT_ROAD, lv: 0 } : { lv: 1000 * 2 ** x }));
    const o = landValueOverlay(g);
    expect(o.mode).toBe(OVERLAY_BINNED);
    expect(o.smooth).toBe(false);
    expect(o.bytes[0]).toBeLessThan(o.bytes[9]);
    expect(o.bytes[5]).toBeGreaterThan(0);                       // the road shows the area's value
    expect(o.legend.labels).toHaveLength(5);
    expect(o.legend.labels[0].startsWith('<')).toBe(true);
    expect(o.legend.labels[4].endsWith('+')).toBe(true);
  });

  it('fills road plots from priced neighbours only', () => {
    const v = new Float32Array([10, 0, 30, 0, 0]);
    const k = new Uint8Array([PLOT_PARCEL, PLOT_ROAD, PLOT_PARCEL, PLOT_RIVER, PLOT_ROAD]);
    const out = fillRoads(v, k, 5, 1, (x) => x === PLOT_ROAD);
    expect(out[1]).toBe(20);
    expect(out[3]).toBe(0);                                      // water is never filled
    expect(out[4]).toBe(0);                                      // no priced neighbour within reach
  });

  it('traffic: 0–100 onto the sequential ramp', () => {
    const o = trafficOverlay(grid(2, 1, (_i, x) => ({ traffic: x * 100 })));
    expect(o.mode).toBe(OVERLAY_SEQUENTIAL);
    expect([...o.bytes]).toEqual([0, 255]);
    expect(o.legend.empty).toBeUndefined();
  });

  it('zones: districts grouped into eight classes; roads neutral', () => {
    const o = zonesOverlay(grid(4, 1, (_i, x) => (x === 3 ? { kind: PLOT_ROAD } : { district: [1, 6, 9][x] })));
    expect(o.mode).toBe(OVERLAY_CATEGORICAL);
    expect(o.palette).toBe('zones');
    expect([...o.bytes]).toEqual([0, 4, 7, CAT_NONE]);
    expect(o.legend.labels).toEqual(['Downtown', 'Industrial', 'Parks & civic']);
  });

  it('owners: footprints by colour index; you are labelled "You"', () => {
    const o = ownersOverlay(4, 4, [
      { id: 1, px: 0, pz: 0, w: 2, h: 2, colorIndex: 0, ownerName: 'Your Corp', isPlayer: true },
      { id: 2, px: 3, pz: 3, w: 1, h: 1, colorIndex: 3, ownerName: 'LocalCo', isPlayer: false },
    ]);
    expect(o.bytes[0]).toBe(0);
    expect(o.bytes[5]).toBe(0);
    expect(o.bytes[15]).toBe(3);
    expect(o.bytes[2]).toBe(CAT_NONE);
    expect(o.legend.labels).toEqual(['You', 'LocalCo', 'Local & civic']);
  });

  it('profit: symmetric diverging scale around the neutral byte', () => {
    const o = profitOverlay(3, 1, [
      { id: 1, px: 0, pz: 0, w: 1, h: 1, netIncome: -50_000 },
      { id: 2, px: 2, pz: 0, w: 1, h: 1, netIncome: 100_000 },
    ]);
    expect(o.mode).toBe(OVERLAY_DIVERGING);
    expect(o.bytes[1]).toBe(DIVERGING_MID);
    expect(o.bytes[2]).toBe(255);
    expect(o.bytes[0]).toBe(64);
  });

  it('market share: your halos green, rivals red, nothing neutral', () => {
    const o = shareOverlay(30, 10, [
      { id: 1, px: 2, pz: 4, w: 2, h: 2, share: 0.6, mine: true },
      { id: 2, px: 25, pz: 4, w: 2, h: 2, share: 0.3, mine: false },
    ], 'Soft Drink', 4);
    expect(o.mode).toBe(OVERLAY_DIVERGING);
    expect(o.bytes[5 * 30 + 3]).toBeGreaterThan(200);
    expect(o.bytes[5 * 30 + 26]).toBeLessThan(DIVERGING_MID);
    expect(o.bytes[5 * 30 + 14]).toBe(DIVERGING_MID);
    expect(o.legend.labels).toEqual(['Rivals 30%', 'You 60%']);
    expect(shareOverlay(5, 5, [], 'Bread').legend.empty).toMatch(/Bread/);
  });

  it('resamples between grid sizes', () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    expect([...resampleBytes(src, 2, 2, 4, 4)]).toEqual([1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]);
    expect(resampleBytes(src, 2, 2, 2, 2)).toBe(src);
  });

  it('formats short legend money', () => {
    expect(shortMoney(13_800)).toBe('$14K');
    expect(shortMoney(1_234_000)).toBe('$1.2M');
    expect(shortMoney(950)).toBe('$950');
  });

  it('cycles overlays through "none"', () => {
    expect(nextOverlay(null)).toBe('landValue');
    expect(nextOverlay('links')).toBeNull();
    expect(nextOverlay(null, -1)).toBe('links');
  });
});

describe('building model', () => {
  const company = (id: number, isPlayer: boolean, colorIndex: number): CompanySummaryDto => ({
    id, name: isPlayer ? 'Your Corp' : 'LocalCo', isPlayer, cash: 0, totalAssets: 0, equity: 0, revenueThisMonth: 0, netIncomeThisMonth: 0,
    buildingCount: 1, color: '#000', corporateValue: 0, netIncomeLast12: 0, colorIndex,
  });
  const building = (id: number, ownerId: number, over: Partial<BuildingSummaryDto> = {}): BuildingSummaryDto => ({
    id, typeId: 'supermarket', category: 'supermarket', ownerId, cityId: 'metropolis', level: 1, configuredSlots: 1, capacity: 6,
    name: `Store ${id}`, slotKind: 'retail', status: 'operating', products: ['bread'], monthlyOpex: 15000, cashFlowThisMonth: 0,
    netIncomeThisMonth: 0, topStock: [], placement: { px: 1, pz: 2, rotation: 0, source: 'auto' }, colorIndex: ownerId === 1 ? 0 : 2, ...over,
  });

  it('merges last month’s activity from the city view and classifies status', () => {
    const view = {
      cityId: 'metropolis', revision: 4, full: true, buildings: [], removedIds: [],
      activity: { month: { year: 2026, month: 2 }, ids: [1, 2], revenue: [1000, 50], unitsSold: [500, 10], exportUnits: [0, 0], netIncome: [300, -80], utilization: [null, null], transfersIn: [0, 0], transfersOut: [0, 0] },
    } as CityViewDto;
    const models = buildModels('metropolis', [building(1, 1), building(2, 2), building(3, 2, { cityId: 'riverside' })], view, [company(1, true, 0), company(2, false, 2)], [{ id: 'supermarket', name: 'Supermarket', footprintWidth: 3, footprintHeight: 3 }], 1);
    expect(models.size).toBe(2);
    expect(models.get(1)).toMatchObject({ isPlayer: true, netIncome: 300, unitsSold: 500, statusClass: 'profitable', typeName: 'Supermarket', ownerName: 'Your Corp' });
    expect(models.get(2)).toMatchObject({ isPlayer: false, statusClass: 'loss', colorIndex: 2 });
  });

  it('puts construction and operating trouble before profit', () => {
    expect(classifyStatus('underConstruction', 100)).toBe('construction');
    expect(classifyStatus('starved', 100)).toBe('warning');
    expect(classifyStatus('idle', 0)).toBe('warning');
    expect(classifyStatus('operating', -10)).toBe('loss');
    expect(classifyStatus('operating', 0)).toBe('neutral');
  });
});
