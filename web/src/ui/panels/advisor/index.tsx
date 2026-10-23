// Advisor drawer (H) — UX §6.15. Morgan, your COO, ranks what needs doing by
// its estimated effect on monthly profit (bridge `advisor`: severity, then
// $/month impact). Each item has a one-click fix when the bridge offers one,
// deep links into the screen that shows the problem (the building inspector,
// Markets, Finance, R&D…), and "dismiss for 3 months". The tutorial checklist
// and what Morgan said this game follow below.

import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Clock, Info, Lightbulb, RotateCcw, Sparkles, Wrench, XOctagon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { MethodArgs, MethodName } from '@/bridge/protocol';
import { useGameStore } from '@/state/gameStore';
import { currentTutorialStep, useTutorialStore } from '@/state/tutorialStore';
import { engineMutate, useEngineQuery } from '@/state/useEngineQuery';
import { useUiStore } from '@/state/uiStore';
import { AdvisorPortrait } from '@/ui/hud/AdvisorDock';
import { Badge, Button, DrawerFrame, EmptyState, SectionTitle } from '@/ui/components';
import { ErrorBlock, LoadingBlock, useMoneyFormat } from '../_shared-b/components';
import { useNames } from '../_shared-b/names';
import { humanizeIds } from '../_shared-b/text';
import type { PanelProps } from '../registry';
import { rankAdvice, totalAtStake, type Advice, type AdviceLink } from './advice';
import { activeDismissals, DISMISS_MONTHS, useDismissals } from './dismissals';
import styles from './Advisor.module.css';

const SEVERITY_ICON = {
  danger: <XOctagon size={15} />,
  warning: <AlertTriangle size={15} />,
  info: <Info size={15} />,
  success: <CheckCircle2 size={15} />,
} as const;

export default function AdvisorPanel(_props: PanelProps) {
  const gameId = useGameStore((s) => s.gameId);
  const monthIndex = useGameStore((s) => s.hud?.monthIndex ?? 0);
  const { data, error } = useEngineQuery('advisor', {});
  const until = useDismissals((s) => s.until);
  const load = useDismissals((s) => s.load);
  const restoreAll = useDismissals((s) => s.restoreAll);
  useEffect(() => load(gameId), [gameId, load]);
  const dismissed = useMemo(() => activeDismissals(until, monthIndex), [until, monthIndex]);
  const list = useMemo(() => (data ? rankAdvice(data, dismissed) : []), [data, dismissed]);
  const stake = totalAtStake(list);
  const fmt = useMoneyFormat();
  const [top, ...rest] = list;

  return (
    <DrawerFrame
      title="Morgan"
      eyebrow="Your COO"
      subtitle="Priorities ranked by monthly impact"
      icon={<AdvisorPortrait size={30} />}
      data-testid="panel-advisor"
    >
      <div className={styles.wrap}>
        <TutorialChecklist />
        {error && !data ? (
          <ErrorBlock error={error} />
        ) : !data ? (
          <LoadingBlock rows={6} />
        ) : list.length === 0 ? (
          <EmptyState compact icon={<CheckCircle2 size={20} />} title="Nothing needs you right now" body="Everything’s running. Scale your best market, or plan the next store." />
        ) : (
          <>
            <div className={styles.summary} data-testid="advisor-summary">
              <span>
                <b>{list.length}</b> item{list.length === 1 ? '' : 's'}
              </span>
              {stake.problems > 0 && (
                <span>
                  <b className={styles.neg}>{fmt(stake.problems)}</b>/mo at stake
                </span>
              )}
              {stake.opportunities > 0 && (
                <span>
                  <b className={styles.pos}>{fmt(stake.opportunities)}</b>/mo up for grabs
                </span>
              )}
            </div>
            {top && <AdviceCard advice={top} featured monthIndex={monthIndex} />}
            {rest.length > 0 && <SectionTitle>Then</SectionTitle>}
            {rest.map((a) => (
              <AdviceCard key={a.key} advice={a} monthIndex={monthIndex} />
            ))}
          </>
        )}
        {dismissed.size > 0 && (
          <button type="button" className={styles.restore} onClick={restoreAll}>
            <RotateCcw size={12} /> {dismissed.size} dismissed — show again
          </button>
        )}
        <SaidThisGame />
      </div>
    </DrawerFrame>
  );
}

function AdviceCard({ advice, featured = false, monthIndex }: { advice: Advice; featured?: boolean; monthIndex: number }) {
  const names = useNames();
  const fmt = useMoneyFormat();
  const dismiss = useDismissals((s) => s.dismiss);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const { item } = advice;
  const ids = useMemo(() => [...names.productIds, ...names.cityIds], [names.productIds, names.cityIds]);
  const message = humanizeIds(item.message, ids, (id) => (names.productIds.includes(id) ? names.product(id) : names.city(id)));

  const runFix = async () => {
    if (!advice.fix) return;
    setState('busy');
    const r = await engineMutate(advice.fix.method as MethodName, advice.fix.args as MethodArgs<MethodName>);
    setState(r === undefined ? 'idle' : 'done');
  };
  const follow = (l: AdviceLink) => {
    if (l.buildingId !== undefined) {
      useUiStore.getState().closeOverlay();
      useGameStore.getState().selectBuilding(l.buildingId);
      return;
    }
    if (l.panel) useUiStore.getState().openPanel(l.panel, l.params ?? {});
  };

  return (
    <div
      className={clsx(styles.card, featured && styles.featured, styles[`sev-${item.severity}`], advice.kind === 'opportunity' && styles.opportunity, state === 'done' && styles.done)}
      data-testid={`advice-${item.code}`}
    >
      <div className={styles.head}>
        <span className={styles.icon}>{advice.kind === 'opportunity' ? <Lightbulb size={15} /> : advice.kind === 'step' ? <Sparkles size={15} /> : SEVERITY_ICON[item.severity]}</span>
        <span className={styles.title}>{advice.title}</span>
        {item.impactPerMonth !== undefined && item.impactPerMonth > 0 && (
          <span className={clsx(styles.impact, advice.kind === 'opportunity' ? styles.pos : styles.neg)} title="Estimated effect on monthly profit">
            {advice.kind === 'opportunity' ? '+' : ''}
            {fmt(item.impactPerMonth, { digits: 1 })}
            <span className={styles.per}>/mo</span>
          </span>
        )}
      </div>
      <p className={styles.message}>{message}</p>
      {state === 'done' ? (
        <div className={styles.doneLine}>
          <Check size={14} /> Done — takes effect at month close.
        </div>
      ) : (
        <div className={styles.actions}>
          {advice.fix && (
            <Button size="sm" variant={featured ? 'primary' : 'secondary'} icon={<Wrench size={13} />} loading={state === 'busy'} onClick={() => void runFix()} sound="confirm" data-testid={`advice-fix-${item.code}`}>
              {advice.fix.label}
            </Button>
          )}
          {advice.links.slice(0, 2).map((l) => (
            <Button key={l.label} size="sm" variant="ghost" iconRight={<ArrowRight size={12} />} onClick={() => follow(l)}>
              {l.label}
            </Button>
          ))}
          <span className={styles.spacer} />
          <Button size="sm" variant="ghost" icon={<Clock size={12} />} onClick={() => dismiss(advice.key, monthIndex)} title={`Hide this for ${DISMISS_MONTHS} months`}>
            Later
          </Button>
        </div>
      )}
    </div>
  );
}

function TutorialChecklist() {
  const step = useTutorialStore(currentTutorialStep);
  const script = useTutorialStore((s) => s.script);
  const latched = useTutorialStore((s) => s.latched);
  if (!script) return null;
  return (
    <div className={styles.tutorial}>
      <SectionTitle>{script.title}</SectionTitle>
      {script.steps.map((s) => (
        <div key={s.id} className={styles.step}>
          <Badge tone={latched.includes(s.id) ? 'success' : s.id === step?.id ? 'gold' : 'neutral'}>{latched.includes(s.id) ? 'Done' : s.id === step?.id ? 'Now' : 'Next'}</Badge>
          <span>{s.title}</span>
        </div>
      ))}
    </div>
  );
}

function SaidThisGame() {
  const history = useUiStore((s) => s.advisor.history);
  const openPanel = useUiStore((s) => s.openPanel);
  const [open, setOpen] = useState(false);
  if (history.length === 0) return null;
  const shown = [...history].reverse().slice(0, open ? 20 : 3);
  return (
    <div className={styles.said}>
      <SectionTitle>Morgan said</SectionTitle>
      {shown.map((m) => (
        <div key={m.id} className={styles.saidItem}>
          <div className={styles.saidTitle}>{m.title ?? 'Morgan'}</div>
          <div className={styles.saidText}>{m.text}</div>
          {m.actions?.some((a) => a.panel) && (
            <div className={styles.saidActions}>
              {m.actions
                .filter((a) => a.panel)
                .map((a) => (
                  <button key={a.label} type="button" className={styles.saidLink} onClick={() => openPanel(a.panel!, a.params)}>
                    {a.label} →
                  </button>
                ))}
            </div>
          )}
        </div>
      ))}
      {history.length > 3 && (
        <button type="button" className={styles.restore} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `Show ${Math.min(17, history.length - 3)} more`}
        </button>
      )}
    </div>
  );
}
