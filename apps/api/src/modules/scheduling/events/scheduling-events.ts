import type { ConflictKind } from '@dcm/contracts';
import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Events `scheduling` emits (A20; CLAUDE.md §9: ids and minimal facts). The generic audit subscriber
 * records each one; nothing consumes them yet (`notifications` will).
 */

interface AppointmentFacts {
  appointmentId: string;
  patientId: string;
}

export const APPOINTMENT_BOOKED = 'AppointmentBooked';
export type AppointmentBooked = DomainEvent<
  typeof APPOINTMENT_BOOKED,
  AppointmentFacts & { dentistId: string; overridden: ConflictKind[] }
>;

export const APPOINTMENT_CONFIRMED = 'AppointmentConfirmed';
export type AppointmentConfirmed = DomainEvent<typeof APPOINTMENT_CONFIRMED, AppointmentFacts>;

export const APPOINTMENT_CHECKED_IN = 'AppointmentCheckedIn';
export type AppointmentCheckedIn = DomainEvent<typeof APPOINTMENT_CHECKED_IN, AppointmentFacts>;

export const APPOINTMENT_CHECK_IN_UNDONE = 'AppointmentCheckInUndone';
export type AppointmentCheckInUndone = DomainEvent<
  typeof APPOINTMENT_CHECK_IN_UNDONE,
  AppointmentFacts
>;

export const APPOINTMENT_RESCHEDULED = 'AppointmentRescheduled';
export type AppointmentRescheduled = DomainEvent<
  typeof APPOINTMENT_RESCHEDULED,
  AppointmentFacts & { fromAppointmentId: string; overridden: ConflictKind[] }
>;

export const APPOINTMENT_RESIZED = 'AppointmentResized';
export type AppointmentResized = DomainEvent<
  typeof APPOINTMENT_RESIZED,
  AppointmentFacts & { overridden: ConflictKind[] }
>;

export const APPOINTMENT_ROOM_CHANGED = 'AppointmentRoomChanged';
export type AppointmentRoomChanged = DomainEvent<
  typeof APPOINTMENT_ROOM_CHANGED,
  AppointmentFacts & { roomId: string | null }
>;

export const APPOINTMENT_CANCELLED = 'AppointmentCancelled';
export type AppointmentCancelled = DomainEvent<typeof APPOINTMENT_CANCELLED, AppointmentFacts>;

export const APPOINTMENT_MARKED_NO_SHOW = 'AppointmentMarkedNoShow';
export type AppointmentMarkedNoShow = DomainEvent<
  typeof APPOINTMENT_MARKED_NO_SHOW,
  AppointmentFacts
>;

export const APPOINTMENT_STARTED = 'AppointmentStarted';
export type AppointmentStarted = DomainEvent<
  typeof APPOINTMENT_STARTED,
  AppointmentFacts & { visitId: string }
>;

export const APPOINTMENT_COMPLETED = 'AppointmentCompleted';
export type AppointmentCompleted = DomainEvent<
  typeof APPOINTMENT_COMPLETED,
  AppointmentFacts & { visitId: string }
>;

interface FollowUpFacts {
  followUpId: string;
  patientId: string;
}

export const FOLLOW_UP_RECOMMENDED = 'FollowUpRecommended';
export type FollowUpRecommended = DomainEvent<
  typeof FOLLOW_UP_RECOMMENDED,
  FollowUpFacts & { visitId: string }
>;

export const FOLLOW_UP_BOOKED = 'FollowUpBooked';
export type FollowUpBooked = DomainEvent<
  typeof FOLLOW_UP_BOOKED,
  FollowUpFacts & { appointmentId: string }
>;

export const FOLLOW_UP_REOPENED = 'FollowUpReopened';
export type FollowUpReopened = DomainEvent<typeof FOLLOW_UP_REOPENED, FollowUpFacts>;

export const FOLLOW_UP_TAGGED = 'FollowUpTagged';
export type FollowUpTagged = DomainEvent<typeof FOLLOW_UP_TAGGED, FollowUpFacts>;

export const FOLLOW_UP_DECLINED = 'FollowUpDeclined';
export type FollowUpDeclined = DomainEvent<typeof FOLLOW_UP_DECLINED, FollowUpFacts>;

export const OPENING_HOURS_CHANGED = 'OpeningHoursChanged';
export type OpeningHoursChanged = DomainEvent<typeof OPENING_HOURS_CHANGED, { branchId: string }>;
