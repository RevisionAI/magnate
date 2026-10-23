// Alerts drawer (J) — owned by U1. Everything that needed attention this game,
// newest first, filterable by severity (UX §6.21: warnings and worse persist
// here; info goes to the news log). Opening it marks everything read.

import clsx from 'clsx';
import { Bell } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AlertSeverity } from '@/state/alerts';
import { useAlertsStore } from '@/state/alertsStore';
import { useGameStore } from '@/state/gameStore';
import { Button, DrawerFrame, EmptyState, SEVERITY_ICON, Segmented } from '@/ui/components';
import { addMonths, monthYear } from '@/util/format';
import { runAlertAction } from '@/ui/hud/alertActions';
import type { PanelProps } from '../registry';
import styles from './Alerts.module.css';

type Filter = 'all' | 'critical' | 'warning' | 'good';

export default function AlertsPanel(_props: PanelProps) {
  const history = useAlertsStore((s) => s.history);
  const markAllRead = useAlertsStore((s) => s.markAllRead);
  const clearHistory = useAlertsStore((s) => s.clearHistory);
  const hud = useGameStore((s) => s.hud);
  const [filter, setFilter] = useState<Filter>('all');
  const [unreadAtOpen] = useState(() => new Set(history.filter((a) => !a.read).map((a) => a.id)));

  useEffect(() => {
    markAllRead();
  }, [history.length, markAllRead]);

  const items = useMemo(() => {
    const match = (s: AlertSeverity) =>
      filter === 'all' ? s !== 'info' : filter === 'critical' ? s === 'critical' : filter === 'warning' ? s === 'warning' : s === 'success' || s === 'opportunity';
    return [...history].reverse().filter((a) => match(a.severity));
  }, [history, filter]);

  const when = (monthIndex: number) => (hud ? monthYear(addMonths(hud.date, monthIndex - hud.monthIndex)) : '');

  return (
    <DrawerFrame
      title="Alerts"
      icon={<Bell size={17} />}
      subtitle={`${history.filter((a) => a.severity !== 'info').length} this game`}
      data-testid="panel-alerts"
      footer={
        <Button size="sm" variant="ghost" onClick={clearHistory} disabled={history.length === 0}>
          Clear history
        </Button>
      }
    >
      <div className={styles.toolbar}>
        <Segmented<Filter>
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'critical', label: 'Critical' },
            { value: 'warning', label: 'Warnings' },
            { value: 'good', label: 'Good news' },
          ]}
        />
      </div>
      {items.length === 0 && <EmptyState compact icon={<Bell size={18} />} title="All quiet" body="Warnings, opportunities and milestones collect here as months close." />}
      {items.map((a) => (
        <div key={a.id} className={clsx(styles.item, styles[a.severity], unreadAtOpen.has(a.id) && styles.unread)}>
          <span className={styles.icon}>{SEVERITY_ICON[a.severity]}</span>
          <div className={styles.title}>
            <span>{a.title}</span>
            <span className={styles.when}>{when(a.monthIndex)}</span>
          </div>
          {a.body && <div className={styles.body}>{a.body}</div>}
          {a.actions.some((x) => x.kind !== 'ack') && (
            <div className={styles.actions}>
              {a.actions
                .filter((x) => x.kind !== 'ack')
                .map((x) => (
                  <Button key={`${x.kind}-${x.label}`} size="sm" variant="ghost" onClick={() => runAlertAction(a, x)}>
                    {x.label}
                  </Button>
                ))}
            </div>
          )}
        </div>
      ))}
    </DrawerFrame>
  );
}
