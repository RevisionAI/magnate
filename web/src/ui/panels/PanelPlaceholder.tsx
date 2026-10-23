// Shared body for Wave 1 placeholder panels: what the panel will contain (from
// the UX spec), who builds it, and a skeleton preview — or real data when the
// placeholder passes `children`. Wave 2 panels replace their directory wholesale.

import clsx from 'clsx';
import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Skeleton } from '@/ui/components';
import styles from './PanelPlaceholder.module.css';

export interface PanelPlaceholderProps {
  title: string;
  lede: string;
  features: readonly string[];
  /** Workstream that delivers the full panel. */
  owner: string;
  /** Real content to show next to the description (instead of a skeleton). */
  children?: ReactNode;
  previewTitle?: string;
  compact?: boolean;
}

const BARS = [38, 52, 44, 61, 58, 70, 66, 78, 74, 88, 84, 96];

export function PanelPlaceholder({ title, lede, features, owner, children, previewTitle = 'Preview', compact = false }: PanelPlaceholderProps) {
  return (
    <div className={clsx(styles.wrap, compact && styles.compact)} data-testid="panel-placeholder">
      <div className={styles.intro}>
        <span className={styles.kicker}>
          <Sparkles size={12} /> In development
        </span>
        <h3 className={styles.headline}>{title}</h3>
        <p className={styles.lede}>{lede}</p>
        <ul className={styles.list}>
          {features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <div className={styles.owner}>
          <Badge tone="gold">{owner}</Badge> builds the full panel in the next wave.
        </div>
      </div>
      <div className={styles.preview}>
        <div className={styles.previewHead}>
          <span>{previewTitle}</span>
          {!children && <span>Sample layout</span>}
        </div>
        {children ?? <SkeletonPreview />}
      </div>
    </div>
  );
}

function SkeletonPreview() {
  return (
    <>
      <div className={styles.chartSkeleton} aria-hidden>
        {BARS.map((h, i) => (
          <span key={i} style={{ height: `${h}%`, opacity: 0.35 + i * 0.05 }} />
        ))}
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <Skeleton height={10} width={`${70 - i * 6}%`} />
          <Skeleton height={10} />
          <Skeleton height={10} />
          <Skeleton height={10} width="60%" />
        </div>
      ))}
    </>
  );
}

/** Two-column grid for KPI tiles inside a placeholder preview. */
export function PlaceholderGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid2}>{children}</div>;
}

/** Vertical stack for lists inside a placeholder preview. */
export function PlaceholderStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}
