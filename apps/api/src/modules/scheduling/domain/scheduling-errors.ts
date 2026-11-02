import type { AppointmentConflict, AppointmentStatus } from '@dcm/contracts';
import { DomainError } from '../../../platform/kernel/domain-error';

export class AppointmentNotFoundError extends DomainError {
  readonly code = 'appointment.not_found';
  readonly kind = 'not_found' as const;
  constructor(id: string) {
    super('Appointment not found', { id });
  }
}

export class FollowUpNotFoundError extends DomainError {
  readonly code = 'follow_up.not_found';
  readonly kind = 'not_found' as const;
  constructor(id: string) {
    super('Follow-up not found', { id });
  }
}

/** Someone else booked or closed it first. */
export class FollowUpNotAwaitingError extends DomainError {
  readonly code = 'follow_up.not_awaiting';
  readonly kind = 'conflict' as const;
  constructor(id: string) {
    super('This follow-up is no longer waiting to be booked', { id });
  }
}

export class InvalidAppointmentTransitionError extends DomainError {
  readonly code = 'appointment.invalid_transition';
  readonly kind = 'conflict' as const;
  constructor(from: AppointmentStatus, to: AppointmentStatus) {
    super(`An appointment cannot go from ${from} to ${to}`, { from, to });
  }
}

/** A hard conflict, or a warning the caller has no override for; the body lists them. */
export class AppointmentConflictError extends DomainError {
  readonly code = 'appointment.conflict';
  readonly kind = 'conflict' as const;
  override readonly extensions: Readonly<{ conflicts: readonly AppointmentConflict[] }>;
  constructor(conflicts: readonly AppointmentConflict[]) {
    super('The appointment conflicts with another', { conflicts });
    this.extensions = { conflicts };
  }
}

export class AppointmentIdempotencyMismatchError extends DomainError {
  readonly code = 'appointment.idempotency_mismatch';
  readonly kind = 'conflict' as const;
  constructor() {
    super('This Idempotency-Key was already used for a different request');
  }
}

export class AppointmentInPastError extends DomainError {
  readonly code = 'appointment.in_past';
  readonly kind = 'invalid' as const;
  constructor() {
    super('An appointment cannot start in the past');
  }
}

export class AppointmentInvalidRangeError extends DomainError {
  readonly code = 'appointment.invalid_range';
  readonly kind = 'invalid' as const;
  constructor(message = 'That range is not valid') {
    super(message);
  }
}

export class AppointmentRoomNotInBranchError extends DomainError {
  readonly code = 'appointment.room_not_in_branch';
  readonly kind = 'invalid' as const;
  constructor(roomId: string) {
    super('That room is not an active room of this branch', { roomId });
  }
}

/** The dentist left, or is not in this branch (G16). */
export class AppointmentDentistNotInBranchError extends DomainError {
  readonly code = 'appointment.dentist_not_in_branch';
  readonly kind = 'invalid' as const;
  constructor(dentistId: string) {
    super('That dentist does not work in this branch', { dentistId });
  }
}

export class AppointmentNotForPatientError extends DomainError {
  readonly code = 'appointment.not_for_patient';
  readonly kind = 'invalid' as const;
  constructor(appointmentId: string) {
    super('That appointment is for another patient', { appointmentId });
  }
}

/** The action is not open at this time: a check-in on another day, say (G21). */
export class AppointmentActionUnavailableError extends DomainError {
  readonly code = 'appointment.action_unavailable';
  readonly kind = 'conflict' as const;
  constructor(action: string) {
    super('That action is not available for this appointment now', { action });
  }
}

/** D2: a patient with upcoming appointments is not archived. */
export class PatientHasUpcomingAppointmentsError extends DomainError {
  readonly code = 'patient.has_upcoming_appointments';
  readonly kind = 'conflict' as const;
  override readonly extensions: Readonly<{ patientId: string; patientName: string; count: number }>;
  constructor(patientId: string, patientName: string, count: number) {
    super(`${patientName} has upcoming appointments`, { patientId, count });
    this.extensions = { patientId, patientName, count };
  }
}

/** G14: both records have arrived for the same time; one visit has to end before the merge. */
export class MergeAppointmentsInProgressError extends DomainError {
  readonly code = 'patient.merge_appointments_in_progress';
  readonly kind = 'conflict' as const;
  constructor(patientId: string) {
    super('Both records have an appointment in progress at the same time', { patientId });
  }
}

/** G16: open appointments are moved or closed before their dentist leaves. */
export class StaffHasOpenAppointmentsError extends DomainError {
  readonly code = 'staff.has_open_appointments';
  readonly kind = 'conflict' as const;
  override readonly extensions: Readonly<{ count: number }>;
  constructor(profileId: string, count: number) {
    super('This dentist still has open appointments', { profileId, count });
    this.extensions = { count };
  }
}
