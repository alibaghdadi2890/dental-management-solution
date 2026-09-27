import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import type { CountryCode } from 'libphonenumber-js/min';

/**
 * Phone parsing for `patients` (feature 3 Q3). Built on `libphonenumber-js/min`, the trimmed
 * metadata build — country dialling plans and validity, no carrier/geocoding data. Pure; no I/O.
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
 * not a valid number for the country it resolves to.
 */
export function normalizePhone(input: string, country: CountryCode): NormalizedPhone | null {
  const phoneNumber = parsePhoneNumberFromString(input, country);
  if (!phoneNumber || !phoneNumber.isValid()) return null;
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

/** Strips everything but digits, for matching a typed search query against `phone_search`. */
export function phoneDigits(query: string): string {
  return query.replace(/\D/g, '');
}
