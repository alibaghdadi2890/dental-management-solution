import { SUPPORTED_COUNTRIES, TENANT_DEFAULTS } from '@dcm/contracts';

/** Every IANA zone the browser knows, with the D8 default first. */
export const TIME_ZONES: readonly string[] = [
  TENANT_DEFAULTS.timeZone,
  ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== TENANT_DEFAULTS.timeZone),
];

/** Currencies offered in the tenant forms (one currency per tenant, D8). USD is the default. */
export const CURRENCIES: readonly string[] = [
  'USD',
  'EUR',
  'GBP',
  'LBP',
  'AED',
  'SAR',
  'QAR',
  'KWD',
  'BHD',
  'OMR',
  'JOD',
  'EGP',
  'IQD',
  'TRY',
  'MAD',
  'DZD',
  'TND',
  'CAD',
  'AUD',
  'CHF',
];

/** A country option for a select: its code and a locale-appropriate display label. */
export interface CountryOption {
  code: string;
  label: string;
}

/**
 * Every country `libphonenumber-js` has dialling data for (re-exported from `@dcm/contracts` so
 * only that package depends on the library), labelled in `locale` and sorted by that label with a
 * single collator instance. Pure and side-effect free so it's cheap to unit test directly; the UI
 * caches its result per locale (`useCountryOptions` in `country-select.tsx`).
 */
export function countryOptions(locale: string): CountryOption[] {
  const displayNames = new Intl.DisplayNames([locale], { type: 'region' });
  const collator = new Intl.Collator(locale);
  return SUPPORTED_COUNTRIES.map((code) => ({
    code,
    // `.of()` is typed `string | undefined`, but every code in `SUPPORTED_COUNTRIES` is one
    // `Intl.DisplayNames` recognises, and its default `fallback: 'code'` guarantees a string back
    // (the code itself) rather than `undefined`. The `?? code` branch is therefore unreachable in
    // practice; it's kept only to satisfy the declared return type.
    label: displayNames.of(code) ?? code,
  })).sort((a, b) => collator.compare(a.label, b.label));
}
