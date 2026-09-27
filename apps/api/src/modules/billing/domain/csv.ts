/**
 * CSV writing for the patient export (design Q4): RFC 4180 fields and CRLF line ends, plus a
 * guard against CSV injection. Pure: strings in, strings out.
 */

/** RFC 4180 line end. */
export const CSV_EOL = '\r\n';

/** Written once at the start of a file so Excel reads it as UTF-8 (Arabic, accents). */
export const UTF8_BOM = '\uFEFF';

/**
 * A spreadsheet treats a cell starting with one of these as a formula (OWASP CSV injection),
 * including their full-width forms (U+FF1D ＝, U+FF0B ＋, U+FF0D －, U+FF20 ＠), which some
 * spreadsheets normalise, and even behind leading whitespace.
 */
const TRIGGERS = new Set([
  '=',
  '+',
  '-',
  '@',
  ...[0xff1d, 0xff0b, 0xff0d, 0xff20].map((code) => String.fromCharCode(code)),
]);

/** Tab, CR and LF start a formula-bearing cell on their own (they are also whitespace). */
const CONTROL_START = /^[\t\r\n]/;

function looksLikeFormula(value: string): boolean {
  return CONTROL_START.test(value) || TRIGGERS.has(value.trimStart().charAt(0));
}

/** A plain signed decimal (`-50.00`, `34`): safe as a number, whatever its sign. */
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

const NEEDS_QUOTES = /[",\r\n]/;

export interface CsvRowOptions {
  /**
   * Indexes of the columns written from numbers (amounts, counts). A decimal string there keeps
   * its leading `-` instead of being guarded; anything else there is guarded as usual.
   */
  numericColumns?: readonly number[];
}

function csvCell(value: string, numeric: boolean): string {
  const exempt = numeric && DECIMAL.test(value);
  const guarded = looksLikeFormula(value) && !exempt ? `'${value}` : value;
  return NEEDS_QUOTES.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/**
 * One CSV line, terminated by CRLF. A cell starting with tab, CR or LF, or whose first
 * non-whitespace character is `=`, `+`, `-`, `@` (or a full-width form), is prefixed with `'` so
 * a spreadsheet shows it as text instead of running it — except a decimal string in a numeric
 * column. Then a cell containing a comma, a quote, CR or LF is quoted, with quotes doubled.
 */
export function csvRow(cells: readonly string[], options: CsvRowOptions = {}): string {
  const numeric = new Set(options.numericColumns);
  return cells.map((cell, index) => csvCell(cell, numeric.has(index))).join(',') + CSV_EOL;
}
