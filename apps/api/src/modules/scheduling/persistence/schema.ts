import {
  APPOINTMENT_STATUSES,
  type ConflictKind,
  FOLLOW_UP_KINDS,
  FOLLOW_UP_STATUSES,
  FOLLOW_UP_TIMINGS,
  PLAN_PRIORITIES,
  type VisitType,
  WAITLIST_ATTEMPT_OUTCOMES,
  WAITLIST_STATUSES,
} from '@dcm/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';

const instant = () => timestamp({ withTimezone: true });

export const appointmentStatus = pgEnum('appointment_status', APPOINTMENT_STATUSES);
export const followUpStatus = pgEnum('follow_up_status', FOLLOW_UP_STATUSES);
export const waitlistStatus = pgEnum('waitlist_status', WAITLIST_STATUSES);

/**
 * A reservation of a dentist and optionally a room of a branch (ADR-0066). Room and patient overlaps
 * are refused by the exclusion constraints `appointments_room_no_overlap` and
 * `appointments_patient_no_overlap` (migration 0056, ADR-0067), written by hand as drizzle-kit has no
 * syntax for them. A move inserts a new row with the same `lineage_id`; history is never rewritten.
 * `patient_id`, `dentist_id`, `room_id`, `branch_id` and the visit have no foreign key: other modules
 * own those tables (CLAUDE.md §4 rule 1).
 */
export const appointments = pgTable(
  'appointments',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    branchId: uuid().notNull(),
    patientId: uuid().notNull(),
    /** A staff profile id (ADR-0020). */
    dentistId: uuid().notNull(),
    roomId: uuid(),
    /** The room came from *Auto*: a move chooses it again (G8). */
    roomAuto: boolean().notNull().default(false),
    startsAt: instant().notNull(),
    endsAt: instant().notNull(),
    status: appointmentStatus().notNull().default('booked'),
    reason: text().notNull(),
    visitType: text().$type<VisitType>(),
    planIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    followUpId: uuid(),
    /** The live visit a booking from the Complete dialog comes from (A15). */
    sourceVisitId: uuid(),
    lineageId: uuid().notNull(),
    /** The warnings an override went through (A20). */
    overridden: text()
      .array()
      .$type<ConflictKind[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The auth user ids of whoever made each change (CLAUDE.md §7). */
    bookedBy: uuid().notNull(),
    confirmedBy: uuid(),
    confirmedAt: instant(),
    checkedInBy: uuid(),
    checkedInAt: instant(),
    /** Who took it to a terminal status, and when. */
    closedBy: uuid(),
    closedAt: instant(),
    cancelReason: text(),
    /** The waitlist entry this row was booked or moved from (feature 21, B4). */
    waitlistEntryId: uuid(),
    /** `Idempotency-Key` of the request that created the row, and its hash (ADR-0037). */
    idempotencyKey: uuid(),
    idempotencyHash: text(),
    ...timestamps(),
  },
  (table) => [
    index('appointments_tenant_idx').on(table.tenantId),
    index('appointments_branch_starts_idx').on(table.tenantId, table.branchId, table.startsAt),
    // The dashboards and the Schedule's List view (feature 19): every branch by start.
    index('appointments_starts_idx').on(table.tenantId, table.startsAt),
    index('appointments_dentist_starts_idx').on(table.tenantId, table.dentistId, table.startsAt),
    index('appointments_patient_starts_idx').on(table.tenantId, table.patientId, table.startsAt),
    index('appointments_lineage_idx').on(table.tenantId, table.lineageId),
    index('appointments_source_visit_idx').on(table.tenantId, table.sourceVisitId),
    uniqueIndex('appointments_idempotency_key_unique')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    uniqueIndex('appointments_follow_up_active_unique')
      .on(table.tenantId, table.followUpId)
      .where(
        sql`${table.followUpId} is not null and ${table.status} in ('booked', 'confirmed', 'checked_in', 'in_room')`,
      ),
    check('appointments_range', sql`${table.endsAt} > ${table.startsAt}`),
    tenantIsolationPolicy(),
  ],
);

/**
 * The dentist's recommendation for the patient's next appointment (ADR-0069). One visit has at most
 * one. `expired` is derived at read from `window_from` and the tenant's window, so a Settings change
 * applies at once and a reopened follow-up gets a fresh window (G7).
 */
export const followUps = pgTable(
  'follow_ups',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    branchId: uuid().notNull(),
    patientId: uuid().notNull(),
    sourceVisitId: uuid().notNull(),
    sourceVisitNumber: integer().notNull(),
    /** A staff profile id: the dentist who recommended it. */
    recommendedBy: uuid().notNull(),
    preferredDentistId: uuid(),
    kind: text({ enum: FOLLOW_UP_KINDS }).notNull(),
    title: text().notNull(),
    planIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    priority: text({ enum: PLAN_PRIORITIES }),
    sessionNumber: smallint(),
    sessionTotal: smallint(),
    durationMin: integer().notNull(),
    timing: text({ enum: FOLLOW_UP_TIMINGS }).notNull(),
    customDate: date(),
    /** The source visit's tenant-local date. */
    visitDate: date().notNull(),
    dueOn: date(),
    /** Where the window that ends in expiry starts: the due date, or a later reopen date. */
    windowFrom: date().notNull(),
    note: text(),
    clinicalPrep: text(),
    status: followUpStatus().notNull().default('awaiting'),
    /** The *Patient will call* tag: an auth user id, and when. */
    willCallBy: uuid(),
    willCallAt: instant(),
    declinedBy: uuid(),
    declinedAt: instant(),
    declinedReason: text(),
    /** The auth user id of whoever completed the visit. */
    createdBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('follow_ups_tenant_idx').on(table.tenantId),
    index('follow_ups_status_due_idx').on(table.tenantId, table.status, table.dueOn),
    index('follow_ups_patient_idx').on(table.tenantId, table.patientId),
    uniqueIndex('follow_ups_source_visit_unique').on(table.tenantId, table.sourceVisitId),
    tenantIsolationPolicy(),
  ],
);

/** One weekday of a branch: 0 is Sunday (ADR-0068). A closed day keeps its times. */
export const branchOpeningHours = pgTable(
  'branch_opening_hours',
  {
    tenantId: tenantIdColumn(),
    branchId: uuid().notNull(),
    weekday: smallint().notNull(),
    isOpen: boolean().notNull(),
    fromTime: time().notNull(),
    toTime: time().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.branchId, table.weekday] }),
    index('branch_opening_hours_tenant_idx').on(table.tenantId),
    check('branch_opening_hours_weekday', sql`${table.weekday} between 0 and 6`),
    check(
      'branch_opening_hours_range',
      sql`not ${table.isOpen} or ${table.fromTime} < ${table.toTime}`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** One row per tenant; none reads as the default window. */
export const schedulingSettings = pgTable(
  'scheduling_settings',
  {
    tenantId: tenantIdColumn().primaryKey(),
    followUpWindowDays: smallint().notNull(),
    ...timestamps(),
  },
  (table) => [
    check('scheduling_settings_window', sql`${table.followUpWindowDays} between 1 and 365`),
    tenantIsolationPolicy(),
  ],
);

/**
 * The waitlist (feature 21, ADR-0103): a patient who wants an earlier time for `appointment_id`, or
 * who waits with none. With an appointment, its reason, type, duration and plans are the
 * appointment's and these columns keep what the entry had when it was added. `expired` is derived
 * (ADR-0107), so a waiting entry past its date stays `waiting` here; one waiting entry per
 * appointment and one without is the service's rule, under a per-patient lock. Never deleted.
 */
export const waitlistEntries = pgTable(
  'waitlist_entries',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    branchId: uuid().notNull(),
    patientId: uuid().notNull(),
    appointmentId: uuid(),
    /** A staff profile id; null is *Any dentist*. */
    dentistId: uuid(),
    reason: text().notNull(),
    visitType: text().$type<VisitType>(),
    durationMin: integer().notNull(),
    planIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    followUpId: uuid(),
    /** Without an appointment: the last day an opening may fall on (clinic-local). */
    untilOn: date(),
    /** 0 is Sunday; empty is any day. */
    weekdays: smallint()
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    betweenFrom: time(),
    betweenTo: time(),
    notBefore: date(),
    sameDay: boolean().notNull().default(false),
    urgent: boolean().notNull().default(false),
    note: text(),
    status: waitlistStatus().notNull().default('waiting'),
    /** The last call only: calls are not logged (decision 7). */
    attemptAt: instant(),
    attemptBy: uuid(),
    attemptOutcome: text({ enum: WAITLIST_ATTEMPT_OUTCOMES }),
    /** The cancellation that made it wait without an appointment, and whether it was new then. */
    cancelledAppointmentId: uuid(),
    cancelCreated: boolean().notNull().default(false),
    bookedAppointmentId: uuid(),
    removeReason: text(),
    /** Auth user ids (CLAUDE.md §7). */
    createdBy: uuid().notNull(),
    closedBy: uuid(),
    closedAt: instant(),
    ...timestamps(),
  },
  (table) => [
    index('waitlist_entries_tenant_idx').on(table.tenantId),
    index('waitlist_entries_branch_status_idx').on(table.tenantId, table.branchId, table.status),
    index('waitlist_entries_patient_idx').on(table.tenantId, table.patientId),
    index('waitlist_entries_appointment_idx').on(table.tenantId, table.appointmentId),
    index('waitlist_entries_follow_up_idx').on(table.tenantId, table.followUpId),
    index('waitlist_entries_cancelled_idx').on(table.tenantId, table.cancelledAppointmentId),
    check(
      'waitlist_entries_kind',
      sql`(${table.appointmentId} is null) = (${table.untilOn} is not null)`,
    ),
    check(
      'waitlist_entries_between',
      sql`(${table.betweenFrom} is null) = (${table.betweenTo} is null) and (${table.betweenFrom} is null or ${table.betweenFrom} < ${table.betweenTo})`,
    ),
    check('waitlist_entries_duration', sql`${table.durationMin} between 5 and 480`),
    tenantIsolationPolicy(),
  ],
);

/** *Leave open* (B6): a freed appointment whose opening stays off Today. */
export const waitlistLeftOpen = pgTable(
  'waitlist_left_open',
  {
    tenantId: tenantIdColumn(),
    appointmentId: uuid().primaryKey(),
    leftBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [index('waitlist_left_open_tenant_idx').on(table.tenantId), tenantIsolationPolicy()],
);
