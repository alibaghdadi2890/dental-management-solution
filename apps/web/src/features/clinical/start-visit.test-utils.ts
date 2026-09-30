import type { LiveVisitRef, Visit } from '@dcm/contracts';
import { DENTIST_ID, id, profileId } from '@/features/patients/patients.test-utils';

/** Test-only: visit fixtures for the start popover, the header pill and the record header. A
 * `liveRef` has run 12 min 05 s at its `serverNow`; a `startedVisit` has just started. */

export const BRANCH = { id: id(70), name: 'Main St' };

export function liveRef(
  n: number,
  patientName: string,
  extra: Partial<LiveVisitRef> = {},
): LiveVisitRef {
  return {
    id: id(n),
    patientId: id(1),
    patientName,
    dentistName: 'Dr. Ana Reyes',
    status: 'in_progress',
    startedAt: '2026-09-04T09:00:00.000Z',
    pausedAt: null,
    pausedSeconds: 0,
    serverNow: '2026-09-04T09:12:05.000Z',
    ...extra,
  };
}

export function startedVisit(n: number, extra: Partial<Visit> = {}): Visit {
  return {
    id: id(n),
    patientId: id(1),
    branchId: BRANCH.id,
    roomId: null,
    dentistId: profileId(DENTIST_ID),
    startedBy: DENTIST_ID,
    status: 'in_progress',
    localDate: '2026-09-04',
    startedAt: '2026-09-04T09:00:00.000Z',
    pausedAt: null,
    pausedSeconds: 0,
    completedAt: null,
    durationMinutes: null,
    notes: '',
    discountMode: 'percent',
    discountValue: '0.00',
    currency: 'USD',
    services: [],
    money: { subtotal: '0.00', discount: '0.00', total: '0.00', capped: false },
    serverNow: '2026-09-04T09:00:00.000Z',
    ...extra,
  };
}
