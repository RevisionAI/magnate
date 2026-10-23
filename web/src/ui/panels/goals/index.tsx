// Goals drawer (G) — UX §6.16, D11. Live goals with their rule (reach once →
// latched ✓, or hold at the deadline), current against target, progress and a
// "how to" link; the deadline and how you lose; the scenario briefing; and,
// once the game is decided, the debrief (also exported for the outcome modal).

import clsx from 'clsx';
import { ArrowRight, Check, Flag, Play, Skull, Target, Trophy, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { GoalDto } from '@/bridge/protocol';
import { SECONDS_PER_MONTH } from '@/game/clock';
import { useGameStore } from '@/state/gameStore';
import { goalLabel, nameLookup } from '@/state/hud';
import { useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { Badge, Button, DrawerFrame, EmptyState, Progress, SectionTitle, Sparkline, Stat, type TabItem } from '@/ui/components';
import { durationMonths, monthYear, realTimeEstimate } from '@/util/format';
import { ErrorBlock, LoadingBlock } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import { humanizeIds } from '../_shared-b/text';
import type { PanelProps } from '../registry';
import { Briefing } from './Briefing';
import { OutcomeDebrief } from './Debrief';
import { formatGoalValue, goalSeries, goalState, howTo, stateText } from './goalText';
import styles from './Goals.module.css';

type GoalsTab = 'goals' | 'briefing' | 'debrief';

export default function GoalsPanel({ params }: PanelProps) {
  const scenario = useGameStore((s) => s.hud?.scenario ?? null);
  const { data, error } = useEngineQuery('goals', {});
  const decided = data ? data.outcome.status !== 'playing' : false;
  const tabs: TabItem<GoalsTab>[] = [
    { id: 'goals', label: 'Goals' },
    { id: 'briefing', label: 'Briefing' },
    ...(decided ? [{ id: 'debrief' as const, label: 'Debrief' }] : []),
  ];
  const wanted = typeof params.tab === 'string' ? params.tab : decided ? 'debrief' : 'goals';
  const [tab, setTab] = useState<GoalsTab>(wanted === 'briefing' || wanted === 'debrief' ? (wanted as GoalsTab) : 'goals');
  const current: GoalsTab = tab === 'debrief' && !decided ? 'goals' : tab;

  if (!scenario) {
    return (
      <DrawerFrame title="Goals" icon={<Target size={17} />} data-testid="panel-goals">
        <EmptyState icon={<Target size={22} />} title="Free play" body="This game has no scenario goals. Build whatever empire you like." compact />
      </DrawerFrame>
    );
  }
  return (
    <DrawerFrame title="Goals" eyebrow={scenario.name} icon={<Target size={17} />} tabs={tabs} tab={current} onTabChange={setTab} data-testid="panel-goals">
      <div data-testid={`goals-tab-${current}`}>
        {current === 'goals' && (error && !data ? <ErrorBlock error={error} /> : !data ? <LoadingBlock rows={6} /> : <GoalsList goals={data.goals} nextGoalId={data.nextGoalId ?? null} decided={decided} onDebrief={() => setTab('debrief')} />)}
        {current === 'briefing' && <Briefing />}
        {current === 'debrief' && <OutcomeDebrief compact />}
      </div>
    </DrawerFrame>
  );
}

function GoalsList({ goals, nextGoalId, decided, onDebrief }: { goals: GoalDto[]; nextGoalId: string | null; decided: boolean; onDebrief: () => void }) {
  const names = useNames();
  const lookup = useMemo(() => nameLookup(names.catalog), [names.catalog]);
  const hud = useGameStore((s) => s.hud);
  const { data: goalsDto } = useEngineQuery('goals', {});
  const playerId = names.playerId;
  const seriesNeeded = useMemo(() => [...new Set(goals.map(goalSeries).filter((s): s is NonNullable<typeof s> => s !== null))], [goals]);
  const { data: hist } = useEngineQuery('history', seriesNeeded.length && playerId !== null ? { series: seriesNeeded, companyIds: [playerId] } : null);
  const openPanel = useUiStore((s) => s.openPanel);
  const ids = useMemo(() => [...names.productIds, ...names.cityIds], [names.productIds, names.cityIds]);
  const fix = (t: string) => humanizeIds(t, ids, (id) => (names.productIds.includes(id) ? names.product(id) : names.city(id)));
  const outcome = goalsDto?.outcome ?? { status: 'playing' as const };
  const done = goals.filter((g) => goalState(g, decided) === 'latched' || (g.mode === 'holdAtDeadline' && g.achieved)).length;
  const deadline = goalsDto?.deadline ?? hud?.scenario?.endDate ?? null;
  const left = goalsDto?.monthsRemaining ?? hud?.scenario?.monthsRemaining ?? null;
  const insolvency = hud?.insolvency;

  return (
    <div className={styles.wrap}>
      {outcome.status !== 'playing' && (
        <button type="button" className={clsx(styles.banner, outcome.status === 'won' ? styles.bannerWon : styles.bannerLost)} onClick={onDebrief}>
          {outcome.status === 'won' ? <Trophy size={18} /> : <Skull size={18} />}
          <span>
            <b>{outcome.status === 'won' ? 'Victory' : 'Defeat'}</b>
            {outcome.at ? ` · ${monthYear(outcome.at)}` : ''} — read the debrief
          </span>
          <ArrowRight size={14} />
        </button>
      )}
      <div className={styles.summary}>
        <Stat tile size="sm" label="Goals done" value={`${done} / ${goals.length}`} tone={done === goals.length && goals.length > 0 ? 'pos' : 'default'} />
        <Stat
          tile
          size="sm"
          label="Deadline"
          value={deadline ? monthYear(deadline) : 'None'}
          foot={decided ? 'The game is decided' : left !== null ? `${durationMonths(left)} · ${realTimeEstimate(left * SECONDS_PER_MONTH[1])} at 1×` : 'Play at your own pace'}
          tone={decided ? 'default' : left !== null && left <= 3 ? 'neg' : left !== null && left <= 12 ? 'warn' : 'default'}
        />
      </div>
      <SectionTitle>To win</SectionTitle>
      {goals.map((g) => {
        const state = goalState(g, decided);
        const next = state === 'open' && g.id === nextGoalId;
        const link = howTo(g);
        const series = goalSeries(g);
        const values = series ? (hist?.companies[0]?.series[series] ?? null) : null;
        const label = goalLabel(g, lookup);
        return (
          <div key={g.id} className={clsx(styles.goal, (state === 'latched' || state === 'met') && styles.done, next && styles.next, state === 'missed' && styles.missed)} data-testid={`goal-${g.id}`}>
            <span className={styles.mark}>
              {state === 'latched' || state === 'met' ? <Check size={13} strokeWidth={3} /> : state === 'missed' ? <X size={12} strokeWidth={3} /> : next ? <Play size={11} /> : null}
            </span>
            <div className={styles.body}>
              <div className={styles.labelRow}>
                <span className={styles.label}>{label}</span>
                <Badge tone={g.mode === 'holdAtDeadline' ? 'info' : 'neutral'}>{g.mode === 'holdAtDeadline' ? 'Hold at deadline' : 'Reach once'}</Badge>
              </div>
              {g.description && fix(g.description) !== label && <div className={styles.desc}>{fix(g.description)}</div>}
              <div className={styles.numbers}>
                <span>
                  <b>{formatGoalValue(g.unit, g.current)}</b>
                  {g.unit !== 'flag' && <span className={styles.of}> of {formatGoalValue(g.unit, g.target)}</span>}
                </span>
                {values && values.filter((v) => v !== null).length > 1 && <Sparkline values={values.slice(-24)} width={88} height={20} tone={state === 'latched' || state === 'met' ? 'pos' : 'gold'} />}
              </div>
              <Progress value={g.progress} size="sm" tone={state === 'latched' || state === 'met' ? 'success' : state === 'missed' ? 'danger' : 'gold'} />
              <div className={styles.footRow}>
                <span className={styles.state}>{stateText(g, state)}</span>
                {link && state !== 'latched' && !decided && (
                  <button type="button" className={styles.howTo} onClick={() => openPanel(link.panel, link.params)}>
                    {link.label} →
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <SectionTitle>How you lose</SectionTitle>
      <div className={styles.rules}>
        <div className={styles.rule}>
          <Flag size={14} />
          <span>
            <b>Insolvency:</b> cash below $0 at {insolvency?.graceMonths ?? 6} month-ends in a row.
            {insolvency?.bankruptcyInMonths !== null && insolvency?.bankruptcyInMonths !== undefined ? (
              <>
                {' '}
                <Badge tone="danger" variant="solid">
                  Insolvent in {insolvency.bankruptcyInMonths} mo
                </Badge>
              </>
            ) : insolvency && insolvency.negativeCashMonths === 0 ? (
              <span className={styles.ok}> You are solvent.</span>
            ) : null}
          </span>
        </div>
        <div className={styles.rule}>
          <Flag size={14} />
          <span>
            <b>Deadline:</b> {deadline ? `not every goal met by ${monthYear(deadline)}.` : 'none in this scenario.'}
          </span>
        </div>
      </div>
      {!decided && (
        <Button size="sm" variant="ghost" iconRight={<ArrowRight size={12} />} onClick={() => useUiStore.getState().openPanel('advisor')}>
          What should I do next? Ask Morgan
        </Button>
      )}
    </div>
  );
}
