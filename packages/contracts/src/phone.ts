import { getCountries, parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { CountryCode } from 'libphonenumber-js/max';
import { toAsciiDigits } from './digits.js';

/**
 * Phone parsing for `patients` (feature 3 Q3) — used for both the patient's own `phone` and
 * `guardianPhone`, which share this exact function so a fix here (e.g. rejecting extensions)
 * applies to both without a separate code path. Built on `libphonenumber-js/max`, the full
 * metadata build: validity (not just "looks like a number") matters here because balances,
 * reminders and SMS/WhatsApp delivery (feature 6+) depend on a dialable number. Pure; no I/O.
 */

export interface NormalizedPhone {
  /** E.164, the stored form (`+9613123456`). */
  e164: string;
  /** National-format digits only, including the trunk prefix (`03123456`). */
  national: string;
}

/**
 * Parses a phone number as typed against the tenant's country. A leading `+` is honoured as
 * typed (an international number for a different country). Returns `null` when the number is
 * not a valid number for the country it resolves to, or when it carries an extension (an
 * extension isn't part of a dialable E.164 number and the create/edit form has no field for it).
 */
export function normalizePhone(input: string, country: CountryCode): NormalizedPhone | null {
  const phoneNumber = parsePhoneNumberFromString(input, country);
  if (!phoneNumber || !phoneNumber.isValid() || phoneNumber.ext) return null;
  return {
    e164: phoneNumber.number,
    national: phoneDigits(phoneNumber.formatNational()),
  };
}

/** Formats a stored E.164 number for display, e.g. `+9613123456` → `+961 3 123 456`. */
export function formatPhone(e164: string): string {
  const phoneNumber = parsePhoneNumberFromString(e164);
  return phoneNumber ? phoneNumber.formatInternational() : e164;
}

/**
 * Formats a stored E.164 number for a tenant: numbers of the tenant's own country in national
 * format (`+9613123456` → `03 123 456`, how staff type and read them), others in international
 * format (`+33612345678` → `+33 6 12 34 56 78`). Unparseable input is returned unchanged.
 */
export function formatPhoneFor(e164: string, country: CountryCode): string {
  const phoneNumber = parsePhoneNumberFromString(e164);
  if (!phoneNumber) return e164;
  return phoneNumber.country === country
    ? phoneNumber.formatNational()
    : phoneNumber.formatInternational();
}

/** Strips everything but digits, for matching a typed search query against `phone_search`.
 * Arabic-Indic digits count as digits (`٠٣١٢` → `0312`). */
export function phoneDigits(query: string): string {
  return toAsciiDigits(query).replace(/\D/g, '');
}

/**
 * Every ISO 3166-1 alpha-2 country `libphonenumber-js/max` has dialling data for — the same set
 * `countrySchema` (`common.ts`) accepts. The one place the web app needs this list, so it re-uses
 * this build instead of adding its own `libphonenumber-js` dependency (feature 3 Q3).
 */
export const SUPPORTED_COUNTRIES: readonly CountryCode[] = getCountries();
