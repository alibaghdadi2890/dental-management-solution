import {
  type AddWaitlistEntryRequest,
  type Appointment,
  appointmentSchema,
  type FillWaitlistEntryRequest,
  leaveOpeningResultSchema,
  type UpdateWaitlistEntryRequest,
  type WaitlistAttemptOutcome,
  type WaitlistEntry,
  waitlistEntrySchema,
  waitlistOpeningDetailSchema,
  waitlistOpeningsSchema,
  waitlistPageSchema,
  type WaitlistViewStatus,
} from '@dcm/contracts';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { IDEMPOTENCY_HEADER } from '@/lib/idempotency';
import { SCHEDULE_REFETCH_MS, schedulingKeys } from '../scheduling-api';

/** The waitlist's queries live under the schedule's key: every schedule change refreshes them. */
const keys = {
  all: () => [...schedulingKeys.all(actingTenantId()), 'waitlist'] as const,
};

const base = '/scheduling/waitlist';

export interface WaitlistFilter {
  branchId: string;
  status: WaitlistViewStatus;
  dentistId?: string | undefined;
  appointment?: 'with' | 'without' | undefined;
  fits?: boolean | undefined;
}

/** Schedule › Waitlist (C1): the waiting list is one page; the history is paged by its cursor. */
export function waitlistQuery(filter: WaitlistFilter) {
  return infiniteQueryOptions({
    queryKey: [...keys.all(), 'list', filter] as const,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const search = new URLSearchParams({
        branchId: filter.branchId,
        status: filter.status,
        limit: '50',
      });
      if (filter.dentistId) search.set('dentistId', filter.dentistId);
      if (filter.appointment) search.set('appointment', filter.appointment);
      if (filter.fits) search.set('fits', 'true');
      if (pageParam) search.set('cursor', pageParam);
      return apiFetch(`${base}?${search.toString()}`, waitlistPageSchema);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: SCHEDULE_REFETCH_MS,
  });
}

/** The branch's openings and the waiting count: Today's lane, the toolbar, the calendar. */
export function openingsQuery(branchId: string, enabled = true) {
  return queryOptions({
    queryKey: [...keys.all(), 'openings', branchId] as const,
    queryFn: () => apiFetch(`${base}/openings?branchId=${branchId}`, waitlistOpeningsSchema),
    refetchInterval: SCHEDULE_REFETCH_MS,
    enabled,
  });
}

/** *Fill*: one opening of a freed appointment and who fits it. */
export function openingQuery(appointmentId: string, at?: string) {
  const search = at ? `?at=${encodeURIComponent(at)}` : '';
  return queryOptions({
    queryKey: [...keys.all(), 'opening', appointmentId, at ?? null] as const,
    queryFn: () =>
      apiFetch(`${base}/openings/${appointmentId}${search}`, waitlistOpeningDetailSchema),
    refetchInterval: SCHEDULE_REFETCH_MS,
  });
}

export const fetchOpening = (appointmentId: string) =>
  apiFetch(`${base}/openings/${appointmentId}`, waitlistOpeningDetailSchema);

/** The patient's waiting entries: the record, the panels' *On the waitlist* line. */
export function patientWaitlistQuery(patientId: string, enabled = true) {
  return queryOptions({
    queryKey: [...keys.all(), 'patient', patientId] as const,
    queryFn: () =>
      apiFetch(`/scheduling/patients/${patientId}/waitlist`, z.array(waitlistEntrySchema)),
    enabled: enabled && patientId !== '',
  });
}

/** The entry without an appointment, if the patient has one. */
export const waitingWithout = (entries: readonly WaitlistEntry[] | undefined) =>
  entries?.find((entry) => entry.appointment === null) ?? null;

export const addToWaitlist = (input: AddWaitlistEntryRequest) =>
  apiFetch(base, waitlistEntrySchema, { method: 'POST', json: input });

export const updateWaitlistEntry = (id: string, input: UpdateWaitlistEntryRequest) =>
  apiFetch(`${base}/${id}`, waitlistEntrySchema, { method: 'PATCH', json: input });

export const removeWaitlistEntry = (id: string, reason: string) =>
  apiFetch(`${base}/${id}/remove`, waitlistEntrySchema, { method: 'POST', json: { reason } });

export const recordAttempt = (id: string, outcome: WaitlistAttemptOutcome) =>
  apiFetch(`${base}/${id}/attempt`, waitlistEntrySchema, { method: 'POST', json: { outcome } });

export const fillOpening = (
  id: string,
  input: FillWaitlistEntryRequest,
  key: string,
): Promise<Appointment> =>
  apiFetch(`${base}/${id}/fill`, appointmentSchema, {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: key },
  });

export const leaveOpen = (appointmentId: string, at?: string) =>
  apiFetch(`${base}/openings/${appointmentId}/leave-open`, leaveOpeningResultSchema, {
    method: 'POST',
    json: at ? { at } : {},
  });
