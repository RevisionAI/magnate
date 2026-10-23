// P&L tab: period columns (month / quarter / year / custom), revenue bars with
// the net-income line, the statement grid with drill-down, the variance
// waterfall for the latest column against the one before it, and the
// books-close check from the balance sheet.

import { CheckCircle2, Download, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { IncomeStatementDto } from '@/bridge/protocol';
import { useEngineQuery } from '@/state/useEngineQuery';
import { Button, Delta, Panel, Stat, Toggle } from '@/ui/components';
import { money } from '@/util/format';
import { ComboChart, Waterfall } from '../_shared-b/charts';
import { ErrorBlock, LoadingBlock, Note, pct, useMoneyFormat } from '../_shared-b/components';
import { downloadCsv } from '../_shared-b/csv';
import { useNames } from '../_shared-b/names';
import { CompanyPicker, PeriodPicker, useColumns, useGameDates, type PeriodState } from '../_shared-b/PeriodPicker';
import { isClosed, toPeriodArgs, type PeriodColumn } from '../_shared-b/periods';
import { incomeStatementRows, type StatementRow } from '../_shared-b/statement';
import { StatementTable } from '../_shared-b/StatementTable';
import { useEngineQueries } from '../_shared-b/useEngineQueries';
import shared from '../_shared-b/shared.module.css';
import type { ReportsNav } from './index';
import { driverSteps, whySummary } from './why';
import styles from './Reports.module.css';

const TABLE_COLUMNS = { month: 6, quarter: 4, year: 3, custom: 2 } as const;

export function PnlTab({ nav }: { nav: ReportsNav }) {
  const [period, setPeriod] = useState<PeriodState>({ granularity: 'month', custom: null });
  const [compare, setCompare] = useState(true);
  const dates = useGameDates();
  const names = useNames();
  const fmt = useMoneyFormat();
  // The chart shows a longer run of months; the table the latest few.
  const chartColumns = useColumns(period, period.granularity === 'month' ? 12 : undefined);
  const columns = useMemo(() => chartColumns.slice(-TABLE_COLUMNS[period.granularity]), [chartColumns, period.granularity]);
  const companyId = nav.companyId;
  const argsList = useMemo(() => chartColumns.map((c) => ({ period: toPeriodArgs(c), ...(companyId !== null ? { companyId } : {}) })), [chartColumns, companyId]);
  const closed = useMemo(() => chartColumns.map((c) => (dates ? isClosed(c, dates.now) : false)), [chartColumns, dates]);
  const q = useEngineQueries('incomeStatement', argsList, closed);
  const all = q.data as (IncomeStatementDto | undefined)[];
  const tableData = all.slice(-columns.length);
  const rows = useMemo(() => incomeStatementRows(tableData), [tableData]);
  const isPlayer = companyId === null || companyId === names.playerId;

  const latest = tableData[tableData.length - 1];
  const previous = tableData.length >= 2 ? tableData[tableData.length - 2] : undefined;
  const latestCol = columns[columns.length - 1];
  const prevCol = columns.length >= 2 ? columns[columns.length - 2] : undefined;

  const onDrill = (row: StatementRow) => {
    if (!row.drill || row.drill.kind === 'none') return;
    if (row.drill.kind === 'tab') nav.go(row.drill.tab as never);
    else if (isPlayer && latestCol) nav.go('ledger', { categories: row.drill.categories, from: columns[0]?.from, to: latestCol.to });
  };

  const exportCsv = () => {
    downloadCsv(`income-statement-${columns[0]?.label ?? ''}-${latestCol?.label ?? ''}`, [
      ['Line', ...columns.map((c) => c.caption)],
      ...rows.filter((r) => r.kind !== 'header').map((r) => [r.label, ...r.values.map((v) => (v === null ? null : r.format === 'percent' ? Math.round(v * 10000) / 100 : v))]),
    ]);
  };

  return (
    <div className={shared.page}>
      <div className={shared.toolbar}>
        <PeriodPicker state={period} onChange={setPeriod} />
        <Toggle size="sm" checked={compare} onChange={setCompare} label="Compare with previous" data-testid="pnl-compare" />
        <CompanyPicker value={companyId} onChange={nav.setCompanyId} />
        <span className={shared.spacer} />
        <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={exportCsv} disabled={rows.length === 0}>
          Export CSV
        </Button>
      </div>

      <div className={shared.split}>
        <div className={shared.stack}>
          <Panel title="Revenue and net income" padding="md" variant="solid">
            <ComboChart
              height={190}
              labels={chartColumns.map((c) => c.label)}
              highlight={chartColumns.findIndex((c) => c.open)}
              bars={[{ id: 'rev', label: 'Revenue', values: all.map((d) => d?.revenue ?? null), color: 'rgba(90, 167, 216, 0.75)' }]}
              lines={[{ id: 'ni', label: 'Net income', values: all.map((d) => d?.netIncome ?? null), color: '#D7B766' }]}
              yFormat={(v) => money(v, 1)}
              aria-label="Revenue and net income by period"
            />
          </Panel>
          {q.error && !latest ? <ErrorBlock error={q.error} /> : null}
          {!latest && !q.error ? (
            <LoadingBlock rows={10} />
          ) : (
            <StatementTable columns={columns} rows={rows} showDelta={compare} onDrill={onDrill} aria-label="Income statement" data-testid="pnl-table" />
          )}
          <div className={shared.legendRow}>
            <span>• = month to date (the books close at month end)</span>
            <span>Click a line to drill into it</span>
            {!isPlayer && <span>Rival statements come from public filings</span>}
          </div>
        </div>

        <div className={shared.stack}>
          {latest && (
            <Panel title={latestCol?.caption ?? 'Latest'} padding="md" variant="solid">
              <div className={shared.kpis}>
                <Stat
                  size="sm"
                  label="Revenue"
                  value={fmt(latest.revenue)}
                  delta={previous && latest.revenue !== previous.revenue ? <Delta value={latest.revenue - previous.revenue} /> : undefined}
                />
                <Stat
                  size="sm"
                  label="Net income"
                  value={fmt(latest.netIncome)}
                  tone={latest.netIncome > 0 ? 'pos' : latest.netIncome < 0 ? 'neg' : 'default'}
                  delta={previous && latest.netIncome !== previous.netIncome ? <Delta value={latest.netIncome - previous.netIncome} /> : undefined}
                />
                <Stat size="sm" label="Gross margin" value={pct(latest.grossMargin)} />
                <Stat size="sm" label="Net margin" value={pct(latest.netMargin)} />
              </div>
            </Panel>
          )}
          {isPlayer ? <WhyCard base={prevCol} compare={latestCol} /> : <Note>“Why did it change?” explains your own results; rivals publish totals only.</Note>}
          <BooksClose companyId={companyId} />
        </div>
      </div>
    </div>
  );
}

function WhyCard({ base, compare }: { base?: PeriodColumn; compare?: PeriodColumn }) {
  const names = useNames();
  const fmt = useMoneyFormat();
  const args = base && compare ? { base: toPeriodArgs(base), compare: toPeriodArgs(compare) } : null;
  const { data, error } = useEngineQuery('explainNetIncome', args);
  const lookup = { product: (id: string) => names.product(id), building: (id: number) => names.building(id) };
  return (
    <Panel title="Why did it change?" padding="md" variant="solid" accent data-testid="why-card">
      {!base || !compare ? (
        <Note>Play a second period to compare it with the first.</Note>
      ) : error ? (
        <ErrorBlock error={error} />
      ) : !data ? (
        <LoadingBlock rows={6} />
      ) : (
        <>
          <div className={styles.whyHead}>
            <div>
              <div className={styles.whyCaption}>
                {base.label} → {compare.label}
              </div>
              <div className={`${styles.whyBig} ${data.compareNetIncome - data.baseNetIncome >= 0 ? shared.pos : shared.neg}`}>
                {fmt(data.compareNetIncome - data.baseNetIncome, { signed: true })}
              </div>
            </div>
          </div>
          <p className={`${shared.small} ${shared.muted}`} style={{ margin: '0 0 12px' }}>
            {whySummary(data, lookup, (v, s) => fmt(v, { signed: s }))}
          </p>
          <Waterfall
            data-testid="why-waterfall"
            start={{ label: `Net income ${base.label}`, value: data.baseNetIncome }}
            steps={driverSteps(data, lookup).map((s) => ({ id: s.id, label: s.label, amount: s.amount, title: s.detail }))}
            end={{ label: `Net income ${compare.label}`, value: data.compareNetIncome }}
            format={(v, signed) => fmt(v, { signed, digits: 1 })}
          />
          {compare.open && <div className={`${shared.tiny} ${shared.dim}`} style={{ marginTop: 8 }}>{compare.label} is still open — the books close at month end.</div>}
        </>
      )}
    </Panel>
  );
}

function BooksClose({ companyId }: { companyId: number | null }) {
  const { data } = useEngineQuery('balanceSheet', companyId !== null ? { companyId } : {});
  const fmt = useMoneyFormat();
  if (!data) return null;
  return (
    <Panel title="Books close" padding="md" variant="solid" data-testid="books-close">
      <div className={styles.books}>
        {data.booksClose ? <CheckCircle2 size={16} color="var(--c-green)" /> : <XCircle size={16} color="var(--c-red)" />}
        <span>
          {data.booksClose ? 'Assets − liabilities = equity, to the cent.' : `Out of balance by ${fmt(data.drift)}.`}
        </span>
      </div>
      <div className={`${shared.tiny} ${shared.dim}`} style={{ marginTop: 6 }}>
        Equity {fmt(data.equity)} = paid-in {fmt(data.startingCapital)} + retained earnings {fmt(data.retainedEarnings)}
      </div>
    </Panel>
  );
}
