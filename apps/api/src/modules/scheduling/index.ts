// Public API of the scheduling module. Other modules import from this file only (CLAUDE.md §4).
export { SchedulingModule } from './scheduling.module';
export { type AppointmentRef, AppointmentsService } from './application/appointments.service';
export {
  APPOINTMENT_BOOKED,
  APPOINTMENT_CANCELLED,
  APPOINTMENT_COMPLETED,
  APPOINTMENT_MARKED_NO_SHOW,
  APPOINTMENT_RESCHEDULED,
  type AppointmentBooked,
  type AppointmentCompleted,
  type AppointmentMarkedNoShow,
  type AppointmentRescheduled,
  APPOINTMENT_CHECK_IN_UNDONE,
  APPOINTMENT_CHECKED_IN,
  APPOINTMENT_RESTORED,
  type AppointmentCancelled,
  type AppointmentCheckInUndone,
  type AppointmentCheckedIn,
  type AppointmentRestored,
} from './events/scheduling-events';
