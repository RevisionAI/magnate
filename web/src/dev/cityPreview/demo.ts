// Demo company buildings for the city preview: every content building type placed on suitable parcels of the real
// layout (vacant commercial/industrial lots, deposits, the port, farmland), with owners 0–7, levels, construction
// stages and a closed store — the shapes E3b's engine placements will have (source 'engine', front facing the road).
import type { BuildingStatus, BuildingVisualDto, CityActivityDto, CityViewDto, Rotation } from '@/bridge/protocol';
import { OWNER_COLORS } from '@/theme/tokens';
import { decodeLayout } from '@/scene/city/layout/decode';
import { D_CBD, D_COMMERCIAL, D_INDUSTRIAL, D_MIXED, D_PORT, D_RURAL, isWaterKind, type CityGrid, type CityLayoutWire, type ParcelInfo } from '@/scene/city/layout/types';

interface DemoType { typeId: string; category: string; fw: number; fh: number; owner: number; level?: number; progress?: number; closed?: boolean; products?: string[]; where: 'retail' | 'industry' | 'rural' | 'iron' | 'oil' | 'port' | 'media' }

const DEMO: readonly DemoType[] = [
  { typeId: 'supermarket', category: 'supermarket', fw: 3, fh: 3, owner: 0, level: 3, where: 'retail', products: ['soft_drink'] },
  { typeId: 'department_store', category: 'department_store', fw: 4, fh: 4, owner: 1, where: 'retail', products: ['clothing'] },
  { typeId: 'supermarket', category: 'supermarket', fw: 3, fh: 3, owner: 2, level: 1, where: 'retail', products: ['bread'] },
  { typeId: 'convenience_store', category: 'convenience_store', fw: 1, fh: 1, owner: 0, where: 'retail', products: ['soft_drink'] },
  { typeId: 'convenience_store', category: 'convenience_store', fw: 1, fh: 1, owner: 3, closed: true, where: 'retail' },
  { typeId: 'supermarket', category: 'supermarket', fw: 3, fh: 3, owner: 4, progress: 0.15, where: 'retail' },
  { typeId: 'rd_center', category: 'rd_center', fw: 3, fh: 3, owner: 0, where: 'media' },
  { typeId: 'tv_station', category: 'media', fw: 3, fh: 3, owner: 5, where: 'media' },
  { typeId: 'radio_station', category: 'media', fw: 2, fh: 2, owner: 6, where: 'media' },
  { typeId: 'newspaper_publisher', category: 'media', fw: 3, fh: 3, owner: 7, progress: 0.55, where: 'media' },
  { typeId: 'magazine_publisher', category: 'media', fw: 3, fh: 3, owner: 2, where: 'media' },
  { typeId: 'factory_small', category: 'factory', fw: 3, fh: 3, owner: 0, level: 2, where: 'industry', products: ['flour'] },
  { typeId: 'factory_large', category: 'factory', fw: 5, fh: 5, owner: 4, level: 3, where: 'industry', products: ['steel'] },
  { typeId: 'warehouse_small', category: 'warehouse', fw: 2, fh: 2, owner: 0, where: 'industry' },
  { typeId: 'warehouse_large', category: 'warehouse', fw: 4, fh: 4, owner: 1, where: 'industry' },
  { typeId: 'factory_small', category: 'factory', fw: 3, fh: 3, owner: 5, progress: 0.9, where: 'industry' },
  { typeId: 'small_farm', category: 'farm', fw: 3, fh: 3, owner: 0, where: 'rural', products: ['wheat'] },
  { typeId: 'large_farm', category: 'farm', fw: 5, fh: 5, owner: 2, where: 'rural', products: ['cattle'] },
  { typeId: 'small_plantation', category: 'plantation', fw: 3, fh: 3, owner: 3, where: 'rural', products: ['coffee_beans'] },
  { typeId: 'iron_mine', category: 'mine', fw: 3, fh: 3, owner: 0, where: 'iron', products: ['iron_ore'] },
  { typeId: 'oil_well', category: 'oil_well', fw: 2, fh: 2, owner: 6, level: 2, where: 'oil', products: ['crude_oil'] },
  { typeId: 'seaport', category: 'seaport', fw: 5, fh: 3, owner: 0, where: 'port' },
];

export const DEMO_COMPANIES = [
  'Magnate Corp', 'Orange Retail', 'Lilac Holdings', 'Verde Foods', 'Vermilion Steel', 'Skyline Media', 'Goldcrest', 'Violet Group',
].map((name, i) => ({ id: i + 1, name, colorIndex: i }));

function fits(grid: CityGrid, p: ParcelInfo, w: number, h: number): boolean {
  return p.w >= w && p.h >= h && p.px + w <= grid.gridW && p.pz + h <= grid.gridH;
}

function waterSide(grid: CityGrid, px: number, pz: number, w: number, h: number): number {
  const W = grid.gridW;
  const water = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < grid.gridH && isWaterKind(grid.kind[z * W + x]);
  const score = [0, 0, 0, 0];
  for (let x = px; x < px + w; x++) { if (water(x, pz + h)) score[0]++; if (water(x, pz - 1)) score[2]++; }
  for (let z = pz; z < pz + h; z++) { if (water(px + w, z)) score[1]++; if (water(px - 1, z)) score[3]++; }
  let best = 0;
  for (let k = 1; k < 4; k++) if (score[k] > score[best]) best = k;
  return score[best] > 0 ? best : -1;
}

/** Place the demo set on a layout; deterministic. */
export function demoView(wire: CityLayoutWire, month = 6): CityViewDto {
  const grid = decodeLayout(wire);
  const used = new Set<number>();
  const buildings: BuildingVisualDto[] = [];
  const cbd = grid.cbd;
  const byDistance = [...grid.parcels].sort((a, b) => Math.hypot(a.px + a.w / 2 - cbd.x, a.pz + a.h / 2 - cbd.z) - Math.hypot(b.px + b.w / 2 - cbd.x, b.pz + b.h / 2 - cbd.z) || a.id - b.id);
  const deposits = new Map(grid.deposits.map((d) => [d.id, d]));
  const portLandmarks = grid.landmarks.filter((l) => l.kind === 'port');
  for (const t of DEMO) {
    const candidates = byDistance.filter((p) => {
      if (used.has(p.id) || p.landmark) return false;
      switch (t.where) {
        case 'retail': return p.vacant && (p.district === D_CBD || p.district === D_COMMERCIAL || p.district === D_MIXED);
        case 'media': return p.vacant && (p.district === D_COMMERCIAL || p.district === D_MIXED || p.district === D_CBD);
        case 'industry': return p.vacant && (p.district === D_INDUSTRIAL || p.district === D_PORT);
        case 'rural': return p.district === D_RURAL && p.depositId === null && (p.ambient?.kind === 'field' || p.ambient?.kind === 'pasture' || p.vacant);
        case 'iron': return p.depositId !== null && deposits.get(p.depositId)?.resource === 'iron';
        case 'oil': return p.depositId !== null && deposits.get(p.depositId)?.resource === 'oil';
        // Keep clear of the port authority's berths (their ships would overlap).
        case 'port': return p.district === D_PORT && !portLandmarks.some((l) => Math.max(l.px - (p.px + p.w), p.px - (l.px + l.w), l.pz - (p.pz + p.h), p.pz - (l.pz + l.h)) < 4);
      }
      return false;
    });
    let placed: { p: ParcelInfo; rot: number; w: number; h: number } | null = null;
    for (const p of candidates) {
      for (const rot of t.where === 'port' ? [0, 1, 2, 3] : [p.facing, (p.facing + 1) % 4]) {
        const w = rot % 2 === 0 ? t.fw : t.fh, h = rot % 2 === 0 ? t.fh : t.fw;
        if (!fits(grid, p, w, h)) continue;
        if (t.where === 'port') {
          const side = waterSide(grid, p.px, p.pz, w, h);
          if (side !== rot) continue;
        }
        placed = { p, rot, w, h };
        break;
      }
      if (placed) break;
    }
    if (!placed) continue;
    used.add(placed.p.id);
    // Push the footprint to the parcel's street side (keeps the building on its frontage).
    const { p, rot, w, h } = placed;
    // A seaport goes to the water side instead (its berth faces `rot`).
    let px = p.px, pz = p.pz;
    const front = t.where === 'port' ? rot : p.facing;
    if (front === 0) pz = p.pz + p.h - h;
    if (front === 1) px = p.px + p.w - w;
    const id = buildings.length + 1;
    const status: BuildingStatus = t.closed ? 'closed' : t.progress !== undefined ? 'underConstruction' : 'operating';
    const b: BuildingVisualDto = {
      id, typeId: t.typeId, category: t.category, slotKind: 'none', ownerId: t.owner + 1, isPlayer: t.owner === 0, color: OWNER_COLORS[t.owner],
      colorIndex: t.owner, level: t.level ?? 1, footprintW: t.fw, footprintH: t.fh,
      placement: { px, pz, rotation: (rot * 90) as Rotation, source: 'engine' }, status, products: t.products ?? [], visualRev: id,
    };
    if (t.progress !== undefined) b.construction = { started: { year: 2026, month }, completesAt: { year: 2026, month: month + 2 }, progress: t.progress, costPaid: 0, costRemaining: 0 };
    buildings.push(b);
  }
  const activity: CityActivityDto = {
    month: { year: 2026, month }, ids: buildings.map((b) => b.id),
    revenue: buildings.map(() => 1e5), unitsSold: buildings.map((b) => (b.slotKind === 'retail' || b.category.includes('store') || b.category === 'supermarket' ? 4e5 : 0)),
    exportUnits: buildings.map(() => 0), netIncome: buildings.map(() => 1e4),
    utilization: buildings.map((b) => (b.category === 'factory' || b.category === 'mine' || b.category === 'oil_well' || b.category === 'farm' || b.category === 'rd_center' ? 0.85 : null)),
    transfersIn: buildings.map((b) => (b.category === 'warehouse' || b.category === 'seaport' ? 900 : 120)),
    transfersOut: buildings.map((b) => (b.category === 'warehouse' || b.category === 'factory' ? 600 : 0)),
  };
  return { cityId: wire.cityId, revision: 1, full: true, buildings, removedIds: [], activity };
}
