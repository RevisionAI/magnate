// CSV export for statements and the ledger explorer (UX §6.9 "Export CSV").

export type CsvCell = string | number | null | undefined;

/** RFC 4180 quoting; numbers stay raw (no currency symbols) so spreadsheets can sum them. */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return '';
          if (typeof cell === 'number') return Number.isFinite(cell) ? String(Math.round(cell * 100) / 100) : '';
          return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
        })
        .join(','),
    )
    .join('\r\n');
}

/** Saves a CSV file through a temporary object URL (no-op outside a browser). */
export function downloadCsv(filename: string, rows: readonly (readonly CsvCell[])[]): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([`﻿${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
