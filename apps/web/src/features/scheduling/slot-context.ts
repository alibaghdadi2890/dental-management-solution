import {
  type Appointment,
  FOLLOW_UP_KIND_DEFAULTS,
  type FollowUp,
  followUpSearchWindow,
} from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { addDays } from './schedule-time';
import type { SlotRequestContext } from './slot-finder';

/** What the finder needs to book a follow-up. */
export function useFollowUpContext(): (followUp: FollowUp, today: string) => SlotRequestContext {
  const { t } = useTranslation('scheduling');
  return (followUp, today) => {
    const window = followUpSearchWindow(followUp, today);
    return {
      patientId: followUp.patientId,
      patientName: followUp.patientName,
      reason: followUp.title,
      visitType: FOLLOW_UP_KIND_DEFAULTS[followUp.kind].visitType,
      durationMin: followUp.durationMin,
      dentistId: followUp.preferredDentistId,
      pickDentist: !followUp.preferredDentistAvailable,
      from: window.from,
      to: window.to,
      timingLabel: t(`timings.${followUp.timing}`),
      planIds: followUp.planIds,
      followUpId: followUp.id,
      invalidReason: followUp.invalidReason,
      recommender: followUp.recommendedByName,
    };
  };
}

/** What the finder needs to move an appointment (A9: from the worklist or the record). */
export function moveContext(appointment: Appointment, today: string): SlotRequestContext {
  return {
    patientId: appointment.patient.id,
    patientName: appointment.patient.fullName,
    reason: appointment.reason,
    visitType: appointment.visitType,
    durationMin: (Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000,
    dentistId: appointment.dentistId,
    from: today,
    to: addDays(today, 14),
    timingLabel: '',
    rescheduleId: appointment.id,
  };
}
