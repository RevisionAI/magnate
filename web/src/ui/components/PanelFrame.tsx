// Frames for the two panel layers (UX §6.2):
//   DrawerFrame  — L2 right drawer (inspector, build palette, goals, advisor, alerts)
//   OverlayFrame — L3 full-screen overlay with header tabs (reports, markets, finance…)
//
// Panels render their own frame so they control tabs, actions and footers; the
// host (ui/panels/PanelHosts.tsx) supplies defaults (title, icon, close, back)
// through PanelChromeContext, so a panel can be as small as:
//
//   export default function MarketsPanel() {
//     return <OverlayFrame tabs={tabs} tab={tab} onTabChange={setTab}>…</OverlayFrame>;
//   }

import clsx from 'clsx';
import { ArrowLeft, X } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { IconButton } from './Button';
import { Kbd } from './Kbd';
import { Tabs, type TabItem } from './Tabs';
import styles from './PanelFrame.module.css';

export interface PanelChrome {
  title: string;
  icon?: ReactNode;
  hotkey?: string | null;
  close: () => void;
  /** Present when the drawer back stack has a previous entry. */
  back?: () => void;
  /** True while the exit animation plays. */
  closing?: boolean;
}

const PanelChromeContext = createContext<PanelChrome | null>(null);
export const PanelChromeProvider = PanelChromeContext.Provider;

/** The host-provided chrome (null when a frame is rendered outside a host, e.g. the UiKit page). */
export function usePanelChrome(): PanelChrome | null {
  return useContext(PanelChromeContext);
}

interface FrameTabs<T extends string> {
  tabs?: readonly TabItem<T>[];
  tab?: T;
  onTabChange?: (id: T) => void;
}

export interface DrawerFrameProps<T extends string = string> extends FrameTabs<T> {
  title?: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  /** No body padding (tables, maps). */
  flush?: boolean;
  onClose?: () => void;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function DrawerFrame<T extends string = string>({
  title,
  eyebrow,
  subtitle,
  icon,
  actions,
  footer,
  flush = false,
  onClose,
  tabs,
  tab,
  onTabChange,
  children,
  className,
  ...rest
}: DrawerFrameProps<T>) {
  const chrome = usePanelChrome();
  const close = onClose ?? chrome?.close;
  return (
    <section
      className={clsx(styles.drawer, chrome?.closing && styles.closing, className)}
      aria-label={typeof title === 'string' ? title : chrome?.title}
      data-testid={rest['data-testid']}
    >
      <header className={styles.drawerHeader}>
        {chrome?.back && <IconButton size="sm" label="Back" icon={<ArrowLeft size={15} />} onClick={chrome.back} sound="close" tooltipSide="bottom" />}
        {(icon ?? chrome?.icon) && <span className={styles.headerIcon}>{icon ?? chrome?.icon}</span>}
        <div className={styles.titleBlock}>
          {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
          <div className={styles.drawerTitle}>{title ?? chrome?.title}</div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        <div className={styles.headerActions}>
          {actions}
          {close && <IconButton size="sm" label="Close" kbd="Escape" icon={<X size={16} />} onClick={close} sound="close" data-testid="drawer-close" />}
        </div>
      </header>
      {tabs && tab !== undefined && onTabChange && (
        <div className={styles.drawerTabs}>
          <Tabs items={tabs} value={tab} onChange={onTabChange} size="sm" />
        </div>
      )}
      <div className={clsx(styles.drawerBody, flush && styles.flush)}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  );
}

export interface OverlayFrameProps<T extends string = string> extends FrameTabs<T> {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  onClose?: () => void;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  'data-testid'?: string;
}

export function OverlayFrame<T extends string = string>({
  title,
  subtitle,
  icon,
  actions,
  flush = false,
  onClose,
  tabs,
  tab,
  onTabChange,
  children,
  className,
  bodyClassName,
  ...rest
}: OverlayFrameProps<T>) {
  const chrome = usePanelChrome();
  const close = onClose ?? chrome?.close;
  return (
    <section
      className={clsx(styles.overlay, chrome?.closing && styles.closing, className)}
      role="dialog"
      aria-label={typeof title === 'string' ? title : chrome?.title}
      data-testid={rest['data-testid']}
    >
      <header className={styles.overlayHeader}>
        <div className={styles.overlayTitleBlock}>
          {(icon ?? chrome?.icon) && <span className={styles.headerIcon}>{icon ?? chrome?.icon}</span>}
          <div>
            <div className={styles.overlayTitle}>{title ?? chrome?.title}</div>
            {subtitle && <div className={styles.overlaySub}>{subtitle}</div>}
          </div>
        </div>
        <div className={styles.overlayTabs}>{tabs && tab !== undefined && onTabChange && <Tabs items={tabs} value={tab} onChange={onTabChange} />}</div>
        <div className={styles.overlayActions}>
          {actions}
          {close && (
            <>
              <span className={styles.escHint}>
                <Kbd small>Esc</Kbd>
              </span>
              <IconButton label="Close" icon={<X size={18} />} onClick={close} sound="close" data-testid="overlay-close" />
            </>
          )}
        </div>
      </header>
      <div className={clsx(styles.overlayBody, flush && styles.flush, bodyClassName)}>{children}</div>
    </section>
  );
}
