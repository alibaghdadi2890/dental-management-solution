import { z } from 'zod';
import {
  blankToUndefined,
  displayNumberSchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  optionalText,
  queryBooleanSchema,
} from './common.js';
import type { Permission } from './permissions.js';
import { visitTypeSchema } from './visit-flow.js';

/**
 * The appointment waitlist (feature 21, ADR-0103 to ADR-0107): the patients who want an earlier
 * appointment and those who have none. An entry with an appointment reads its reason, type,
 * duration and planned items from it; one without holds its own. Expiry, openings and who fits are
 * derived when read. This file imports nothing from `scheduling.ts`, which imports it.
 */

export const WAITLIST_STATUSES = ['waiting', 'booked', 'removed'] as const;
export const waitlistStatusSchema = z.enum(WAITLIST_STATUSES);
export type WaitlistStatus = z.infer<typeof waitlistStatusSchema>;

/** The statuses a person sees: `expired` is derived from a waiting entry (ADR-0107). */
export const WAITLIST_VIEW_STATUSES = ['waiting', 'booked', 'removed', 'expired'] as const;
export const waitlistViewStatusSchema = z.enum(WAITLIST_VIEW_STATUSES);
export type WaitlistViewStatus = z.infer<typeof waitlistViewStatusSchema>;

export const WAITLIST_ATTEMPT_OUTCOMES = ['no_answer', 'not_this_time'] as const;
export const waitlistAttemptOutcomeSchema = z.enum(WAITLIST_ATTEMPT_OUTCOMES);
export type WaitlistAttemptOutcome = z.infer<typeof waitlistAttemptOutcomeSchema>;

/** Where an entry was added from, for the audit sentence. */
export const WAITLIST_SOURCES = [
  'appointment',
  'waitlist',
  'slot_finder',
  'follow_up',
  'record',
  'cancel',
] as const;
export const waitlistSourceSchema = z.enum(WAITLIST_SOURCES);
export type WaitlistSource = z.infer<typeof waitlistSourceSchema>;

/** *Until* of an entry without an appointment: 30 days ahead by default, 180 at most (A2). */
export const WAITLIST_UNTIL_DEFAULT_DAYS = 30;
export const WAITLIST_UNTIL_MAX_DAYS = 180;
/** Starts sit on this grid, and less freed time than this is no opening (B1, B2). */
export const WAITLIST_GRID_MIN = 15;
export const OPENING_MIN_FREED_MINUTES = 15;
export const WAITLIST_DURATION_DEFAULT = 30;
const WAITLIST_REASON_MAX = 200;

const addDays = (date: string, days: number): string => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

export const waitlistUntilDefault = (today: string): string =>
  addDays(today, WAITLIST_UNTIL_DEFAULT_DAYS);
export const waitlistUntilMax = (today: string): string => addDays(today, WAITLIST_UNTIL_MAX_DAYS);

const clockSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, 'Expected a time in 15-minute steps');

const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? null);

/**
 * The wishes (A2), with *Urgent* and the note: what the *Wants an earlier time* tick reveals and the
 * Add to waitlist panel holds. *Days* empty is any day; *Between* is both ends or neither.
 */
export const waitlistWishesSchema = z
  .object({
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'The same day is picked twice')
      .default([]),
    betweenFrom: nullable(clockSchema),
    betweenTo: nullable(clockSchema),
    notBefore: nullable(isoDateSchema),
    sameDay: z.boolean().default(false),
    urgent: z.boolean().default(false),
    note: optionalText(500),
  })
  .refine((wishes) => (wishes.betweenFrom === null) === (wishes.betweenTo === null), {
    message: 'Pick both times or neither',
    path: ['betweenTo'],
  })
  .refine(
    (wishes) =>
      wishes.betweenFrom === null ||
      wishes.betweenTo === null ||
      wishes.betweenFrom < wishes.betweenTo,
    { message: 'The earliest time must be before the latest', path: ['betweenTo'] },
  );
export type WaitlistWishes = z.infer<typeof waitlistWishesSchema>;
export type WaitlistWishesInput = z.input<typeof waitlistWishesSchema>;

const planIdsSchema = z
  .array(idSchema)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'The same plan is picked twice');

/** What an entry without an appointment holds of its own (A1). */
const ownFields = {
  /** A staff profile id; null is *Any dentist*. */
  dentistId: idSchema.nullable(),
  reason: z.string().trim().min(1).max(WAITLIST_REASON_MAX),
  visitType: nullable(visitTypeSchema),
  durationMin: z.number().int().min(5).max(480).default(WAITLIST_DURATION_DEFAULT),
  /** Left out: 30 days ahead. */
  until: isoDateSchema.optional(),
};

/** `POST /scheduling/waitlist`: a patient waits with no appointment (A4). */
export const addWaitlistEntrySchema = z.object({
  branchId: idSchema,
  patientId: idSchema,
  ...ownFields,
  planIds: planIdsSchema.default([]),
  /** The awaiting follow-up it stands for: its title, duration and planned items (A1). */
  followUpId: idSchema.optional(),
  wishes: waitlistWishesSchema.prefault({}),
  source: waitlistSourceSchema.default('waitlist'),
});
export type AddWaitlistEntry = z.infer<typeof addWaitlistEntrySchema>;
export type AddWaitlistEntryRequest = z.input<typeof addWaitlistEntrySchema>;

/**
 * `PATCH /scheduling/waitlist/:id`: the wishes, and for an entry without an appointment its own
 * fields too. An entry with an appointment ignores them: they are the appointment's.
 */
export const updateWaitlistEntrySchema = z.object({
  wishes: waitlistWishesSchema,
  dentistId: idSchema.nullable().optional(),
  reason: ownFields.reason.optional(),
  visitType: visitTypeSchema.nullable().optional(),
  durationMin: z.number().int().min(5).max(480).optional(),
  until: isoDateSchema.optional(),
});
export type UpdateWaitlistEntry = z.infer<typeof updateWaitlistEntrySchema>;
export type UpdateWaitlistEntryRequest = z.input<typeof updateWaitlistEntrySchema>;

export const removeWaitlistEntrySchema = z.object({ reason: optionalText(500) });
export type RemoveWaitlistEntry = z.infer<typeof removeWaitlistEntrySchema>;

export const waitlistAttemptSchema = z.object({ outcome: waitlistAttemptOutcomeSchema });
export type WaitlistAttempt = z.infer<typeof waitlistAttemptSchema>;

/**
 * `POST /scheduling/waitlist/:id/fill` (B4, `Idempotency-Key`): the existing booking or move into
 * the opening, never through a warning.
 */
export const fillWaitlistEntrySchema = z.object({
  /** The opening's id: one of its freed appointments. */
  openingId: idSchema,
  startsAt: isoDateTimeSchema,
  /** A move keeps its room rule; left out, a booking is *Auto*. */
  roomId: z.union([idSchema, z.literal('auto')]).optional(),
  /** *Confirmed with patient*: the patient has just agreed. */
  confirmed: z.boolean().default(true),
});
export type FillWaitlistEntry = z.infer<typeof fillWaitlistEntrySchema>;
export type FillWaitlistEntryRequest = z.input<typeof fillWaitlistEntrySchema>;

export const waitlistWishesReadSchema = z.object({
  weekdays: z.array(z.number().int().min(0).max(6)),
  betweenFrom: z.string().nullable(),
  betweenTo: z.string().nullable(),
  notBefore: isoDateSchema.nullable(),
  sameDay: z.boolean(),
});
export type WaitlistWishesRead = z.infer<typeof waitlistWishesReadSchema>;

/** The appointment's waiting entry, as the card, popover and record read it (C2, C4). */
export const appointmentWaitlistSchema = z.object({
  entryId: idSchema,
  wishes: waitlistWishesReadSchema,
  urgent: z.boolean(),
  note: z.string().nullable(),
});
export type AppointmentWaitlist = z.infer<typeof appointmentWaitlistSchema>;

const appointmentFactsSchema = z.object({
  id: idSchema,
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  localDate: isoDateSchema,
  dentistId: idSchema,
  dentistName: z.string(),
});

export const waitlistEntrySchema = z.object({
  id: idSchema,
  branchId: idSchema,
  patient: z.object({
    id: idSchema,
    fullName: z.string(),
    displayNumber: displayNumberSchema,
    registrationIncomplete: z.boolean(),
  }),
  /** The patient's phone, else the primary guardian's; null without `patient:read`. */
  callPhone: z.string().nullable(),
  /** The appointment it brings forward. */
  appointment: appointmentFactsSchema.nullable(),
  /** Without one: the patient's soonest active appointment, booked some other way (A5). */
  otherAppointment: appointmentFactsSchema.omit({ endsAt: true }).nullable(),
  /** Null is *Any dentist*. */
  dentistId: idSchema.nullable(),
  dentistName: z.string().nullable(),
  reason: z.string(),
  visitType: visitTypeSchema.nullable(),
  durationMin: z.number().int().positive(),
  planIds: z.array(idSchema),
  /** Its awaiting follow-up; null once that follow-up expired (A5). */
  followUpId: idSchema.nullable(),
  wishes: waitlistWishesReadSchema,
  urgent: z.boolean(),
  note: z.string().nullable(),
  /** *Before* the appointment's day, or *Until* this date. */
  until: isoDateSchema,
  status: waitlistViewStatusSchema,
  lastAttempt: z
    .object({
      at: isoDateTimeSchema,
      byName: z.string(),
      outcome: waitlistAttemptOutcomeSchema,
    })
    .nullable(),
  triedToday: z.boolean(),
  createdAt: isoDateTimeSchema,
  addedByName: z.string(),
  closedAt: isoDateTimeSchema.nullable(),
  removeReason: z.string().nullable(),
  bookedAppointmentId: idSchema.nullable(),
  /** The soonest opening it fits (C1); null when none, and outside the waiting list. */
  fits: z
    .object({ openingId: idSchema, startsAt: isoDateTimeSchema, dentistId: idSchema })
    .nullable(),
});
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;

export const WAITLIST_APPOINTMENT_FILTERS = ['with', 'without'] as const;

/** `GET /scheduling/waitlist` (C1): the waiting list is one page; the others are paged. */
export const waitlistQuerySchema = z.object({
  branchId: idSchema,
  status: blankToUndefined(waitlistViewStatusSchema.default('waiting')),
  dentistId: blankToUndefined(idSchema.optional()),
  appointment: blankToUndefined(z.enum(WAITLIST_APPOINTMENT_FILTERS).optional()),
  fits: blankToUndefined(queryBooleanSchema),
  cursor: blankToUndefined(z.string().min(1).optional()),
  limit: blankToUndefined(z.coerce.number().int().min(1).max(100).default(50)),
});
export type WaitlistQuery = z.infer<typeof waitlistQuerySchema>;

export const waitlistPageSchema = z.object({
  items: z.array(waitlistEntrySchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type WaitlistPage = z.infer<typeof waitlistPageSchema>;

const spanSchema = z.object({ startsAt: isoDateTimeSchema, endsAt: isoDateTimeSchema });

/** Free time of a dentist around freed time (B1, ADR-0104): derived, never stored. */
export const waitlistOpeningSchema = z.object({
  /** Its first freed appointment: the cancelled or moved row whose time it holds. */
  id: idSchema,
  branchId: idSchema,
  dentistId: idSchema,
  dentistName: z.string(),
  date: isoDateSchema,
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  freed: z.array(spanSchema),
  freedAppointmentIds: z.array(idSchema),
  /** *Leave open*: off Today and the dashboard (B6). */
  leftOpen: z.boolean(),
  fitCount: z.number().int().nonnegative(),
});
export type WaitlistOpening = z.infer<typeof waitlistOpeningSchema>;

/** `GET /scheduling/waitlist/openings?branchId=`: the branch's openings, soonest first. */
export const waitlistOpeningsSchema = z.object({
  waitingCount: z.number().int().nonnegative(),
  openings: z.array(waitlistOpeningSchema),
});
export type WaitlistOpenings = z.infer<typeof waitlistOpeningsSchema>;

/** A row of *Fill*: the entry, and every start it may take, the default first. */
export const waitlistFitSchema = z.object({
  entry: waitlistEntrySchema,
  starts: z.array(isoDateTimeSchema).min(1),
});
export type WaitlistFit = z.infer<typeof waitlistFitSchema>;

/** `GET /scheduling/waitlist/openings/:appointmentId`: null when that time is no opening now. */
export const waitlistOpeningDetailSchema = z.object({
  opening: waitlistOpeningSchema.nullable(),
  fits: z.array(waitlistFitSchema),
});
export type WaitlistOpeningDetail = z.infer<typeof waitlistOpeningDetailSchema>;

/** Who may change an entry: its appointment's column, or the dentist it names (Access). */
export function canWriteWaitlistEntry(
  actor: { permissions: Iterable<Permission>; profileId: string | null },
  entry: { dentistId: string | null },
): boolean {
  const held = new Set(actor.permissions);
  if (held.has('appointment:write_all')) return true;
  return (
    held.has('appointment:write') &&
    actor.profileId !== null &&
    entry.dentistId !== null &&
    entry.dentistId === actor.profileId
  );
}

/** An opening of a freed appointment: the one holding `at` when it is split (ADR-0104). */
export const waitlistOpeningQuerySchema = z.object({
  at: blankToUndefined(isoDateTimeSchema.optional()),
});
export type WaitlistOpeningQuery = z.infer<typeof waitlistOpeningQuerySchema>;

/** `POST /scheduling/waitlist/openings/:appointmentId/leave-open` (B6). */
export const leaveOpeningOpenSchema = z.object({ at: isoDateTimeSchema.optional() });
export type LeaveOpeningOpen = z.infer<typeof leaveOpeningOpenSchema>;

/** What *Leave open* left: the opening, or null when that time is no opening now. */
export const leaveOpeningResultSchema = z.object({ opening: waitlistOpeningSchema.nullable() });
export type LeaveOpeningResult = z.infer<typeof leaveOpeningResultSchema>;
