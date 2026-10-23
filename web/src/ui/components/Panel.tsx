// Glass panel and section heading — the base surface of every HUD element.
//
//   <Panel title="Goals" icon={<Target size={14} />} actions={…} accent>…</Panel>

import clsx from 'clsx';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import styles from './Panel.module.css';

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  variant?: 'glass' | 'solid' | 'inset';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Gold hairline along the top edge (featured surfaces). */
  accent?: boolean;
  scroll?: boolean;
  bodyClassName?: string;
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { title, icon, actions, variant = 'glass', padding = 'md', accent = false, scroll = false, className, bodyClassName, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={clsx(styles.panel, variant === 'solid' && styles.solid, variant === 'inset' && styles.inset, accent && styles.accent, className)}
      {...rest}
    >
      {(title || actions) && (
        <div className={styles.header}>
          {icon && <span className={styles.headerIcon}>{icon}</span>}
          <span className={styles.title}>{title}</span>
          {actions && <span className={styles.actions}>{actions}</span>}
        </div>
      )}
      <div className={clsx(styles.body, styles[`pad-${padding}`], scroll && styles.scroll, bodyClassName)}>{children}</div>
    </div>
  );
});

/** Small uppercase section label with a fading rule. */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h4 className={clsx(styles.section, className)}>{children}</h4>;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={clsx(styles.divider, className)} />;
}
