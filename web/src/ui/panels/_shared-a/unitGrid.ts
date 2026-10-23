// The CapLab-style unit layout (UX §6.7.2, MASTER-PLAN D13): the engine's slot
// model re-expressed as a 3-column unit grid with an INPUTS band above and an
// OUTPUT band below, linked by arrows whose width follows monthly volume.
// Pure: it reads a BuildingDetailDto (+ the type's level ladder) and returns
// cells, nodes and links; the React layer only draws them.

import type { BuildingDetailDto, LevelDto, SlotDetailDto, SupplyLinkDto } from '@/bridge/protocol';
import { lostShare } from './stockPolicy';

export type CellState = 'used' | 'free' | 'locked' | 'void';

export interface UnitCell {
  index: number;
  state: CellState;
  slot?: SlotDetailDto;
  /** Level that unlocks a locked cell. */
  unlockLevel?: number;
}

export const GRID_COLUMNS = 3;

/**
 * Unit cells: the level-aware capacity (`GetCapacity`) as used/free cells, then
 * the cells the next level unlocks as locked, padded to whole rows of three.
 */
export function unitCells(detail: Pick<BuildingDetailDto, 'capacity' | 'level' | 'slots'>, levels: readonly LevelDto[] = []): UnitCell[] {
  const bySlot = new Map(detail.slots.map((s) => [s.index, s]));
  const next = levels.find((l) => l.level === detail.level + 1);
  const total = Math.max(detail.capacity, next?.capacity ?? 0, ...detail.slots.map((s) => s.index + 1));
  const cells: UnitCell[] = [];
  for (let i = 0; i < total; i++) {
    const slot = bySlot.get(i);
    if (slot) cells.push({ index: i, state: 'used', slot });
    else if (i < detail.capacity) cells.push({ index: i, state: 'free' });
    else cells.push({ index: i, state: 'locked', unlockLevel: levels.find((l) => l.capacity > i)?.level ?? detail.level + 1 });
  }
  while (cells.length % GRID_COLUMNS !== 0) cells.push({ index: cells.length, state: 'void' });
  return cells;
}

export type NodeTone = 'own' | 'world' | 'shoppers' | 'export' | 'stock' | 'transfer';

export interface FlowNode {
  id: string;
  side: 'input' | 'output';
  productId: string;
  tone: NodeTone;
  /** Headline, e.g. "Soft Drink" or "Shoppers". */
  title: string;
  /** Second line: source / destination ("World market · $1.50", "Own: Factory #4"). */
  detail: string;
  /** Monthly units (or $ when only an amount is known — see `volumeIsMoney`). */
  volume: number;
  volumeIsMoney: boolean;
  /** Below need: dashed link (UX: starved < 90 % of need, or a sold-out shelf). */
  starved: boolean;
  warning?: string;
  buildingId?: number;
}

export interface FlowLink {
  id: string;
  nodeId: string;
  cellIndex: number;
  side: 'input' | 'output';
  volume: number;
  starved: boolean;
}

export interface UnitFlow {
  inputs: FlowNode[];
  outputs: FlowNode[];
  links: FlowLink[];
  /** Largest volume among links of the same unit kind (for width scaling). */
  maxVolume: number;
}

/** Stroke width for a link: 1.5 px … 6 px, square-root scaled so small flows stay visible. */
export function linkWidth(volume: number, maxVolume: number): number {
  if (!(maxVolume > 0) || !(volume > 0)) return 1.5;
  return 1.5 + 4.5 * Math.sqrt(Math.min(1, volume / maxVolume));
}

/** A retail shelf emptied last month (all restocked units sold): sales were capped by stock. */
export function shelfEmptied(slot: SlotDetailDto): boolean {
  const r = slot.retail;
  if (!r) return false;
  const lost = lostShare(r);
  if (lost !== null) return lost >= 0.05;
  return r.onHand <= 0 && r.lastMonthUnits > 0 && r.lastMonthUnits >= r.restockTarget * 0.99;
}

interface Named {
  productName(id: string): string;
  buildingLabel?(id: number): string;
}

function sumBy<T>(items: readonly T[], f: (t: T) => number): number {
  return items.reduce((s, t) => s + f(t), 0);
}

function linkVolume(links: readonly SupplyLinkDto[]): { volume: number; isMoney: boolean } {
  const qty = links.filter((l) => l.quantity !== undefined && l.quantity !== null);
  if (qty.length > 0) return { volume: sumBy(qty, (l) => l.quantity ?? 0), isMoney: false };
  return { volume: sumBy(links, (l) => l.amount ?? 0), isMoney: true };
}

/** Inputs → units → outputs for one building (retail, production, extraction, warehouse; research has no flows). */
export function unitFlow(detail: BuildingDetailDto, names: Named): UnitFlow {
  const inputs = new Map<string, FlowNode>();
  const outputs = new Map<string, FlowNode>();
  const links: FlowLink[] = [];
  const label = (id: number) => names.buildingLabel?.(id) ?? `#${id}`;
  const sources = detail.supply?.sources ?? [];
  const destinations = detail.supply?.destinations ?? [];

  for (const slot of detail.slots) {
    if (slot.retail) {
      const r = slot.retail;
      const product = slot.productId;
      const own = sources.filter((s) => s.productId === product && s.kind === 'transfer');
      const inId = `in:${product}`;
      const emptied = shelfEmptied(slot);
      if (!inputs.has(inId)) {
        const fromOwn = own.find((s) => s.counterpartyBuildingId !== undefined);
        inputs.set(inId, {
          id: inId,
          side: 'input',
          productId: product,
          tone: fromOwn ? 'own' : 'world',
          title: names.productName(product),
          detail: fromOwn?.counterpartyBuildingId !== undefined ? `Own: ${label(fromOwn.counterpartyBuildingId)}` : `World market · $${r.effectiveWorldPrice.toFixed(2)}`,
          volume: r.lastMonthUnits,
          volumeIsMoney: false,
          starved: emptied,
          warning: emptied ? 'Shelf emptied last month' : undefined,
          buildingId: fromOwn?.counterpartyBuildingId,
        });
      }
      links.push({ id: `${inId}>${slot.index}`, nodeId: inId, cellIndex: slot.index, side: 'input', volume: r.lastMonthUnits, starved: emptied });
      const outId = `out:shoppers:${product}`;
      const prev = outputs.get(outId);
      outputs.set(outId, {
        id: outId,
        side: 'output',
        productId: product,
        tone: 'shoppers',
        title: names.productName(product),
        detail: `Shoppers · $${r.price.toFixed(2)}`,
        volume: (prev?.volume ?? 0) + r.lastMonthUnits,
        volumeIsMoney: false,
        starved: false,
      });
      links.push({ id: `${slot.index}>${outId}`, nodeId: outId, cellIndex: slot.index, side: 'output', volume: r.lastMonthUnits, starved: false });
      continue;
    }

    if (slot.production) {
      const p = slot.production;
      const low = p.utilization !== undefined && p.utilization !== null && p.utilization < 0.9;
      for (const input of p.inputs) {
        const inId = `in:${input.productId}`;
        const starved = low && input.onHand < input.perMonth;
        const prev = inputs.get(inId);
        inputs.set(inId, {
          id: inId,
          side: 'input',
          productId: input.productId,
          tone: input.source === 'worldMarket' ? 'world' : 'own',
          title: names.productName(input.productId),
          detail:
            input.source === 'worldMarket' || input.sourceBuildingId === undefined
              ? `World market · $${input.effectiveWorldPrice.toFixed(2)}`
              : `Own: ${label(input.sourceBuildingId)}${input.source === 'ownOtherCity' ? ' (other city)' : ''}`,
          volume: (prev?.volume ?? 0) + input.perMonth,
          volumeIsMoney: false,
          starved: (prev?.starved ?? false) || starved,
          warning: starved ? 'Short of this input' : prev?.warning,
          buildingId: input.sourceBuildingId,
        });
        links.push({ id: `${inId}>${slot.index}`, nodeId: inId, cellIndex: slot.index, side: 'input', volume: input.perMonth, starved });
      }
      addProducerOutputs(slot, p.lastMonthOutput ?? p.outputPerMonth, destinations, detail, outputs, links, names, label);
      continue;
    }

    if (slot.extraction) {
      addProducerOutputs(slot, slot.extraction.yieldPerMonth, destinations, detail, outputs, links, names, label);
      continue;
    }

    if (slot.warehouse) {
      const w = slot.warehouse;
      const inbound = sources.filter((s) => s.productId === slot.productId);
      const inId = `in:${slot.productId}`;
      const vol = linkVolume(inbound);
      const fromOwn = inbound.find((s) => s.kind === 'transfer' && s.counterpartyBuildingId !== undefined);
      inputs.set(inId, {
        id: inId,
        side: 'input',
        productId: slot.productId,
        tone: fromOwn ? 'own' : 'world',
        title: names.productName(slot.productId),
        detail: fromOwn?.counterpartyBuildingId !== undefined ? `Own: ${label(fromOwn.counterpartyBuildingId)}` : 'World market',
        volume: vol.volume,
        volumeIsMoney: vol.isMoney,
        starved: w.onHand < w.targetStock * 0.9,
        warning: w.onHand < w.targetStock * 0.9 ? 'Below target stock' : undefined,
      });
      links.push({ id: `${inId}>${slot.index}`, nodeId: inId, cellIndex: slot.index, side: 'input', volume: vol.volume, starved: w.onHand < w.targetStock * 0.9 });
      addProducerOutputs(slot, w.onHand, destinations, detail, outputs, links, names, label);
    }
  }

  const all = links.map((l) => l.volume).filter((v) => v > 0);
  return { inputs: [...inputs.values()], outputs: [...outputs.values()], links, maxVolume: all.length ? Math.max(...all) : 0 };
}

function addProducerOutputs(
  slot: SlotDetailDto,
  fallbackVolume: number,
  destinations: readonly SupplyLinkDto[],
  detail: BuildingDetailDto,
  outputs: Map<string, FlowNode>,
  links: FlowLink[],
  names: Named,
  label: (id: number) => string,
): void {
  const product = slot.productId;
  const mine = destinations.filter((d) => d.productId === product);
  const groups = new Map<string, SupplyLinkDto[]>();
  for (const d of mine) {
    const key = d.kind === 'transfer' ? `transfer:${d.counterpartyBuildingId ?? '?'}` : d.kind;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  if (groups.size === 0) {
    const exporting = detail.autoExport && detail.autoExportApplies;
    const id = exporting ? `out:export:${product}` : `out:stock:${product}`;
    const prev = outputs.get(id);
    outputs.set(id, {
      id,
      side: 'output',
      productId: product,
      tone: exporting ? 'export' : 'stock',
      title: exporting ? `Export · ${names.productName(product)}` : `${names.productName(product)} in stock`,
      detail: exporting ? 'Sold to the world market at month close' : 'No buyer yet: link a store or turn on export',
      volume: (prev?.volume ?? 0) + Math.max(0, fallbackVolume),
      volumeIsMoney: false,
      starved: false,
      warning: exporting && slot.production?.exportsAtLoss ? 'Exports below unit cost' : undefined,
    });
    links.push({ id: `${slot.index}>${id}`, nodeId: id, cellIndex: slot.index, side: 'output', volume: Math.max(0, fallbackVolume), starved: false });
    return;
  }
  for (const [key, group] of groups) {
    const id = `out:${key}:${product}`;
    const vol = linkVolume(group);
    const first = group[0];
    const isExport = first.kind === 'export';
    const isTransfer = first.kind === 'transfer';
    outputs.set(id, {
      id,
      side: 'output',
      productId: product,
      tone: isExport ? 'export' : isTransfer ? 'transfer' : 'shoppers',
      title: isExport ? `Export · ${names.productName(product)}` : isTransfer && first.counterpartyBuildingId !== undefined ? `→ ${label(first.counterpartyBuildingId)}` : names.productName(product),
      detail: isExport ? 'World market' : isTransfer ? names.productName(product) : 'Retail sales',
      volume: vol.volume,
      volumeIsMoney: vol.isMoney,
      starved: false,
      warning: isExport && slot.production?.exportsAtLoss ? 'Exports below unit cost' : undefined,
      buildingId: first.counterpartyBuildingId,
    });
    links.push({ id: `${slot.index}>${id}`, nodeId: id, cellIndex: slot.index, side: 'output', volume: vol.volume, starved: false });
  }
}

export interface BandSlot {
  node: FlowNode;
  /** 1-based CSS grid column when the band is column-aligned with the unit grid. */
  column?: number;
}

export interface BandPlacement {
  /** Columns of the band's grid (1…3). */
  columns: number;
  /** True when every node sits directly above/below the unit it links to. */
  aligned: boolean;
  slots: BandSlot[];
}

/**
 * Lays a band's nodes out so the pipes don't hide behind other nodes: when
 * each node links to units in a distinct grid column (the common 1:1 retail
 * case) it is placed straight above/below that column; otherwise the nodes are
 * ordered by the leftmost column they feed and spread over ≤ 3 equal columns.
 */
export function bandPlacement(nodes: readonly FlowNode[], links: readonly FlowLink[]): BandPlacement {
  const firstCol = new Map<string, number>();
  for (const l of links) {
    const col = l.cellIndex % GRID_COLUMNS;
    const prev = firstCol.get(l.nodeId);
    if (prev === undefined || col < prev) firstCol.set(l.nodeId, col);
  }
  const colOf = (n: FlowNode) => firstCol.get(n.id) ?? GRID_COLUMNS;
  const ordered = nodes
    .map((node, i) => ({ node, i }))
    .sort((a, b) => colOf(a.node) - colOf(b.node) || a.i - b.i)
    .map((x) => x.node);
  const cols = ordered.map(colOf);
  const distinct = new Set(cols).size === cols.length && cols.every((c) => c < GRID_COLUMNS);
  if (ordered.length > 1 && ordered.length <= GRID_COLUMNS && distinct) {
    return { columns: GRID_COLUMNS, aligned: true, slots: ordered.map((node, k) => ({ node, column: cols[k] + 1 })) };
  }
  return { columns: Math.max(1, Math.min(GRID_COLUMNS, ordered.length)), aligned: false, slots: ordered.map((node) => ({ node })) };
}
