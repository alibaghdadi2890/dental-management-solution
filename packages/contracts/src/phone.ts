import { getCountries, parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { CountryCode } from 'libphonenumber-js/max';
import { toAsciiDigits } from './digits.js';

/**
 * Phone parsing for `patients` (feature 3 Q3) — used for the patient's own `phone` and every
 * contact's `phone` (guardians, billing and emergency contacts), which share this exact function
 * so a fix here (e.g. rejecting extensions) applies to all of them without a separate code path.
 * Built on `libphonenumber-js/max`, the full
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

/**
 * A phone as stored (ADR-0052): `value` is E.164 when the number is valid for the country it
 * resolves to (`normalizePhone`), otherwise the text as typed, spaces collapsed — a clinic keeps
 * numbers the library cannot place. `search` holds the digits a phone search matches: the E.164
 * and national digits of a valid number, the typed digits of any other; null without a digit.
 */
export interface StoredPhone {
  value: string;
  search: string | null;
}

/** The stored form of a typed phone; null for blank text (no phone). */
export function storedPhone(input: string, country: CountryCode): StoredPhone | null {
  const typed = input.trim().replace(/\s+/g, ' ');
  if (typed === '') return null;
  const normalized = normalizePhone(typed, country);
  if (normalized) {
    return {
      value: normalized.e164,
      search: `${phoneDigits(normalized.e164)} ${normalized.national}`,
    };
  }
  const digits = phoneDigits(typed);
  return { value: typed, search: digits === '' ? null : digits };
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
