// Right column of the HUD (UX §6.3): the goals tracker (top 3 goals, progress,
// deadline; collapsible; G opens the Goals drawer) and the toast stack (≤ 3,
// alerts policy §6.21). Shifts left of the right drawer when one is open.

import clsx from 'clsx';
import { Check, ChevronDown, Target } from 'lucide-react';
import { useEffect, useState } from 'react';
import { bus } from '@/game/events';
import { useAlertsStore } from '@/state/alertsStore';
import { useGameStore } from '@/state/gameStore';
import { useUiStore } from '@/state/uiStore';
import { Progress, ToastCard, Tooltip } from '@/ui/components';
import { monthYear } from '@/util/format';
import { readJson, writeJson } from '@/util/storage';
import { runAlertAction } from './alertActions';
import styles from './RightColumn.module.css';

const COLLAPSE_KEY = 'magnate.ui.goalsCollapsed';

function GoalsChip() {
  const scenario = useGameStore((s) => s.hud?.scenario ?? null);
  const openPanel = useUiStore((s) => s.openPanel);
  // The Goals drawer shows the full list; the chip steps aside while it is open.
  const goalsDrawerOpen = useUiStore((s) => s.drawers[s.drawers.length - 1]?.id === 'goals');
  const [collapsed, setCollapsed] = useState(() => readJson<boolean>(COLLAPSE_KEY, false));
  const [celebrate, setCelebrate] = useState(0);

  useEffect(
    () =>
      bus.on('gameEvent', (e) => {
        if (e.kind === 'goalAchieved') setCelebrate((n) => n + 1);
      }),
    [],
  );

  if (!scenario || scenario.goals.length === 0 || goalsDrawerOpen) return null;
  const { goals, goalsAchieved, monthsRemaining, endDate, nextGoalId } = scenario;
  // Next goal first, then other open goals, then achieved ones — top 3 (UX §6.3).
  const ordered = [
    ...goals.filter((g) => g.id === nextGoalId && !g.latched),
    ...goals.filter((g) => g.id !== nextGoalId && !g.latched),
    ...goals.filter((g) => g.latched),
  ].slice(0, 3);

  const toggle = () => {
    setCollapsed((c) => {
      writeJson(COLLAPSE_KEY, !c);
      return !c;
    });
  };

  return (
    <section key={celebrate} className={clsx(styles.goals, collapsed && styles.collapsed, celebrate > 0 && styles.celebrate)} data-testid="goals-chip" data-ui-id="goals.chip">
      <button type="button" className={styles.goalsHead} onClick={toggle} aria-expanded={!collapsed}>
        <span className={styles.goalsIcon}>
          <Target size={14} />
        </span>
        <span className={styles.goalsTitle}>Goals</span>
        <span className={styles.goalsCount}>
          {goalsAchieved}/{goals.length}
        </span>
        <span className={styles.goalsDeadline}>{endDate ? `${monthsRemaining ?? 0} mo left` : 'No deadline'}</span>
        <span className={styles.chev}>
          <ChevronDown size={14} />
        </span>
      </button>
      {!collapsed && (
        <div className={styles.goalList}>
          {ordered.map((g) => (
            <Tooltip
              key={g.id}
              block
              side="left"
              wide
              title={g.label}
              content={
                <>
                  {g.description && g.description !== g.label && <div>{g.description}</div>}
                  <div>
                    {g.rule === 'holdAtDeadline' ? 'Hold at deadline' : 'Reach once'}
                    {g.detail ? ` · ${g.detail}` : ''}
                    {g.achievedAt ? ` · reached ${monthYear(g.achievedAt)}` : ''}
                  </div>
                </>
              }
            >
              <button
                type="button"
                className={clsx(styles.goal, g.latched && styles.goalDone, !g.latched && g.id === nextGoalId && styles.goalNext)}
                onClick={() => openPanel('goals')}
              >
                <span className={styles.goalMark}>{g.latched ? <Check size={10} strokeWidth={3.5} /> : null}</span>
                <span className={styles.goalLabel}>{g.label}</span>
                {!g.latched && g.id === nextGoalId && (
                  <span className={styles.goalProgress}>
                    <Progress value={g.progress} size="sm" valueLabel={`${Math.round(g.progress * 100)}%`} />
                  </span>
                )}
              </button>
            </Tooltip>
          ))}
          {goals.length > 3 && <div className={styles.goalsMore}>+{goals.length - 3} more · press G</div>}
        </div>
      )}
    </section>
  );
}

function ToastStack() {
  const toasts = useAlertsStore((s) => s.toasts);
  const dismiss = useAlertsStore((s) => s.dismissToast);
  return (
    <div className={styles.toasts} aria-live="polite" data-testid="toasts">
      {toasts.map((t) => (
        <ToastCard
          key={t.id}
          severity={t.severity}
          title={t.title}
          body={t.body}
          actions={t.actions}
          durationMs={t.sticky ? null : t.durationMs}
          count={t.batchCount}
          onAction={(a) => runAlertAction(t, a)}
          onDismiss={() => dismiss(t.id)}
          onExpire={() => dismiss(t.id)}
        />
      ))}
    </div>
  );
}

export function RightColumn() {
  return (
    <div className={styles.column}>
      <GoalsChip />
      <ToastStack />
    </div>
  );
}
