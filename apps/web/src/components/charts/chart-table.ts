/** A chart's data as a real table: what _View as table_ shows, a screen reader reads, and _Export
 * CSV_ writes. Cells are already formatted text; `exact` cells (money) export unformatted. */
export interface ChartTable {
  columns: string[];
  rows: { cells: string[]; exact?: (string | null)[] }[];
}

const BOM = String.fromCharCode(0xfeff);

const quote = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

/** The table as CSV (a BOM so spreadsheets read UTF-8; the exact values where given). */
export function tableCsv(table: ChartTable): string {
  const lines = [
    table.columns.map(quote).join(','),
    ...table.rows.map((row) =>
      row.cells.map((cell, index) => quote(row.exact?.[index] ?? cell)).join(','),
    ),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** Downloads `table` as `<name>.csv`, built in the browser from what the card shows. */
export function downloadTable(table: ChartTable, name: string): void {
  const url = URL.createObjectURL(new Blob([tableCsv(table)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
