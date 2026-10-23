// Inspector view-model (pure): the alerts a building shows inline (UX §6.7.1,
// game-feel §8 rows 9–11) and the per-line rows of the Overview table. Every
// number is a bridge field; this file only decides what to say about it.

import type { BuildingDetailDto, SlotDetailDto } from '@/bridge/protocol';
import { money, percent, price as fmtPrice } from '@/util/format';
import { qty as compact } from '../_shared-a/numbers';
import { coverMonths, lineForecast, lostShare } from '../_shared-a/stockPolicy';
import { shelfEmptied } from '../_shared-a/unitGrid';

export type InspectorTab = 'overview' | 'layout' | 'setup' | 'finance';

export interface InspectorAlert {
  id: string;
  tone: 'danger' | 'warning' | 'opportunity' | 'info';
  text: string;
  action?: { label: string; tab: InspectorTab; slotIndex?: number };
}

/** Cover above this many months is overstock (game-feel §8 row 10). */
export const OVERSTOCK_MONTHS = 3;

export function buildingAlerts(d: BuildingDetailDto, opts: { productName: (id: string) => string; cash: number }): InspectorAlert[] {
  const out: InspectorAlert[] = [];
  if (!d.isPlayer) return out;
  if (d.construction) {
    out.push({ id: 'construction', tone: 'info', text: `Under construction: ${percent(d.construction.progress, 0)} done. You can set up its units now; they start when it opens.` });
  }
  if (d.slotKind !== 'none' && d.slots.length === 0) {
    out.push({ id: 'idle', tone: 'warning', text: `Idle: it costs ${money(d.monthlyOpex)}/mo and earns nothing until a unit is set up.`, action: { label: 'Set up', tab: 'setup' } });
  }
  for (const s of d.slots) {
    const name = opts.productName(s.productId);
    if (s.retail) {
      const r = s.retail;
      if (r.belowCost) out.push({ id: `below:${s.index}`, tone: 'danger', text: `${name} sells below its unit cost (${fmtPrice(r.price)} vs ${fmtPrice(r.unitCost)}).`, action: { label: 'Fix price', tab: 'setup', slotIndex: s.index } });
      const lost = lostShare(r);
      if (lost !== null && lost >= 0.05) {
        out.push({ id: `lost:${s.index}`, tone: 'warning', text: `${name}: lost ${compact(r.lastMonthLostUnits ?? 0)} sales last month (${percent(lost, 0)} of demand).`, action: { label: 'Stock more', tab: 'setup', slotIndex: s.index } });
      } else if (lost === null && shelfEmptied(s)) {
        out.push({ id: `empty:${s.index}`, tone: 'warning', text: `${name}: the shelf ran empty last month, so you may be turning shoppers away.`, action: { label: 'Stock more', tab: 'setup', slotIndex: s.index } });
      }
      const f = lineForecast(r);
      const cover = coverMonths(r.restockTarget, f.units);
      if (cover !== null && cover > OVERSTOCK_MONTHS && f.source !== 'model') {
        out.push({ id: `over:${s.index}`, tone: 'info', text: `${name}: ${cover.toFixed(1)} months of stock ties up cash.`, action: { label: 'Trim stock', tab: 'setup', slotIndex: s.index } });
      }
    }
    if (s.production) {
      const p = s.production;
      if (p.exportsAtLoss) out.push({ id: `exportloss:${s.index}`, tone: 'warning', text: `${name} is exported below its unit cost.`, action: { label: 'Review', tab: 'setup', slotIndex: s.index } });
      const short = p.inputs.filter((i) => i.onHand < i.perMonth);
      if (p.utilization !== undefined && p.utilization < 0.9 && short.length > 0) {
        out.push({
          id: `starved:${s.index}`,
          tone: 'warning',
          text: `${name} runs at ${percent(p.utilization, 0)}: short of ${short.map((i) => opts.productName(i.productId).toLowerCase()).join(', ')}.`,
          action: { label: 'Layout', tab: 'layout' },
        });
      }
    }
    if (s.research?.blocked) out.push({ id: `blocked:${s.index}`, tone: 'warning', text: `Research on ${name} is blocked by a rival patent.`, action: { label: 'Change', tab: 'setup', slotIndex: s.index } });
  }
  if (d.upgrade && d.upgrade.affordable && d.slots.length >= d.capacity && d.slotKind !== 'none') {
    out.push({ id: 'upgrade', tone: 'opportunity', text: `Every unit is in use. Level ${d.upgrade.toLevel} adds ${d.upgrade.capacity - d.capacity} units for ${money(d.upgrade.cost)}.`, action: { label: 'Upgrade', tab: 'finance' } });
  }
  return out;
}

export interface LineRow {
  slot: SlotDetailDto;
  /** Main figure ("$2.25", "200K/mo"). */
  primary: string;
  /** Volume line ("1.30M / 1.30M sold", "94% utilised"). */
  volume: string;
  /** 0..1 fill for the volume bar (sold ÷ demand, utilisation, progress). */
  fill: number | null;
  fillTone: 'ok' | 'warn' | 'bad';
  /** Stock cover / on-hand text. */
  stock: string;
  warn: boolean;
}

export function lineRow(s: SlotDetailDto): LineRow {
  if (s.retail) {
    const r = s.retail;
    const f = lineForecast(r);
    const demand = r.lastMonthDemand ?? (r.lastMonthLostUnits !== undefined ? r.lastMonthUnits + r.lastMonthLostUnits : null);
    const cover = coverMonths(r.restockTarget, f.units);
    const lost = lostShare(r);
    const emptied = shelfEmptied(s);
    return {
      slot: s,
      primary: fmtPrice(r.price),
      volume: demand !== null ? `${compact(r.lastMonthUnits)} / ${compact(demand)} sold` : `${compact(r.lastMonthUnits)} sold · ${compact(r.modelDemandUnits)} forecast`,
      fill: demand ? Math.min(1, r.lastMonthUnits / demand) : f.units > 0 ? Math.min(1, r.lastMonthUnits / f.units) : null,
      fillTone: (lost ?? 0) >= 0.05 || emptied ? 'warn' : 'ok',
      stock: cover === null ? `${compact(r.onHand)} on hand` : `${cover >= 10 ? cover.toFixed(0) : cover.toFixed(1)} mo cover`,
      warn: r.belowCost || emptied || (lost ?? 0) >= 0.05,
    };
  }
  if (s.production) {
    const p = s.production;
    const u = p.utilization ?? null;
    return {
      slot: s,
      primary: `${compact(p.lastMonthOutput ?? p.outputPerMonth)}/mo`,
      volume: u !== null ? `${percent(u, 0)} utilised` : `${compact(p.outputPerMonth)}/mo capacity`,
      fill: u,
      fillTone: u === null || u >= 0.9 ? 'ok' : u >= 0.5 ? 'warn' : 'bad',
      stock: p.unitCost !== undefined ? `cost ${fmtPrice(p.unitCost)}` : `world ${fmtPrice(p.effectiveWorldPrice)}`,
      warn: p.exportsAtLoss || (u !== null && u < 0.9),
    };
  }
  if (s.extraction) {
    const e = s.extraction;
    return { slot: s, primary: `${compact(e.yieldPerMonth)}/mo`, volume: `quality ${e.quality.toFixed(0)}`, fill: e.quality / 100, fillTone: 'ok', stock: `${compact(e.onHand)} on hand`, warn: false };
  }
  if (s.warehouse) {
    const w = s.warehouse;
    const fill = w.targetStock > 0 ? Math.min(1, w.onHand / w.targetStock) : null;
    return { slot: s, primary: `${compact(w.onHand)}`, volume: `of ${compact(w.targetStock)} target`, fill, fillTone: (fill ?? 1) >= 0.9 ? 'ok' : 'warn', stock: w.unitCost > 0 ? `cost ${fmtPrice(w.unitCost)}` : '—', warn: (fill ?? 1) < 0.9 };
  }
  if (s.research) {
    const r = s.research;
    const fill = r.threshold > 0 ? Math.min(1, r.progress / r.threshold) : null;
    return {
      slot: s,
      primary: `Tech ${r.tech}/${r.maxTech}`,
      volume: r.blocked ? 'Blocked by a patent' : r.tech >= r.maxTech ? 'At maximum' : r.etaMonths !== undefined ? `next level in ${r.etaMonths} mo` : 'researching',
      fill,
      fillTone: r.blocked ? 'bad' : 'ok',
      stock: `${compact(r.companyPointsPerMonth)} pts/mo`,
      warn: r.blocked,
    };
  }
  return { slot: s, primary: '—', volume: '', fill: null, fillTone: 'ok', stock: '', warn: false };
}

/** Upgrade economics the engine exposes: running-cost saving and extra units (payback only from opex savings). */
export function upgradeSummary(d: Pick<BuildingDetailDto, 'monthlyOpex' | 'capacity' | 'upgrade'>): { opexDelta: number; extraUnits: number; paybackMonths: number | null } | null {
  if (!d.upgrade) return null;
  const opexDelta = d.upgrade.monthlyOpex - d.monthlyOpex;
  const saving = -opexDelta;
  return { opexDelta, extraUnits: d.upgrade.capacity - d.capacity, paybackMonths: saving > 0 ? Math.ceil(d.upgrade.cost / saving) : null };
}
