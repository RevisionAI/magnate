// Rich tooltip: delayed on hover (400 ms, UX §6.20), immediate-ish on keyboard
// focus, dismissed with Esc, portalled above everything, flips and clamps to
// stay on screen. The trigger gets aria-describedby.
//
//   <Tooltip title="Cash" content="Runway 14 months" shortcut="R"><span>…</span></Tooltip>

import clsx from 'clsx';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { MOTION } from '@/theme/tokens';
import { useStableId } from '../hooks';
import styles from './Tooltip.module.css';
import { KeyChord } from './Kbd';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  /** Bold first line. */
  title?: ReactNode;
  /** Body (any rich content). */
  content?: ReactNode;
  shortcut?: string;
  side?: TooltipSide;
  delay?: number;
  disabled?: boolean;
  /** Stretch the anchor wrapper to the parent's width. */
  block?: boolean;
  wide?: boolean;
  /** Controlled visibility (design docs, tutorials); hover/focus are ignored while set. */
  open?: boolean;
  children: ReactNode;
  className?: string;
}

const MARGIN = 8;
const GAP = 8;

interface Placement {
  top: number;
  left: number;
  side: TooltipSide;
  arrow: number;
}

function place(anchor: DOMRect, tip: DOMRect, preferred: TooltipSide): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits = {
    top: anchor.top - tip.height - GAP >= MARGIN,
    bottom: anchor.bottom + tip.height + GAP <= vh - MARGIN,
    left: anchor.left - tip.width - GAP >= MARGIN,
    right: anchor.right + tip.width + GAP <= vw - MARGIN,
  };
  const opposite: Record<TooltipSide, TooltipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const side = fits[preferred] ? preferred : fits[opposite[preferred]] ? opposite[preferred] : preferred;
  let top: number;
  let left: number;
  if (side === 'top' || side === 'bottom') {
    top = side === 'top' ? anchor.top - tip.height - GAP : anchor.bottom + GAP;
    left = anchor.left + anchor.width / 2 - tip.width / 2;
  } else {
    left = side === 'left' ? anchor.left - tip.width - GAP : anchor.right + GAP;
    top = anchor.top + anchor.height / 2 - tip.height / 2;
  }
  left = Math.min(Math.max(MARGIN, left), vw - tip.width - MARGIN);
  top = Math.min(Math.max(MARGIN, top), vh - tip.height - MARGIN);
  const arrow =
    side === 'top' || side === 'bottom'
      ? Math.min(Math.max(10, anchor.left + anchor.width / 2 - left - 4), tip.width - 18)
      : Math.min(Math.max(8, anchor.top + anchor.height / 2 - top - 4), tip.height - 16);
  return { top, left, side, arrow };
}

export function Tooltip({
  title,
  content,
  shortcut,
  side = 'top',
  delay = MOTION.tooltipDelay,
  disabled = false,
  block = false,
  wide = false,
  open: controlledOpen,
  children,
  className,
}: TooltipProps) {
  const id = useStableId('tip');
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [hoverOpen, setOpen] = useState(false);
  const open = controlledOpen ?? hoverOpen;
  const [placement, setPlacement] = useState<Placement | null>(null);
  const empty = !title && !content && !shortcut;

  const clear = () => window.clearTimeout(timer.current);
  const show = useCallback(
    (wait: number) => {
      if (disabled || empty) return;
      clear();
      timer.current = window.setTimeout(() => setOpen(true), wait);
    },
    [disabled, empty],
  );
  const hide = useCallback(() => {
    clear();
    setOpen(false);
    if (controlledOpen === undefined) setPlacement(null);
  }, [controlledOpen]);

  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  /** Places the tip next to its anchor; hides it while the anchor is scrolled out of view. */
  const reposition = useCallback(() => {
    if (!anchorRef.current || !tipRef.current) return;
    const target = (anchorRef.current.firstElementChild as HTMLElement | null) ?? anchorRef.current;
    const a = target.getBoundingClientRect();
    if (a.bottom < 0 || a.top > window.innerHeight || a.right < 0 || a.left > window.innerWidth) {
      setPlacement(null);
      return;
    }
    setPlacement(place(a, tipRef.current.getBoundingClientRect(), side));
  }, [side]);

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, title, content, reposition]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    // Hover tooltips close on scroll; controlled ones follow their anchor.
    const onScroll = () => (controlledOpen === undefined ? hide() : reposition());
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, hide, reposition, controlledOpen]);

  const child =
    isValidElement(children) && !empty
      ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': open ? id : undefined })
      : children;

  const fromOffset =
    placement?.side === 'top'
      ? { '--from-y': '3px' }
      : placement?.side === 'bottom'
        ? { '--from-y': '-3px' }
        : placement?.side === 'left'
          ? { '--from-x': '3px', '--from-y': '0' }
          : { '--from-x': '-3px', '--from-y': '0' };

  return (
    <span
      ref={anchorRef}
      className={clsx(block ? styles.block : styles.anchor, className)}
      onPointerEnter={(e) => e.pointerType !== 'touch' && show(delay)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches?.(':focus-visible')) show(Math.min(delay, 150));
      }}
      onBlur={hide}
    >
      {child}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={clsx(styles.tooltip, wide && styles.wide, placement && styles[`side-${placement.side}`])}
            style={{
              top: placement?.top ?? -9999,
              left: placement?.left ?? -9999,
              visibility: placement ? 'visible' : 'hidden',
              ...(fromOffset as Record<string, string>),
            }}
          >
            {(title || shortcut) && (
              <div className={styles.head}>
                {title && <span className={styles.title}>{title}</span>}
                {shortcut && <KeyChord chord={shortcut} small />}
              </div>
            )}
            {content && <div className={styles.body}>{content}</div>}
            {placement && (
              <span
                className={styles.arrow}
                style={placement.side === 'top' || placement.side === 'bottom' ? { left: placement.arrow } : { top: placement.arrow }}
              />
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
