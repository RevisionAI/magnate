// Product profitability (UX §6.9 Products): units, revenue, COGS, gross margin,
// marketing and contribution per product for a period, ranked; a row opens the
// product in Markets.

import { useMemo, useState } from 'react';
import type { ProductPnlRowDto } from '@/bridge/protocol';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { BarChart, Panel, Sparkline, Stat, Table } from '@/ui/components';
import { compact, money, percent } from '@/util/format';
import { ErrorBlock, LoadingBlock, Note, useMoneyFormat } from '../_shared-b/components';
import { PresetPicker, useGameDates, type Preset } from '../_shared-b/PeriodPicker';
import { isClosed, periodColumns, toPeriodArgs } from '../_shared-b/periods';
import { useEngineQueries } from '../_shared-b/useEngineQueries';
import shared from '../_shared-b/shared.module.css';
import { dropColumns, useNarrow } from '../_shared-b/useNarrow';

export function ProductsTab() {
  const narrow = useNarrow();
  const [preset, setPreset] = useState<Preset>('last12');
  const fmt = useMoneyFormat();
  const { data, error } = useEngineQuery('productProfitability', { period: { preset } });
  const openPanel = useUiStore((s) => s.openPanel);
  const rows = data?.rows ?? [];
  // Contribution per product for each of the last 8 months (closed months are cached).
  const dates = useGameDates();
  const months = useMemo(() => (dates ? periodColumns('month', dates.now, dates.start, 8) : []), [dates]);
  const monthArgs = useMemo(() => months.map((c) => ({ period: toPeriodArgs(c) })), [months]);
  const monthClosed = useMemo(() => months.map((c) => (dates ? isClosed(c, dates.now) : false)), [months, dates]);
  const trend = useEngineQueries('productProfitability', monthArgs, monthClosed);
  const trendOf = (productId: string) => trend.data.map((d) => (d ? (d.rows.find((r) => r.productId === productId)?.netMargin ?? 0) : null));
  const totals = rows.reduce(
    (t, r) => ({ revenue: t.revenue + r.revenue, gross: t.gross + r.grossMargin, net: t.net + r.netMargin, marketing: t.marketing + r.marketing }),
    { revenue: 0, gross: 0, net: 0, marketing: 0 },
  );
  const best = rows.slice().sort((a, b) => b.netMargin - a.netMargin)[0];
  const worst = rows.slice().sort((a, b) => a.netMargin - b.netMargin)[0];

  return (
    <div className={shared.page}>
      <div className={shared.toolbar}>
        <PresetPicker value={preset} onChange={setPreset} />
      </div>
      {error && !data ? (
        <ErrorBlock error={error} />
      ) : !data ? (
        <LoadingBlock rows={8} chart />
      ) : rows.length === 0 ? (
        <Note>Nothing sold in this period yet. Products appear here once a store or factory sells them.</Note>
      ) : (
        <>
          <div className={shared.kpis}>
            <Stat tile size="sm" label="Revenue" value={fmt(totals.revenue)} />
            <Stat tile size="sm" label="Gross margin" value={fmt(totals.gross)} foot={totals.revenue ? `${percent(totals.gross / totals.revenue, 1)} of revenue` : undefined} />
            <Stat tile size="sm" label="Marketing" value={fmt(totals.marketing)} />
            <Stat tile size="sm" label="Contribution" value={fmt(totals.net)} tone={totals.net >= 0 ? 'pos' : 'neg'} />
            {best && <Stat tile size="sm" label="Best product" value={best.name} foot={fmt(best.netMargin, { signed: true })} />}
            {worst && worst !== best && worst.netMargin < 0 && <Stat tile size="sm" label="Losing money" value={worst.name} tone="neg" foot={fmt(worst.netMargin, { signed: true })} />}
          </div>
          <div className={shared.split}>
            <Panel title="Products by contribution" padding="none" variant="solid">
              <Table<ProductPnlRowDto>
                rowKey={(r) => r.productId}
                rows={rows}
                defaultSort={{ id: 'net', dir: 'desc' }}
                onRowClick={(r) => openPanel('markets', { productId: r.productId })}
                showTotal
                aria-label="Product profitability"
                columns={dropColumns(narrow, ['cogs', 'gmp', 'trend'], [
                  { id: 'name', header: 'Product', sortValue: (r) => r.name, cell: (r) => r.name, total: 'Total' },
                  { id: 'units', header: 'Units', numeric: true, sortValue: (r) => r.unitsSold, cell: (r) => compact(r.unitsSold) },
                  { id: 'rev', header: 'Revenue', numeric: true, sortValue: (r) => r.revenue, cell: (r) => fmt(r.revenue), total: fmt(totals.revenue) },
                  { id: 'cogs', header: 'COGS', numeric: true, sortValue: (r) => r.cogs, cell: (r) => fmt(-r.cogs) },
                  { id: 'gm', header: 'Gross margin', numeric: true, sortValue: (r) => r.grossMargin, cell: (r) => fmt(r.grossMargin), total: fmt(totals.gross) },
                  { id: 'gmp', header: 'GM %', numeric: true, sortValue: (r) => (r.revenue ? r.grossMargin / r.revenue : null), cell: (r) => (r.revenue ? percent(r.grossMargin / r.revenue, 1) : '—') },
                  { id: 'mkt', header: 'Marketing', numeric: true, sortValue: (r) => r.marketing, cell: (r) => (r.marketing ? fmt(-r.marketing) : '—'), total: fmt(-totals.marketing) },
                  {
                    id: 'net',
                    header: 'Contribution',
                    numeric: true,
                    hint: 'Gross margin minus marketing for this product',
                    sortValue: (r) => r.netMargin,
                    cell: (r) => <b className={r.netMargin >= 0 ? shared.pos : shared.neg}>{fmt(r.netMargin, { signed: true })}</b>,
                    total: <b>{fmt(totals.net, { signed: true })}</b>,
                  },
                  {
                    id: 'trend',
                    header: 'Last 8 months',
                    cell: (r) => <Sparkline values={trendOf(r.productId)} variant="bars" width={84} height={20} minSlots={8} aria-label={`${r.name} contribution by month`} />,
                  },
                  { id: 'nmp', header: 'Margin', numeric: true, sortValue: (r) => r.netMarginPct ?? null, cell: (r) => (r.netMarginPct !== undefined ? percent(r.netMarginPct, 1) : '—') },
                ])}
              />
            </Panel>
            <Panel title="Contribution by product" padding="md" variant="solid">
              <BarChart
                height={220}
                signed
                yFormat={(v) => money(v, 1)}
                data={rows
                  .slice()
                  .sort((a, b) => b.netMargin - a.netMargin)
                  .map((r) => ({ label: r.name.length > 10 ? `${r.name.slice(0, 9)}…` : r.name, value: r.netMargin }))}
              />
              <div className={`${shared.tiny} ${shared.dim}`} style={{ marginTop: 8 }}>
                Click a product to open its markets. Units are what left your shelves and docks (retail + export).
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
