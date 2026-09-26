import { TENANT_DEFAULTS } from '@dcm/contracts';

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
