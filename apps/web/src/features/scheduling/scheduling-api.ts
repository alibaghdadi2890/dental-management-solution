import {
  type Appointment,
  appointmentCheckResultSchema,
  type AppointmentCheckRequest,
  appointmentSchema,
  type BookAppointmentRequest,
  type FollowUp,
  followUpSchema,
  openingHoursSchema,
  type OpeningHours,
  type RescheduleAppointmentRequest,
  scheduleResourcesSchema,
  schedulingSettingsSchema,
  type SchedulingSettings,
  slotDaysSchema,
  todayBoardSchema,
} from '@dcm/contracts';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { IDEMPOTENCY_HEADER } from '@/lib/idempotency';

/** How often the calendar and the board pick up what others booked. */
export const SCHEDULE_REFETCH_MS = 30_000;

const appointmentsSchema = z.array(appointmentSchema);
const followUpsSchema = z.array(followUpSchema);

const base = '/scheduling';
const appointmentPath = (id: string) => `${base}/appointments/${id}`;

/** The feature's queries, under the acting tenant like the others'. */
export const schedulingKeys = {
  all: (tenantId: string | null) => ['scheduling', tenantId] as const,
  resources: (tenantId: string | null, branchId: string) =>
    [...schedulingKeys.all(tenantId), 'resources', branchId] as const,
  hours: (tenantId: string | null, branchId: string) =>
    [...schedulingKeys.all(tenantId), 'hours', branchId] as const,
  settings: (tenantId: string | null) => [...schedulingKeys.all(tenantId), 'settings'] as const,
  range: (tenantId: string | null, branchId: string, from: string, to: string) =>
    [...schedulingKeys.all(tenantId), 'range', branchId, from, to] as const,
  today: (tenantId: string | null, branchId: string) =>
    [...schedulingKeys.all(tenantId), 'today', branchId] as const,
  worklist: (tenantId: string | null, branchId: string) =>
    [...schedulingKeys.all(tenantId), 'worklist', branchId] as const,
  patientAppointments: (tenantId: string | null, patientId: string) =>
    [...schedulingKeys.all(tenantId), 'patient', patientId, 'appointments'] as const,
  patientFollowUps: (tenantId: string | null, patientId: string) =>
    [...schedulingKeys.all(tenantId), 'patient', patientId, 'follow-ups'] as const,
  slots: (tenantId: string | null, query: SlotRequest) =>
    [...schedulingKeys.all(tenantId), 'slots', query] as const,
};

export interface SlotRequest {
  branchId: string;
  dentistId: string;
  patientId?: string | undefined;
  durationMin: number;
  from: string;
  to: string;
  stepMin: number;
  ignoreAppointmentId?: string | undefined;
  includeWarnings?: boolean | undefined;
}

/** Awaiting and not expired: what the record says is left to book. */
export const isOpenFollowUp = (followUp: FollowUp) =>
  followUp.status === 'awaiting' && !followUp.expired;

export function invalidateSchedule(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: schedulingKeys.all(actingTenantId()) });
}

export function resourcesQuery(branchId: string) {
  return queryOptions({
    queryKey: schedulingKeys.resources(actingTenantId(), branchId),
    queryFn: () => apiFetch(`${base}/resources?branchId=${branchId}`, scheduleResourcesSchema),
  });
}

export function openingHoursQuery(branchId: string) {
  return queryOptions({
    queryKey: schedulingKeys.hours(actingTenantId(), branchId),
    queryFn: () => apiFetch(`${base}/branches/${branchId}/opening-hours`, openingHoursSchema),
  });
}

export function schedulingSettingsQuery() {
  return queryOptions({
    queryKey: schedulingKeys.settings(actingTenantId()),
    queryFn: () => apiFetch(`${base}/settings`, schedulingSettingsSchema),
  });
}

export function appointmentsQuery(branchId: string, from: string, to: string) {
  const search = new URLSearchParams({ branchId, from, to });
  return queryOptions({
    queryKey: schedulingKeys.range(actingTenantId(), branchId, from, to),
    queryFn: () => apiFetch(`${base}/appointments?${search.toString()}`, appointmentsSchema),
    refetchInterval: SCHEDULE_REFETCH_MS,
  });
}

export function todayBoardQuery(branchId: string, enabled = true) {
  return queryOptions({
    queryKey: schedulingKeys.today(actingTenantId(), branchId),
    queryFn: () => apiFetch(`${base}/today?branchId=${branchId}`, todayBoardSchema),
    refetchInterval: SCHEDULE_REFETCH_MS,
    enabled,
  });
}

export function worklistQuery(branchId: string, enabled = true) {
  return queryOptions({
    queryKey: schedulingKeys.worklist(actingTenantId(), branchId),
    queryFn: () => apiFetch(`${base}/follow-ups?branchId=${branchId}`, followUpsSchema),
    refetchInterval: SCHEDULE_REFETCH_MS,
    enabled,
  });
}

export function patientAppointmentsQuery(patientId: string, enabled = true) {
  return queryOptions({
    queryKey: schedulingKeys.patientAppointments(actingTenantId(), patientId),
    queryFn: () => apiFetch(`${base}/patients/${patientId}/appointments`, appointmentsSchema),
    enabled,
  });
}

export function patientFollowUpsQuery(patientId: string, enabled = true) {
  return queryOptions({
    queryKey: schedulingKeys.patientFollowUps(actingTenantId(), patientId),
    queryFn: () => apiFetch(`${base}/patients/${patientId}/follow-ups`, followUpsSchema),
    enabled,
  });
}

export function slotsQuery(request: SlotRequest, enabled = true) {
  const search = new URLSearchParams({
    branchId: request.branchId,
    dentistId: request.dentistId,
    durationMin: String(request.durationMin),
    from: request.from,
    to: request.to,
    stepMin: String(request.stepMin),
  });
  if (request.patientId) search.set('patientId', request.patientId);
  if (request.ignoreAppointmentId) search.set('ignoreAppointmentId', request.ignoreAppointmentId);
  if (request.includeWarnings) search.set('includeWarnings', 'true');
  return queryOptions({
    queryKey: schedulingKeys.slots(actingTenantId(), request),
    queryFn: () => apiFetch(`${base}/slots?${search.toString()}`, slotDaysSchema),
    enabled,
  });
}

export function checkAppointment(input: AppointmentCheckRequest) {
  return apiFetch(`${base}/appointments/check`, appointmentCheckResultSchema, {
    method: 'POST',
    json: input,
  });
}

export function bookAppointment(input: BookAppointmentRequest, key: string): Promise<Appointment> {
  return apiFetch(`${base}/appointments`, appointmentSchema, {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: key },
  });
}

export function rescheduleAppointment(
  id: string,
  input: RescheduleAppointmentRequest,
  key: string,
): Promise<Appointment> {
  return apiFetch(`${appointmentPath(id)}/reschedule`, appointmentSchema, {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: key },
  });
}

const act = (id: string, path: string, json: object = {}) =>
  apiFetch(`${appointmentPath(id)}/${path}`, appointmentSchema, { method: 'POST', json });

export const resizeAppointment = (id: string, durationMin: number, override: boolean) =>
  act(id, 'resize', { durationMin, override });
export const confirmAppointment = (id: string) => act(id, 'confirm');
export const checkInAppointment = (id: string, roomId?: string) =>
  act(id, 'check-in', roomId ? { roomId } : {});
export const undoCheckIn = (id: string) => act(id, 'undo-check-in');
export const changeAppointmentRoom = (id: string, roomId: string | null) =>
  act(id, 'room', { roomId });
export const cancelAppointment = (id: string, reason: string) => act(id, 'cancel', { reason });
export const markNoShow = (id: string) => act(id, 'no-show');

export const markFollowUpWillCall = (id: string) =>
  apiFetch(`${base}/follow-ups/${id}/will-call`, followUpSchema, { method: 'POST', json: {} });
export const declineFollowUp = (id: string, reason: string) =>
  apiFetch(`${base}/follow-ups/${id}/decline`, followUpSchema, {
    method: 'POST',
    json: { reason },
  });

export const saveOpeningHours = (branchId: string, hours: OpeningHours) =>
  apiFetch(`${base}/branches/${branchId}/opening-hours`, openingHoursSchema, {
    method: 'PUT',
    json: hours,
  });
export const saveSchedulingSettings = (settings: SchedulingSettings) =>
  apiFetch(`${base}/settings`, schedulingSettingsSchema, { method: 'PUT', json: settings });
