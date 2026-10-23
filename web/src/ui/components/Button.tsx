// Buttons, icon buttons and the spinner.
//
//   <Button variant="primary" icon={<Play />} kbd="Space" onClick={…}>Resume</Button>
//   <IconButton label="Close" icon={<X />} onClick={…} />      // label → aria-label + tooltip

import clsx from 'clsx';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { audio, type UiCue } from '@/audio';
import styles from './Button.module.css';
import { KeyChord } from './Kbd';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Shortcut hint rendered as a key cap ("B", "Mod+S"). */
  kbd?: string;
  loading?: boolean;
  full?: boolean;
  round?: boolean;
  /** Toggle buttons: rendered as aria-pressed. */
  pressed?: boolean;
  badge?: ReactNode;
  /** UI cue played on click (false = silent). */
  sound?: UiCue | false;
  type?: 'button' | 'submit' | 'reset';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    kbd,
    loading = false,
    full = false,
    round = false,
    pressed,
    badge,
    sound = 'click',
    className,
    children,
    disabled,
    onClick,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconOnly = !children && !!icon && !iconRight;
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        styles.button,
        styles[variant],
        size !== 'md' && styles[size],
        iconOnly && styles.iconOnly,
        round && styles.round,
        full && styles.full,
        loading && styles.loading,
        className,
      )}
      disabled={disabled || loading}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (sound) audio.ui(sound);
        onClick?.(e);
      }}
      {...rest}
    >
      {icon && <span className={styles.icon}>{icon}</span>}
      {children !== undefined && children !== null && <span className={styles.label}>{children}</span>}
      {iconRight && <span className={styles.icon}>{iconRight}</span>}
      {kbd && <KeyChord chord={kbd} className={styles.kbd} small />}
      {loading && (
        <span className={styles.spinnerSlot}>
          <Spinner />
        </span>
      )}
      {badge && <span className={styles.badge}>{badge}</span>}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
  icon: ReactNode;
  /** Accessible name; also the tooltip title. */
  label: string;
  /** Extra tooltip body. */
  description?: ReactNode;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  /** Hide the tooltip (e.g. when a visible label sits next to it). */
  noTooltip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, description, kbd, tooltipSide = 'bottom', noTooltip = false, variant = 'ghost', ...rest },
  ref,
) {
  const button = <Button ref={ref} variant={variant} icon={icon} aria-label={label} {...rest} />;
  if (noTooltip) return button;
  return (
    <Tooltip title={label} content={description} shortcut={kbd} side={tooltipSide}>
      {button}
    </Tooltip>
  );
});

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx(styles.spinner, className)} role="progressbar" aria-label="Loading" />;
}
