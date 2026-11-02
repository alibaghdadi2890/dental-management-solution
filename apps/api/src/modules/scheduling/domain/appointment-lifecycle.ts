import type { AppointmentStatus } from '@dcm/contracts';
import { InvalidAppointmentTransitionError } from './scheduling-errors';

/**
 * The appointment state machine (CLAUDE.md §8, ADR-0066). `in_room` from `booked` or `confirmed` is
 * the implicit check-in of a visit started from the appointment; `checked_in → confirmed` is Undo
 * check-in; `in_room → checked_in` is a discarded visit.
 */
const TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  booked: ['confirmed', 'checked_in', 'in_room', 'cancelled', 'no_show', 'rescheduled'],
  confirmed: ['checked_in', 'in_room', 'cancelled', 'no_show', 'rescheduled'],
  checked_in: ['confirmed', 'in_room'],
  in_room: ['checked_in', 'completed'],
  completed: [],
  cancelled: [],
  no_show: [],
  rescheduled: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidAppointmentTransitionError(from, to);
  }
}

/** Derived, never stored: still waiting for the patient after the time has passed. */
export function isUnresolved(status: AppointmentStatus, endsAt: Date, now: Date): boolean {
  return (status === 'booked' || status === 'confirmed') && endsAt < now;
}
