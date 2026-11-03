// Public API of the scheduling module. Other modules import from this file only (CLAUDE.md §4).
export { SchedulingModule } from './scheduling.module';
export { AppointmentsService } from './application/appointments.service';
export {
  APPOINTMENT_CANCELLED,
  APPOINTMENT_CHECK_IN_UNDONE,
  APPOINTMENT_CHECKED_IN,
  type AppointmentCancelled,
  type AppointmentCheckInUndone,
  type AppointmentCheckedIn,
} from './events/scheduling-events';
