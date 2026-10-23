// Multi-period statement grid (P&L, cash flow): sticky line labels, one column
// per period (the open month-to-date column is marked), an optional Δ column
// comparing the last two periods, hover hints and click-to-drill rows.

import clsx from 'clsx';
import { HelpCircle } from 'lucide-react';
import { Tooltip } from '@/ui/components';
import { signedPercent } from '@/util/format';
import { pct, useMoneyFormat } from './components';
import type { PeriodColumn } from './periods';
import { columnDelta, type StatementRow } from './statement';
import styles from './shared.module.css';

export interface StatementTableProps {
  columns: readonly Pick<PeriodColumn, 'label' | 'caption' | 'open'>[];
  rows: readonly StatementRow[];
  /** Add a Δ% column comparing the last two columns. */
  showDelta?: boolean;
  onDrill?: (row: StatementRow) => void;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function StatementTable({ columns, rows, showDelta = false, onDrill, ...rest }: StatementTableProps) {
  const fmt = useMoneyFormat();
  const last = columns.length - 1;
  const deltaOn = showDelta && columns.length >= 2;
  return (
    <div className={styles.statementWrap} data-testid={rest['data-testid']}>
      <table className={styles.statement} aria-label={rest['aria-label']}>
        <thead>
          <tr>
            <th scope="col">Line</th>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={clsx(c.open && styles.colOpen)} title={c.open ? `${c.caption} — month to date` : c.caption}>
                {c.label}
                {c.open ? ' •' : ''}
              </th>
            ))}
            {deltaOn && (
              <th scope="col" className={styles.deltaCell} title="Change from the previous column">
                Δ
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const clickable = !!onDrill && !!row.drill && row.drill.kind !== 'none';
            const isPct = row.format === 'percent';
            const delta = deltaOn && row.kind !== 'header' ? (isPct ? diffPts(row.values[last - 1], row.values[last]) : columnDelta(row.values[last - 1], row.values[last])) : null;
            const deltaGood = delta === null ? null : row.invert ? delta < 0 : delta > 0;
            return (
              <tr
                key={row.id}
                className={clsx(styles[`r-${row.kind}`], row.indent === 1 && styles.indent1, row.indent === 2 && styles.indent2, clickable && styles.drill)}
                onClick={clickable ? () => onDrill!(row) : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onDrill!(row);
                        }
                      }
                    : undefined
                }
                data-row={row.id}
              >
                <td>
                  {row.label}
                  {row.hint && (
                    <Tooltip content={row.hint} side="right">
                      <span className={styles.hintIcon} tabIndex={0} aria-label={row.hint}>
                        <HelpCircle size={12} />
                      </span>
                    </Tooltip>
                  )}
                </td>
                {columns.map((_, i) => {
                  const v = row.values[i];
                  const text = row.kind === 'header' ? '' : v === null || v === undefined ? '—' : isPct ? pct(v, 1) : fmt(v);
                  const tone = row.kind === 'grand' && v !== null && v !== undefined ? (v > 0 ? styles.cellPos : v < 0 ? styles.cellNeg : undefined) : undefined;
                  return (
                    <td key={i} className={clsx(i === last && columns.length > 1 && styles.cellLatest, tone)}>
                      {text}
                    </td>
                  );
                })}
                {deltaOn && (
                  <td className={clsx(styles.deltaCell, deltaGood === true && styles.pos, deltaGood === false && styles.neg)}>
                    {row.kind === 'header' || delta === null ? '' : isPct ? `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta * 100).toFixed(1)} pts` : signedPercent(delta, 1)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function diffPts(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return b - a;
}
