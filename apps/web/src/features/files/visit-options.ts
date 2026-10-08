import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { usePermission } from '@/features/auth/use-permission';
import { patientVisitsQuery } from '@/features/clinical/visits-list/visits-list-api';
import { liveVisitsQuery, visitQuery } from '@/features/clinical/visits-api';

/** The visit a file can be linked to, as the field names it. */
export interface VisitOption {
  id: string;
  displayNumber: number;
  localDate: string;
  live?: boolean;
}

/**
 * The patient's visits a file can be linked to, newest first with the live one on top (§1):
 * the live visit (it has no place in the history list yet) and the first page of the history.
 * Empty without `visit:read`.
 */
export function useVisitOptions(patientId: string, enabled: boolean): VisitOption[] {
  const canRead = usePermission('visit:read') && enabled;
  const live = useQuery({ ...liveVisitsQuery({ patientId }), enabled: canRead });
  const liveId = live.data?.[0]?.id;
  const liveVisit = useQuery({
    ...visitQuery(liveId ?? ''),
    enabled: canRead && liveId !== undefined,
  });
  const history = useInfiniteQuery({ ...patientVisitsQuery(patientId), enabled: canRead });
  const past = (history.data?.pages[0]?.items ?? []).map(({ id, displayNumber, localDate }) => ({
    id,
    displayNumber,
    localDate,
  }));
  return liveVisit.data
    ? [
        {
          id: liveVisit.data.id,
          displayNumber: liveVisit.data.displayNumber,
          localDate: liveVisit.data.localDate,
          live: true,
        },
        ...past.filter((visit) => visit.id !== liveVisit.data.id),
      ]
    : past;
}
