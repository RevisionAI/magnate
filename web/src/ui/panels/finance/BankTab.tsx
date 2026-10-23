// Finance › Bank (econ §4.10, bridge-spec §8.4): the credit profile, loan
// offers priced by your rating with an amortisation preview and the effect on
// runway, outstanding loans with early repayment, and the revolving credit
// line. While `features.loans` is off the bridge answers feature_unavailable
// and this tab explains the lending rules instead.

import { AlertOctagon, Banknote, Check, Landmark, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fx } from '@/game/fx';
import { useGameStore } from '@/state/gameStore';
import { engineMutate, useEngineQuery } from '@/state/useEngineQuery';
import { Badge, Button, Meter, Panel, Slider, Stat, Table, TextInput } from '@/ui/components';
import { money, monthYear, signedMoney } from '@/util/format';
import { ComboChart } from '../_shared-b/charts';
import { ErrorBlock, FeatureGate, isFeatureUnavailable, LoadingBlock, Note, useMoneyFormat } from '../_shared-b/components';
import {
  amortization,
  amortizationByYear,
  asFraction,
  borrowable,
  type BalanceSheetView,
  type CreditProfileView,
  type LoanOfferView,
  type LoanView,
  ratePct,
  termLabel,
} from '../_shared-b/finance';
import shared from '../_shared-b/shared.module.css';
import { CreditProfileCard } from './RatingCard';
import styles from './Finance.module.css';

export function BankTab() {
  const profile = useEngineQuery('creditProfile', {});
  if (isFeatureUnavailable(profile.error)) return <BankGate />;
  if (profile.error && !profile.data) return <ErrorBlock error={profile.error} retry={profile.refetch} />;
  if (!profile.data) return <LoadingBlock rows={8} chart />;
  const view: CreditProfileView = profile.data;
  return <BankLive available={borrowable(view)} profile={view} />;
}

function BankLive({ available, profile }: { available: number; profile: CreditProfileView }) {
  const fmt = useMoneyFormat();
  const player = useGameStore((s) => s.hud?.player ?? null);
  const loans = useEngineQuery('loans', {});
  const { data: bsData } = useEngineQuery('balanceSheet', {});
  const bs: BalanceSheetView | undefined = bsData;
  const minAmount = Math.min(available, 100_000);
  const [draft, setDraft] = useState(() => Math.round(Math.min(available, Math.max(minAmount, available * 0.25)) / 100_000) * 100_000);
  const [amount, setAmount] = useState(draft);
  useEffect(() => {
    if (amount > available) {
      setAmount(available);
      setDraft(available);
    }
  }, [available, amount]);
  const offers = useEngineQuery('loanOffers', available > 0 ? { amount } : null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const selected =
    offers.data?.find((o) => o.offerId === offerId) ??
    offers.data?.slice().sort((a, b) => Math.abs(a.termMonths - 60) - Math.abs(b.termMonths - 60))[0] ??
    null;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const revolverLine = bs?.liabilityLines?.find((l) => /revolv|credit line|overdraft/i.test(l.label)) ?? null;
  const revolverDrawn = profile.revolverDrawn ?? bs?.revolver ?? revolverLine?.amount ?? 0;
  const distress = profile.solvency === 'distress' || profile.solvency === 'bankrupt';
  const unrated = (profile.rating ?? 'NR').toUpperCase() === 'NR';

  const take = async (offer: LoanOfferView) => {
    setBusy(true);
    const loan = await engineMutate('takeLoan', { offerId: offer.offerId });
    setBusy(false);
    setConfirming(false);
    if (loan) fx.popup({ text: `+${money(loan.principal)}`, tone: 'gain', anchor: 'topbar.cash' });
  };

  return (
    <div className={shared.page}>
      {distress && <DistressBanner profile={profile} />}
      <div className={shared.split}>
        <div className={shared.stack}>
          <Panel title="Borrow" padding="md" variant="solid" data-testid="loan-builder">
            {available <= 0 ? (
              <Note tone="warn">
                {distress
                  ? 'Banks lend nothing new to a company in distress. Cure it first: get cash positive and pay what is due.'
                  : 'You have used your whole credit limit. Repay a loan or grow profits and assets to borrow more.'}
              </Note>
            ) : (
              <>
                <div className={styles.amountRow}>
                  <Slider
                    value={draft}
                    min={minAmount}
                    max={available}
                    step={100_000}
                    scale={available / Math.max(1, minAmount) > 50 ? 'log' : 'linear'}
                    format={(v) => money(v, 2)}
                    onChange={setDraft}
                    onCommit={setAmount}
                    showScale
                    aria-label="Loan amount"
                    data-testid="loan-amount"
                  />
                  <div className={styles.amount}>{money(draft, 2)}</div>
                </div>
                <div className={shared.tiny} style={{ margin: '4px 0 12px', color: 'var(--c-dim)' }}>
                  Up to {fmt(available)} available
                  {unrated ? ` — unrated companies are priced as ${profile.pricingRating ?? 'BBB'}` : ` at your ${profile.rating} rating`}
                  {profile.minTermMonths !== undefined && profile.maxTermMonths !== undefined ? ` · terms ${termLabel(profile.minTermMonths)} to ${termLabel(profile.maxTermMonths)}` : ''}
                </div>
                {offers.error ? (
                  <ErrorBlock error={offers.error} />
                ) : !offers.data ? (
                  <LoadingBlock rows={2} />
                ) : offers.data.length === 0 ? (
                  <Note>No bank will lend that amount right now.</Note>
                ) : (
                  <div className={styles.offers} role="radiogroup" aria-label="Loan offers">
                    {offers.data.map((o) => (
                      <button
                        key={o.offerId}
                        type="button"
                        role="radio"
                        aria-checked={selected?.offerId === o.offerId}
                        className={`${styles.offer} ${selected?.offerId === o.offerId ? styles.offerOn : ''}`}
                        onClick={() => {
                          setOfferId(o.offerId);
                          setConfirming(false);
                        }}
                        data-testid={`loan-offer-${o.termMonths}`}
                      >
                        <span className={styles.offerTerm}>{termLabel(o.termMonths)}</span>
                        <span className={styles.offerRate}>{ratePct(o.annualRate)}</span>
                        <span className={styles.offerPay}>{fmt(o.monthlyPayment)}/month</span>
                        {(o as LoanOfferView).totalInterest !== undefined && <span className={styles.offerInterest}>{fmt((o as LoanOfferView).totalInterest)} interest</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </Panel>
          {selected && <OfferPreview offer={selected} cash={player?.cash ?? 0} runway={player?.runwayMonths ?? null} />}
          {selected && (
            <div className={styles.confirm}>
              {confirming ? (
                <>
                  <span style={{ flex: 1 }}>
                    Borrow <b>{fmt(selected.amount)}</b> for {termLabel(selected.termMonths)} at <b>{ratePct(selected.annualRate)}</b> — {fmt(selected.monthlyPayment)} a month from next month.
                  </span>
                  <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" icon={<Check size={13} />} loading={busy} onClick={() => void take(selected)} sound="confirm" data-testid="loan-confirm">
                    Sign the loan
                  </Button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1 }} className={shared.muted}>
                    The cash arrives immediately; repayments start at the next month close. Early repayment is free.
                  </span>
                  <Button variant="primary" icon={<Banknote size={15} />} onClick={() => setConfirming(true)} data-testid="loan-take">
                    Take loan
                  </Button>
                </>
              )}
            </div>
          )}
          <LoansTable loans={loans.data ?? []} loading={!loans.data && !loans.error} nextPayment={profile.nextPayment ?? null} />
        </div>
        <div className={shared.stack}>
          <CreditProfileCard profile={profile} />
          <RevolverCard drawn={revolverDrawn} limit={profile.revolverLimit ?? null} rate={profile.revolverRate ?? null} />
        </div>
      </div>
    </div>
  );
}

function OfferPreview({ offer, cash, runway }: { offer: LoanOfferView; cash: number; runway: number | null }) {
  const fmt = useMoneyFormat();
  const plan = useMemo(() => amortization(offer.amount, asFraction(offer.annualRate), offer.termMonths, offer.monthlyPayment), [offer]);
  const monthly = offer.termMonths <= 24;
  const years = useMemo(
    () => (monthly ? plan.rows.map((r) => ({ year: r.month, interest: r.interest, principal: r.principal, balance: r.balance })) : amortizationByYear(plan)),
    [plan, monthly],
  );
  const burn = runway !== null && runway > 0 ? cash / runway : null;
  const runwayAfter = burn !== null ? (cash + offer.amount) / (burn + offer.monthlyPayment) : null;
  return (
    <Panel title={`Repayment plan · ${termLabel(offer.termMonths)}`} padding="md" variant="solid" data-testid="loan-preview">
      <div className={styles.summary}>
        <Stat size="sm" label="Monthly payment" value={fmt(offer.monthlyPayment)} />
        <Stat size="sm" label="Total interest" value={fmt(offer.totalInterest ?? plan.totalInterest)} tone="warn" />
        <Stat size="sm" label="Total repaid" value={fmt(offer.totalInterest !== undefined ? offer.amount + offer.totalInterest : plan.totalPaid)} />
        <Stat
          size="sm"
          label="Runway after"
          value={runwayAfter === null ? 'Not burning cash' : runwayAfter > 24 ? '> 24 months' : `${runwayAfter.toFixed(1)} mo`}
          foot={runway === null ? 'Payments come out of operating profit' : `now ${runway > 24 ? '> 24' : runway.toFixed(1)} mo`}
        />
      </div>
      <div style={{ marginTop: 14 }}>
        <ComboChart
          height={170}
          stacked
          labels={years.map((y) => (monthly ? `M${y.year}` : `Year ${y.year}`))}
          bars={[
            { id: 'p', label: 'Principal', values: years.map((y) => y.principal), color: '#5AA7D8' },
            { id: 'i', label: 'Interest', values: years.map((y) => y.interest), color: '#E8B63A' },
          ]}
          lines={[{ id: 'b', label: 'Balance owed', values: years.map((y) => y.balance), color: '#D7B766', dashed: true }]}
          yFormat={(v) => money(v, 1)}
        />
      </div>
      <div className={`${shared.tiny} ${shared.dim}`}>
        Month 1: {fmt(plan.rows[0]?.interest ?? 0)} interest + {fmt(plan.rows[0]?.principal ?? 0)} principal. Each month more of the payment repays principal.
      </div>
    </Panel>
  );
}

function LoansTable({ loans, loading, nextPayment }: { loans: LoanView[]; loading: boolean; nextPayment: number | null }) {
  const fmt = useMoneyFormat();
  const [repay, setRepay] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const doRepay = async (loan: LoanView, amount: number) => {
    setBusy(loan.loanId);
    const res = await engineMutate('repayLoan', { loanId: loan.loanId, amount });
    setBusy(null);
    if (res) fx.popup({ text: signedMoney(-amount), tone: 'loss', anchor: 'topbar.cash' });
  };
  return (
    <Panel
      title="Your loans"
      padding="none"
      variant="solid"
      data-testid="loans-table"
      actions={nextPayment !== null && nextPayment > 0 ? <span className={`${shared.small} ${shared.muted}`}>Due at the next close: <b className={shared.num}>{fmt(nextPayment)}</b></span> : undefined}
    >
      {loading ? (
        <LoadingBlock rows={3} />
      ) : (
        <Table<LoanView>
          rowKey={(l) => l.loanId}
          rows={loans}
          empty="No loans outstanding."
          columns={[
            { id: 'id', header: 'Loan', cell: (l) => <span>#{l.loanId} <span className={shared.cellSub}>{monthYear(l.taken)}</span></span> },
            { id: 'p', header: 'Borrowed', numeric: true, cell: (l) => fmt(l.principal) },
            { id: 'o', header: 'Owed', numeric: true, cell: (l) => <b>{fmt(l.outstanding)}</b> },
            { id: 'r', header: 'Rate', numeric: true, cell: (l) => ratePct(l.annualRate) },
            { id: 'm', header: 'Months left', numeric: true, cell: (l) => `${l.monthsRemaining} / ${l.termMonths}` },
            { id: 'pay', header: 'Payment', numeric: true, cell: (l) => fmt(l.monthlyPayment) },
            {
              id: 's',
              header: 'Status',
              cell: (l) =>
                l.inDefault ? (
                  <Badge tone="danger" variant="solid">In default</Badge>
                ) : (l.missedPayments ?? 0) > 0 ? (
                  <Badge tone="warning">{l.missedPayments} missed</Badge>
                ) : (
                  <Badge tone="success">On schedule</Badge>
                ),
            },
            {
              id: 'repay',
              header: 'Repay early',
              cell: (l) => {
                const raw = repay[l.loanId] ?? '';
                const value = Number(raw.replace(/[^0-9.]/g, ''));
                const amount = Number.isFinite(value) && value > 0 ? Math.min(value, l.outstanding) : 0;
                return (
                  <span className={styles.repay}>
                    <TextInput size="sm" placeholder="Amount" value={raw} onChange={(e) => setRepay({ ...repay, [l.loanId]: e.target.value })} aria-label={`Repay loan ${l.loanId}`} />
                    <Button size="sm" variant="ghost" disabled={amount <= 0 || busy === l.loanId} onClick={() => void doRepay(l, amount)}>
                      Repay
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === l.loanId} onClick={() => void doRepay(l, l.outstanding)}>
                      All
                    </Button>
                  </span>
                );
              },
            },
          ]}
        />
      )}
    </Panel>
  );
}

function BankGate() {
  const player = useGameStore((s) => s.hud?.player ?? null);
  const fmt = useMoneyFormat();
  return (
    <div className={shared.page}>
      <FeatureGate
        data-testid="bank-gate"
        icon={<Landmark size={20} />}
        kicker="Opening soon"
        title="Bank loans and the credit line"
        body="Banks are about to start lending. Borrowing pays when the new business earns more than the interest — every rule below is fixed before you sign."
        rules={[
          'Term loans of 1 to 20 years, repaid in equal monthly instalments; early repayment is free.',
          'Rate = policy rate 4.00% + a term premium + a spread for your credit rating, fixed when you sign.',
          'Your rating (AAA to D) is reviewed every quarter from interest cover, debt to EBITDA and company size; new companies are unrated for a year.',
          'How much you can borrow depends on your buildings, stock and land as collateral, and on your operating profit.',
          'A revolving credit line covers a month’s shortfall automatically, so a bad month no longer means negative cash.',
          'Miss a payment or run out of credit and the company enters distress: 3 months to cure, or bankruptcy.',
        ]}
      />
      {player && (
        <div className={shared.kpis}>
          <Stat tile size="sm" label="Cash today" value={fmt(player.cash)} />
          <Stat tile size="sm" label="Equity" value={fmt(player.equity)} />
          <Stat tile size="sm" label="Net income, last 12 months" value={player.netIncomeLast12 === null ? '—' : fmt(player.netIncomeLast12)} tone={player.netIncomeLast12 !== null && player.netIncomeLast12 < 0 ? 'neg' : 'default'} />
          <Stat tile size="sm" label="Runway" value={player.runwayMonths === null ? 'Not burning cash' : `${player.runwayMonths.toFixed(1)} months`} />
        </div>
      )}
    </div>
  );
}

/** Distress (econ §4.14): a missed payment or a credit line over its limit starts a 3-month cure window. */
function DistressBanner({ profile }: { profile: CreditProfileView }) {
  const bankrupt = profile.solvency === 'bankrupt';
  const left = profile.cureMonthsLeft;
  return (
    <div className={styles.distress} role="alert" data-testid="bank-distress">
      <AlertOctagon size={20} />
      <div>
        <b>{bankrupt ? 'Bankrupt' : left !== undefined ? `In distress — ${left} month-end${left === 1 ? '' : 's'} left to cure` : 'In distress'}</b>
        <span>
          {bankrupt
            ? 'The lenders have taken over: buildings are sold and the proceeds repay the debt.'
            : 'Get cash positive and pay what is due before the deadline, or the company is declared bankrupt and liquidated. New loans are frozen until then.'}
        </span>
      </div>
    </div>
  );
}

/** The automatic revolving credit line (econ §4.10): covers negative cash, swept back from surplus cash. */
function RevolverCard({ drawn, limit, rate }: { drawn: number; limit: number | null; rate: number | null }) {
  const fmt = useMoneyFormat();
  const used = limit && limit > 0 ? Math.min(1, drawn / limit) : null;
  return (
    <Panel title="Revolving credit line" padding="md" variant="solid" data-testid="revolver">
      <div className={shared.stackTight}>
        <div className={shared.meterRow}>
          <span className={shared.muted}>{drawn > 0 ? 'Drawn' : 'Not drawn'}</span>
          <b className={`${shared.num} ${drawn > 0 ? shared.neg : ''}`}>{fmt(drawn)}{limit !== null ? ` of ${fmt(limit)}` : ''}</b>
        </div>
        {used !== null && <Meter value={used} segments={20} thresholds={[{ at: 0, tone: 'success' }, { at: 0.5, tone: 'warning' }, { at: 0.9, tone: 'danger' }]} label="Credit line used" />}
        {rate !== null && (
          <div className={shared.meterRow}>
            <span className={shared.muted}>Floating rate</span>
            <b className={shared.num}>{ratePct(rate)}</b>
          </div>
        )}
      </div>
      <p className={`${shared.small} ${shared.muted}`} style={{ margin: '10px 0 0' }}>
        {drawn > 0
          ? 'The bank covered a cash shortfall automatically. Interest is charged monthly, and surplus cash repays it on its own.'
          : 'If a month’s payments would take cash below zero, the credit line covers the gap automatically — up to the limit. Going over the limit puts the company in distress.'}
      </p>
    </Panel>
  );
}
