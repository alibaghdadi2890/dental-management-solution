import {
  DIAGNOSIS_STATUSES,
  DISCOUNT_MODES,
  PLAN_STATUSES,
  SURFACES,
  TOOTH_PRESENCE_VALUES,
  VISIT_STATUSES,
} from '@dcm/contracts';
import { sql, type AnyColumn } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  deletedAtColumn,
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';
import { LIVE_VISIT_STATUSES } from '../domain/visit-lifecycle';

/** Stable and not tenant-extendable, hence a Postgres enum (CLAUDE.md §7). */
export const chargeUnit = pgEnum('charge_unit', ['per_tooth', 'per_jaw']);

/**
 * The service catalog ("procedures", ADR-0002). Prices are money in the tenant currency at the
 * time they were set (ADR-0015). Codes are unique among live rows, so a deleted code can return.
 */
export const procedures = pgTable(
  'procedures',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    code: text().notNull(),
    name: text().notNull(),
    category: text(),
    chargeUnit: chargeUnit().notNull(),
    priceAmount: numeric({ precision: 12, scale: 2 }).notNull(),
    priceCurrency: char({ length: 3 }).notNull(),
    frequent: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    deletedAt: deletedAtColumn(),
    ...timestamps(),
  },
  (table) => [
    index('procedures_tenant_idx').on(table.tenantId),
    // Target of the visit_services/treatment_plans composite foreign keys.
    unique('procedures_tenant_id_unique').on(table.tenantId, table.id),
    uniqueIndex('procedures_code_unique')
      .on(table.tenantId, sql`lower(${table.code})`)
      .where(sql`${table.deletedAt} is null`),
    check('procedures_price_non_negative', sql`${table.priceAmount} >= 0`),
    tenantIsolationPolicy(),
  ],
);

/** The diagnosis catalog: what dentists record at an examination. No price. */
export const diagnoses = pgTable(
  'diagnoses',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    code: text().notNull(),
    name: text().notNull(),
    category: text(),
    frequent: boolean().notNull().default(false),
    active: boolean().notNull().default(true),
    deletedAt: deletedAtColumn(),
    ...timestamps(),
  },
  (table) => [
    index('diagnoses_tenant_idx').on(table.tenantId),
    // Target of the patient_diagnoses composite foreign key.
    unique('diagnoses_tenant_id_unique').on(table.tenantId, table.id),
    uniqueIndex('diagnoses_code_unique')
      .on(table.tenantId, sql`lower(${table.code})`)
      .where(sql`${table.deletedAt} is null`),
    tenantIsolationPolicy(),
  ],
);

// Feature 4a: visits and the clinical record (spec §Data model → clinical). Patient, branch, room
// and dentist ids point at other modules' tables, so they carry no foreign key (CLAUDE.md §4 rule
// 1). Foreign keys inside `clinical` are composite with `tenant_id` (the `rooms` pattern), so a row
// can never point at another tenant's row. Every `*_by` column is an auth user id, the actor
// (W10); `dentist_id` is the clinically responsible dentist's staff profile id (ADR-0020).

/** Stable lifecycles, not tenant-extendable (CLAUDE.md §7); the values come from contracts. */
export const visitStatus = pgEnum('visit_status', VISIT_STATUSES);
export const discountMode = pgEnum('discount_mode', DISCOUNT_MODES);
export const diagnosisStatus = pgEnum('diagnosis_status', DIAGNOSIS_STATUSES);
export const planStatus = pgEnum('plan_status', PLAN_STATUSES);
export const toothPresence = pgEnum('tooth_presence', TOOTH_PRESENCE_VALUES);
/** A correction with a reason (4b), or the discount set at checkout (checkout handoff, C4). */
export const visitAmendmentKind = pgEnum('visit_amendment_kind', [
  'amendment',
  'checkout_discount',
]);

const money = () => numeric({ precision: 12, scale: 2 });
const instant = () => timestamp({ withTimezone: true });
const surfacesColumn = () =>
  text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

const quotedList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

/** Canonical FDI tooth code (ADR-0021): exactly the 52 codes of `toothCodeSchema`. */
const toothCodeCheck = (name: string, column: AnyColumn) =>
  check(name, sql`${column} ~ '^([1-4][1-8]|[5-8][1-5])$'`);

/** Surface keys only (`SURFACES`); duplicates and per-tooth validity are the service's checks. */
const surfacesCheck = (name: string, column: AnyColumn) =>
  check(name, sql`${column} <@ ${sql.raw(`ARRAY[${quotedList(SURFACES)}]::text[]`)}`);

const LIVE_STATUS_LIST = sql.raw(`(${quotedList(LIVE_VISIT_STATUSES)})`);
/** Statuses that carry frozen money and a completion: completed, and those corrected since.
 * CHECKs compare them as text: the migrations run in one transaction, and Postgres refuses a
 * literal of an enum value added in the same transaction (0019). */
const FINISHED_STATUS_LIST = sql.raw(`(${quotedList(['completed', 'amended', 'voided'])})`);

/**
 * A clinical encounter (spec W1–W4, W19). Money is computed live from the services while the visit
 * is live and frozen into `subtotal`/`discount_amount`/`total` at completion; `discount_value` is
 * the raw entry (a percent or an amount per `discount_mode`), capped only when computed.
 */
export const visits = pgTable(
  'visits',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    /** Per-tenant counter value minted at start (`visit_counters`), shown as `V-000123` (4b, D9). */
    displayNumber: integer().notNull(),
    patientId: uuid().notNull(),
    branchId: uuid().notNull(),
    /** Null when the branch has no active rooms (W7). */
    roomId: uuid(),
    dentistId: uuid().notNull(),
    startedBy: uuid().notNull(),
    status: visitStatus().notNull().default('in_progress'),
    /** The tenant-local date the visit started on. */
    localDate: date().notNull(),
    startedAt: instant().notNull(),
    pausedAt: instant(),
    pausedSeconds: integer().notNull().default(0),
    completedAt: instant(),
    completedBy: uuid(),
    discardedAt: instant(),
    discardedBy: uuid(),
    voidedAt: instant(),
    voidedBy: uuid(),
    voidReason: text(),
    durationMinutes: integer(),
    notes: text().notNull().default(''),
    discountMode: discountMode().notNull().default('percent'),
    discountValue: money().notNull().default('0'),
    /** The tenant currency when the visit started; every price on it must match (W12). */
    currency: char({ length: 3 }).notNull(),
    subtotal: money(),
    discountAmount: money(),
    total: money(),
    ...timestamps(),
  },
  (table) => [
    index('visits_tenant_idx').on(table.tenantId),
    // Target of the composite foreign keys from the record tables.
    unique('visits_tenant_id_unique').on(table.tenantId, table.id),
    unique('visits_display_number_unique').on(table.tenantId, table.displayNumber),
    // One live visit per room (W1); `VisitsService.start` maps a violation to 409 visit.room_busy.
    uniqueIndex('visits_room_live_unique')
      .on(table.tenantId, table.roomId)
      .where(sql`${table.status} in ${LIVE_STATUS_LIST} and ${table.roomId} is not null`),
    index('visits_patient_started_idx').on(table.tenantId, table.patientId, table.startedAt.desc()),
    // `lastRoomToday`: the start popover's default room (V3).
    index('visits_started_by_date_idx').on(table.tenantId, table.startedBy, table.localDate),
    // The visits list (4b): a branch's visits, newest first, paged by (started_at, id).
    index('visits_branch_started_idx').on(
      table.tenantId,
      table.branchId,
      table.startedAt.desc(),
      table.id.desc(),
    ),
    index('visits_live_idx')
      .on(table.tenantId, table.status)
      .where(sql`${table.status} in ${LIVE_STATUS_LIST}`),
    check('visits_paused_seconds_non_negative', sql`${table.pausedSeconds} >= 0`),
    check('visits_discount_value_non_negative', sql`${table.discountValue} >= 0`),
    check(
      'visits_paused_consistent',
      sql`(${table.pausedAt} is not null) = (${table.status} = 'paused')`,
    ),
    check(
      'visits_completed_fields',
      sql`${table.status}::text not in ${FINISHED_STATUS_LIST} or (${table.completedAt} is not null and ${table.completedBy} is not null and ${table.durationMinutes} is not null and ${table.subtotal} is not null and ${table.discountAmount} is not null and ${table.total} is not null)`,
    ),
    check(
      'visits_discarded_fields',
      sql`${table.status} <> 'discarded' or (${table.discardedAt} is not null and ${table.discardedBy} is not null)`,
    ),
    check(
      'visits_voided_fields',
      sql`(${table.status}::text = 'voided') = (${table.voidedAt} is not null and ${table.voidedBy} is not null and ${table.voidReason} is not null)`,
    ),
    check(
      'visits_void_reason_length',
      sql`${table.voidReason} is null or char_length(${table.voidReason}) >= 3`,
    ),
    check(
      'visits_duration_positive',
      sql`${table.durationMinutes} is null or ${table.durationMinutes} >= 1`,
    ),
    check(
      'visits_money_consistent',
      sql`${table.total} is null or (${table.subtotal} >= 0 and ${table.discountAmount} >= 0 and ${table.discountAmount} <= ${table.subtotal} and ${table.total} = ${table.subtotal} - ${table.discountAmount})`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** One row per tenant: the source of the next `visits.display_number` (4b, D9). */
export const visitCounters = pgTable(
  'visit_counters',
  {
    tenantId: tenantIdColumn().primaryKey(),
    lastValue: integer().notNull(),
    ...timestamps(),
  },
  () => [tenantIsolationPolicy()],
);

/**
 * One amendment of a completed visit (4b, D1–D4, ADR-0025): append-only (no UPDATE/DELETE grant),
 * the visit as it was and as it became (`AmendmentSnapshot`), the reason and the money delta
 * `billing` posts. The visit row and its services hold the current state; this is its history.
 */
export const visitAmendments = pgTable(
  'visit_amendments',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    visitId: uuid().notNull(),
    /** 1, 2, … per visit. */
    sequence: integer().notNull(),
    kind: visitAmendmentKind().notNull().default('amendment'),
    /** Required for an amendment; optional for a checkout discount. */
    reason: text(),
    before: jsonb().notNull(),
    after: jsonb().notNull(),
    /** `after.total − before.total`, in the visit currency. */
    delta: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    amendedBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('visit_amendments_tenant_idx').on(table.tenantId),
    uniqueIndex('visit_amendments_sequence_unique').on(
      table.tenantId,
      table.visitId,
      table.sequence,
    ),
    foreignKey({
      name: 'visit_amendments_visit_fk',
      columns: [table.tenantId, table.visitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    check('visit_amendments_sequence_positive', sql`${table.sequence} >= 1`),
    check(
      'visit_amendments_reason_length',
      sql`(${table.kind}::text = 'checkout_discount' and ${table.reason} is null) or (${table.reason} is not null and char_length(${table.reason}) >= 3)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * A diagnosis recorded on a patient's tooth (W9: `diagnoses` is the catalog). It belongs to the
 * patient and is dated by the visit that recorded it; a later visit may resolve it. The catalog
 * item's code, name and category are snapshots, so later catalog edits never change the record.
 */
export const patientDiagnoses = pgTable(
  'patient_diagnoses',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    patientId: uuid().notNull(),
    toothCode: text().notNull(),
    surfaces: surfacesColumn(),
    diagnosisId: uuid().notNull(),
    code: text().notNull(),
    name: text().notNull(),
    category: text(),
    status: diagnosisStatus().notNull().default('active'),
    note: text(),
    dentistId: uuid().notNull(),
    recordedBy: uuid().notNull(),
    recordedInVisitId: uuid().notNull(),
    recordedAt: instant().notNull(),
    resolvedInVisitId: uuid(),
    resolvedAt: instant(),
    deletedAt: deletedAtColumn(),
    ...timestamps(),
  },
  (table) => [
    index('patient_diagnoses_tenant_idx').on(table.tenantId),
    // Target of the treatment_plans composite foreign key.
    unique('patient_diagnoses_tenant_id_unique').on(table.tenantId, table.id),
    index('patient_diagnoses_patient_tooth_idx').on(
      table.tenantId,
      table.patientId,
      table.toothCode,
    ),
    foreignKey({
      name: 'patient_diagnoses_diagnosis_fk',
      columns: [table.tenantId, table.diagnosisId],
      foreignColumns: [diagnoses.tenantId, diagnoses.id],
    }),
    foreignKey({
      name: 'patient_diagnoses_recorded_visit_fk',
      columns: [table.tenantId, table.recordedInVisitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'patient_diagnoses_resolved_visit_fk',
      columns: [table.tenantId, table.resolvedInVisitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    toothCodeCheck('patient_diagnoses_tooth_code_format', table.toothCode),
    surfacesCheck('patient_diagnoses_surfaces_valid', table.surfaces),
    // Resolve stamps both fields; reopen clears both.
    check(
      'patient_diagnoses_resolved_fields',
      sql`case when ${table.status} = 'resolved' then ${table.resolvedInVisitId} is not null and ${table.resolvedAt} is not null else ${table.resolvedInVisitId} is null and ${table.resolvedAt} is null end`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * One planned procedure on a patient (W9), recorded in a visit and performed or cancelled in the
 * same or a later one. The catalog item and its price are snapshots taken when it was planned.
 */
export const treatmentPlans = pgTable(
  'treatment_plans',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    patientId: uuid().notNull(),
    /** Set iff `charge_unit` is `per_tooth` (W11). */
    toothCode: text(),
    surfaces: surfacesColumn(),
    procedureId: uuid().notNull(),
    code: text().notNull(),
    name: text().notNull(),
    category: text(),
    chargeUnit: chargeUnit().notNull(),
    priceAmount: money().notNull(),
    priceCurrency: char({ length: 3 }).notNull(),
    /** The tooth's most recent active diagnosis when planned; unlinked if that record is removed. */
    diagnosisRecordId: uuid(),
    status: planStatus().notNull().default('planned'),
    note: text(),
    dentistId: uuid().notNull(),
    recordedBy: uuid().notNull(),
    recordedInVisitId: uuid().notNull(),
    recordedAt: instant().notNull(),
    performedInVisitId: uuid(),
    performedAt: instant(),
    cancelledInVisitId: uuid(),
    cancelledAt: instant(),
    deletedAt: deletedAtColumn(),
    ...timestamps(),
  },
  (table) => [
    index('treatment_plans_tenant_idx').on(table.tenantId),
    // Target of the visit_services composite foreign key.
    unique('treatment_plans_tenant_id_unique').on(table.tenantId, table.id),
    index('treatment_plans_patient_tooth_idx').on(table.tenantId, table.patientId, table.toothCode),
    foreignKey({
      name: 'treatment_plans_procedure_fk',
      columns: [table.tenantId, table.procedureId],
      foreignColumns: [procedures.tenantId, procedures.id],
    }),
    foreignKey({
      name: 'treatment_plans_diagnosis_record_fk',
      columns: [table.tenantId, table.diagnosisRecordId],
      foreignColumns: [patientDiagnoses.tenantId, patientDiagnoses.id],
    }),
    foreignKey({
      name: 'treatment_plans_recorded_visit_fk',
      columns: [table.tenantId, table.recordedInVisitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'treatment_plans_performed_visit_fk',
      columns: [table.tenantId, table.performedInVisitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'treatment_plans_cancelled_visit_fk',
      columns: [table.tenantId, table.cancelledInVisitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    toothCodeCheck('treatment_plans_tooth_code_format', table.toothCode),
    surfacesCheck('treatment_plans_surfaces_valid', table.surfaces),
    check(
      'treatment_plans_tooth_matches_unit',
      sql`(${table.toothCode} is not null) = (${table.chargeUnit} = 'per_tooth')`,
    ),
    check('treatment_plans_price_non_negative', sql`${table.priceAmount} >= 0`),
    // Perform stamps both fields and its undo clears both; cancel likewise.
    check(
      'treatment_plans_performed_fields',
      sql`case when ${table.status} = 'performed' then ${table.performedInVisitId} is not null and ${table.performedAt} is not null else ${table.performedInVisitId} is null and ${table.performedAt} is null end`,
    ),
    check(
      'treatment_plans_cancelled_fields',
      sql`case when ${table.status} = 'cancelled' then ${table.cancelledInVisitId} is not null and ${table.cancelledAt} is not null else ${table.cancelledInVisitId} is null and ${table.cancelledAt} is null end`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * A service performed in a visit: the catalog item as it was when added (snapshot), and its base
 * price and line discount in the visit currency. `plan_id` is set when performing a plan created
 * it; removing the service puts the plan back to `planned`.
 */
export const visitServices = pgTable(
  'visit_services',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    visitId: uuid().notNull(),
    procedureId: uuid().notNull(),
    code: text().notNull(),
    name: text().notNull(),
    category: text(),
    chargeUnit: chargeUnit().notNull(),
    /** Set iff `charge_unit` is `per_tooth` (W11). */
    toothCode: text(),
    surfaces: surfacesColumn(),
    baseAmount: money().notNull(),
    discountAmount: money().notNull().default('0'),
    planId: uuid(),
    recordedBy: uuid().notNull(),
    deletedAt: deletedAtColumn(),
    ...timestamps(),
  },
  (table) => [
    index('visit_services_tenant_idx').on(table.tenantId),
    index('visit_services_visit_idx').on(table.tenantId, table.visitId),
    // A plan is performed at most once; undoing it soft-deletes the service and frees the plan.
    uniqueIndex('visit_services_plan_unique')
      .on(table.tenantId, table.planId)
      .where(sql`${table.deletedAt} is null and ${table.planId} is not null`),
    foreignKey({
      name: 'visit_services_visit_fk',
      columns: [table.tenantId, table.visitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    foreignKey({
      name: 'visit_services_procedure_fk',
      columns: [table.tenantId, table.procedureId],
      foreignColumns: [procedures.tenantId, procedures.id],
    }),
    foreignKey({
      name: 'visit_services_plan_fk',
      columns: [table.tenantId, table.planId],
      foreignColumns: [treatmentPlans.tenantId, treatmentPlans.id],
    }),
    toothCodeCheck('visit_services_tooth_code_format', table.toothCode),
    surfacesCheck('visit_services_surfaces_valid', table.surfaces),
    check(
      'visit_services_tooth_matches_unit',
      sql`(${table.toothCode} is not null) = (${table.chargeUnit} = 'per_tooth')`,
    ),
    check(
      'visit_services_discount_within_base',
      sql`${table.discountAmount} >= 0 and ${table.discountAmount} <= ${table.baseAmount}`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * Which tooth is present at a succession position (W5): the primary tooth or its permanent
 * successor. A pure state row, one per patient and position, changed only inside a live visit
 * (W15). No row means the dentition stage decides (`presentTooth`).
 */
export const toothStatus = pgTable(
  'tooth_status',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    patientId: uuid().notNull(),
    /** The permanent FDI code of the column, positions 1–5 (`SUCCESSION_POSITIONS`). */
    position: text().notNull(),
    present: toothPresence().notNull(),
    changedInVisitId: uuid().notNull(),
    changedBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('tooth_status_tenant_idx').on(table.tenantId),
    uniqueIndex('tooth_status_position_unique').on(table.tenantId, table.patientId, table.position),
    foreignKey({
      name: 'tooth_status_changed_visit_fk',
      columns: [table.tenantId, table.changedInVisitId],
      foreignColumns: [visits.tenantId, visits.id],
    }),
    check('tooth_status_position_format', sql`${table.position} ~ '^[1-4][1-5]$'`),
    tenantIsolationPolicy(),
  ],
);
