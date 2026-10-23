// Advisor dock (UX §6.3/§6.15/§6.17): Morgan's portrait bottom-right with a
// speech bubble. Shows the active tutorial step when a chapter runs (the
// tutorial's "advisor bubble"), otherwise the advisor message queue. Clicking
// the portrait opens the Advisor drawer (H).

import clsx from 'clsx';
import { ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useGameStore } from '@/state/gameStore';
import { currentTutorialStep, useTutorialStore } from '@/state/tutorialStore';
import { useUiStore, type AdvisorMessage } from '@/state/uiStore';
import { Button, IconButton } from '@/ui/components';
import { useStableId } from '@/ui/hooks';
import { advisorReadMs } from './advisorTiming';
import styles from './AdvisorDock.module.css';

/** Morgan, your COO — a stylised bust in a gold medallion. */
export function AdvisorPortrait({ size = 56 }: { size?: number }) {
  const id = useStableId('advisor');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#2c4155" />
          <stop offset="100%" stopColor="#0c141b" />
        </radialGradient>
        <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f7e4aa" />
          <stop offset="50%" stopColor="#cfa851" />
          <stop offset="100%" stopColor="#87672a" />
        </linearGradient>
        <linearGradient id={`${id}-suit`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3c5468" />
          <stop offset="100%" stopColor="#1d2a36" />
        </linearGradient>
        <linearGradient id={`${id}-skin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d8c3ae" />
          <stop offset="100%" stopColor="#ae957f" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="32" cy="32" r="27" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="31.5" fill={`url(#${id}-ring)`} />
      <circle cx="32" cy="32" r="29" fill="#0b1117" />
      <circle cx="32" cy="32" r="27" fill={`url(#${id}-bg)`} />
      <g clipPath={`url(#${id}-clip)`}>
        <path d="M9 66 C9 49 19 42.5 32 42.5 C45 42.5 55 49 55 66 Z" fill={`url(#${id}-suit)`} />
        <path d="M26.6 42.6 L32 53 L37.4 42.6 Z" fill="#ece5d6" />
        <path d="M31 44.6 L33 44.6 L34.2 50.6 L32 53.6 L29.8 50.6 Z" fill="#cfa851" />
        <path d="M22 46 L27.5 43 L31 53 Z M42 46 L36.5 43 L33 53 Z" fill="#2a3a48" />
        <rect x="28.4" y="34" width="7.2" height="9.4" rx="3.2" fill={`url(#${id}-skin)`} />
        <ellipse cx="32" cy="27" rx="8.6" ry="10.2" fill={`url(#${id}-skin)`} />
        <path d="M23.3 26.4 C22.6 17.2 28.6 14.2 32.4 14.2 C38.2 14.2 41.9 18.4 41 26.4 C39.4 21.2 35.8 19.8 32.2 19.8 C28.1 19.8 25 21.9 23.3 26.4 Z" fill="#2c2520" />
      </g>
      <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,0.08)" />
    </svg>
  );
}

export function AdvisorDock() {
  const current = useUiStore((s) => s.advisor.current);
  const queued = useUiStore((s) => s.advisor.queue.length);
  const dismiss = useUiStore((s) => s.dismissAdvisor);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const openPanel = useUiStore((s) => s.openPanel);
  // The Advisor drawer shows the same lines in full; the bubble steps aside while it is open.
  const drawerOpen = useUiStore((s) => s.drawers[s.drawers.length - 1]?.id === 'advisor');
  const step = useTutorialStore(currentTutorialStep);
  const nextStep = useTutorialStore((s) => s.next);
  const skipTutorial = useTutorialStore((s) => s.skipAll);
  const [speaking, setSpeaking] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Lines said while the loading screen still covers the city wait for it to lift.
  const loadingHeld = useGameStore((s) => s.holds.includes('loading'));

  const key = step ? `t-${step.id}` : current ? `m-${current.id}` : null;
  useEffect(() => {
    if (!key) return;
    setSpeaking(true);
    const t = window.setTimeout(() => setSpeaking(false), 4000);
    return () => window.clearTimeout(t);
  }, [key]);

  // Non-critical lines advance on their own after a reading time (paused while hovered);
  // critical lines stay until dismissed. Everything stays in the Advisor drawer's history.
  const autoText = !step && current && current.tone !== 'critical' ? current.text : null;
  useEffect(() => {
    if (autoText === null || hovered || loadingHeld) return;
    const t = window.setTimeout(dismiss, advisorReadMs(autoText, queued));
    return () => window.clearTimeout(t);
  }, [key, autoText, hovered, loadingHeld, queued, dismiss]);

  const runAction = (a: NonNullable<AdvisorMessage['actions']>[number]) => {
    if (a.panel) openPanel(a.panel, a.params);
    a.run?.();
    dismiss();
  };

  const showBubble = !drawerOpen;
  return (
    <div
      className={clsx(styles.dock, step && styles.coaching)}
      data-ui-id="advisor.dock"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {!showBubble ? null : step ? (
        <div key={key} className={styles.bubble} role="status" aria-live="polite" data-testid="advisor-bubble">
          <div className={styles.bubbleHead}>
            <span className={styles.bubbleTitle}>{step.title}</span>
          </div>
          <div className={styles.text}>{step.body}</div>
          {step.why && <div className={styles.why}>{step.why}</div>}
          <div className={styles.actions}>
            {!step.complete && (
              <Button size="sm" variant="primary" iconRight={<ChevronRight size={13} />} onClick={nextStep}>
                Next
              </Button>
            )}
            {step.skippable !== false && (
              <Button size="sm" variant="ghost" onClick={skipTutorial}>
                Skip tutorial
              </Button>
            )}
          </div>
        </div>
      ) : (
        current && (
          <div key={key} className={clsx(styles.bubble, styles[`tone-${current.tone}`])} role="status" aria-live="polite" data-testid="advisor-bubble">
            <div className={styles.bubbleHead}>
              <span className={styles.bubbleTitle}>{current.title ?? 'Morgan'}</span>
              {queued > 0 && <span className={styles.queue}>+{queued}</span>}
              <IconButton className={styles.close} size="sm" label="Dismiss" icon={<X size={13} />} onClick={dismiss} sound="close" noTooltip />
            </div>
            <div className={styles.text}>{current.text}</div>
            {current.actions && current.actions.length > 0 && (
              <div className={styles.actions}>
                {current.actions.map((a) => (
                  <Button key={a.label} size="sm" variant="secondary" onClick={() => runAction(a)}>
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )
      )}
      <div className={styles.portraitRow}>
        <div className={styles.nameplate}>
          <span className={styles.name}>Morgan</span>
          <span className={styles.role}>Your COO · H</span>
        </div>
        <button type="button" className={clsx(styles.portrait, speaking && styles.speaking)} onClick={() => togglePanel('advisor')} aria-label="Open the advisor (H)" data-testid="advisor-portrait">
          <AdvisorPortrait />
          {(current || step) && !speaking && <span className={styles.dotBadge} />}
        </button>
      </div>
    </div>
  );
}
