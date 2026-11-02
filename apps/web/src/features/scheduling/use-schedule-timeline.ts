import { type Appointment, type FollowUp, isActiveAppointment } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { usePermission } from '@/features/auth/use-permission';
import { patientAppointmentsQuery, patientFollowUpsQuery } from './scheduling-api';

export type TimelineEntry =
  | { kind: 'appointment'; key: string; date: string; appointment: Appointment }
  | { kind: 'followUp'; key: string; date: string; followUp: FollowUp };

export interface ScheduleTimeline {
  upcoming: Appointment[];
  /** The appointments that ended in a visit: each folds into its visit's row (A18). */
  completed: ReadonlyMap<string, Appointment>;
  /** What the timeline adds to the visits: muted appointments, and the follow-ups. */
  entries: TimelineEntry[];
}

/** A patient's appointments and follow-ups, as Visits & history shows them (A18). */
export function useScheduleTimeline(patientId: string): ScheduleTimeline {
  const canRead = usePermission('appointment:read');
  const appointments = useQuery(patientAppointmentsQuery(patientId, canRead));
  const followUps = useQuery(patientFollowUpsQuery(patientId, canRead));
  const rows = appointments.data ?? [];
  return {
    upcoming: rows
      .filter((item) => isActiveAppointment(item.status))
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    completed: new Map(
      rows.filter((item) => item.status === 'completed').map((item) => [item.id, item]),
    ),
    entries: [
      ...rows
        .filter((item) => !isActiveAppointment(item.status) && item.status !== 'completed')
        .map((appointment): TimelineEntry => ({
          kind: 'appointment',
          key: appointment.id,
          date: appointment.localDate,
          appointment,
        })),
      ...(followUps.data ?? []).map((followUp): TimelineEntry => ({
        kind: 'followUp',
        key: followUp.id,
        date: followUp.visitDate,
        followUp,
      })),
    ],
  };
}
