/**
 * Calendar/age arithmetic for `patients` (feature 3). No I/O, no time zone, no `Date` objects —
 * every date is an ISO `YYYY-MM-DD` string and every "today" is passed in by the caller, already
 * resolved to the tenant's time zone (CLAUDE.md §5, §8). Split out of `patients.ts` so the pure
 * calendar math has a home separate from the request/response schemas.
 */

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parseIsoDate(date: string): DateParts {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

function formatIsoDate(parts: DateParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 31;
}

/** Whole years from `dob` to `today`. A Feb-29 birthday turns a year older on Mar 1 (non-leap). */
export function ageOn(dob: string, today: string): number {
  const birth = parseIsoDate(dob);
  const current = parseIsoDate(today);
  let age = current.year - birth.year;
  const hasHadBirthdayThisYear =
    current.month > birth.month || (current.month === birth.month && current.day >= birth.day);
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

export const DENTITION_STAGES = ['primary', 'mixed', 'permanent'] as const;
export type DentitionStage = (typeof DENTITION_STAGES)[number];

/** `primary` 0–5, `mixed` 6–12, `permanent` 13+ (README §Patients age·sex column). */
export function dentitionStage(age: number): DentitionStage {
  if (age <= 5) return 'primary';
  if (age <= 12) return 'mixed';
  return 'permanent';
}

const ADULT_AGE = 18;
const SENIOR_AGE = 65;

export function isMinor(dob: string, today: string): boolean {
  return ageOn(dob, today) < ADULT_AGE;
}

export const AGE_BANDS = ['child', 'adult', 'senior'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Subtracts whole years, clamping Feb 29 to Feb 28 when the target year is not a leap year. */
function subtractYears(parts: DateParts, years: number): DateParts {
  const year = parts.year - years;
  const day = Math.min(parts.day, daysInMonth(year, parts.month));
  return { year, month: parts.month, day };
}

export interface AgeBandBounds {
  /** Dob must be strictly after this date (exclusive lower age bound). */
  after?: string;
  /** Dob must be on or before this date (inclusive upper age bound). */
  onOrBefore?: string;
}

/**
 * The date-of-birth range such that `dob` falls in it iff `ageOn(dob, today)` falls in `band`
 * (design: "child: after = today−18y; adult: onOrBefore = today−18y, after = today−65y; senior:
 * onOrBefore = today−65y"). Consistent with `ageOn` at the Feb-29 boundary by construction.
 */
export function ageBandBounds(band: AgeBand, today: string): AgeBandBounds {
  const parts = parseIsoDate(today);
  const adultThreshold = formatIsoDate(subtractYears(parts, ADULT_AGE));
  const seniorThreshold = formatIsoDate(subtractYears(parts, SENIOR_AGE));
  switch (band) {
    case 'child':
      return { after: adultThreshold };
    case 'adult':
      return { onOrBefore: adultThreshold, after: seniorThreshold };
    case 'senior':
      return { onOrBefore: seniorThreshold };
  }
}
