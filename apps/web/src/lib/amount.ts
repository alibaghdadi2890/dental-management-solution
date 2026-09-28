import { toAsciiDigits } from '@dcm/contracts';

/**
 * Locale-aware reading of typed amounts: `sanitizeAmountInput` for fields that clean as you type
 * (the catalog's price cells), `parseAmount` for fields that must refuse rather than clean (the
 * patients feature's opening balance). A person's OS/keyboard may
 * produce Arabic-Indic digits or the Arabic decimal separator (`٫`, U+066B) regardless of the
 * app's own UI locale, and French (among others) uses `,` as its decimal separator and a space as
 * its thousands separator — a plain `[^0-9.]` strip alone silently drops the fraction entirely
 * (`'12,50'` → `'1250'`, a hundred times too large) instead of reading it as `12.50`.
 *
 * Normalises to a plain ASCII decimal string with `.` as the separator and at most two decimal
 * digits (money never has more, CLAUDE.md §7). `sanitizeAmountInput` leaves leading/trailing dot
 * clean-up (`.5` vs `0.5`) to its caller: `catalog-draft.ts`'s `sanitizePrice` keeps a bare
 * trailing dot while a price is still being typed.
 */

/** The Arabic decimal separator, U+066B — distinct from the Arabic thousands separator, U+066C. */
const ARABIC_DECIMAL_SEPARATOR = '٫';
const ARABIC_GROUP_SEPARATOR = '٬';

function decimalSeparatorFor(locale: string): string {
  const part = new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal');
  return part?.value ?? '.';
}

/** Keeps digits and a single `.`, at most two decimals after it — the shared core every caller's
 * own sanitizer builds on. */
export function sanitizeAmountInput(text: string, locale: string): string {
  const separator = decimalSeparatorFor(locale);
  let normalized = toAsciiDigits(text).replaceAll(ARABIC_DECIMAL_SEPARATOR, '.');
  if (separator !== '.') {
    normalized = normalized.split(separator).join('.');
  }
  const cleaned = normalized.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  const decimals = cleaned
    .slice(dot + 1)
    .replace(/\./g, '')
    .slice(0, 2);
  return `${cleaned.slice(0, dot)}.${decimals}`;
}

function groupSeparatorFor(locale: string): string {
  const part = new Intl.NumberFormat(locale).formatToParts(1000).find((p) => p.type === 'group');
  return part?.value ?? ',';
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A typed amount read strictly for `locale`, as a plain ASCII decimal (`'1 234,50'` in French →
 * `'1234.50'`), `''` for blank input, and `null` for anything that isn't a clean number: letters,
 * a symbol, a third decimal, a misplaced group separator. Unlike `sanitizeAmountInput`, nothing
 * typed is dropped — a field using this can flag the input rather than save something else.
 * Arabic-Indic digits and the Arabic separators are read as well; `.` is accepted as the decimal
 * separator too wherever it isn't the locale's group separator, and in a locale grouping with the
 * Arabic `٬`, ASCII `,` groups as well (`1,234.50` in `ar-EG` → `'1234.50'`).
 */
export function parseAmount(text: string, locale: string): string | null {
  const decimal = decimalSeparatorFor(locale);
  const group = groupSeparatorFor(locale);
  const spaceGroup = /\s/.test(group);
  // An Arabic-digit locale's keyboard may still type ASCII `1,234.50`: `,` groups there too.
  const asciiComma = group === ARABIC_GROUP_SEPARATOR ? group : ',';
  const normalized = toAsciiDigits(text.trim())
    .replaceAll(ARABIC_DECIMAL_SEPARATOR, decimal)
    .replaceAll(ARABIC_GROUP_SEPARATOR, group)
    .replaceAll(',', asciiComma)
    .replace(/\s/g, spaceGroup ? ' ' : '\u0000');
  if (normalized === '') return '';

  const decimals = decimal === '.' || group === '.' ? escape(decimal) : `[${escape(decimal)}.]`;
  const groups = spaceGroup ? ' ' : escape(group);
  const plain = new RegExp(`^(\\d*)(?:${decimals}(\\d{0,2}))?$`);
  const grouped = new RegExp(`^(\\d{1,3}(?:${groups}\\d{3})+)(?:${decimals}(\\d{0,2}))?$`);
  const match = plain.exec(normalized) ?? grouped.exec(normalized);
  if (!match) return null;

  const whole = (match[1] ?? '').replace(/\D/g, '');
  const fraction = match[2] ?? '';
  if (whole === '' && fraction === '') return null;
  return fraction === '' ? whole : `${whole || '0'}.${fraction}`;
}
