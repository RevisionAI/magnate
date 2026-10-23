// Data table: sortable columns, numeric alignment (tabular figures), sticky
// header, row selection, keyboard row activation, optional total row.
//
//   <Table
//     rowKey={(r) => r.id}
//     columns={[
//       { id: 'name', header: 'Building', cell: (r) => r.name, sortValue: (r) => r.name },
//       { id: 'ni', header: 'Net / mo', numeric: true, cell: (r) => <Money value={r.ni} signed colored />, sortValue: (r) => r.ni },
//     ]}
//     rows={rows} defaultSort={{ id: 'ni', dir: 'desc' }} onRowClick={(r) => select(r.id)} />

import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import styles from './Table.module.css';

export type SortDir = 'asc' | 'desc';

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** Enables sorting on this column. */
  sortValue?: (row: T) => number | string | null;
  numeric?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /** Header tooltip (native title). */
  hint?: string;
  /** Total row cell. */
  total?: ReactNode;
}

export interface TableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string | number;
  defaultSort?: { id: string; dir: SortDir };
  /** Controlled sort. */
  sort?: { id: string; dir: SortDir } | null;
  onSortChange?: (sort: { id: string; dir: SortDir }) => void;
  onRowClick?: (row: T) => void;
  selectedKey?: string | number | null;
  dense?: boolean;
  /** Max height before the body scrolls (header stays sticky). */
  maxHeight?: number | string;
  empty?: ReactNode;
  showTotal?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  defaultSort,
  sort: controlled,
  onSortChange,
  onRowClick,
  selectedKey,
  dense = false,
  maxHeight,
  empty = 'Nothing to show yet.',
  showTotal = false,
  className,
  ...aria
}: TableProps<T>) {
  const [internal, setInternal] = useState(defaultSort ?? null);
  const sort = controlled !== undefined ? controlled : internal;

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.id === sort.id);
    if (!column?.sortValue) return rows;
    const get = column.sortValue;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb)) * factor;
    });
  }, [rows, columns, sort]);

  const toggleSort = (column: Column<T>) => {
    if (!column.sortValue) return;
    const next: { id: string; dir: SortDir } =
      sort?.id === column.id ? { id: column.id, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { id: column.id, dir: column.numeric ? 'desc' : 'asc' };
    if (controlled === undefined) setInternal(next);
    onSortChange?.(next);
  };

  const alignClass = (c: Column<T>) => (c.numeric || c.align === 'right' ? styles.num : c.align === 'center' ? styles.center : undefined);
  const style: CSSProperties | undefined = maxHeight !== undefined ? { maxHeight } : undefined;

  return (
    <div className={clsx(styles.wrap, dense && styles.dense, className)} style={style}>
      <table className={styles.table} aria-label={aria['aria-label']}>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.id === c.id;
              return (
                <th
                  key={c.id}
                  className={clsx(styles.th, alignClass(c))}
                  style={c.width !== undefined ? { width: c.width } : undefined}
                  title={c.hint}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  scope="col"
                >
                  {c.sortValue ? (
                    <button type="button" className={clsx(styles.thButton, active && styles.sorted)} onClick={() => toggleSort(c)}>
                      {c.header}
                      <span className={styles.sortIcon}>
                        {active ? sort!.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} /> : <ArrowUpDown size={11} opacity={0.4} />}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td className={styles.empty} colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          )}
          {sorted.map((row, i) => {
            const key = rowKey(row, i);
            const clickable = !!onRowClick;
            return (
              <tr
                key={key}
                className={clsx(styles.row, clickable && styles.clickable, selectedKey === key && styles.selected)}
                tabIndex={clickable ? 0 : undefined}
                aria-selected={selectedKey !== undefined ? selectedKey === key : undefined}
                onClick={clickable ? () => onRowClick!(row) : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick!(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td key={c.id} className={clsx(styles.td, alignClass(c))}>
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            );
          })}
          {showTotal && sorted.length > 0 && (
            <tr className={styles.totalRow}>
              {columns.map((c) => (
                <td key={c.id} className={clsx(styles.td, alignClass(c))}>
                  {c.total}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
