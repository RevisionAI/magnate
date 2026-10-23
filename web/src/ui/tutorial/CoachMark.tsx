// Tutorial coach mark (UX §6.17): dims the screen except the current step's
// target (`highlight.ui` = a `data-ui-id`), rings it in gold, applies the step's
// `allow` whitelist (other controls dimmed, not hidden) and, after
// `hintAfterSec` (default 45 s) without progress, shows the hint and nudges.
// The step text itself lives in the advisor bubble (AdvisorDock).

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { currentTutorialStep, useTutorialStore } from '@/state/tutorialStore';
import { useFrame, useStableId } from '@/ui/hooks';
import styles from './CoachMark.module.css';

const PAD = 6;

/** Controls that stay live under every gate: the advisor dock carries the step text and its Next / Skip buttons. */
const ALWAYS_ALLOWED: ReadonlySet<string> = new Set(['advisor.dock']);

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findTarget(uiId: string | undefined): HTMLElement | null {
  if (!uiId) return null;
  return document.querySelector<HTMLElement>(`[data-ui-id="${CSS.escape(uiId)}"]`);
}

/** Applies the allow-list gate: dims every `data-ui-id` control not whitelisted by the step. */
function useTutorialGate(allow: readonly string[] | undefined): void {
  useEffect(() => {
    if (!allow) return;
    const apply = () => {
      document.body.dataset.tutorialGate = 'on';
      for (const el of document.querySelectorAll<HTMLElement>('[data-ui-id]')) {
        const uiId = el.dataset.uiId ?? '';
        const ok = allow.includes(uiId) || ALWAYS_ALLOWED.has(uiId);
        if (ok) el.dataset.tutorialAllowed = 'true';
        else delete el.dataset.tutorialAllowed;
      }
    };
    apply();
    const id = window.setInterval(apply, 300); // panels mount and unmount while the step is active
    return () => {
      window.clearInterval(id);
      delete document.body.dataset.tutorialGate;
      for (const el of document.querySelectorAll<HTMLElement>('[data-tutorial-allowed]')) delete el.dataset.tutorialAllowed;
    };
  }, [allow]);
}

export function CoachMark() {
  const step = useTutorialStore(currentTutorialStep);
  const startedAt = useTutorialStore((s) => s.stepStartedAt);
  const maskId = useStableId('coach');
  const [rect, setRect] = useState<Rect | null>(null);
  const [hint, setHint] = useState(false);
  const last = useRef<string>('');

  useTutorialGate(step?.allow);

  useEffect(() => {
    setHint(false);
    if (!step) return;
    const ms = (step.hintAfterSec ?? 45) * 1000;
    const t = window.setTimeout(() => setHint(true), Math.max(0, ms - (performance.now() - startedAt)));
    return () => window.clearTimeout(t);
  }, [step, startedAt]);

  useFrame(
    () => {
      const el = findTarget(step?.highlight?.ui);
      if (!el) {
        if (last.current !== '') {
          last.current = '';
          setRect(null);
        }
        return;
      }
      const r = el.getBoundingClientRect();
      const key = `${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}:${Math.round(r.height)}`;
      if (key !== last.current) {
        last.current = key;
        setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
      }
    },
    !!step?.highlight?.ui,
  );

  if (!step || !step.highlight?.ui || !rect) return null;
  const below = rect.top + rect.height + 60 < window.innerHeight;
  return (
    <div className={styles.layer} aria-hidden data-testid="coach-mark">
      <svg className={styles.dim}>
        <defs>
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            <rect x={rect.left} y={rect.top} width={rect.width} height={rect.height} rx={8} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(4, 8, 12, 0.5)" mask={`url(#${maskId})`} />
      </svg>
      <div className={clsx(styles.ring, hint && styles.nudge)} style={rect} />
      {hint && step.hint && (
        <div className={styles.hint} style={{ left: rect.left, top: below ? rect.top + rect.height + 10 : rect.top - 44 }}>
          {step.hint}
        </div>
      )}
    </div>
  );
}
