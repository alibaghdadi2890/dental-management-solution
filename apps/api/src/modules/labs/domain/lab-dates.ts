import { addDays, daysBetween, type LabItemTarget } from '@dcm/contracts';

/**
 * Lab dates (B3, D8) in calendar days and the clinic's local dates (`YYYY-MM-DD`): the caller turns
 * "now" into the clinic's today first.
 */

/** The expected wait: the longest item turnaround, else the lab's standard (B1). */
export function defaultExpectedDays(
  labTurnaround: number,
  itemTurnarounds: readonly (number | null)[],
): number {
  const known = itemTurnarounds.filter((days): days is number => days !== null);
  return known.length > 0 ? Math.max(...known) : labTurnaround;
}

/** Sent date + expected wait (B3, O3). */
export const expectedOn = (sentOn: string, expectedDays: number): string =>
  addDays(sentOn, expectedDays);

/** At the lab and today past the expected date; never on hold (B3). */
export function isLate(status: string, expected: string | null, today: string): boolean {
  return status === 'at_lab' && expected !== null && today > expected;
}

/**
 * The first day after `today` the branch is open (D8): `openWeekdays` holds 0 (Sunday) to 6. With
 * no open weekday at all, tomorrow.
 */
export function nextOpenDay(today: string, openWeekdays: ReadonlySet<number>): string {
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = addDays(today, offset);
    if (openWeekdays.has(new Date(`${day}T00:00:00Z`).getUTCDay())) return day;
  }
  return addDays(today, 1);
}

/**
 * A corrected sent date moves the promised and expected dates by the same days (D2): the
 * turnaround promised did not change.
 */
export function shiftTripDates(
  trip: { sentOn: string; promisedOn: string; expectedOn: string },
  sentOn: string,
): { sentOn: string; promisedOn: string; expectedOn: string } {
  const shift = daysBetween(trip.sentOn, sentOn);
  return {
    sentOn,
    promisedOn: addDays(trip.promisedOn, shift),
    expectedOn: addDays(trip.expectedOn, shift),
  };
}

/** Teeth only for the `teeth` target; an arch target carries none. */
export function teethFor(target: LabItemTarget, teeth: readonly string[]): string[] {
  return target === 'teeth' ? [...teeth] : [];
}
