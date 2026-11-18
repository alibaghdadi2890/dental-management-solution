import {
  LAB_ADJUSTMENT_KINDS,
  LAB_DELIVERY_METHODS,
  LAB_ITEM_TARGETS,
  LAB_ORDER_STATUSES,
  LAB_PRIORITIES,
  LAB_REMAKE_BORNE_BY,
  LAB_REMAKE_REASONS,
  LAB_SENT_VIA,
  LAB_SUBMISSIONS,
  LAB_TRIP_OUTCOMES,
  PAYMENT_METHODS,
} from '@dcm/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';

const money = () => numeric({ precision: 12, scale: 2 });
const instant = () => timestamp({ withTimezone: true });
const quoted = (values: readonly string[]) =>
  sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);

/**
 * A dental laboratory the clinic works with (feature 18, Part A). Never deleted: an inactive lab is
 * hidden from new orders and stays on old ones. The opening balance is what the clinic already owed
 * it when the clinic started recording (Part D, ADR-0083).
 */
export const labs = pgTable(
  'labs',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    name: text().notNull(),
    contactPerson: text(),
    phone: text(),
    email: text(),
    address: text(),
    deliveryMethods: text({ enum: LAB_DELIVERY_METHODS }).array().notNull(),
    portalUrl: text(),
    turnaroundDays: smallint().notNull(),
    note: text(),
    active: boolean().notNull().default(true),
    openingBalance: money(),
    openingBalanceOn: date(),
    currency: char({ length: 3 }).notNull(),
    createdBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('labs_tenant_idx').on(table.tenantId),
    uniqueIndex('labs_name_unique').on(table.tenantId, sql`lower(${table.name})`),
    check('labs_delivery_methods', sql`cardinality(${table.deliveryMethods}) >= 1`),
    check('labs_turnaround', sql`${table.turnaroundDays} between 1 and 365`),
    check(
      'labs_opening_balance_complete',
      sql`(${table.openingBalance} is null) = (${table.openingBalanceOn} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** One line of a lab's price list. A changed price applies to new orders only (they snapshot it). */
export const labServices = pgTable(
  'lab_services',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    labId: uuid()
      .notNull()
      .references(() => labs.id),
    name: text().notNull(),
    price: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    turnaroundDays: smallint(),
    active: boolean().notNull().default(true),
    createdBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('lab_services_tenant_idx').on(table.tenantId),
    uniqueIndex('lab_services_name_unique').on(table.labId, sql`lower(${table.name})`),
    check('lab_services_price', sql`${table.price} >= 0`),
    check(
      'lab_services_turnaround',
      sql`${table.turnaroundDays} is null or ${table.turnaroundDays} between 1 and 365`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** One row per tenant: the source of the next `lab_orders.display_number` (D7). */
export const labOrderCounters = pgTable(
  'lab_order_counters',
  {
    tenantId: tenantIdColumn().primaryKey(),
    lastValue: integer().notNull(),
    ...timestamps(),
  },
  () => [tenantIsolationPolicy()],
);

/**
 * Lab work ordered for a patient (Part B): one number, a status and a history of trips
 * (ADR-0082). `patient_id`, `dentist_id` (a staff profile, ADR-0020), `branch_id`, `visit_id` and
 * `appointment_id` have no foreign key: other modules own those tables. `cost` is the estimate
 * until someone with lab money sets it (`cost_set_by_hand`); it is owed from `first_received_on`
 * (ADR-0083). Never deleted.
 */
export const labOrders = pgTable(
  'lab_orders',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    displayNumber: integer().notNull(),
    patientId: uuid().notNull(),
    dentistId: uuid().notNull(),
    labId: uuid()
      .notNull()
      .references(() => labs.id),
    branchId: uuid().notNull(),
    visitId: uuid(),
    appointmentId: uuid(),
    status: text({ enum: LAB_ORDER_STATUSES }).notNull().default('to_send'),
    /** On hold: the status Resume returns to. */
    heldFrom: text({ enum: LAB_ORDER_STATUSES }),
    holdReason: text(),
    /** Cancelled: the status an Undo returns to. */
    cancelledFrom: text({ enum: LAB_ORDER_STATUSES }),
    priority: text({ enum: LAB_PRIORITIES }).notNull().default('normal'),
    submission: text({ enum: LAB_SUBMISSIONS }).notNull().default('physical'),
    labCaseRef: text(),
    labCaseUrl: text(),
    expectedDays: smallint().notNull(),
    notes: text(),
    planIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    cost: money().notNull(),
    costSetByHand: boolean().notNull().default(false),
    currency: char({ length: 3 }).notNull(),
    firstReceivedOn: date(),
    waitingSince: date().notNull(),
    doneOn: date(),
    cancelReason: text(),
    cancelCharge: money(),
    cancelledOn: date(),
    createdBy: uuid().notNull(),
    idempotencyKey: uuid(),
    idempotencyHash: text(),
    ...timestamps(),
  },
  (table) => [
    index('lab_orders_tenant_idx').on(table.tenantId),
    unique('lab_orders_display_number_unique').on(table.tenantId, table.displayNumber),
    index('lab_orders_status_idx').on(table.tenantId, table.status),
    index('lab_orders_patient_idx').on(table.tenantId, table.patientId),
    index('lab_orders_appointment_idx')
      .on(table.tenantId, table.appointmentId)
      .where(sql`${table.appointmentId} is not null`),
    index('lab_orders_lab_idx').on(table.tenantId, table.labId),
    uniqueIndex('lab_orders_idempotency_unique')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check('lab_orders_status', sql`${table.status} in ${quoted(LAB_ORDER_STATUSES)}`),
    check('lab_orders_held', sql`(${table.status} = 'on_hold') = (${table.heldFrom} is not null)`),
    check(
      'lab_orders_cancelled',
      sql`(${table.status} = 'cancelled') = (${table.cancelledFrom} is not null and ${table.cancelledOn} is not null)`,
    ),
    check('lab_orders_cost', sql`${table.cost} >= 0`),
    check(
      'lab_orders_cancel_charge',
      sql`${table.cancelCharge} is null or ${table.cancelCharge} >= 0`,
    ),
    check('lab_orders_expected_days', sql`${table.expectedDays} between 1 and 365`),
    tenantIsolationPolicy(),
  ],
);

/** What is ordered. Replaced as a list while the order is edited: the order's content. */
export const labOrderItems = pgTable(
  'lab_order_items',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    orderId: uuid()
      .notNull()
      .references(() => labOrders.id),
    position: smallint().notNull(),
    serviceId: uuid().references(() => labServices.id),
    description: text().notNull(),
    /** The service's price when ordered; null for a free-text item. */
    unitPrice: money(),
    turnaroundDays: smallint(),
    quantity: smallint().notNull(),
    shade: text(),
    target: text({ enum: LAB_ITEM_TARGETS }).notNull(),
    teeth: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (table) => [
    index('lab_order_items_tenant_idx').on(table.tenantId),
    index('lab_order_items_order_idx').on(table.orderId),
    check('lab_order_items_quantity', sql`${table.quantity} between 1 and 99`),
    check('lab_order_items_target', sql`${table.target} in ${quoted(LAB_ITEM_TARGETS)}`),
    check(
      'lab_order_items_teeth',
      sql`(${table.target} = 'teeth') = (cardinality(${table.teeth}) > 0)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * One trip to the lab and back (ADR-0082): opened by Mark sent, closed by Mark received; the
 * outcome says why the work went back. `promised_on` is what the lab is judged on, `expected_on`
 * what the clinic plans around.
 */
export const labOrderTrips = pgTable(
  'lab_order_trips',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    orderId: uuid()
      .notNull()
      .references(() => labOrders.id),
    seq: smallint().notNull(),
    sentOn: date().notNull(),
    sentVia: text({ enum: LAB_SENT_VIA }).notNull(),
    sentReference: text(),
    promisedOn: date().notNull(),
    expectedOn: date().notNull(),
    receivedOn: date(),
    receivedNote: text(),
    outcome: text({ enum: LAB_TRIP_OUTCOMES }),
    outcomeNote: text(),
    outcomeOn: date(),
    remakeReason: text({ enum: LAB_REMAKE_REASONS }),
    remakeBorneBy: text({ enum: LAB_REMAKE_BORNE_BY }),
    remakeCharge: money(),
    ...timestamps(),
  },
  (table) => [
    index('lab_order_trips_tenant_idx').on(table.tenantId),
    unique('lab_order_trips_seq_unique').on(table.orderId, table.seq),
    check(
      'lab_order_trips_received_after_sent',
      sql`${table.receivedOn} is null or ${table.receivedOn} >= ${table.sentOn}`,
    ),
    check(
      'lab_order_trips_outcome_after_received',
      sql`${table.outcome} is null or (${table.receivedOn} is not null and ${table.outcomeOn} is not null)`,
    ),
    check(
      'lab_order_trips_remake',
      sql`(${table.outcome} = 'remake') = (${table.remakeReason} is not null and ${table.remakeBorneBy} is not null)`,
    ),
    check(
      'lab_order_trips_remake_charge',
      sql`${table.remakeCharge} is null or (${table.remakeCharge} >= 0 and ${table.remakeBorneBy} = 'clinic')`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** The patient's files attached to an order (B1); `files` owns the files. A junction. */
export const labOrderFiles = pgTable(
  'lab_order_files',
  {
    tenantId: tenantIdColumn(),
    orderId: uuid()
      .notNull()
      .references(() => labOrders.id),
    fileId: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.orderId, table.fileId] }),
    index('lab_order_files_tenant_idx').on(table.tenantId),
    tenantIsolationPolicy(),
  ],
);

/**
 * A payment to a lab's account (O7), never to an order. Mirrored into Expenses (ADR-0085). Voided
 * with a reason, never deleted.
 */
export const labPayments = pgTable(
  'lab_payments',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    labId: uuid()
      .notNull()
      .references(() => labs.id),
    paidOn: date().notNull(),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    method: text({ enum: PAYMENT_METHODS }).notNull(),
    reference: text(),
    note: text(),
    createdBy: uuid().notNull(),
    voidedAt: instant(),
    voidedBy: uuid(),
    voidReason: text(),
    idempotencyKey: uuid(),
    idempotencyHash: text(),
    ...timestamps(),
  },
  (table) => [
    index('lab_payments_tenant_idx').on(table.tenantId),
    index('lab_payments_lab_idx').on(table.tenantId, table.labId, table.paidOn),
    uniqueIndex('lab_payments_idempotency_unique')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check('lab_payments_amount_positive', sql`${table.amount} > 0`),
    check('lab_payments_method', sql`${table.method} in ${quoted(PAYMENT_METHODS)}`),
    check(
      'lab_payments_void_complete',
      sql`(${table.voidedAt} is null) = (${table.voidedBy} is null) and (${table.voidedAt} is null) = (${table.voidReason} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** A credit or a charge on a lab's account, with its reason. Append-only. */
export const labAdjustments = pgTable(
  'lab_adjustments',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    labId: uuid()
      .notNull()
      .references(() => labs.id),
    onDate: date().notNull(),
    kind: text({ enum: LAB_ADJUSTMENT_KINDS }).notNull(),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    reason: text().notNull(),
    createdBy: uuid().notNull(),
    idempotencyKey: uuid(),
    idempotencyHash: text(),
    ...timestamps(),
  },
  (table) => [
    index('lab_adjustments_tenant_idx').on(table.tenantId),
    index('lab_adjustments_lab_idx').on(table.tenantId, table.labId, table.onDate),
    uniqueIndex('lab_adjustments_idempotency_unique')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check('lab_adjustments_amount_positive', sql`${table.amount} > 0`),
    check('lab_adjustments_kind', sql`${table.kind} in ${quoted(LAB_ADJUSTMENT_KINDS)}`),
    tenantIsolationPolicy(),
  ],
);
