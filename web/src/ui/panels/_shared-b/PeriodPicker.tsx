// Period controls shared by the statements: Month / Quarter / Year / Custom
// columns, a custom from–to range, and a company picker (rival statements are
// public, bridge-spec §5.8; the ledger stays player-only).

import { useMemo } from 'react';
import type { DateDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { Segmented, Select, type SelectOption } from '@/ui/components';
import { monthYear } from '@/util/format';
import { useNames } from './names';
import { monthKey, monthOptions, parseMonthKey, periodColumns, type Granularity, type PeriodColumn } from './periods';
import styles from './shared.module.css';

export interface PeriodState {
  granularity: Granularity;
  custom: { from: DateDto; to: DateDto } | null;
}

const COUNTS: Record<Granularity, number> = { month: 6, quarter: 4, year: 3, custom: 2 };

/** The game's current month and start month (bridge snapshot). */
export function useGameDates(): { now: DateDto; start: DateDto } | null {
  const date = useGameStore((s) => s.hud?.date);
  const start = useGameStore((s) => s.hud?.startDate ?? s.snapshot?.startDate ?? null);
  return useMemo(() => (date ? { now: date, start: start ?? date } : null), [date, start]);
}

/** Columns for the picker state, oldest first. */
export function useColumns(state: PeriodState, countOverride?: number): PeriodColumn[] {
  const dates = useGameDates();
  return useMemo(() => {
    if (!dates) return [];
    return periodColumns(state.granularity, dates.now, dates.start, countOverride ?? COUNTS[state.granularity], state.custom ?? undefined);
  }, [dates, state.granularity, state.custom, countOverride]);
}

export function PeriodPicker({ state, onChange }: { state: PeriodState; onChange: (s: PeriodState) => void }) {
  const dates = useGameDates();
  const months = useMemo(() => (dates ? monthOptions(dates.start, dates.now) : []), [dates]);
  const options: SelectOption<string>[] = months.map((m) => ({ value: monthKey(m), label: monthYear(m) }));
  const custom = state.custom ?? (dates ? { from: months[Math.min(2, months.length - 1)] ?? dates.now, to: dates.now } : null);
  return (
    <div className={styles.toolbarGroup}>
      <span className={styles.toolbarLabel}>Period</span>
      <Segmented<Granularity>
        size="sm"
        label="Statement period"
        value={state.granularity}
        onChange={(g) => onChange({ granularity: g, custom: g === 'custom' ? custom : state.custom })}
        options={[
          { value: 'month', label: 'Month', testId: 'period-month' },
          { value: 'quarter', label: 'Quarter', testId: 'period-quarter' },
          { value: 'year', label: 'Year', testId: 'period-year' },
          { value: 'custom', label: 'Custom', testId: 'period-custom' },
        ]}
      />
      {state.granularity === 'custom' && custom && (
        <>
          <Select<string>
            size="sm"
            aria-label="From month"
            value={monthKey(custom.from)}
            options={options}
            onChange={(k) => {
              const from = parseMonthKey(k);
              if (from) onChange({ ...state, custom: { from, to: custom.to } });
            }}
          />
          <span className={styles.dim}>to</span>
          <Select<string>
            size="sm"
            aria-label="To month"
            value={monthKey(custom.to)}
            options={options}
            onChange={(k) => {
              const to = parseMonthKey(k);
              if (to) onChange({ ...state, custom: { from: custom.from, to } });
            }}
          />
        </>
      )}
    </div>
  );
}

/** Player + rivals; `null` value = the player. */
export function CompanyPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const names = useNames();
  const options: SelectOption<number>[] = names.companies
    .slice()
    .sort((a, b) => (a.isPlayer === b.isPlayer ? a.name.localeCompare(b.name) : a.isPlayer ? -1 : 1))
    .map((c) => ({ value: c.id, label: c.isPlayer ? `${c.name} (you)` : c.name }));
  const current = value ?? names.playerId;
  const ref = names.company(current);
  return (
    <div className={styles.toolbarGroup}>
      <span className={styles.toolbarLabel}>Company</span>
      <Select<number>
        size="sm"
        aria-label="Company"
        data-testid="report-company"
        value={current}
        options={options}
        onChange={(id) => onChange(id === names.playerId ? null : id)}
      />
      {!ref.isPlayer && <span className={styles.tiny}>Public filings — no ledger detail</span>}
    </div>
  );
}

export type Preset = 'thisMonth' | 'lastMonth' | 'ytd' | 'last12' | 'sinceStart';

export const PRESET_LABEL: Record<Preset, string> = {
  thisMonth: 'This month',
  lastMonth: 'Last month',
  ytd: 'Year to date',
  last12: 'Last 12 months',
  sinceStart: 'Since start',
};

/** Single-period presets (bridge-spec §4.6.2) for ranked reports (products, exports, ledger). */
export function PresetPicker({ value, onChange }: { value: Preset; onChange: (p: Preset) => void }) {
  return (
    <div className={styles.toolbarGroup}>
      <span className={styles.toolbarLabel}>Period</span>
      <Segmented<Preset>
        size="sm"
        label="Report period"
        value={value}
        onChange={onChange}
        options={(Object.keys(PRESET_LABEL) as Preset[]).map((p) => ({ value: p, label: PRESET_LABEL[p], testId: `preset-${p}` }))}
      />
    </div>
  );
}
