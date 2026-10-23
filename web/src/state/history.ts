// Client-side metric history for HUD sparklines and the debrief charts, until
// the bridge's persisted `history` method (bridge-spec §5.10) is available —
// then `historyFromDto` fills the same shape from the engine. Values are read
// from snapshots, never recomputed.

import type { DateDto } from '@/bridge/protocol';
import type { HudModel } from './hud';

export interface MonthRecord {
  monthIndex: number;
  date: DateDto;
  cash: number;
  value: number;
  revenue: number;
  netIncome: number;
}

/** Hard cap so a 30-year sandbox stays small in memory and in the UI sidecar. */
export const HISTORY_CAP = 480;

/** One record from a HUD snapshot (the month the snapshot describes). */
export function recordFromHud(hud: HudModel): MonthRecord | null {
  if (!hud.player) return null;
  return {
    monthIndex: hud.monthIndex,
    date: hud.date,
    cash: hud.player.cash,
    value: hud.player.value,
    revenue: hud.player.revenue,
    netIncome: hud.player.netIncome,
  };
}

/** Appends or replaces the record for its month, keeping the list ordered and capped. */
export function appendRecord(history: readonly MonthRecord[], record: MonthRecord): MonthRecord[] {
  const next = history.filter((r) => r.monthIndex !== record.monthIndex);
  next.push(record);
  next.sort((a, b) => a.monthIndex - b.monthIndex);
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

/** Consecutive profitable months ending with the latest record. */
export function profitStreak(history: readonly MonthRecord[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if ((history[i]?.netIncome ?? 0) > 0) n++;
    else break;
  }
  return n;
}

interface LooseHistoryDto {
  start?: DateDto;
  months?: number;
  companies?: { companyId: number; series?: Record<string, (number | null)[]> }[];
}

/** Builds records from the bridge `history` result for one company (bridge-spec §5.10). */
export function historyFromDto(dto: unknown, companyId: number, startMonthIndex: number): MonthRecord[] {
  const h = dto as LooseHistoryDto;
  const row = h.companies?.find((c) => c.companyId === companyId);
  if (!h.start || !row?.series) return [];
  const series = row.series;
  const length = Math.max(...Object.values(series).map((v) => v?.length ?? 0), 0);
  const out: MonthRecord[] = [];
  for (let i = 0; i < length; i++) {
    const ord = h.start.year * 12 + (h.start.month - 1) + i;
    const pick = (name: string) => series[name]?.[i] ?? null;
    const cash = pick('cash');
    if (cash === null) continue;
    out.push({
      monthIndex: startMonthIndex + i,
      date: { year: Math.floor(ord / 12), month: (ord % 12) + 1 },
      cash,
      value: pick('corporateValue') ?? pick('totalAssets') ?? cash,
      revenue: pick('revenue') ?? 0,
      netIncome: pick('netIncome') ?? 0,
    });
  }
  return out;
}
