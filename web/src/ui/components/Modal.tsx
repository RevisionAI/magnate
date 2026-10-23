// L4 modal (UX §6.2: always pauses — the host holds time while any modal is
// open) and the confirm dialog. Focus is trapped and restored; Esc closes when
// the modal is dismissible.
//
//   <Modal open title="Settings" onClose={close} size="lg" footer={<Button>Done</Button>}>…</Modal>
//   <ConfirmDialog open title="Quit to title?" tone="danger" onResult={(r) => …} />

import clsx from 'clsx';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap, useStableId } from '../hooks';
import { Button, IconButton } from './Button';
import styles from './Modal.module.css';

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose?: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  tone?: 'default' | 'danger';
  footer?: ReactNode;
  /** Left side of the footer (secondary actions). */
  footerStart?: ReactNode;
  dismissible?: boolean;
  flush?: boolean;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  'data-testid'?: string;
}

export function Modal({
  open,
  title,
  subtitle,
  icon,
  onClose,
  size = 'md',
  tone = 'default',
  footer,
  footerStart,
  dismissible = true,
  flush = false,
  children,
  className,
  bodyClassName,
  ...rest
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useStableId('modal-title');
  useFocusTrap(ref, open);
  if (!open) return null;
  return createPortal(
    <div
      className={styles.backdrop}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose?.();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(styles.modal, styles[size], styles[`tone-${tone}`], className)}
        data-testid={rest['data-testid']}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            if (dismissible) onClose?.();
          }
        }}
      >
        <header className={styles.header}>
          {icon && <span className={styles.icon}>{icon}</span>}
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </div>
          {dismissible && onClose && <IconButton className={styles.close} label="Close" kbd="Escape" icon={<X size={18} />} onClick={onClose} sound="close" />}
        </header>
        <div className={clsx(styles.body, flush && styles.flush, bodyClassName)}>{children}</div>
        {(footer || footerStart) && (
          <footer className={styles.footer}>
            {footerStart && <div className={styles.footerStart}>{footerStart}</div>}
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

export type ConfirmChoice = 'confirm' | 'cancel' | 'alt';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  altLabel?: string;
  tone?: 'default' | 'danger';
  onResult: (choice: ConfirmChoice) => void;
}

/** Yes/no (and optional third choice) confirmation. Enter confirms, Esc cancels. */
export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', altLabel, tone = 'default', onResult }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      size="sm"
      tone={tone}
      title={title}
      icon={tone === 'danger' ? <AlertTriangle size={18} /> : <HelpCircle size={18} />}
      onClose={() => onResult('cancel')}
      data-testid="confirm-dialog"
      footerStart={
        altLabel ? (
          <Button variant="ghost" onClick={() => onResult('alt')} data-testid="confirm-alt">
            {altLabel}
          </Button>
        ) : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onResult('cancel')} sound="close" data-testid="confirm-cancel">
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => onResult('confirm')} sound="confirm" data-autofocus data-testid="confirm-ok">
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
    </Modal>
  );
}
