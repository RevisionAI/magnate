// Small building blocks shared by the U3 screens: query states (loading,
// error, feature-not-yet-available), locked "coming soon" cards, company tags,
// tech pips, notes and the money formatter that follows the number setting.

import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Lock, RotateCw, Sparkles } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';
import type { FeatureName } from '@/bridge/protocol';
import { EngineError } from '@/bridge/engine';
import { useGameStore } from '@/state/gameStore';
import { useSettingsStore } from '@/state/settingsStore';
import { Button, Emblem, Skeleton } from '@/ui/components';
import { money, moneyExact } from '@/util/format';
import type { CompanyRef } from './names';
import styles from './shared.module.css';

// ------------------------------------------------------------------ errors and features

/** True when the bridge refused a call because its feature flag is still off (EXT methods). */
export function isFeatureUnavailable(error: unknown): boolean {
  return error instanceof EngineError ? error.code === 'feature_unavailable' : (error as { code?: string } | null)?.code === 'feature_unavailable';
}

/** `init.features[name]` (false until the engine workstream switches it on). */
export function useFeature(name: FeatureName): boolean {
  return useGameStore((s) => s.init?.features?.[name] === true);
}

/** Player-facing text for a bridge error (rendered from code + details, never raw engine text). */
export function errorText(error: unknown): string {
  if (error instanceof EngineError) {
    const d = error.details;
    switch (error.code) {
      case 'insufficient_funds':
        return d?.shortfall ? `Not enough cash — ${money(d.shortfall)} short.` : 'Not enough cash.';
      case 'credit_limit_exceeded':
        return d?.available !== undefined ? `Above your credit limit — at most ${money(d.available)} available.` : 'That is above your credit limit.';
      case 'feature_unavailable':
        return 'This part of the economy is not switched on yet.';
      case 'invalid_argument':
        return d?.min !== undefined && d?.max !== undefined ? `Choose a value between ${money(d.min)} and ${money(d.max)}.` : 'That value is not allowed.';
      case 'not_found':
        return 'That no longer exists.';
      case 'no_game':
        return 'No game is running.';
      case 'patent_self_license':
        return 'You cannot license a patent to yourself.';
      case 'not_patent_holder':
      case 'patent_not_active':
        return 'You do not hold an active patent on that product.';
      case 'loan_not_found':
        return 'That loan is already repaid.';
      default:
        return error.message || 'The engine refused that request.';
    }
  }
  return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------------------------------ query states

export function LoadingBlock({ rows = 5, chart = false }: { rows?: number; chart?: boolean }) {
  return (
    <div className={styles.skeletonBlock} aria-busy="true" aria-label="Loading">
      {chart && <Skeleton height={140} radius={8} />}
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={12} width={`${92 - ((i * 13) % 40)}%`} />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className={styles.errorBox} role="alert">
      <AlertTriangle size={16} color="var(--c-red)" />
      <span style={{ flex: 1 }}>{errorText(error)}</span>
      {retry && (
        <Button size="sm" variant="ghost" icon={<RotateCw size={13} />} onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ feature gate / locked cards

export interface FeatureGateProps {
  kicker?: string;
  title: string;
  body: ReactNode;
  rules?: readonly ReactNode[];
  icon?: ReactNode;
  children?: ReactNode;
  'data-testid'?: string;
}

/** A tasteful "arrives soon" state for features the bridge reports as unavailable. */
export function FeatureGate({ kicker = 'Coming soon', title, body, rules, icon, children, ...rest }: FeatureGateProps) {
  return (
    <div className={styles.gate} data-testid={rest['data-testid'] ?? 'feature-gate'}>
      <div className={styles.gateIcon}>{icon ?? <Sparkles size={20} />}</div>
      <div>
        <div className={styles.gateKicker}>{kicker}</div>
        <h3 className={styles.gateTitle}>{title}</h3>
        <p className={styles.gateBody}>{body}</p>
        {rules && rules.length > 0 && (
          <ul className={styles.gateRules}>
            {rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
        {children}
      </div>
    </div>
  );
}

export function LockedCard({ title, children, footer, icon }: { title: ReactNode; children: ReactNode; footer?: ReactNode; icon?: ReactNode }) {
  return (
    <div className={styles.locked}>
      <div className={styles.lockedHead}>
        {icon ?? <Lock size={14} />}
        {title}
      </div>
      <div className={clsx(styles.small, styles.muted)}>{children}</div>
      {footer}
    </div>
  );
}

// ------------------------------------------------------------------ notes, tags, pips

export function Note({ tone = 'info', icon, children, className }: { tone?: 'info' | 'warn' | 'danger' | 'ok' | 'gold'; icon?: ReactNode; children: ReactNode; className?: string }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'warn' || tone === 'danger' ? AlertTriangle : Info;
  const color = tone === 'ok' ? 'var(--c-green)' : tone === 'warn' ? 'var(--c-amber)' : tone === 'danger' ? 'var(--c-red)' : tone === 'gold' ? 'var(--c-gold)' : 'var(--c-blue)';
  return (
    <div
      className={clsx(
        styles.note,
        tone === 'warn' && styles.noteWarn,
        tone === 'danger' && styles.noteDanger,
        tone === 'ok' && styles.noteOk,
        tone === 'gold' && styles.noteGold,
        className,
      )}
    >
      {icon ?? <Icon size={14} color={color} />}
      <div>{children}</div>
    </div>
  );
}

export function CompanyTag({ company, size = 14, you = true, className }: { company: CompanyRef; size?: number; you?: boolean; className?: string }) {
  return (
    <span className={clsx(styles.cellName, className)}>
      <Emblem shape={company.emblem} color={company.color} size={size} ring={company.isPlayer} />
      <span>
        {company.name}
        {you && company.isPlayer ? <span className={styles.dim}> (you)</span> : null}
      </span>
    </span>
  );
}

/** Tech level as pips: filled to `tech`, a marker at the best rival's level. */
export function TechPips({ tech, max, rival }: { tech: number; max: number; rival?: number | null }) {
  const n = Math.max(1, Math.min(20, max));
  return (
    <span className={styles.pips} role="img" aria-label={`Tech ${tech} of ${max}${rival ? `, best rival ${rival}` : ''}`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={clsx(styles.pip, i < tech && styles.pipOn, rival !== null && rival !== undefined && i === rival - 1 && styles.pipRival)} />
      ))}
    </span>
  );
}

// ------------------------------------------------------------------ percentages

/** "42.0%" / "−3.1%" with a true minus sign; values that round to zero print without a sign. */
export function pct(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—';
  const v = Number((fraction * 100).toFixed(digits));
  if (v === 0) return `${(0).toFixed(digits)}%`;
  return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;
}

// ------------------------------------------------------------------ money formatting

/** Money formatter following Settings → Gameplay → number format (short "$1.2M" / full "$1,234,567"). */
export function useMoneyFormat(): (value: number | null | undefined, opts?: { signed?: boolean; digits?: number }) => string {
  const format = useSettingsStore((s) => s.gameplay.numberFormat);
  return useCallback(
    (value, opts = {}) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return '—';
      const abs = format === 'full' ? moneyExact(Math.abs(value)) : money(Math.abs(value), opts.digits ?? 2);
      if (value < 0) return `−${abs}`;
      if (opts.signed && value > 0) return `+${abs}`;
      return abs;
    },
    [format],
  );
}
