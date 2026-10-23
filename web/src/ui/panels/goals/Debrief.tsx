// Win / lose debrief (UX §6.16). Headline, months taken, final value and rank;
// value against rivals and revenue / net income over the game; every goal with
// the month it was reached; highlights from the event log; and on a loss the
// cause, the moment cash went negative, the biggest drain and what would have
// helped (Morgan's open priorities). Exported for the outcome modal (U1).

import clsx from 'clsx';
import { Check, Crown, Minus, Sparkles, TrendingDown } from 'lucide-react';
import { useMemo } from 'react';
import type { GameEventDto, GameEventKind } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { goalLabel, nameLookup } from '@/state/hud';
import { useEngineQuery } from '@/state/useEngineQuery';
import { LineChart, SectionTitle, Stat } from '@/ui/components';
import { addMonths, money, monthName, monthYear } from '@/util/format';
import { ComboChart } from '../_shared-b/charts';
import { LoadingBlock, useMoneyFormat } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import { shortMonth } from '../_shared-b/periods';
import { rankAdvice } from '../advisor/advice';
import { goalState, OUTCOME_TEXT } from './goalText';
import styles from './Goals.module.css';

const HIGHLIGHT_KINDS = new Set<GameEventKind>(['firstSale', 'recordMonth', 'revenueMilestone', 'shareRankFirst', 'patentGranted', 'goalAchieved', 'brandMilestone', 'techLevelUp', 'ipoCompleted']);

/** First month of the final run of negative month-end cash (null if cash ends positive). */
export function negativeSince(cash: readonly (number | null)[]): number | null {
  let i = cash.length - 1;
  if (i < 0 || (cash[i] ?? 0) >= 0) return null;
  while (i > 0 && (cash[i - 1] ?? 0) < 0) i--;
  return i;
}

export function OutcomeDebrief({ compact = false }: { compact?: boolean }) {
  const names = useNames();
  const fmt = useMoneyFormat();
  const hud = useGameStore((s) => s.hud);
  const lookup = useMemo(() => nameLookup(names.catalog), [names.catalog]);
  const { data: goals } = useEngineQuery('goals', {});
  const ids = names.companies.map((c) => c.id);
  const { data: valueHist } = useEngineQuery('history', ids.length ? { series: ['corporateValue'], companyIds: ids } : null);
  const { data: mine } = useEngineQuery('history', names.playerId !== null ? { series: ['revenue', 'netIncome', 'cash'], companyIds: [names.playerId] } : null);
  const { data: feed } = useEngineQuery('activityFeed', { limit: 500 });
  const { data: advisor } = useEngineQuery('advisor', {});
  const { data: products } = useEngineQuery('productProfitability', { period: { preset: 'last12' } });

  if (!goals || !hud) return <LoadingBlock rows={8} chart />;
  const outcome = goals.outcome;
  const won = outcome.status === 'won';
  const ranked = names.companies.slice().sort((a, b) => b.value - a.value);
  const rank = ranked.findIndex((c) => c.isPlayer) + 1;
  const player = hud.player;
  const labels = valueHist ? Array.from({ length: valueHist.months }, (_, i) => shortMonth(addMonths(valueHist.start, i))) : [];
  const my = mine?.companies[0]?.series;
  const myLabels = mine ? Array.from({ length: mine.months }, (_, i) => shortMonth(addMonths(mine.start, i))) : [];
  const valueSeries = valueHist?.companies.find((c) => c.companyId === names.playerId)?.series.corporateValue ?? [];
  const peak = valueSeries.length ? Math.max(...valueSeries.map((v) => v ?? 0)) : null;
  const totalNi = my?.netIncome ? my.netIncome.reduce<number>((s, v) => s + (v ?? 0), 0) : null;
  const highlights = (feed?.events ?? [])
    .filter((e) => HIGHLIGHT_KINDS.has(e.kind) && e.isPlayer !== false)
    .slice(-8)
    .reverse();
  const negIdx = my?.cash ? negativeSince(my.cash) : null;
  const negMonth = negIdx !== null && mine ? addMonths(mine.start, negIdx) : null;
  const drain = products?.rows.slice().sort((a, b) => a.netMargin - b.netMargin)[0];
  const helped = advisor ? rankAdvice(advisor, new Set()).filter((a) => a.kind !== 'step').slice(0, 3) : [];
  const reason = outcome.reason ? OUTCOME_TEXT[outcome.reason] : won ? OUTCOME_TEXT.allGoals : 'The scenario is over.';

  return (
    <div className={clsx(styles.debrief, compact && styles.debriefCompact, !won && styles.debriefLost)} data-testid="outcome-debrief">
      <div className={styles.hero}>
        <div className={styles.heroKicker}>{hud.scenario?.name ?? 'Free play'}</div>
        <div className={styles.heroTitle}>{won ? 'You built an empire' : outcome.status === 'lost' ? 'The company has fallen' : 'Still in play'}</div>
        <div className={styles.heroSub}>
          {reason}
          {outcome.at ? ` ${monthYear(outcome.at)}.` : ''}
        </div>
      </div>
      <div className={styles.heroStats}>
        <Stat tile size="sm" label="Company value" value={fmt(player?.value ?? 0)} tone={won ? 'gold' : 'default'} />
        <Stat tile size="sm" label="Months played" value={hud.elapsedMonths ?? '—'} />
        <Stat tile size="sm" label="Rank" value={rank ? `#${rank} of ${ranked.length}` : '—'} icon={rank === 1 ? <Crown size={12} /> : undefined} />
        <Stat tile size="sm" label="Net income, all game" value={totalNi === null ? '—' : fmt(totalNi, { signed: true })} tone={totalNi !== null && totalNi < 0 ? 'neg' : 'default'} foot={peak ? `Peak value ${money(peak, 1)}` : undefined} />
      </div>

      {!won && outcome.status === 'lost' && (
        <div className={styles.cause}>
          <div className={styles.causeTitle}>
            <TrendingDown size={15} /> What happened
          </div>
          <ul>
            {negMonth && <li>Cash fell below zero in {monthYear(negMonth)} and never recovered.</li>}
            {drain && drain.netMargin < 0 && (
              <li>
                {drain.name} lost {fmt(-drain.netMargin)} over the last 12 months{drain.marketing > 0 ? `, including ${fmt(drain.marketing)} of advertising` : ''}.
              </li>
            )}
            {outcome.reason === 'deadline' && <li>The goals still open at the deadline are marked below.</li>}
          </ul>
          {helped.length > 0 && (
            <>
              <div className={styles.causeTitle}>What would have helped</div>
              <ul>
                {helped.map((a) => (
                  <li key={a.key}>
                    <b>{a.title}</b> — {a.item.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className={styles.debriefCharts}>
        <div>
          <SectionTitle>Company value against rivals</SectionTitle>
          {valueHist ? (
            <LineChart
              height={compact ? 150 : 190}
              labels={labels}
              yFormat={(v) => money(v, 0)}
              series={valueHist.companies
                .slice()
                .sort((a, b) => (a.companyId === names.playerId ? -1 : b.companyId === names.playerId ? 1 : 0))
                .map((c) => {
                  const ref = names.company(c.companyId);
                  return { id: String(c.companyId), label: ref.name, values: c.series.corporateValue ?? [], color: ref.color, area: ref.isPlayer };
                })}
            />
          ) : (
            <LoadingBlock rows={2} chart />
          )}
        </div>
        <div>
          <SectionTitle>Revenue and net income</SectionTitle>
          {my ? (
            <ComboChart
              height={compact ? 150 : 190}
              labels={myLabels}
              bars={[{ id: 'rev', label: 'Revenue', values: my.revenue ?? [], color: 'rgba(90, 167, 216, 0.75)' }]}
              lines={[{ id: 'ni', label: 'Net income', values: my.netIncome ?? [], color: '#D7B766' }]}
              yFormat={(v) => money(v, 1)}
            />
          ) : (
            <LoadingBlock rows={2} chart />
          )}
        </div>
      </div>

      <div className={styles.debriefCols}>
        <div>
          <SectionTitle>Goals</SectionTitle>
          {goals.goals.map((g) => {
            const state = goalState(g, true);
            const ok = state === 'latched' || state === 'met';
            return (
              <div key={g.id} className={styles.goalLine}>
                {ok ? <Check size={14} className={styles.okIcon} /> : <Minus size={14} className={styles.noIcon} />}
                <span>
                  {goalLabel(g, lookup)}
                  {g.achievedAt ? <span className={styles.of}> · {monthYear(g.achievedAt)}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
        <div>
          <SectionTitle>Highlights</SectionTitle>
          {highlights.length === 0 ? <div className={styles.of}>No milestones this game.</div> : highlights.map((e) => <Highlight key={e.seq} e={e} />)}
        </div>
      </div>
    </div>
  );
}

function Highlight({ e }: { e: GameEventDto }) {
  return (
    <div className={styles.goalLine}>
      <Sparkles size={13} className={styles.goldIcon} />
      <span>
        {e.message}
        <span className={styles.of}>
          {' '}
          · {monthName(e.month.month)} {e.month.year}
        </span>
      </span>
    </div>
  );
}
