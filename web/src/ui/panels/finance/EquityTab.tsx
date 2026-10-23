// Finance › Equity and › Stock market. Shares, the IPO, dividends, buybacks
// and trading arrive in Wave 3 (MASTER-PLAN D9, econ §4.11). Until the bridge
// flips `features.stockMarket` these tabs show each corporate action as a
// locked card with its planned rule and the player's progress toward it, and
// the league table of company values that the stock market will later price.

import { CandlestickChart, Coins, Lock, Repeat, Rocket, TrendingUp } from 'lucide-react';
import type { StockQuoteDto } from '@/bridge/protocol';
import type { CompanyView } from '@/state/hud';
import { useGameStore } from '@/state/gameStore';
import { useEngineQuery } from '@/state/useEngineQuery';
import { Panel, Progress, Table } from '@/ui/components';
import { percent, price, signedPercent } from '@/util/format';
import { CompanyTag, FeatureGate, isFeatureUnavailable, LoadingBlock, LockedCard, useMoneyFormat } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import shared from '../_shared-b/shared.module.css';

/** Planned IPO eligibility (econ §4.11, normal difficulty). Shown as guidance; the engine decides. */
const IPO_RULES = { revenueTtm: 50_000_000, equity: 30_000_000 };

export function EquityTab() {
  const fmt = useMoneyFormat();
  const player = useGameStore((s) => s.hud?.player ?? null);
  const market = useEngineQuery('stockMarket', {});
  const { data: is12 } = useEngineQuery('incomeStatement', { period: { preset: 'last12' } });
  const { data: bs } = useEngineQuery('balanceSheet', {});
  const listed = market.data?.find((q) => q.companyId === player?.id && q.listed) ?? null;
  const off = isFeatureUnavailable(market.error);
  if (!player) return <LoadingBlock rows={6} />;
  const revenue = is12?.revenue ?? 0;
  const ni = player.netIncomeLast12 ?? is12?.netIncome ?? 0;
  const equity = bs?.equity ?? player.equity;
  const checks = [
    { label: `Revenue over the last 12 months ≥ ${fmt(IPO_RULES.revenueTtm)}`, value: revenue, target: IPO_RULES.revenueTtm, ok: revenue >= IPO_RULES.revenueTtm, now: fmt(revenue) },
    { label: 'Profitable over the last 12 months', value: ni > 0 ? 1 : 0, target: 1, ok: ni > 0, now: fmt(ni, { signed: true }) },
    { label: `Equity ≥ ${fmt(IPO_RULES.equity)}`, value: equity, target: IPO_RULES.equity, ok: equity >= IPO_RULES.equity, now: fmt(equity) },
  ];
  const met = checks.filter((c) => c.ok).length;

  return (
    <div className={shared.page}>
      {off && (
        <FeatureGate
          data-testid="equity-gate"
          icon={<Rocket size={20} />}
          kicker="Arrives with the stock market"
          title="Shares, the IPO and dividends"
          body="Every company starts private, owned 100% by its founder. Going public raises cash and puts a market price on your company every month — the rules below are planned, and each locked card tracks how close you are."
        />
      )}
      {listed && <QuoteCard quote={listed} />}
      <div className={shared.cards}>
        <LockedCard
          icon={<Rocket size={14} />}
          title="Initial public offering (IPO)"
          footer={
            <div className={shared.stackTight}>
              {checks.map((c) => (
                <div key={c.label}>
                  <div className={shared.meterRow}>
                    <span className={shared.small}>{c.label}</span>
                    <span className={`${shared.small} ${c.ok ? shared.pos : shared.muted}`}>{c.now}</span>
                  </div>
                  <Progress value={c.target ? Math.max(0, c.value) / c.target : 0} size="sm" tone={c.ok ? 'success' : 'gold'} />
                </div>
              ))}
              <span className={`${shared.tiny} ${shared.dim}`}>
                {met} of {checks.length} requirements met
              </span>
            </div>
          }
        >
          Sell up to 40% of the company to the public at 90% of its estimated value. Underwriters keep 6%.
        </LockedCard>
        <LockedCard icon={<Coins size={14} />} title="Dividends">
          Pay shareholders every quarter from retained earnings, as long as two months of fixed costs stay in the bank. Needs a listing.
        </LockedCard>
        <LockedCard icon={<Repeat size={14} />} title="Share buybacks">
          Retire up to 10% of your shares a year at 102% of the market price — when debt is modest and cash covers three months of fixed costs.
        </LockedCard>
        <LockedCard icon={<TrendingUp size={14} />} title="Issue new shares">
          Listed companies can raise up to 20% more shares a year at 95% of the market price (4% fee).
        </LockedCard>
      </div>
    </div>
  );
}

function QuoteCard({ quote }: { quote: StockQuoteDto }) {
  const fmt = useMoneyFormat();
  return (
    <Panel title={`Listed · ${quote.ticker}`} padding="md" variant="solid" accent>
      <div className={shared.kpis}>
        <div>
          <div className={shared.toolbarLabel}>Share price</div>
          <b>{price(quote.sharePrice)}</b> <span className={quote.changePctMonth >= 0 ? shared.pos : shared.neg}>{signedPercent(quote.changePctMonth)}</span>
        </div>
        <div>
          <div className={shared.toolbarLabel}>Market cap</div>
          <b>{fmt(quote.marketCap)}</b>
        </div>
        <div>
          <div className={shared.toolbarLabel}>P/E</div>
          <b>{quote.pe !== undefined ? quote.pe.toFixed(1) : '—'}</b>
        </div>
        <div>
          <div className={shared.toolbarLabel}>Dividend yield</div>
          <b>{percent(quote.dividendYield, 1)}</b>
        </div>
      </div>
    </Panel>
  );
}

export function StockMarketTab() {
  const names = useNames();
  const fmt = useMoneyFormat();
  const market = useEngineQuery('stockMarket', {});
  const off = isFeatureUnavailable(market.error);
  const companies = names.companies.slice().sort((a, b) => b.value - a.value);
  return (
    <div className={shared.page}>
      {off ? (
        <FeatureGate
          data-testid="stocks-gate"
          icon={<CandlestickChart size={20} />}
          kicker="Arrives with the stock market"
          title="The exchange"
          body="Listed companies get a share price from their profits and book value, plus market mood. You will be able to buy into rivals — and past 50% you control them."
          rules={['Prices follow return on equity and growth, not hype.', 'Rising interest rates compress valuations.', 'Takeover at more than 50% of the shares.', 'Share prices move monthly with results and the economy.']}
        />
      ) : market.data ? (
        <Panel title="Listed companies" padding="none" variant="solid">
          <Table<StockQuoteDto>
            rowKey={(q) => q.companyId}
            rows={market.data.filter((q) => q.listed)}
            defaultSort={{ id: 'cap', dir: 'desc' }}
            empty="No company has listed yet."
            columns={[
              { id: 't', header: 'Ticker', sortValue: (q) => q.ticker, cell: (q) => <CompanyTag company={names.company(q.companyId)} /> },
              { id: 'p', header: 'Price', numeric: true, sortValue: (q) => q.sharePrice, cell: (q) => price(q.sharePrice) },
              { id: 'c', header: 'Month', numeric: true, sortValue: (q) => q.changePctMonth, cell: (q) => <span className={q.changePctMonth >= 0 ? shared.pos : shared.neg}>{signedPercent(q.changePctMonth)}</span> },
              { id: 'cap', header: 'Market cap', numeric: true, sortValue: (q) => q.marketCap, cell: (q) => fmt(q.marketCap) },
              { id: 'pe', header: 'P/E', numeric: true, sortValue: (q) => q.pe ?? null, cell: (q) => (q.pe !== undefined ? q.pe.toFixed(1) : '—') },
            ]}
          />
        </Panel>
      ) : (
        <LoadingBlock rows={6} />
      )}
      <Panel title="Company values today" padding="none" variant="solid" actions={<Lock size={13} color="var(--c-dim)" />}>
        <Table<CompanyView>
          rowKey={(c) => c.id}
          rows={companies}
          columns={[
            { id: 'rank', header: '#', width: 36, cell: (_, i) => i + 1 },
            { id: 'n', header: 'Company', cell: (c) => <CompanyTag company={names.company(c.id)} /> },
            { id: 'v', header: 'Company value', numeric: true, cell: (c) => <b>{fmt(c.value)}</b> },
            { id: 'e', header: 'Equity', numeric: true, cell: (c) => fmt(c.equity) },
            { id: 'ni', header: 'Net income, 12 mo', numeric: true, cell: (c) => (c.netIncomeLast12 === null ? '—' : <span className={c.netIncomeLast12 >= 0 ? shared.pos : shared.neg}>{fmt(c.netIncomeLast12, { signed: true })}</span>) },
          ]}
        />
      </Panel>
    </div>
  );
}
