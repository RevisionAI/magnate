// Finance › Overview: cash, debt, equity, leverage, rating, runway and
// coverage at a glance; cash / equity / debt over time; the capital structure;
// and the rules of money in this game, visible before you need them.

import { ArrowRight, Landmark } from 'lucide-react';
import { useMemo } from 'react';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { Button, LineChart, Panel, StackedBar, Stat } from '@/ui/components';
import { addMonths, money } from '@/util/format';
import { isFeatureUnavailable, LoadingBlock, Note, useMoneyFormat } from '../_shared-b/components';
import { type BalanceSheetView, borrowable, type CreditProfileView, finiteRatio, policyRateText, ratePct } from '../_shared-b/finance';
import { shortMonth } from '../_shared-b/periods';
import shared from '../_shared-b/shared.module.css';
import type { FinanceTab } from './index';
import { RatingBadge, RatingLadder } from './RatingCard';
import styles from './Finance.module.css';

export function OverviewTab({ go }: { go: (tab: FinanceTab) => void }) {
  const fmt = useMoneyFormat();
  const player = useGameStore((s) => s.hud?.player ?? null);
  const playerId = player?.id ?? null;
  const { data: bsData } = useEngineQuery('balanceSheet', {});
  const bs: BalanceSheetView | undefined = bsData;
  const profileQuery = useEngineQuery('creditProfile', {});
  const profile: { data: CreditProfileView | undefined; error: unknown } = profileQuery;
  const loansOff = isFeatureUnavailable(profile.error);
  const { data: hist } = useEngineQuery('history', playerId !== null ? { series: ['cash', 'equity', 'totalAssets'], companyIds: [playerId] } : null);
  const series = hist?.companies[0]?.series;
  const labels = useMemo(() => (hist ? Array.from({ length: hist.months }, (_, i) => shortMonth(addMonths(hist.start, i))) : []), [hist]);
  const debtSeries = useMemo(
    () => (series?.totalAssets && series.equity ? series.totalAssets.map((a, i) => (a === null || series.equity![i] === null || series.equity![i] === undefined ? null : a - series.equity![i]!)) : []),
    [series],
  );

  if (!player || !bs) return <LoadingBlock rows={8} chart />;
  const debt = bs.termLoans !== undefined || bs.revolver !== undefined ? (bs.termLoans ?? 0) + (bs.revolver ?? 0) : bs.liabilities;
  const de = bs.equity > 0 ? debt / bs.equity : null;
  const runway = player.runwayMonths;
  const grace = useGameStore.getState().hud?.insolvency.graceMonths ?? 3;
  const p = profile.data;
  const cover = finiteRatio(p?.interestCoverage);
  const distress = p?.solvency === 'distress' || p?.solvency === 'bankrupt';
  const runwayTile =
    distress && p?.cureMonthsLeft !== undefined
      ? { value: 'In distress', tone: 'neg' as const, foot: `${p.cureMonthsLeft} month-end${p.cureMonthsLeft === 1 ? '' : 's'} left to cure` }
      : player.cash < 0
        ? { value: 'Overdrawn', tone: 'neg' as const, foot: 'Cash is below zero — every month-end like this counts toward insolvency' }
        : {
            value: runway === null ? 'Not burning cash' : runway > 24 ? '> 24 months' : `${runway.toFixed(1)} months`,
            tone: runway !== null && runway < 3 ? ('neg' as const) : runway !== null && runway < 6 ? ('warn' as const) : ('default' as const),
            foot: 'Months of cash at the last 3 months’ operating burn',
          };

  return (
    <div className={shared.page}>
      <div className={shared.kpis}>
        <Stat tile label="Cash" value={fmt(player.cash)} data-testid="fin-cash" />
        <Stat
          tile
          label="Debt"
          value={fmt(debt)}
          foot={debt === 0 ? 'Debt-free' : bs.revolver ? `incl. ${fmt(bs.revolver)} on the credit line` : undefined}
          tone={debt > 0 && distress ? 'neg' : 'default'}
        />
        <Stat tile label="Equity" value={fmt(bs.equity)} />
        <Stat tile label="Debt / equity" value={de === null ? '—' : de.toFixed(2)} tone={de !== null && de > 1.5 ? 'warn' : 'default'} />
        <Stat tile label="Cash runway" value={runwayTile.value} tone={runwayTile.tone} foot={runwayTile.foot} data-testid="fin-runway" />
        <Stat tile label="Interest cover" value={p ? (cover === null ? 'No interest' : `${cover.toFixed(1)}×`) : '—'} foot="EBIT ÷ interest expense" />
      </div>

      <div className={shared.split}>
        <div className={shared.stack}>
          <Panel title="Cash, equity and debt" padding="md" variant="solid">
            {series ? (
              <LineChart
                height={240}
                labels={labels}
                yFormat={(v) => money(v, 1)}
                series={[
                  { id: 'equity', label: 'Equity', values: series.equity ?? [] },
                  { id: 'cash', label: 'Cash', values: series.cash ?? [], area: false },
                  { id: 'debt', label: 'Debt', values: debtSeries, area: false, dashed: true, color: '#DF6F6A' },
                ]}
              />
            ) : (
              <LoadingBlock rows={3} chart />
            )}
          </Panel>
          <Panel title="Capital structure" padding="md" variant="solid">
            <StackedBar
              height={16}
              format={(v) => money(v, 1)}
              segments={[
                { label: 'Equity', value: Math.max(0, bs.equity), color: '#5AA7D8' },
                ...(bs.liabilityLines && bs.liabilityLines.length > 0
                  ? bs.liabilityLines.map((l, i) => ({ label: l.label, value: l.amount, color: ['#DF6F6A', '#E69F00', '#CC79A7', '#7E9CF0'][i % 4] }))
                  : [{ label: 'Debt', value: debt, color: '#DF6F6A' }]),
              ]}
            />
            <p className={`${shared.small} ${shared.muted}`} style={{ margin: '10px 0 0' }}>
              {debt === 0
                ? 'Everything you own is paid for with founders’ capital and profits. Borrowing makes sense when a new business earns more than the interest.'
                : `Lenders fund ${Math.round((debt / Math.max(1, bs.totalAssets)) * 100)}% of your assets.`}
            </p>
          </Panel>
        </div>
        <div className={shared.stack}>
          <Panel title="Credit rating" padding="md" variant="solid" accent>
            <RatingBadge rating={p?.rating ?? null} pricedAs={p?.pricingRating ?? null} />
            <RatingLadder rating={p?.rating ?? null} />
            {loansOff ? (
              <Note className={shared.small}>Banks start rating companies when lending opens. Until then you grow on your own cash.</Note>
            ) : p ? (
              <p className={`${shared.small} ${shared.muted}`} style={{ margin: '10px 0 0' }}>
                Borrowing rate {ratePct(p.interestRate)} · up to {fmt(borrowable(p))} in new loans
              </p>
            ) : null}
            <Button size="sm" variant="secondary" icon={<Landmark size={14} />} iconRight={<ArrowRight size={13} />} onClick={() => go('bank')} style={{ marginTop: 12 }} data-testid="fin-open-bank">
              {loansOff ? 'How bank loans will work' : 'Loan offers'}
            </Button>
          </Panel>
          {p?.taxRate !== undefined && (
            <Panel title="Tax" padding="md" variant="solid" data-testid="fin-tax">
              <div className={shared.stackTight}>
                <div className={shared.meterRow}>
                  <span className={shared.muted}>Income tax rate</span>
                  <b className={shared.num}>{ratePct(p.taxRate, 0)}</b>
                </div>
                <div className={shared.meterRow}>
                  <span className={shared.muted}>Paid this year</span>
                  <b className={shared.num}>{fmt(p.taxPaidYtd ?? 0)}</b>
                </div>
                <div className={shared.meterRow}>
                  <span className={shared.muted}>Losses carried forward</span>
                  <b className={shared.num}>{fmt(p.lossCarryForward ?? 0)}</b>
                </div>
              </div>
              <p className={`${shared.small} ${shared.muted}`} style={{ margin: '10px 0 0' }}>
                Tax is settled on the year’s profit to date. A loss year carries forward and shelters up to 80% of later profits.
              </p>
            </Panel>
          )}
          <Panel title="Rules of money" padding="md" variant="solid">
            <ul className={styles.rules}>
              {loansOff || !p ? (
                <li>Cash below $0 at {grace} month-ends in a row and the company is insolvent — the game ends.</li>
              ) : (
                <li>A missed loan payment, or a credit line drawn past its limit, puts the company in distress: 3 month-ends to cure it, or bankruptcy.</li>
              )}
              <li>Construction and upgrades turn cash into buildings on the balance sheet: investments, not expenses{p?.taxRate !== undefined ? '; they wear out as depreciation' : ''}.</li>
              <li>Stock on the shelves is cash too — it becomes a cost only when it sells.</li>
              <li>Bank loans repay in equal monthly instalments; your credit rating sets the rate (policy rate {policyRateText(p)} plus a spread).</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
