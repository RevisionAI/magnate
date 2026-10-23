// Finance overlay (F) — UX §6.10, MASTER-PLAN D9. Overview of the capital
// structure (cash, debt, equity, rating, runway, coverage), the Bank (credit
// profile, loan offers with an amortisation preview, outstanding loans and the
// revolving credit line), and Equity / Stock market, which arrive with Wave 3
// and are shown as locked cards with their rules and your progress.
// Loans come online when the bridge flips `features.loans`; until then the
// bridge answers `feature_unavailable` and the Bank shows what is coming.

import { useState } from 'react';
import { OverlayFrame, type TabItem } from '@/ui/components';
import type { PanelProps } from '../registry';
import { BankTab } from './BankTab';
import { EquityTab, StockMarketTab } from './EquityTab';
import { OverviewTab } from './OverviewTab';

export type FinanceTab = 'overview' | 'bank' | 'equity' | 'stocks';

const TABS: TabItem<FinanceTab>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'bank', label: 'Bank' },
  { id: 'equity', label: 'Equity' },
  { id: 'stocks', label: 'Stock market' },
];

export default function FinancePanel({ params }: PanelProps) {
  const initial = typeof params.tab === 'string' && TABS.some((t) => t.id === params.tab) ? (params.tab as FinanceTab) : params.tab === 'loans' ? 'bank' : 'overview';
  const [tab, setTab] = useState<FinanceTab>(initial);
  return (
    <OverlayFrame tabs={TABS} tab={tab} onTabChange={setTab} subtitle="Capital, credit and the market" data-testid="panel-finance">
      <div data-testid={`finance-tab-${tab}`}>
        {tab === 'overview' && <OverviewTab go={setTab} />}
        {tab === 'bank' && <BankTab />}
        {tab === 'equity' && <EquityTab />}
        {tab === 'stocks' && <StockMarketTab />}
      </div>
    </OverlayFrame>
  );
}
