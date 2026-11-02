import type { AppointmentConflict, OpeningDay } from '@dcm/contracts';
import { type Interval, openingInterval, overlaps, startDateOf } from './intervals';

/** An active appointment the new span is measured against. */
export interface BookedSpan extends Interval {
  dentistId: string;
  patientId: string;
  roomId: string | null;
}

export interface ConflictInput {
  span: Interval;
  dentist: { id: string; name: string };
  patientId: string | null;
  room: { id: string; name: string } | null;
  /** The active appointments around the span, the one being moved left out. */
  others: readonly BookedSpan[];
  hours: readonly OpeningDay[];
  timeZone: string;
}

const conflict = (
  kind: AppointmentConflict['kind'],
  hard: boolean,
  names: { roomName?: string; dentistName?: string } = {},
): AppointmentConflict => ({
  kind,
  hard,
  roomName: names.roomName ?? null,
  dentistName: names.dentistName ?? null,
});

/** Room and patient are refused; dentist and hours are warnings an override passes (ADR-0067). */
export function evaluateConflicts(input: ConflictInput): AppointmentConflict[] {
  const { span, dentist, patientId, room, others, hours, timeZone } = input;
  const overlapping = others.filter((other) => overlaps(span, other));
  const conflicts: AppointmentConflict[] = [];
  if (room && overlapping.some((other) => other.roomId === room.id)) {
    conflicts.push(conflict('room', true, { roomName: room.name }));
  }
  if (patientId && overlapping.some((other) => other.patientId === patientId)) {
    conflicts.push(conflict('patient', true));
  }
  if (overlapping.some((other) => other.dentistId === dentist.id)) {
    conflicts.push(conflict('dentist', false, { dentistName: dentist.name }));
  }
  const opening = openingInterval(startDateOf(span, timeZone), hours, timeZone);
  if (opening === null) {
    conflicts.push(conflict('closed_day', false));
  } else if (span.start < opening.start || span.end > opening.end) {
    conflicts.push(conflict('outside_hours', false));
  }
  return conflicts;
}

export const hardConflicts = (conflicts: readonly AppointmentConflict[]): AppointmentConflict[] =>
  conflicts.filter((item) => item.hard);

export const softConflicts = (conflicts: readonly AppointmentConflict[]): AppointmentConflict[] =>
  conflicts.filter((item) => !item.hard);
