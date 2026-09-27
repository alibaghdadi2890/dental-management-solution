/**
 * Locale-aware amount-input sanitising, shared by every free-typed money/decimal field in the SPA
 * (the patients feature's opening balance, the catalog's price cells). A person's OS/keyboard may
 * produce Arabic-Indic digits or the Arabic decimal separator (`٫`, U+066B) regardless of the
 * app's own UI locale, and French (among others) uses `,` as its decimal separator and a space as
 * its thousands separator — a plain `[^0-9.]` strip alone silently drops the fraction entirely
 * (`'12,50'` → `'1250'`, a hundred times too large) instead of reading it as `12.50`.
 *
 * Normalises to a plain ASCII decimal string with `.` as the separator and at most two decimal
 * digits (money never has more, CLAUDE.md §7). Leading/trailing dot clean-up (`.5` vs `0.5`) is
 * deliberately left to each caller: `catalog-draft.ts`'s `sanitizePrice` keeps a bare trailing dot
 * while a price is still being typed, `patient-form.ts`'s `sanitizeAmount` does not — that's a
 * per-field UX choice, not part of the locale bug this module fixes.
 */

const ARABIC_INDIC_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

/** The Arabic decimal separator, U+066B — distinct from the Arabic thousands separator, U+066C. */
const ARABIC_DECIMAL_SEPARATOR = '٫';

function toAsciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_INDIC_DIGITS[digit] ?? digit);
}

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
