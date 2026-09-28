const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/**
 * Arabic-Indic (`٠`–`٩`, U+0660–0669) and Extended Arabic-Indic (`۰`–`۹`, U+06F0–06F9, Persian
 * and Urdu keyboards) digits as ASCII `0`–`9`; everything else unchanged. A person's keyboard may
 * type these whatever the app's own language, so anything read as a number — a phone search, an
 * amount — maps them first.
 */
export function toAsciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const zero =
      code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO;
    return String(code - zero);
  });
}
