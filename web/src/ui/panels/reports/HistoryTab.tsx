// History (ReplayViewer parity, bridge-spec §5.10 monthlyReport): every month's
// result with its best and worst buildings and noteworthy ledger entries.

import type { LedgerCategoryId, MonthSummaryDto } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { Panel, Table, Tooltip } from '@/ui/components';
import { ComboChart } from '../_shared-b/charts';
import { compact, money, monthYear } from '@/util/format';
import { ErrorBlock, LoadingBlock, Note, useMoneyFormat } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import { shortMonth } from '../_shared-b/periods';
import shared from '../_shared-b/shared.module.css';
import styles from './Reports.module.css';

const CATEGORY_LABEL: Record<LedgerCategoryId, string> = {
  startingCapital: 'Founders’ capital',
  constructionCost: 'Construction',
  operatingCost: 'Operating costs',
  inputPurchase: 'Input purchases',
  retailRestock: 'Restocking',
  productSale: 'Sales',
  exportSale: 'Exports',
  shippingCost: 'Shipping',
  advertisingCost: 'Advertising',
  patentRoyaltyIncome: 'Royalties received',
  patentRoyaltyExpense: 'Royalties paid',
  upgradeCost: 'Upgrades',
  // E2 finance categories
  shareIssuance: 'Shares issued',
  shareIssuanceFee: 'Issuance fees',
  shareBuyback: 'Share buyback',
  dividendPaid: 'Dividends',
  loanDrawdown: 'Loan drawn',
  loanRepayment: 'Loan repayment',
  revolverDraw: 'Credit line drawn',
  revolverRepay: 'Credit line repaid',
  landPurchase: 'Land',
  constructionPayment: 'Construction payments',
  equipmentPurchase: 'Equipment',
  assetSale: 'Building sale',
  liquidationProceeds: 'Liquidation',
  otherMaterials: 'Other materials',
  productionEnergy: 'Energy',
  wages: 'Wages',
  utilities: 'Utilities',
  maintenance: 'Maintenance',
  insurance: 'Insurance',
  propertyTax: 'Property tax',
  retailVariable: 'Store running costs',
  corporateOverhead: 'Corporate overhead',
  interestExpense: 'Interest',
  distressInterest: 'Penalty interest',
  interestIncome: 'Interest received',
  incomeTax: 'Income tax',
};

export function ledgerCategoryLabel(c: string): string {
  return (CATEGORY_LABEL as Record<string, string | undefined>)[c] ?? c.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (m) => m.toUpperCase());
}

export function HistoryTab() {
  const names = useNames();
  const fmt = useMoneyFormat();
  const start = useGameStore((s) => s.hud?.startDate ?? null);
  const { data, error } = useEngineQuery('monthlyReport', start ? { from: start } : {});
  if (error && !data) return <ErrorBlock error={error} />;
  if (!data) return <LoadingBlock rows={10} chart />;
  const months = data.months;
  if (months.length === 0) return <Note>The first month has not closed yet.</Note>;
  const newest = months.slice().reverse();
  return (
    <div className={shared.page}>
      <Panel title="Revenue and net income, month by month" padding="md" variant="solid">
        <ComboChart
          height={190}
          labels={months.map((m) => shortMonth(m.month))}
          bars={[{ id: 'rev', label: 'Revenue', values: months.map((m) => m.revenue), color: 'rgba(90, 167, 216, 0.75)' }]}
          lines={[{ id: 'ni', label: 'Net income', values: months.map((m) => m.netIncome), color: '#D7B766' }]}
          yFormat={(v) => money(v, 1)}
        />
      </Panel>
      <Panel title="Month by month" padding="none" variant="solid">
        <Table<MonthSummaryDto>
          dense
          maxHeight={520}
          rowKey={(m) => `${m.month.year}-${m.month.month}`}
          rows={newest}
          aria-label="Monthly history"
          columns={[
            { id: 'm', header: 'Month', cell: (m) => monthYear(m.month) },
            { id: 'rev', header: 'Revenue', numeric: true, cell: (m) => fmt(m.revenue) },
            { id: 'cogs', header: 'COGS', numeric: true, cell: (m) => fmt(-m.cogs) },
            { id: 'exp', header: 'Expenses', numeric: true, hint: 'Operating costs + advertising', cell: (m) => fmt(-m.expenses) },
            { id: 'roy', header: 'Royalties', numeric: true, cell: (m) => (m.royalties ? fmt(m.royalties, { signed: true }) : '—') },
            { id: 'ni', header: 'Net income', numeric: true, cell: (m) => <b className={m.netIncome >= 0 ? shared.pos : shared.neg}>{fmt(m.netIncome, { signed: true })}</b> },
            { id: 'units', header: 'Units', numeric: true, cell: (m) => compact(m.unitsSold) },
            { id: 'nb', header: 'New bldgs', numeric: true, cell: (m) => m.newBuildings || '—' },
            { id: 'ads', header: 'Campaigns', numeric: true, cell: (m) => m.adCampaigns || '—' },
            { id: 'cum', header: 'Cum. net income', numeric: true, cell: (m) => fmt(m.cumulativeNetIncome) },
            {
              id: 'top',
              header: 'Buildings that moved the month',
              cell: (m) => (
                <span className={styles.historyNote}>
                  {m.topBuildings.map((b) => `${names.building(b.buildingId)} ${fmt(b.netIncome, { signed: true, digits: 1 })}`).join(' · ') || '—'}
                </span>
              ),
            },
            {
              id: 'note',
              header: 'Big entries',
              cell: (m) =>
                m.noteworthy.length === 0 ? (
                  <span className={shared.dim}>—</span>
                ) : (
                  <Tooltip
                    title="Ledger entries of $250K or more"
                    content={
                      <div>
                        {m.noteworthy.slice(0, 8).map((n) => (
                          <div key={n.seq}>
                            {ledgerCategoryLabel(n.category)}
                            {n.productId ? ` · ${names.product(n.productId)}` : ''}: {fmt(n.amount, { signed: true })}
                          </div>
                        ))}
                      </div>
                    }
                  >
                    <span className={shared.chip} tabIndex={0}>
                      {m.noteworthy.length} entr{m.noteworthy.length === 1 ? 'y' : 'ies'}
                    </span>
                  </Tooltip>
                ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
