import type { ConflictKind, OpeningDay } from '@dcm/contracts';
import { zonedInstant } from '../../../platform/kernel/local-date';
import { type Interval, openingInterval, overlapsAny, plusMinutes } from './intervals';

const DAY_MINUTES = 1440;

export interface DaySlotInput {
  date: string;
  hours: readonly OpeningDay[];
  timeZone: string;
  durationMin: number;
  /** Starts sit on this grid of the local day. */
  stepMin: number;
  now: Date;
  /** Every list a span must stay clear of: today the dentist's and the patient's appointments. */
  busy: readonly (readonly Interval[])[];
  /** Move mode: every other start too, with what an override would go through. */
  warnedBusy?: readonly Interval[];
  includeWarnings?: boolean;
}

export interface FoundSlot extends Interval {
  warnings: ConflictKind[];
}

const clockOf = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * One day's bookable starts: opening hours minus the busy lists, on the grid, never in the past. A
 * later dentist schedule is one more list (ADR-0068). Starts come from the local clock, so the grid
 * survives a DST change; a clock time skipped by the change is dropped.
 */
export function daySlots(input: DaySlotInput): FoundSlot[] {
  const { date, hours, timeZone, durationMin, stepMin, now, busy, warnedBusy = [] } = input;
  const opening = openingInterval(date, hours, timeZone);
  if (opening === null && !input.includeWarnings) return [];
  const slots: FoundSlot[] = [];
  const seen = new Set<number>();
  for (let minutes = 0; minutes < DAY_MINUTES; minutes += stepMin) {
    const start = zonedInstant(date, clockOf(minutes), timeZone);
    if (seen.has(start.getTime())) continue;
    seen.add(start.getTime());
    const span = { start, end: plusMinutes(start, durationMin) };
    if (start < now || busy.some((list) => overlapsAny(span, list))) continue;
    const warnings: ConflictKind[] = [];
    if (overlapsAny(span, warnedBusy)) warnings.push('dentist');
    if (opening === null) warnings.push('closed_day');
    else if (start < opening.start || span.end > opening.end) warnings.push('outside_hours');
    if (warnings.length === 0 || input.includeWarnings) slots.push({ ...span, warnings });
  }
  return slots;
}
