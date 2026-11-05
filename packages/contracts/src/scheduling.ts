import { z } from 'zod';
import { type PlanPriority, PLAN_PRIORITIES, planPrioritySchema } from './clinical-records.js';
import type { PlanStatus } from './clinical-records.js';
import {
  blankToUndefined,
  commaSeparatedIds,
  displayNumberSchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  optionalText,
  queryBooleanSchema,
} from './common.js';
import type { Permission } from './permissions.js';
import type { ToothCode } from './tooth.js';
import { type VisitType, visitTypeSchema } from './visit-flow.js';

/**
 * Appointments and follow-ups (feature 14, ADR-0066 to ADR-0072). An appointment reserves a dentist
 * and optionally a room of a branch; a follow-up is the dentist's recommendation for the patient's
 * next appointment. Who may act on a row and the follow-up's dates are pure rules here, so the API
 * and the SPA apply the same ones (CLAUDE.md §6).
 */

export const APPOINTMENT_STATUSES = [
  'booked',
  'confirmed',
  'checked_in',
  'in_room',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

/** The statuses that hold their time: the exclusion constraints cover exactly these. */
export const ACTIVE_APPOINTMENT_STATUSES = [
  'booked',
  'confirmed',
  'checked_in',
  'in_room',
] as const satisfies readonly AppointmentStatus[];

export const isActiveAppointment = (status: AppointmentStatus): boolean =>
  (ACTIVE_APPOINTMENT_STATUSES as readonly AppointmentStatus[]).includes(status);

export const DURATION_MIN = 5;
export const DURATION_MAX = 480;
/** The panel's duration chips and the Display menu's slot lengths (A5, A11). */
export const SLOT_LENGTHS = [15, 30, 45, 60, 90, 120] as const;
const durationSchema = z.number().int().min(DURATION_MIN).max(DURATION_MAX);

export const APPOINTMENT_REASON_MAX = 200;
const reasonTextSchema = z.string().trim().min(1).max(APPOINTMENT_REASON_MAX);

const planIdsSchema = z
  .array(idSchema)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'The same plan is picked twice');

/** The chips of the New appointment panel: the text goes in `reason`, the type is a pre-fill. */
export const REASON_CHIPS = [
  { key: 'check_up', visitType: 'examination' },
  { key: 'scaling', visitType: 'hygiene' },
  { key: 'consultation', visitType: 'consultation' },
  { key: 'filling', visitType: 'treatment' },
  { key: 'emergency', visitType: 'emergency' },
  { key: 'review', visitType: null },
] as const satisfies readonly { key: string; visitType: VisitType | null }[];
export type ReasonChipKey = (typeof REASON_CHIPS)[number]['key'];

export const FOLLOW_UP_TIMINGS = [
  'asap',
  'within_1_week',
  'within_2_weeks',
  'within_1_month',
  'after_6_months',
  'custom',
  'no_preference',
] as const;
export const followUpTimingSchema = z.enum(FOLLOW_UP_TIMINGS);
export type FollowUpTiming = z.infer<typeof followUpTimingSchema>;

export const FOLLOW_UP_KINDS = [
  'continue_treatment',
  'planned_treatment',
  'general_follow_up',
  'healing_review',
  'consultation',
  'routine_examination',
  'other',
] as const;
export const followUpKindSchema = z.enum(FOLLOW_UP_KINDS);
export type FollowUpKind = z.infer<typeof followUpKindSchema>;

/** Per kind: the default duration (the prompt's constants) and timing, and the visit type it maps to. */
export const FOLLOW_UP_KIND_DEFAULTS: Readonly<
  Record<FollowUpKind, { durationMin: number; timing: FollowUpTiming; visitType: VisitType | null }>
> = {
  continue_treatment: { durationMin: 60, timing: 'within_1_week', visitType: 'treatment' },
  planned_treatment: { durationMin: 60, timing: 'no_preference', visitType: 'treatment' },
  general_follow_up: { durationMin: 30, timing: 'within_2_weeks', visitType: null },
  healing_review: { durationMin: 15, timing: 'within_1_week', visitType: 'treatment' },
  consultation: { durationMin: 30, timing: 'no_preference', visitType: 'consultation' },
  routine_examination: { durationMin: 30, timing: 'within_1_month', visitType: 'examination' },
  other: { durationMin: 30, timing: 'no_preference', visitType: null },
};

export const FOLLOW_UP_STATUSES = ['awaiting', 'booked', 'declined', 'done'] as const;
export const followUpStatusSchema = z.enum(FOLLOW_UP_STATUSES);
export type FollowUpStatus = z.infer<typeof followUpStatusSchema>;

/** How long a follow-up stays on the list by default, in days after its window opens. */
export const DEFAULT_FOLLOW_UP_WINDOW_DAYS = 30;
export const FOLLOW_UP_DURATION_MAX = 240;

export const FOLLOW_UP_INVALID_REASONS = ['plan_cancelled', 'plan_done'] as const;
export type FollowUpInvalidReason = (typeof FOLLOW_UP_INVALID_REASONS)[number];

export const CONFLICT_KINDS = [
  'room',
  'patient',
  'dentist',
  'outside_hours',
  'closed_day',
] as const;
export const conflictKindSchema = z.enum(CONFLICT_KINDS);
export type ConflictKind = z.infer<typeof conflictKindSchema>;

/** Room and patient are refused; dentist and hours are warnings an override passes (ADR-0067). */
export const appointmentConflictSchema = z.object({
  kind: conflictKindSchema,
  hard: z.boolean(),
  /** The room in use, for `room`. */
  roomName: z.string().nullable(),
  /** The dentist who is busy, for `dentist`. */
  dentistName: z.string().nullable(),
});
export type AppointmentConflict = z.infer<typeof appointmentConflictSchema>;

export const appointmentLineageSchema = z.object({
  /** How many times it was moved. */
  moves: z.number().int().nonnegative(),
  firstStartsAt: isoDateTimeSchema,
  /** On a `rescheduled` row: when its successor starts. */
  movedToStartsAt: isoDateTimeSchema.nullable(),
});
export type AppointmentLineage = z.infer<typeof appointmentLineageSchema>;

export const appointmentSchema = z.object({
  id: idSchema,
  branchId: idSchema,
  patient: z.object({
    id: idSchema,
    fullName: z.string(),
    displayNumber: displayNumberSchema,
    registrationIncomplete: z.boolean(),
  }),
  /** A staff profile id (ADR-0020). */
  dentistId: idSchema,
  dentistName: z.string(),
  roomId: idSchema.nullable(),
  roomName: z.string().nullable(),
  /** The room came from *Auto*: a move picks it again (G8). */
  roomAuto: z.boolean(),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  /** The tenant-local date of `startsAt` (A22). */
  localDate: isoDateSchema,
  status: appointmentStatusSchema,
  reason: z.string(),
  visitType: visitTypeSchema.nullable(),
  planIds: z.array(idSchema),
  followUp: z
    .object({
      id: idSchema,
      title: z.string(),
      sourceVisitNumber: z.number().int().positive(),
      recommendedByName: z.string(),
    })
    .nullable(),
  sourceVisitId: idSchema.nullable(),
  lineageId: idSchema,
  lineage: appointmentLineageSchema,
  /** The warnings an override went through (A20). */
  overridden: z.array(conflictKindSchema),
  bookedByName: z.string(),
  createdAt: isoDateTimeSchema,
  confirmedAt: isoDateTimeSchema.nullable(),
  checkedInAt: isoDateTimeSchema.nullable(),
  cancelReason: z.string().nullable(),
  /** `booked` or `confirmed` and over: derived, never stored. */
  unresolved: z.boolean(),
  updatedAt: isoDateTimeSchema,
});
export type Appointment = z.infer<typeof appointmentSchema>;

export const appointmentRangeQuerySchema = z.object({
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
  branchId: idSchema,
  dentistIds: blankToUndefined(commaSeparatedIds(50).optional()),
  roomId: blankToUndefined(idSchema.optional()),
});
export type AppointmentRangeQuery = z.infer<typeof appointmentRangeQuerySchema>;

const roomChoiceSchema = z.union([idSchema, z.literal('auto')]);
/** Also `none`: an appointment left without a room keeps none (ADR-0075). */
const keptRoomChoiceSchema = z.union([idSchema, z.literal('auto'), z.literal('none')]);

export const bookAppointmentSchema = z.object({
  branchId: idSchema,
  patientId: idSchema,
  dentistId: idSchema,
  startsAt: isoDateTimeSchema,
  durationMin: durationSchema,
  reason: reasonTextSchema,
  visitType: visitTypeSchema.nullish().transform((value) => value ?? null),
  planIds: planIdsSchema.default([]),
  /** A room of the branch, or `auto` (the usual room when free, else the first free, else none). */
  roomId: roomChoiceSchema.default('auto'),
  /** *Confirmed with patient*. */
  confirmed: z.boolean().default(false),
  /** The follow-up this booking takes off the list. */
  followUpId: idSchema.optional(),
  /** The live visit a booking from the Complete dialog comes from (A15). */
  sourceVisitId: idSchema.optional(),
  /** Goes through the warnings; needs `appointment:override`. */
  override: z.boolean().default(false),
});
export type BookAppointment = z.infer<typeof bookAppointmentSchema>;
export type BookAppointmentRequest = z.input<typeof bookAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({
  startsAt: isoDateTimeSchema,
  dentistId: idSchema.optional(),
  roomId: roomChoiceSchema.optional(),
  override: z.boolean().default(false),
});
export type RescheduleAppointment = z.infer<typeof rescheduleAppointmentSchema>;
export type RescheduleAppointmentRequest = z.input<typeof rescheduleAppointmentSchema>;

export const resizeAppointmentSchema = z.object({
  durationMin: durationSchema,
  override: z.boolean().default(false),
});
export type ResizeAppointment = z.infer<typeof resizeAppointmentSchema>;
export type ResizeAppointmentRequest = z.input<typeof resizeAppointmentSchema>;

export const cancelAppointmentSchema = z.object({ reason: optionalText(500) });
export type CancelAppointment = z.infer<typeof cancelAppointmentSchema>;

/** Undoes a cancel (ADR-0075): the warnings a move would meet need the override. */
export const restoreAppointmentSchema = z.object({ override: z.boolean().default(false) });
export type RestoreAppointment = z.infer<typeof restoreAppointmentSchema>;
export type RestoreAppointmentRequest = z.input<typeof restoreAppointmentSchema>;

/**
 * The Edit appointment panel (ADR-0075): the whole form. The same start and dentist change the row in
 * place; another start or dentist is a reschedule, a new row in the lineage.
 */
export const editAppointmentSchema = z.object({
  dentistId: idSchema,
  startsAt: isoDateTimeSchema,
  durationMin: durationSchema,
  reason: reasonTextSchema,
  visitType: visitTypeSchema.nullish().transform((value) => value ?? null),
  /** `none` keeps it without a room, to be given one at check-in. */
  roomId: keptRoomChoiceSchema.default('auto'),
  /** *Confirmed with patient*: confirms in place; a moved appointment is unconfirmed without it. */
  confirmed: z.boolean().default(false),
  override: z.boolean().default(false),
});
export type EditAppointment = z.infer<typeof editAppointmentSchema>;
export type EditAppointmentRequest = z.input<typeof editAppointmentSchema>;

export const checkInAppointmentSchema = z.object({ roomId: idSchema.optional() });
export type CheckInAppointment = z.infer<typeof checkInAppointmentSchema>;

export const changeAppointmentRoomSchema = z.object({ roomId: idSchema.nullable() });
export type ChangeAppointmentRoom = z.infer<typeof changeAppointmentRoomSchema>;

/** `POST /scheduling/appointments/check`: the dry run behind the panel, drag and move mode. */
export const appointmentCheckSchema = z.object({
  branchId: idSchema,
  dentistId: idSchema,
  patientId: idSchema.optional(),
  startsAt: isoDateTimeSchema,
  durationMin: durationSchema,
  roomId: keptRoomChoiceSchema.default('auto'),
  /** The appointment being moved does not conflict with itself. */
  ignoreAppointmentId: idSchema.optional(),
});
export type AppointmentCheck = z.infer<typeof appointmentCheckSchema>;
export type AppointmentCheckRequest = z.input<typeof appointmentCheckSchema>;

/** The room a booking would get, with the "usual room in use" note's facts. */
export const roomPickSchema = z.object({
  roomId: idSchema.nullable(),
  roomName: z.string().nullable(),
  usualRoomId: idSchema.nullable(),
  usualRoomName: z.string().nullable(),
  isUsual: z.boolean(),
});
export type RoomPick = z.infer<typeof roomPickSchema>;

export const appointmentCheckResultSchema = z.object({
  conflicts: z.array(appointmentConflictSchema),
  room: roomPickSchema,
});
export type AppointmentCheckResult = z.infer<typeof appointmentCheckResultSchema>;

export const SLOT_SEARCH_MAX_DAYS = 62;

export const slotQuerySchema = z.object({
  branchId: idSchema,
  dentistId: idSchema,
  patientId: blankToUndefined(idSchema.optional()),
  durationMin: z.coerce.number().int().min(DURATION_MIN).max(DURATION_MAX),
  from: isoDateSchema,
  to: isoDateSchema,
  /** The user's slot length: starts sit on this grid. */
  stepMin: blankToUndefined(z.coerce.number().int().min(5).max(120).default(15)),
  ignoreAppointmentId: blankToUndefined(idSchema.optional()),
  /** Move mode: adds the starts only an override could take, with their warnings. */
  includeWarnings: blankToUndefined(queryBooleanSchema.optional()),
});
export type SlotQuery = z.infer<typeof slotQuerySchema>;

export const slotSchema = roomPickSchema.extend({
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  warnings: z.array(conflictKindSchema),
});
export type Slot = z.infer<typeof slotSchema>;

export const slotDaySchema = z.object({ date: isoDateSchema, slots: z.array(slotSchema) });
export type SlotDay = z.infer<typeof slotDaySchema>;

export const slotDaysSchema = z.array(slotDaySchema);

const nextAppointmentFields = {
  kind: followUpKindSchema,
  title: z.string().trim().min(1).max(APPOINTMENT_REASON_MAX),
  planIds: planIdsSchema.default([]),
  priority: planPrioritySchema.nullish().transform((value) => value ?? null),
  sessionNumber: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((value) => value ?? null),
  sessionTotal: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((value) => value ?? null),
  durationMin: z.number().int().min(DURATION_MIN).max(FOLLOW_UP_DURATION_MAX),
  timing: followUpTimingSchema,
  customDate: isoDateSchema.nullish().transform((value) => value ?? null),
  /** A staff profile id; left out, the recommending dentist. */
  preferredDentistId: idSchema.nullish().transform((value) => value ?? null),
  note: optionalText(500),
  clinicalPrep: optionalText(500),
};

/**
 * What the dentist recommends at Complete visit (A13, A15): opaque to `clinical`, which republishes
 * it on `VisitCompleted`. With `bookedAppointmentId` the follow-up is created `booked`. A completion
 * without a payload is *Skip*.
 */
export const nextAppointmentPayloadSchema = z
  .object({ ...nextAppointmentFields, bookedAppointmentId: idSchema.optional() })
  .refine((payload) => payload.timing !== 'custom' || payload.customDate !== null, {
    message: 'Pick a date',
    path: ['customDate'],
  });
export type NextAppointmentPayload = z.infer<typeof nextAppointmentPayloadSchema>;
export type NextAppointmentRequest = z.input<typeof nextAppointmentPayloadSchema>;

/** `POST /visits/:id/complete`: what comes next. Left out, *Skip*. */
export const completeVisitSchema = z
  .object({ nextAppointment: nextAppointmentPayloadSchema.optional() })
  .prefault({});
export type CompleteVisit = z.infer<typeof completeVisitSchema>;
export type CompleteVisitRequest = z.input<typeof completeVisitSchema>;

export const followUpSchema = z.object({
  id: idSchema,
  branchId: idSchema,
  patientId: idSchema,
  patientName: z.string(),
  patientDisplayNumber: displayNumberSchema,
  sourceVisitId: idSchema,
  sourceVisitNumber: z.number().int().positive(),
  /** A staff profile id. */
  recommendedBy: idSchema,
  recommendedByName: z.string(),
  preferredDentistId: idSchema.nullable(),
  preferredDentistName: z.string().nullable(),
  /** False when that dentist left or is no longer in the branch: pick another (G16). */
  preferredDentistAvailable: z.boolean(),
  kind: followUpKindSchema,
  title: z.string(),
  planIds: z.array(idSchema),
  priority: planPrioritySchema.nullable(),
  sessionNumber: z.number().int().positive().nullable(),
  sessionTotal: z.number().int().positive().nullable(),
  durationMin: z.number().int().positive(),
  timing: followUpTimingSchema,
  customDate: isoDateSchema.nullable(),
  /** The source visit's tenant-local date. */
  visitDate: isoDateSchema,
  dueOn: isoDateSchema.nullable(),
  note: z.string().nullable(),
  clinicalPrep: z.string().nullable(),
  status: followUpStatusSchema,
  /** The *Patient will call* tag. */
  willCallAt: isoDateTimeSchema.nullable(),
  willCallByName: z.string().nullable(),
  declinedAt: isoDateTimeSchema.nullable(),
  declinedReason: z.string().nullable(),
  /** The appointment that holds it, when `booked`. */
  appointmentId: idSchema.nullable(),
  expiresOn: isoDateSchema,
  /** Awaiting and past `expiresOn`: off the list, "Expired — not booked" on the record. */
  expired: z.boolean(),
  /** Days past due while awaiting; 0 when not overdue. */
  overdueDays: z.number().int().nonnegative(),
  invalidReason: z.enum(FOLLOW_UP_INVALID_REASONS).nullable(),
  createdAt: isoDateTimeSchema,
});
export type FollowUp = z.infer<typeof followUpSchema>;

export const followUpListQuerySchema = z.object({
  status: blankToUndefined(z.literal('awaiting').default('awaiting')),
  branchId: idSchema,
});
export type FollowUpListQuery = z.infer<typeof followUpListQuerySchema>;

export const declineFollowUpSchema = z.object({ reason: optionalText(500) });
export type DeclineFollowUp = z.infer<typeof declineFollowUpSchema>;

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, 'Expected a time in 15-minute steps');

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** One weekday's opening: 0 is Sunday. Closed days keep their times for the next time they open. */
export const openingDaySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    isOpen: z.boolean(),
    from: timeOfDaySchema,
    to: timeOfDaySchema,
  })
  .refine((day) => !day.isOpen || day.from < day.to, {
    message: 'The opening must be before the closing',
    path: ['to'],
  });
export type OpeningDay = z.infer<typeof openingDaySchema>;

export const openingHoursSchema = z.object({
  days: z
    .array(openingDaySchema)
    .length(7)
    .refine(
      (days) => new Set(days.map((day) => day.weekday)).size === 7,
      'Every weekday appears once',
    ),
});
export type OpeningHours = z.infer<typeof openingHoursSchema>;

export const schedulingSettingsSchema = z.object({
  followUpWindowDays: z.number().int().min(1).max(365),
});
export type SchedulingSettings = z.infer<typeof schedulingSettingsSchema>;

/** A dentist's column: the branch's active dentists, in staff order (A5). */
export const scheduleDentistSchema = z.object({
  id: idSchema,
  name: z.string(),
  /** The position in staff order: the chart palette colour is derived from it. */
  order: z.number().int().nonnegative(),
});
export type ScheduleDentist = z.infer<typeof scheduleDentistSchema>;

/** The calendar's columns and the room pickers: the branch's active dentists and rooms. */
export const scheduleResourcesSchema = z.object({
  dentists: z.array(scheduleDentistSchema),
  rooms: z.array(z.object({ id: idSchema, name: z.string() })),
});
export type ScheduleResources = z.infer<typeof scheduleResourcesSchema>;

export const scheduleBranchQuerySchema = z.object({ branchId: idSchema });
export type ScheduleBranchQuery = z.infer<typeof scheduleBranchQuerySchema>;

/** `GET /scheduling/today`: the day's appointments; the board's sections are derived from them. */
export const todayBoardSchema = z.object({
  date: isoDateSchema,
  appointments: z.array(appointmentSchema),
  unresolvedCount: z.number().int().nonnegative(),
  unconfirmedCount: z.number().int().nonnegative(),
});
export type TodayBoard = z.infer<typeof todayBoardSchema>;

/** Who may act on an appointment: the actor's rights and their staff profile. */
export interface AppointmentActor {
  permissions: Iterable<Permission>;
  /** The caller's staff profile id in this tenant; null without one. */
  profileId: string | null;
}

/** `appointment:write` is the caller's own column, `appointment:write_all` every column (A2). */
export function canWriteAppointment(
  actor: AppointmentActor,
  appointment: { dentistId: string },
): boolean {
  const held = new Set(actor.permissions);
  if (held.has('appointment:write_all')) return true;
  return (
    held.has('appointment:write') &&
    actor.profileId !== null &&
    actor.profileId === appointment.dentistId
  );
}

/** What an appointment's status and time allow, whoever asks (G21). */
export interface AppointmentMoment {
  status: AppointmentStatus;
  /** The tenant-local date of the start. */
  localDate: string;
  startsAt: string;
}

const isWaitingFor = (status: AppointmentStatus): boolean =>
  status === 'booked' || status === 'confirmed';

export function canCheckIn(appointment: AppointmentMoment, today: string): boolean {
  return isWaitingFor(appointment.status) && appointment.localDate === today;
}

export function canConfirm(appointment: AppointmentMoment, today: string): boolean {
  return appointment.status === 'booked' && appointment.localDate >= today;
}

/** Past, arrived, in-treatment and closed appointments stay where they are (A8). */
export function canMove(appointment: AppointmentMoment, today: string): boolean {
  return isWaitingFor(appointment.status) && appointment.localDate >= today;
}

export function canMarkNoShow(appointment: AppointmentMoment, now: Date): boolean {
  return isWaitingFor(appointment.status) && new Date(appointment.startsAt) <= now;
}

export function canCancel(appointment: AppointmentMoment): boolean {
  return isWaitingFor(appointment.status);
}

/** A cancel is undone while the appointment is still ahead (ADR-0075). */
export function canRestore(appointment: AppointmentMoment, now: Date): boolean {
  return appointment.status === 'cancelled' && new Date(appointment.startsAt) > now;
}

const addDays = (date: string, days: number): string => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

/** The same day some months later, or that month's last day when it is shorter (31 Aug → 28 Feb). */
const addMonths = (date: string, months: number): string => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
};

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The due date: the source visit's local date plus the timing; none for *No preference*. */
export function followUpDueOn(
  timing: FollowUpTiming,
  visitDate: string,
  customDate: string | null,
): string | null {
  switch (timing) {
    case 'asap':
      return visitDate;
    case 'within_1_week':
      return addDays(visitDate, 7);
    case 'within_2_weeks':
      return addDays(visitDate, 14);
    case 'within_1_month':
      return addDays(visitDate, 30);
    case 'after_6_months':
      return addMonths(visitDate, 6);
    case 'custom':
      return customDate;
    case 'no_preference':
      return null;
  }
}

/**
 * Where a follow-up's window starts: the due date, or the visit date without one. Reopening moves it
 * to the reopen date when that is later, so a reopened follow-up cannot leave the list unseen (G7).
 */
export function followUpWindowFrom(dueOn: string | null, visitDate: string): string {
  return dueOn ?? visitDate;
}

export function followUpExpiresOn(windowFrom: string, windowDays: number): string {
  return addDays(windowFrom, windowDays);
}

export function followUpOverdueDays(dueOn: string | null, today: string): number {
  return dueOn === null ? 0 : Math.max(0, daysBetween(dueOn, today));
}

/**
 * The slot finder's opening range (A10): today to the due date, at least a week; a month without one.
 * A custom date and *After 6 months* open on their date, for a week (from today once it has passed).
 */
export function followUpSearchWindow(
  followUp: { dueOn: string | null; timing: FollowUpTiming; customDate: string | null },
  today: string,
): { from: string; to: string } {
  if (followUp.timing === 'custom' && followUp.customDate && followUp.customDate >= today) {
    return { from: followUp.customDate, to: addDays(followUp.customDate, 7) };
  }
  if (followUp.timing === 'after_6_months' && followUp.dueOn) {
    const from = followUp.dueOn > today ? followUp.dueOn : today;
    return { from, to: addDays(from, 7) };
  }
  if (followUp.dueOn === null) return { from: today, to: addDays(today, 31) };
  const week = addDays(today, 7);
  return { from: today, to: followUp.dueOn > week ? followUp.dueOn : week };
}

const priorityRank = (priority: PlanPriority | null): number =>
  priority === null ? PLAN_PRIORITIES.length : PLAN_PRIORITIES.indexOf(priority);

const TIMING_OF_PRIORITY: Readonly<Record<PlanPriority, FollowUpTiming>> = {
  urgent: 'asap',
  high: 'within_2_weeks',
  elective: 'within_1_month',
};

/** What a proposal reads of a plan. */
export interface ProposalPlan {
  id: string;
  name: string;
  status: PlanStatus;
  priority: PlanPriority;
  toothCode: ToothCode | null;
  estimatedSessions: number | null;
  sessions: readonly { visitId: string }[];
}

/** One row of the Next appointment step; the SPA words its title. */
export interface NextAppointmentProposal {
  kind: 'continue_treatment' | 'planned_treatment';
  planId: string;
  name: string;
  toothCode: ToothCode | null;
  priority: PlanPriority;
  sessionNumber: number | null;
  sessionTotal: number | null;
  durationMin: number;
  timing: FollowUpTiming;
}

/**
 * The Next appointment step's list (A13, G4): unfinished work first, this visit's before older work,
 * then the open plan items, highest priority first. Built from the chart the page already holds.
 */
export function proposeNextAppointment(
  plans: readonly ProposalPlan[],
  visitId: string,
): NextAppointmentProposal[] {
  const unfinished = plans
    .filter((plan) => plan.status === 'in_progress')
    .map((plan, index) => ({
      plan,
      index,
      today: plan.sessions.some((session) => session.visitId === visitId),
    }))
    .sort(
      (a, b) =>
        Number(b.today) - Number(a.today) ||
        priorityRank(a.plan.priority) - priorityRank(b.plan.priority) ||
        a.index - b.index,
    )
    .map(({ plan }): NextAppointmentProposal => ({
      kind: 'continue_treatment',
      planId: plan.id,
      name: plan.name,
      toothCode: plan.toothCode,
      priority: plan.priority,
      sessionNumber: plan.sessions.length + 1,
      sessionTotal: plan.estimatedSessions,
      durationMin: FOLLOW_UP_KIND_DEFAULTS.continue_treatment.durationMin,
      timing: FOLLOW_UP_KIND_DEFAULTS.continue_treatment.timing,
    }));
  const planned = plans
    .filter((plan) => plan.status === 'planned')
    .map((plan, index) => ({ plan, index }))
    .sort(
      (a, b) => priorityRank(a.plan.priority) - priorityRank(b.plan.priority) || a.index - b.index,
    )
    .map(({ plan }): NextAppointmentProposal => ({
      kind: 'planned_treatment',
      planId: plan.id,
      name: plan.name,
      toothCode: plan.toothCode,
      priority: plan.priority,
      sessionNumber: null,
      sessionTotal: null,
      durationMin: FOLLOW_UP_KIND_DEFAULTS.planned_treatment.durationMin,
      timing: TIMING_OF_PRIORITY[plan.priority],
    }));
  return [...unfinished, ...planned];
}

const TIMING_ORDER: readonly FollowUpTiming[] = [
  'asap',
  'within_1_week',
  'within_2_weeks',
  'within_1_month',
  'after_6_months',
  'custom',
  'no_preference',
];

/** Several ticked proposals as one follow-up (G13): durations add up, the soonest timing wins. */
export function combineProposals(proposals: readonly NextAppointmentProposal[]): {
  planIds: string[];
  priority: PlanPriority | null;
  durationMin: number;
  timing: FollowUpTiming;
} {
  return {
    planIds: proposals.map((proposal) => proposal.planId),
    priority:
      [...proposals].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))[0]
        ?.priority ?? null,
    durationMin: Math.min(
      FOLLOW_UP_DURATION_MAX,
      proposals.reduce((sum, proposal) => sum + proposal.durationMin, 0),
    ),
    timing:
      TIMING_ORDER.find((timing) => proposals.some((proposal) => proposal.timing === timing)) ??
      'no_preference',
  };
}
