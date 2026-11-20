import { FOLLOW_UP_KIND_DEFAULTS, type FollowUp } from '@dcm/contracts';
import type { WaitlistEntryDraft } from './waitlist-entry-panel';

/** *Add to waitlist* on an awaiting follow-up (A4): pre-filled from it and linked to it. */
export function followUpDraft(followUp: FollowUp): WaitlistEntryDraft {
  return {
    source: 'follow_up',
    patient: {
      id: followUp.patientId,
      fullName: followUp.patientName,
      meta: followUp.patientDisplayNumber,
    },
    dentistId:
      followUp.preferredDentistId && followUp.preferredDentistAvailable
        ? followUp.preferredDentistId
        : undefined,
    reason: followUp.title,
    visitType: FOLLOW_UP_KIND_DEFAULTS[followUp.kind].visitType,
    durationMin: followUp.durationMin,
    planIds: followUp.planIds,
    followUpId: followUp.id,
  };
}
