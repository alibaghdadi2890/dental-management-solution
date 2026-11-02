import { type AppointmentConflict, appointmentConflictSchema } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/lib/api';

/** The conflicts' words, one place for the panel, the drag and the slot finder. */
export function useConflictWords() {
  const { t } = useTranslation('scheduling');
  return {
    needsOverride: t('conflicts.needsOverride'),
    of: (conflict: AppointmentConflict): string => {
      switch (conflict.kind) {
        case 'room':
          return conflict.roomName
            ? t('conflicts.room', { room: conflict.roomName })
            : t('conflicts.roomTaken');
        case 'patient':
          return t('conflicts.patient');
        case 'dentist':
          return t('conflicts.dentist', { dentist: conflict.dentistName ?? '' });
        case 'outside_hours':
          return t('conflicts.outsideHours');
        case 'closed_day':
          return t('conflicts.closedDay');
      }
    },
  };
}

/** The conflicts a 409 listed, when it listed any. */
export function conflictsOf(error: unknown): AppointmentConflict[] {
  if (!(error instanceof ApiError) || error.code !== 'appointment.conflict') return [];
  const parsed = appointmentConflictSchema.array().safeParse(error.problem.conflicts);
  return parsed.success ? parsed.data : [];
}
