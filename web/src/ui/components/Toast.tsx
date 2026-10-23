// Toast card (alerts policy UX §6.21): severity colour + icon, title, body,
// actions ([Locate] [Why?] [Acknowledge]…), a timer bar that pauses on hover.
// Sticky (critical) toasts have no timer and need an explicit acknowledge.

import clsx from 'clsx';
import { CircleCheck, Info, OctagonAlert, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AlertAction, AlertSeverity } from '@/state/alerts';
import { Button, IconButton } from './Button';
import styles from './Toast.module.css';

export const SEVERITY_ICON: Record<AlertSeverity, ReactNode> = {
  critical: <OctagonAlert size={15} />,
  warning: <TriangleAlert size={15} />,
  opportunity: <Sparkles size={15} />,
  success: <CircleCheck size={15} />,
  info: <Info size={15} />,
};

export interface ToastCardProps {
  severity: AlertSeverity;
  title: ReactNode;
  body?: ReactNode;
  actions?: readonly AlertAction[];
  /** 0 or null = sticky. */
  durationMs?: number | null;
  count?: number;
  onAction?: (action: AlertAction) => void;
  onDismiss?: () => void;
  onExpire?: () => void;
  className?: string;
}

export function ToastCard({ severity, title, body, actions = [], durationMs, count, onAction, onDismiss, onExpire, className }: ToastCardProps) {
  const sticky = !durationMs;
  const [paused, setPaused] = useState(false);
  const remaining = useRef(durationMs ?? 0);
  const startedAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    if (sticky || paused) return;
    startedAt.current = performance.now();
    timer.current = window.setTimeout(() => expire.current?.(), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(timer.current);
      remaining.current -= performance.now() - startedAt.current;
    };
  }, [sticky, paused]);

  return (
    <div
      className={clsx(styles.toast, styles[severity], paused && styles.paused, className)}
      role={severity === 'critical' ? 'alert' : 'status'}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      data-testid={`toast-${severity}`}
    >
      <span className={styles.icon}>{SEVERITY_ICON[severity]}</span>
      <div className={styles.text}>
        <div className={styles.title}>
          {title}
          {count && count > 1 ? <span className={styles.count}>×{count}</span> : null}
        </div>
        {body && <div className={styles.body}>{body}</div>}
      </div>
      {onDismiss && !sticky ? (
        <IconButton className={styles.close} size="sm" label="Dismiss" icon={<X size={14} />} onClick={onDismiss} sound="close" noTooltip />
      ) : (
        <span />
      )}
      {actions.length > 0 && (
        <div className={styles.actions}>
          {actions.map((a) => (
            <Button key={`${a.kind}-${a.label}`} size="sm" variant={a.kind === 'ack' ? 'secondary' : 'ghost'} onClick={() => onAction?.(a)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
      {!sticky && (
        <div className={styles.timer}>
          <span style={{ animationDuration: `${durationMs}ms` }} />
        </div>
      )}
    </div>
  );
}
