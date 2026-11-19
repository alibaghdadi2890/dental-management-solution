import {
  BATCH_SOURCES,
  COUNT_STATUSES,
  INVENTORY_CATEGORY_KEYS,
  MOVEMENT_KINDS,
  MOVEMENT_REASONS,
  PAYMENT_METHODS,
  PRICE_PER,
  SUPPLIER_ADJUSTMENT_KINDS,
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
 * What the clinic stocks is grouped by (feature 20a, Part A): the twelve predefined categories,
 * translated by key, and the clinic's own, named. The expense categories' rules (ADR-0094).
 */
export const inventoryCategories = pgTable(
  'inventory_categories',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    key: text({ enum: INVENTORY_CATEGORY_KEYS }),
    name: text(),
    active: boolean().notNull().default(true),
    /** Null for the rows the system seeded. */
    createdBy: uuid(),
    ...timestamps(),
  },
  (table) => [
    index('inventory_categories_tenant_idx').on(table.tenantId),
    uniqueIndex('inventory_categories_key_unique')
      .on(table.tenantId, table.key)
      .where(sql`${table.key} is not null`),
    uniqueIndex('inventory_categories_name_unique')
      .on(table.tenantId, sql`lower(${table.name})`)
      .where(sql`${table.name} is not null`),
    check(
      'inventory_categories_key_or_name',
      sql`(${table.key} is null) <> (${table.name} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** A supplier the clinic buys from (Part D). Never deleted. */
export const inventorySuppliers = pgTable(
  'inventory_suppliers',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    name: text().notNull(),
    contactPerson: text(),
    phone: text(),
    email: text(),
    address: text(),
    note: text(),
    active: boolean().notNull().default(true),
    openingBalance: money(),
    openingBalanceOn: date(),
    currency: char({ length: 3 }).notNull(),
    createdBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('inventory_suppliers_tenant_idx').on(table.tenantId),
    uniqueIndex('inventory_suppliers_name_unique').on(table.tenantId, sql`lower(${table.name})`),
    check(
      'inventory_suppliers_opening_balance_complete',
      sql`(${table.openingBalance} is null) = (${table.openingBalanceOn} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * What the clinic stocks (Part A). The unit is the smallest thing counted; a pack holds
 * `pack_size` units. Never deleted; the unit and pack size lock once the item has moved.
 */
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    name: text().notNull(),
    code: text(),
    categoryId: uuid()
      .notNull()
      .references(() => inventoryCategories.id),
    unit: text().notNull(),
    packName: text(),
    packSize: integer(),
    reorderLevel: integer(),
    usualSupplierId: uuid().references(() => inventorySuppliers.id),
    usualOrderPacks: integer(),
    tracksExpiry: boolean().notNull().default(false),
    note: text(),
    active: boolean().notNull().default(true),
    createdBy: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('inventory_items_tenant_idx').on(table.tenantId),
    uniqueIndex('inventory_items_name_unique').on(table.tenantId, sql`lower(${table.name})`),
    uniqueIndex('inventory_items_code_unique')
      .on(table.tenantId, sql`lower(${table.code})`)
      .where(sql`${table.code} is not null`),
    check('inventory_items_pack', sql`(${table.packName} is null) = (${table.packSize} is null)`),
    check('inventory_items_pack_size', sql`${table.packSize} is null or ${table.packSize} >= 1`),
    check(
      'inventory_items_reorder_level',
      sql`${table.reorderLevel} is null or ${table.reorderLevel} >= 0`,
    ),
    check(
      'inventory_items_usual_order',
      sql`${table.usualOrderPacks} is null or ${table.usualOrderPacks} >= 1`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * An item's state in one branch (B6): its own reorder level, _Ordered_, _To count_. Created on
 * first need; the stock itself is in the batches.
 */
export const inventoryItemBranches = pgTable(
  'inventory_item_branches',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    itemId: uuid()
      .notNull()
      .references(() => inventoryItems.id),
    branchId: uuid().notNull(),
    reorderLevel: integer(),
    orderedOn: date(),
    orderedNote: text(),
    orderedBy: uuid(),
    toCountAt: instant(),
    toCountBy: uuid(),
    ...timestamps(),
  },
  (table) => [
    index('inventory_item_branches_tenant_idx').on(table.tenantId),
    unique('inventory_item_branches_unique').on(table.itemId, table.branchId),
    index('inventory_item_branches_branch_idx').on(table.tenantId, table.branchId),
    check(
      'inventory_item_branches_reorder_level',
      sql`${table.reorderLevel} is null or ${table.reorderLevel} >= 0`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** One row per tenant: the source of the next receipt number (D10). */
export const inventoryReceiptCounters = pgTable(
  'inventory_receipt_counters',
  {
    tenantId: tenantIdColumn().primaryKey(),
    lastValue: integer().notNull(),
    ...timestamps(),
  },
  () => [tenantIsolationPolicy()],
);

/**
 * A delivery received (B1): from a registered supplier (owed once priced) or a one-off purchase
 * with a typed payee (priced and paid when recorded). Its lines are its batches. Voided with a
 * reason, never deleted.
 */
export const inventoryReceipts = pgTable(
  'inventory_receipts',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    displayNumber: integer().notNull(),
    supplierId: uuid().references(() => inventorySuppliers.id),
    payee: text(),
    branchId: uuid().notNull(),
    receivedOn: date().notNull(),
    invoiceNumber: text(),
    invoiceDate: date(),
    discount: money(),
    charges: money(),
    currency: char({ length: 3 }).notNull(),
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
    index('inventory_receipts_tenant_idx').on(table.tenantId),
    unique('inventory_receipts_display_number_unique').on(table.tenantId, table.displayNumber),
    index('inventory_receipts_supplier_idx').on(table.tenantId, table.supplierId, table.receivedOn),
    index('inventory_receipts_received_idx').on(table.tenantId, table.receivedOn),
    uniqueIndex('inventory_receipts_idempotency_unique')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check(
      'inventory_receipts_supplier_or_payee',
      sql`(${table.supplierId} is null) <> (${table.payee} is null)`,
    ),
    check('inventory_receipts_discount', sql`${table.discount} is null or ${table.discount} >= 0`),
    check('inventory_receipts_charges', sql`${table.charges} is null or ${table.charges} >= 0`),
    check(
      'inventory_receipts_void_complete',
      sql`(${table.voidedAt} is null) = (${table.voidedBy} is null) and (${table.voidedAt} is null) = (${table.voidReason} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * Stock of one item in one branch with one origin (B2, ADR-0095): a receipt's line, an opening
 * stock entry, or a count's surplus with no batch to join. `quantity_left` is the sum of its
 * movement lines, written only with them; `amount` is what `quantity` cost (null = to price).
 */
export const inventoryBatches = pgTable(
  'inventory_batches',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    itemId: uuid()
      .notNull()
      .references(() => inventoryItems.id),
    branchId: uuid().notNull(),
    source: text({ enum: BATCH_SOURCES }).notNull(),
    receiptId: uuid().references(() => inventoryReceipts.id),
    position: smallint(),
    lot: text(),
    expiresOn: date(),
    receivedOn: date().notNull(),
    quantity: integer().notNull(),
    quantityLeft: integer().notNull(),
    price: money(),
    pricePer: text({ enum: PRICE_PER }),
    amount: money(),
    currency: char({ length: 3 }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index('inventory_batches_tenant_idx').on(table.tenantId),
    index('inventory_batches_item_idx').on(table.tenantId, table.branchId, table.itemId),
    index('inventory_batches_receipt_idx')
      .on(table.receiptId)
      .where(sql`${table.receiptId} is not null`),
    check('inventory_batches_source', sql`${table.source} in ${quoted(BATCH_SOURCES)}`),
    check(
      'inventory_batches_receipt',
      sql`(${table.source} = 'receipt') = (${table.receiptId} is not null)`,
    ),
    check('inventory_batches_quantity', sql`${table.quantity} >= 0`),
    check('inventory_batches_left', sql`${table.quantityLeft} >= 0`),
    check(
      'inventory_batches_priced',
      sql`(${table.price} is null) = (${table.amount} is null) and (${table.price} is null) = (${table.pricePer} is null)`,
    ),
    check(
      'inventory_batches_amount',
      sql`${table.amount} is null or (${table.amount} >= 0 and ${table.price} >= 0)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * One change by a person to one item in one branch (ADR-0095): what it did in total and why.
 * `action_id` groups one request's movements (a take-out of several items, a count applied, a
 * receipt). Never changed but for being reversed once.
 */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    actionId: uuid().notNull(),
    kind: text({ enum: MOVEMENT_KINDS }).notNull(),
    itemId: uuid()
      .notNull()
      .references(() => inventoryItems.id),
    branchId: uuid().notNull(),
    quantity: integer().notNull(),
    reason: text({ enum: MOVEMENT_REASONS }),
    note: text(),
    occurredOn: date().notNull(),
    receiptId: uuid().references(() => inventoryReceipts.id),
    countId: uuid(),
    reversesId: uuid(),
    reversedAt: instant(),
    reversedBy: uuid(),
    reversalReason: text(),
    createdBy: uuid().notNull(),
    idempotencyKey: uuid(),
    idempotencyHash: text(),
    ...timestamps(),
  },
  (table) => [
    index('inventory_movements_tenant_idx').on(table.tenantId),
    index('inventory_movements_item_idx').on(
      table.tenantId,
      table.branchId,
      table.itemId,
      table.occurredOn,
    ),
    index('inventory_movements_occurred_idx').on(table.tenantId, table.occurredOn, table.kind),
    index('inventory_movements_idempotency_idx')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    uniqueIndex('inventory_movements_reverses_unique')
      .on(table.reversesId)
      .where(sql`${table.reversesId} is not null`),
    check('inventory_movements_kind', sql`${table.kind} in ${quoted(MOVEMENT_KINDS)}`),
    check(
      'inventory_movements_reason',
      sql`${table.reason} is null or ${table.reason} in ${quoted(MOVEMENT_REASONS)}`,
    ),
    check('inventory_movements_quantity', sql`${table.quantity} <> 0`),
    check(
      'inventory_movements_reversed_complete',
      sql`(${table.reversedAt} is null) = (${table.reversedBy} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** Which batches a movement changed and by how much (signed). Append-only. */
export const inventoryMovementBatches = pgTable(
  'inventory_movement_batches',
  {
    tenantId: tenantIdColumn(),
    movementId: uuid()
      .notNull()
      .references(() => inventoryMovements.id),
    batchId: uuid()
      .notNull()
      .references(() => inventoryBatches.id),
    quantity: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.movementId, table.batchId] }),
    index('inventory_movement_batches_tenant_idx').on(table.tenantId),
    index('inventory_movement_batches_batch_idx').on(table.batchId),
    check('inventory_movement_batches_quantity', sql`${table.quantity} <> 0`),
    tenantIsolationPolicy(),
  ],
);

/** A stock count of one branch (B5). One open count per branch. */
export const inventoryCounts = pgTable(
  'inventory_counts',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    branchId: uuid().notNull(),
    categoryIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    status: text({ enum: COUNT_STATUSES }).notNull().default('open'),
    startedBy: uuid().notNull(),
    closedAt: instant(),
    closedBy: uuid(),
    applyIdempotencyKey: uuid(),
    ...timestamps(),
  },
  (table) => [
    index('inventory_counts_tenant_idx').on(table.tenantId),
    uniqueIndex('inventory_counts_open_unique')
      .on(table.tenantId, table.branchId)
      .where(sql`${table.status} = 'open'`),
    check('inventory_counts_status', sql`${table.status} in ${quoted(COUNT_STATUSES)}`),
    check(
      'inventory_counts_closed',
      sql`(${table.status} = 'open') = (${table.closedAt} is null and ${table.closedBy} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * One item of a count (D6): what was counted and what the system had when it was (`system_then`);
 * the opening details for an item that never had stock in the branch; the difference applied.
 */
export const inventoryCountLines = pgTable(
  'inventory_count_lines',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    countId: uuid()
      .notNull()
      .references(() => inventoryCounts.id),
    itemId: uuid()
      .notNull()
      .references(() => inventoryItems.id),
    counted: integer(),
    systemThen: integer(),
    countedBy: uuid(),
    countedAt: instant(),
    openingPrice: money(),
    openingPricePer: text({ enum: PRICE_PER }),
    openingLot: text(),
    openingExpiresOn: date(),
    difference: integer(),
    ...timestamps(),
  },
  (table) => [
    index('inventory_count_lines_tenant_idx').on(table.tenantId),
    unique('inventory_count_lines_unique').on(table.countId, table.itemId),
    check(
      'inventory_count_lines_counted',
      sql`(${table.counted} is null) = (${table.systemThen} is null) and (${table.counted} is null or ${table.counted} >= 0)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * A payment to a supplier's account (I5), or a one-off purchase's payment (no supplier, its
 * receipt and payee). Mirrored into Expenses (ADR-0098). Voided with a reason, never deleted.
 */
export const inventorySupplierPayments = pgTable(
  'inventory_supplier_payments',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    supplierId: uuid().references(() => inventorySuppliers.id),
    receiptId: uuid().references(() => inventoryReceipts.id),
    payee: text(),
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
    index('inventory_supplier_payments_tenant_idx').on(table.tenantId),
    index('inventory_supplier_payments_supplier_idx').on(
      table.tenantId,
      table.supplierId,
      table.paidOn,
    ),
    uniqueIndex('inventory_supplier_payments_idempotency_unique')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check('inventory_supplier_payments_amount', sql`${table.amount} > 0`),
    check('inventory_supplier_payments_method', sql`${table.method} in ${quoted(PAYMENT_METHODS)}`),
    check(
      'inventory_supplier_payments_payee',
      sql`${table.supplierId} is not null or (${table.receiptId} is not null and ${table.payee} is not null)`,
    ),
    check(
      'inventory_supplier_payments_void_complete',
      sql`(${table.voidedAt} is null) = (${table.voidedBy} is null) and (${table.voidedAt} is null) = (${table.voidReason} is null)`,
    ),
    tenantIsolationPolicy(),
  ],
);

/** A credit or a charge on a supplier's account, with its reason. Append-only. */
export const inventorySupplierAdjustments = pgTable(
  'inventory_supplier_adjustments',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    supplierId: uuid()
      .notNull()
      .references(() => inventorySuppliers.id),
    onDate: date().notNull(),
    kind: text({ enum: SUPPLIER_ADJUSTMENT_KINDS }).notNull(),
    amount: money().notNull(),
    currency: char({ length: 3 }).notNull(),
    reason: text().notNull(),
    createdBy: uuid().notNull(),
    idempotencyKey: uuid(),
    idempotencyHash: text(),
    ...timestamps(),
  },
  (table) => [
    index('inventory_supplier_adjustments_tenant_idx').on(table.tenantId),
    index('inventory_supplier_adjustments_supplier_idx').on(
      table.tenantId,
      table.supplierId,
      table.onDate,
    ),
    uniqueIndex('inventory_supplier_adjustments_idempotency_unique')
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check('inventory_supplier_adjustments_amount', sql`${table.amount} > 0`),
    check(
      'inventory_supplier_adjustments_kind',
      sql`${table.kind} in ${quoted(SUPPLIER_ADJUSTMENT_KINDS)}`,
    ),
    tenantIsolationPolicy(),
  ],
);

/**
 * A photo or PDF of a receipt's invoice (B1, ADR-0100); the bytes are in object storage.
 * `saved_at` null = a pending upload, invisible to reads.
 */
export const inventoryReceiptFiles = pgTable(
  'inventory_receipt_files',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    receiptId: uuid()
      .notNull()
      .references(() => inventoryReceipts.id),
    filename: text().notNull(),
    mimeType: text().notNull(),
    sizeBytes: integer().notNull(),
    storageKey: text().notNull(),
    uploadedBy: uuid().notNull(),
    savedAt: instant(),
    ...timestamps(),
  },
  (table) => [
    index('inventory_receipt_files_tenant_idx').on(table.tenantId),
    index('inventory_receipt_files_receipt_idx').on(table.receiptId),
    tenantIsolationPolicy(),
  ],
);

/** The clinic's inventory settings (D9). One row per tenant, created on first change. */
export const inventorySettings = pgTable(
  'inventory_settings',
  {
    tenantId: tenantIdColumn().primaryKey(),
    expiringDays: smallint().notNull(),
    ...timestamps(),
  },
  (table) => [
    check('inventory_settings_expiring_days', sql`${table.expiringDays} between 1 and 365`),
    tenantIsolationPolicy(),
  ],
);
