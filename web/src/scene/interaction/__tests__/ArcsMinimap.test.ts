import { describe, expect, it } from 'vitest';
import type { FlowDto } from '@/bridge/protocol';
import { arcPoints, arcsForFlows, NEUTRAL_ARC, widthClass } from '../LinkArcs';
import { buildingAt, canvasToPlot, fitGrid, minimapBase } from '../MinimapRenderer';
import { PLOT_PARCEL, PLOT_ROAD, PLOT_SEA, type LayoutGrid } from '../CityData';
import { OVERLAY_CATEGORICAL } from '../../materials/CityMaterial';
import { circleRingGeometry, footprintRect, rectRingGeometry, ringWidthFor } from '../FootprintRing';

describe('link arcs', () => {
  it('peaks at a quarter of the distance above the higher roof', () => {
    const pts = arcPoints({ x: 0, y: 10, z: 0 }, { x: 400, y: 30, z: 0 }, 40);
    expect(pts[0].toArray()).toEqual([0, 10, 0]);
    expect(pts[40].x).toBeCloseTo(400);
    const top = Math.max(...pts.map((p) => p.y));
    expect(top).toBeCloseTo(30 + 100, 0);
  });

  it('turns flows into merged, coloured arcs and drops retail', () => {
    const roofs: Record<number, { x: number; z: number; colorIndex: number }> = { 1: { x: 0, z: 0, colorIndex: 0 }, 2: { x: 200, z: 0, colorIndex: 0 }, 3: { x: -100, z: 50, colorIndex: 2 } };
    const building = (id: number) => (roofs[id] ? { roof: { x: roofs[id].x, y: 10, z: roofs[id].z }, colorIndex: roofs[id].colorIndex } : null);
    const flows: FlowDto[] = [
      { kind: 'transfer', productId: 'flour', fromBuildingId: 2, toBuildingId: 1, quantity: 5000 },
      { kind: 'transfer', productId: 'sugar', fromBuildingId: 2, toBuildingId: 1, quantity: 2000 },
      { kind: 'import', productId: 'soft_drink', toBuildingId: 1, toCityId: 'metropolis', amount: 9000 },
      { kind: 'export', productId: 'flour', fromBuildingId: 2, fromCityId: 'metropolis', toCityId: 'riverside', quantity: 100 },
      { kind: 'retail', productId: 'soft_drink', fromBuildingId: 1, quantity: 60000 },
      { kind: 'import', productId: 'bread', toBuildingId: 3, toCityId: 'metropolis', amount: 100 },
    ];
    const arcs = arcsForFlows(flows, 'metropolis', building, 960, 960);
    expect(arcs).toHaveLength(4);
    const transfer = arcs.find((a) => a.from.x === 200 && a.to.x === 0);
    expect(transfer?.quantity).toBe(7000);
    expect(transfer?.color).toBe('#2F7DE1');
    const imp = arcs.find((a) => a.to.x === 0 && a.color === NEUTRAL_ARC);
    expect(imp?.from.y).toBe(0);                                  // from the city edge
    // The Links overlay keeps only flows touching your buildings.
    expect(arcsForFlows(flows, 'metropolis', building, 960, 960, null, 200, (id) => id !== 3)).toHaveLength(3);
    // "Show supply links" for one building.
    expect(arcsForFlows(flows, 'metropolis', building, 960, 960, 1)).toHaveLength(2);
  });

  it('maps quantities onto four width classes', () => {
    expect(widthClass(0)).toBe(0);
    expect(widthClass(20_000)).toBe(1);
    expect(widthClass(500_000)).toBe(2);
    expect(widthClass(1e9)).toBe(3);
  });
});

describe('minimap', () => {
  const g: LayoutGrid = {
    cityId: 'c', gridW: 3, gridH: 1, layoutRev: 1, kinds: new Uint8Array([PLOT_PARCEL, PLOT_ROAD, PLOT_SEA]), roads: new Uint8Array([0, 3, 0]),
    districts: new Uint8Array([1, 0, 0]), landValue: new Float32Array(3), traffic: new Float32Array(3), landmarks: [], cbd: null,
  };

  it('paints districts, roads and water; overlays recolour land only', () => {
    const base = minimapBase(3, 1, g, null);
    expect(base.length).toBe(12);
    expect(base[3]).toBe(255);
    const road = [...base.slice(4, 7)], sea = [...base.slice(8, 11)];
    expect(road[0]).toBeGreaterThan(sea[0]);
    const over = minimapBase(3, 1, g, { bytes: new Uint8Array([0, 0, 0]), mode: OVERLAY_CATEGORICAL, palette: 'owners' });
    expect([...over.slice(0, 3)]).toEqual([0x2f, 0x7d, 0xe1]);       // owner 0 on the parcel
    expect([...over.slice(4, 7)]).toEqual(road);                    // the road keeps its colour
  });

  it('fits the grid into the canvas and maps clicks back to plots', () => {
    const fit = fitGrid(80, 40, 208, 188, 4);
    expect(fit.scale).toBeCloseTo(2.5);
    const [px, pz] = canvasToPlot(fit, fit.ox + 2.5 * 10, fit.oy + 2.5 * 20);
    expect(px).toBeCloseTo(10);
    expect(pz).toBeCloseTo(20);
  });

  it('finds the building under a plot point (topmost first)', () => {
    const list = [{ id: 1, px: 0, pz: 0, w: 3, h: 3, color: '#fff', mine: false }, { id: 2, px: 2, pz: 2, w: 2, h: 2, color: '#fff', mine: true }];
    expect(buildingAt(list, 2.5, 2.5)?.id).toBe(2);
    expect(buildingAt(list, 0.5, 0.5)?.id).toBe(1);
    expect(buildingAt(list, 10, 10)).toBeNull();
  });
});

describe('footprint rings', () => {
  it('builds four quads per rectangle with inward corner offsets', () => {
    const geo = rectRingGeometry([footprintRect(0, 0, 2, 1, 10, 10)], 0.5);
    expect(geo.getAttribute('position').count).toBe(16);
    expect(geo.getIndex()?.count).toBe(24);
    const inn = geo.getAttribute('aIn');
    expect([inn.getX(2), inn.getY(2)]).toEqual([-1, 1]);           // NE corner of the north edge points inward (−x, +z)
  });

  it('builds a closed circle and widens with distance', () => {
    const geo = circleRingGeometry(0, 0, 100, 32);
    expect(geo.getAttribute('position').count).toBe(66);
    expect(ringWidthFor(100, 1.5)).toBe(1.5);
    expect(ringWidthFor(3000, 1.5, 2)).toBeGreaterThan(3);
  });

  it('places a footprint rectangle in world metres', () => {
    expect(footprintRect(0, 0, 1, 1, 10, 10)).toEqual({ x0: -120, z0: -120, x1: -96, z1: -96 });
  });
});
