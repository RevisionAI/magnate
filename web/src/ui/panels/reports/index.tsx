// Reports overlay (R) — UX §6.9. Statements that reconcile and explain
// themselves: P&L with the "Why did it change?" waterfall, balance sheet with
// the books-close check and per-building drill-down, cash flow that reconciles
// to the change in cash, product profitability, exports, charts against
// rivals, month-by-month history and the ledger explorer. Every number comes
// from the bridge (bridge-spec §5.8/§5.10); nothing is re-derived here.

import { useState } from 'react';
import type { DateDto, LedgerCategoryId } from '@/bridge/protocol';
import { OverlayFrame, type TabItem } from '@/ui/components';
import type { PanelProps } from '../registry';
import { BalanceTab } from './BalanceTab';
import { CashFlowTab } from './CashFlowTab';
import { ChartsTab } from './ChartsTab';
import { ExportsTab } from './ExportsTab';
import { HistoryTab } from './HistoryTab';
import { LedgerTab } from './LedgerTab';
import { PnlTab } from './PnlTab';
import { ProductsTab } from './ProductsTab';

export type ReportsTab = 'pnl' | 'balance' | 'cashflow' | 'products' | 'exports' | 'charts' | 'history' | 'ledger';

const TABS: TabItem<ReportsTab>[] = [
  { id: 'pnl', label: 'P&L' },
  { id: 'balance', label: 'Balance sheet' },
  { id: 'cashflow', label: 'Cash flow' },
  { id: 'products', label: 'Products' },
  { id: 'exports', label: 'Exports' },
  { id: 'charts', label: 'Charts' },
  { id: 'history', label: 'History' },
  { id: 'ledger', label: 'Ledger' },
];

const ALIASES: Record<string, ReportsTab> = { why: 'pnl', income: 'pnl', statement: 'pnl', bs: 'balance', cash: 'cashflow', ledger: 'ledger' };

export interface LedgerFilter {
  categories?: LedgerCategoryId[];
  from?: DateDto;
  to?: DateDto;
  productId?: string;
  buildingId?: number;
}

/** Cross-tab navigation inside the overlay (statement row → ledger, revenue → products). */
export interface ReportsNav {
  go: (tab: ReportsTab, ledger?: LedgerFilter) => void;
  companyId: number | null;
  setCompanyId: (id: number | null) => void;
}

function initialTab(tab: unknown): ReportsTab {
  if (typeof tab !== 'string') return 'pnl';
  if (TABS.some((t) => t.id === tab)) return tab as ReportsTab;
  return ALIASES[tab] ?? 'pnl';
}

export default function ReportsPanel({ params }: PanelProps) {
  const [tab, setTab] = useState<ReportsTab>(initialTab(params.tab));
  const [ledger, setLedger] = useState<LedgerFilter>({});
  const [companyId, setCompanyId] = useState<number | null>(typeof params.companyId === 'number' ? params.companyId : null);
  const nav: ReportsNav = {
    go: (next, filter) => {
      if (filter) setLedger(filter);
      setTab(next);
    },
    companyId,
    setCompanyId,
  };
  return (
    <OverlayFrame tabs={TABS} tab={tab} onTabChange={setTab} subtitle="Every number explains itself" data-testid="panel-reports">
      <div data-testid={`reports-tab-${tab}`}>
        {tab === 'pnl' && <PnlTab nav={nav} />}
        {tab === 'balance' && <BalanceTab nav={nav} />}
        {tab === 'cashflow' && <CashFlowTab nav={nav} />}
        {tab === 'products' && <ProductsTab />}
        {tab === 'exports' && <ExportsTab />}
        {tab === 'charts' && <ChartsTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'ledger' && <LedgerTab filter={ledger} onFilter={setLedger} />}
      </div>
    </OverlayFrame>
  );
}
