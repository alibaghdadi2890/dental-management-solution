import { WAITLIST_GRID_MIN } from '@dcm/contracts';
import { localDate, zonedInstant } from '../../../platform/kernel/local-date';
import { type Interval, overlaps, overlapsAny, plusMinutes, weekdayOf } from './intervals';
import type { Opening } from './openings';

/** What the fit reads of a waiting, unexpired entry (B2). */
export interface FitEntry {
  id: string;
  branchId: string;
  /** Null is *Any dentist*. */
  dentistId: string | null;
  durationMin: number;
  /** 0 is Sunday; empty is any day. */
  weekdays: readonly number[];
  /** `HH:MM`, both or neither. */
  betweenFrom: string | null;
  betweenTo: string | null;
  notBefore: string | null;
  sameDay: boolean;
  /** Without an appointment: the last day. */
  until: string | null;
  /** The appointment it brings forward: an opening must start earlier. */
  appointmentStart: Date | null;
  /** The patient's other active appointments, the one brought forward left out. */
  patientBusy: readonly Interval[];
}

export interface FitContext {
  branchId: string;
  timeZone: string;
  /** The clinic-local date now. */
  today: string;
}

const DAY_MINUTES = 1440;

const clockOf = (total: number): string =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/** The local day's 15-minute grid: from the local clock, so a DST change keeps it. */
function gridOf(date: string, timeZone: string): Date[] {
  const seen = new Set<number>();
  const starts: Date[] = [];
  for (let total = 0; total < DAY_MINUTES; total += WAITLIST_GRID_MIN) {
    const start = zonedInstant(date, clockOf(total), timeZone);
    if (seen.has(start.getTime()) || localDate(start, timeZone) !== date) continue;
    seen.add(start.getTime());
    starts.push(start);
  }
  return starts;
}

/** The day-level rules of B2: branch, dentist, today, days, not before, until. */
function dayFits(entry: FitEntry, opening: Opening, context: FitContext): boolean {
  if (entry.branchId !== context.branchId) return false;
  if (entry.dentistId !== null && entry.dentistId !== opening.dentistId) return false;
  if (opening.date === context.today && !entry.sameDay) return false;
  if (entry.weekdays.length > 0 && !entry.weekdays.includes(weekdayOf(opening.date))) return false;
  if (entry.notBefore !== null && opening.date < entry.notBefore) return false;
  if (entry.until !== null && opening.date > entry.until) return false;
  return true;
}

/**
 * Every start the entry may take in the opening (B2), the freed slot's own start first, then in
 * order: at a freed part's start or on the grid, the whole appointment inside the opening, on part
 * of the freed time, inside *Between*, before the appointment it brings forward, clear of the
 * patient's other appointments. Empty: it does not fit.
 */
export function startsFor(entry: FitEntry, opening: Opening, context: FitContext): Date[] {
  if (!dayFits(entry, opening, context)) return [];
  const { timeZone } = context;
  const between =
    entry.betweenFrom !== null && entry.betweenTo !== null
      ? {
          start: zonedInstant(opening.date, entry.betweenFrom, timeZone),
          end: zonedInstant(opening.date, entry.betweenTo, timeZone),
        }
      : null;
  const freedStarts = opening.freed.map((part) => part.start);
  const candidates = [...freedStarts, ...gridOf(opening.date, timeZone)];
  const seen = new Set<number>();
  const starts: Date[] = [];
  for (const start of candidates) {
    if (seen.has(start.getTime())) continue;
    seen.add(start.getTime());
    const span = { start, end: plusMinutes(start, entry.durationMin) };
    if (span.start < opening.start || span.end > opening.end) continue;
    if (!opening.freed.some((part) => overlaps(span, part))) continue;
    if (between && (span.start < between.start || span.end > between.end)) continue;
    if (entry.appointmentStart !== null && span.start >= entry.appointmentStart) continue;
    if (overlapsAny(span, entry.patientBusy)) continue;
    starts.push(start);
  }
  const [first, ...rest] = starts;
  if (first === undefined) return [];
  // The freed slot's start, when it is one of them, stays first; the rest in time order.
  const freedFirst = freedStarts.some((start) => start.getTime() === first.getTime());
  return freedFirst
    ? [first, ...rest.sort((a, b) => a.getTime() - b.getTime())]
    : starts.sort((a, b) => a.getTime() - b.getTime());
}
