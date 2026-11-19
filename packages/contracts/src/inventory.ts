import { z } from 'zod';
import { reasonSchema } from './audit.js';
import { exportLanguageSchema, paymentMethodSchema } from './billing.js';
import {
  aggregateAmountSchema,
  blankToUndefined,
  currencySchema,
  cursorPageQuerySchema,
  cursorPageSchema,
  decimalAmountSchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  optionalText,
  queryBooleanSchema,
} from './common.js';
import { positiveAmountSchema } from './compensation.js';

/**
 * Feature 20a (spec `2026-11-19-inventory-design.md`, ADR-0094–0101): what the clinic stocks,
 * per branch. Stock changes only through movements over batches; the quantity on hand is what
 * they add up to. A receipt is what the clinic owes a supplier; only a payment is an expense.
 * Quantities are whole units of the item. Costs, values, totals and balances (`null` here) are
 * given only to callers with `inventory:money_read`.
 */

// --- Vocabulary ---

/** The categories every clinic starts with, translated by key (`inventory:category.<key>`). */
export const INVENTORY_CATEGORY_KEYS = [
  'anaesthetics',
  'restorative',
  'endodontics',
  'prosthetics_impression',
  'surgery_implants',
  'orthodontics',
  'hygiene_prevention',
  'sterilisation',
  'disposables',
  'instruments_burs',
  'imaging',
  'office_cleaning',
] as const;
export const inventoryCategoryKeySchema = z.enum(INVENTORY_CATEGORY_KEYS);
export type InventoryCategoryKey = z.infer<typeof inventoryCategoryKeySchema>;

/** Units offered by name (translated, `inventory:unit.<key>`); a clinic may type its own word. */
export const INVENTORY_UNIT_KEYS = [
  'piece',
  'carpule',
  'tube',
  'bottle',
  'syringe',
  'pair',
  'sheet',
] as const;
/** Packs offered by name (`inventory:pack.<key>`); a clinic may type its own word. */
export const INVENTORY_PACK_KEYS = ['box', 'pack', 'bag', 'bottle', 'roll', 'kit'] as const;

export const MOVEMENT_KINDS = [
  'receive',
  'opening',
  'take_out',
  'adjust',
  'count',
  'receipt_edit',
  'receipt_void',
  'reversal',
] as const;
export const movementKindSchema = z.enum(MOVEMENT_KINDS);
export type MovementKind = z.infer<typeof movementKindSchema>;

/** Why an adjustment was made (B4); `count` is a count's own (B5). */
export const ADJUST_REASONS = [
  'expired',
  'damaged',
  'lost',
  'returned',
  'unrecorded_use',
  'correction',
] as const;
export const adjustReasonSchema = z.enum(ADJUST_REASONS);
export type AdjustReason = z.infer<typeof adjustReasonSchema>;
export const MOVEMENT_REASONS = [...ADJUST_REASONS, 'count'] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

export const BATCH_SOURCES = ['receipt', 'opening', 'count'] as const;
export type BatchSource = (typeof BATCH_SOURCES)[number];

/** What a typed price is for: one pack or one unit. */
export const PRICE_PER = ['pack', 'unit'] as const;
export const pricePerSchema = z.enum(PRICE_PER);
export type PricePer = z.infer<typeof pricePerSchema>;

export const COUNT_STATUSES = ['open', 'applied', 'discarded'] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];

export const SUPPLIER_ADJUSTMENT_KINDS = ['credit', 'charge'] as const;
export const supplierAdjustmentKindSchema = z.enum(SUPPLIER_ADJUSTMENT_KINDS);
export type SupplierAdjustmentKind = z.infer<typeof supplierAdjustmentKindSchema>;

/** The stored supplier payment events: money rows of the audit log (ADR-0101). */
export const INVENTORY_MONEY_EVENTS = ['SupplierPaymentRecorded', 'SupplierPaymentVoided'] as const;

export const ITEM_NAME_MAX = 120;
export const ITEM_CODE_MAX = 40;
export const UNIT_NAME_MAX = 30;
export const PACK_SIZE_MAX = 10_000;
export const QUANTITY_MAX = 1_000_000;
export const RECEIPT_LINES_MAX = 100;
export const TAKE_OUT_ITEMS_MAX = 50;
export const SAVE_ITEMS_MAX = 200;
export const SUPPLIER_NAME_MAX = 80;
export const LOT_MAX = 40;
export const RECEIPT_FILES_MAX = 5;
export const EXPIRING_DAYS_DEFAULT = 60;
export const EXPIRING_DAYS_MAX = 365;
export const STOCK_CARD_TOP = 8;

const nonNegativeAmountSchema = decimalAmountSchema.refine(
  (amount) => !amount.startsWith('-') || /^-0+(\.0+)?$/.test(amount),
  'Must not be negative',
);
const quantitySchema = z.number().int().min(1).max(QUANTITY_MAX);
const nullableId = idSchema.nullish().transform((value) => value ?? null);
const nullableDate = isoDateSchema
  .nullish()
  .or(z.literal(''))
  .transform((value) => (value ? value : null));
const nullableAmount = nonNegativeAmountSchema
  .nullish()
  .or(z.literal(''))
  .transform((value) => (value ? value : null));

/** `GR-000123`: goods received, in the style of visit numbers (`RCT-` is a patient's receipt). */
export function formatGoodsReceiptNumber(value: number): string {
  return `GR-${String(value).padStart(6, '0')}`;
}

/** `GR-000123`, `GR-123`, `gr123` or `123` → 123; anything else → null. */
export function parseGoodsReceiptNumber(text: string): number | null {
  const match = /^\s*(?:gr-?)?0*(\d{1,9})\s*$/i.exec(text);
  return match?.[1] ? Number(match[1]) : null;
}

// --- Packs and units (D11) ---

export type QuantityMode = 'pack' | 'unit';

/** What the user typed, in units: `n` packs of `packSize`, or `n` units. */
export function toUnits(quantity: number, mode: QuantityMode, packSize: number | null): number {
  return mode === 'pack' && packSize !== null ? quantity * packSize : quantity;
}

/** `units` as whole packs and the units left over (`packs` is 0 without a pack). */
export function splitPacks(
  units: number,
  packSize: number | null,
): { packs: number; units: number } {
  if (packSize === null || packSize < 1) return { packs: 0, units };
  const sign = units < 0 ? -1 : 1;
  const whole = Math.floor(Math.abs(units) / packSize);
  return { packs: sign * whole, units: sign * (Math.abs(units) - whole * packSize) };
}

/** A line's amount from its typed price: per pack it is the share of packs, rounded to cents. */
export function lineAmount(
  price: string,
  pricePer: PricePer,
  quantity: number,
  packSize: number | null,
): string {
  const cents = Math.round(Number(price) * 100);
  const total =
    pricePer === 'pack' && packSize !== null ? (cents * quantity) / packSize : cents * quantity;
  return (Math.round(total) / 100).toFixed(2);
}

// --- Labels (B6, D9) ---

export const STOCK_LABEL_KINDS = [
  'out',
  'expired',
  'low',
  'expiring',
  'ordered',
  'to_count',
] as const;
export const stockLabelKindSchema = z.enum(STOCK_LABEL_KINDS);
export type StockLabelKind = z.infer<typeof stockLabelKindSchema>;

export const stockLabelSchema = z.object({
  kind: stockLabelKindSchema,
  /** The earliest expiry (`expiring`) or the day it was ordered (`ordered`). */
  date: isoDateSchema.nullable(),
});
export type StockLabel = z.infer<typeof stockLabelSchema>;

/** What `stockLabels` reads of an item in one branch. */
export interface StockState {
  active: boolean;
  onHand: number;
  /** The branch's own level, else the item's; null for none. */
  reorderLevel: number | null;
  /** Some batch of the item was ever in this branch. */
  everStocked: boolean;
  /** The distinct expiry dates of its batches with stock left. */
  expiries: readonly string[];
  orderedOn: string | null;
  toCount: boolean;
}

const addCalendarDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The labels of an item in a branch on `today` (the clinic's date), most urgent first (B6):
 * _Out_ (none left, for an active item with a reorder level or ever stocked there), _Expired_
 * (a batch with stock left whose date has passed), _Low_ (at or under the reorder level, above
 * zero), _Expiring_ (a batch with stock left expiring within `expiringDays`, with the earliest
 * date), _Ordered_ (replaces _Low_ and _Out_), _To count_. Pure.
 */
export function stockLabels(state: StockState, today: string, expiringDays: number): StockLabel[] {
  const labels: StockLabel[] = [];
  const ordered = state.orderedOn !== null;
  if (
    !ordered &&
    state.active &&
    state.onHand <= 0 &&
    (state.reorderLevel !== null || state.everStocked)
  ) {
    labels.push({ kind: 'out', date: null });
  }
  const dates = [...state.expiries].sort();
  if (dates.some((date) => date < today)) labels.push({ kind: 'expired', date: null });
  if (
    !ordered &&
    state.reorderLevel !== null &&
    state.onHand > 0 &&
    state.onHand <= state.reorderLevel
  ) {
    labels.push({ kind: 'low', date: null });
  }
  const horizon = addCalendarDays(today, expiringDays);
  const expiring = dates.find((date) => date >= today && date <= horizon);
  if (expiring !== undefined) labels.push({ kind: 'expiring', date: expiring });
  if (ordered) labels.push({ kind: 'ordered', date: state.orderedOn });
  if (state.toCount) labels.push({ kind: 'to_count', date: null });
  return labels;
}

// --- Categories ---

export const inventoryCategorySchema = z.object({
  id: idSchema,
  key: inventoryCategoryKeySchema.nullable(),
  name: z.string().nullable(),
  active: z.boolean(),
  /** Some item uses it: it can't be deleted. */
  inUse: z.boolean(),
});
export type InventoryCategory = z.infer<typeof inventoryCategorySchema>;

const categoryNameSchema = z.string().trim().min(1).max(60);
export const createInventoryCategorySchema = z.object({ name: categoryNameSchema });
export type CreateInventoryCategory = z.infer<typeof createInventoryCategorySchema>;
export const updateInventoryCategorySchema = z
  .object({ name: categoryNameSchema.optional(), active: z.boolean().optional() })
  .refine((patch) => patch.name !== undefined || patch.active !== undefined, 'Nothing to change');
export type UpdateInventoryCategory = z.infer<typeof updateInventoryCategorySchema>;

// --- Items (Part A) ---

export const inventoryItemSchema = z.object({
  id: idSchema,
  name: z.string(),
  code: z.string().nullable(),
  categoryId: idSchema,
  unit: z.string(),
  packName: z.string().nullable(),
  packSize: z.number().int().nullable(),
  reorderLevel: z.number().int().nullable(),
  usualSupplierId: idSchema.nullable(),
  usualOrderPacks: z.number().int().nullable(),
  tracksExpiry: z.boolean(),
  note: z.string().nullable(),
  active: z.boolean(),
  /** Some movement exists: the unit and the pack size are locked. */
  moved: z.boolean(),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export const itemInputSchema = z
  .object({
    /** Absent for a new item. */
    id: idSchema.optional(),
    name: z.string().trim().min(1).max(ITEM_NAME_MAX),
    code: optionalText(ITEM_CODE_MAX),
    categoryId: idSchema,
    unit: z.string().trim().min(1).max(UNIT_NAME_MAX),
    packName: optionalText(UNIT_NAME_MAX),
    packSize: z
      .number()
      .int()
      .min(1)
      .max(PACK_SIZE_MAX)
      .nullish()
      .transform((v) => v ?? null),
    reorderLevel: z
      .number()
      .int()
      .min(0)
      .max(QUANTITY_MAX)
      .nullish()
      .transform((v) => v ?? null),
    usualSupplierId: nullableId,
    usualOrderPacks: z
      .number()
      .int()
      .min(1)
      .max(PACK_SIZE_MAX)
      .nullish()
      .transform((v) => v ?? null),
    tracksExpiry: z.boolean().default(false),
    note: optionalText(500),
    active: z.boolean().default(true),
  })
  .refine((item) => (item.packName === null) === (item.packSize === null), {
    path: ['packSize'],
    message: 'A pack needs a name and a size',
  });
export type ItemInput = z.infer<typeof itemInputSchema>;
export type ItemInputRequest = z.input<typeof itemInputSchema>;

/** `PUT /inventory/items`: the Catalog's save, every row in one transaction. */
export const saveItemsSchema = z.object({
  items: z.array(itemInputSchema).min(1).max(SAVE_ITEMS_MAX),
});
export type SaveItems = z.infer<typeof saveItemsSchema>;
export type SaveItemsRequest = z.input<typeof saveItemsSchema>;

export const itemBranchLevelSchema = z.object({
  reorderLevel: z.number().int().min(0).max(QUANTITY_MAX).nullable(),
});
export type ItemBranchLevel = z.infer<typeof itemBranchLevelSchema>;

export const markOrderedSchema = z.object({
  orderedOn: isoDateSchema,
  note: optionalText(300),
});
export type MarkOrdered = z.infer<typeof markOrderedSchema>;

export const markOrderedManySchema = markOrderedSchema.extend({
  branchId: idSchema,
  itemIds: z.array(idSchema).min(1).max(SAVE_ITEMS_MAX),
});
export type MarkOrderedMany = z.infer<typeof markOrderedManySchema>;

export const branchBodySchema = z.object({ branchId: idSchema });
export type BranchBody = z.infer<typeof branchBodySchema>;

export const inventorySettingsSchema = z.object({
  expiringDays: z.number().int().min(1).max(EXPIRING_DAYS_MAX),
});
export type InventorySettings = z.infer<typeof inventorySettingsSchema>;

// --- Stock (Part B, C1) ---

/** Receipts with a line to price and opening batches with no cost: beside every value (E). */
export const unpricedSchema = z.object({
  receipts: z.number().int().nonnegative(),
  openingBatches: z.number().int().nonnegative(),
});
export type Unpriced = z.infer<typeof unpricedSchema>;

export const stockQuerySchema = z.object({
  branchId: idSchema,
  lang: blankToUndefined(exportLanguageSchema.optional()),
});
export type StockQuery = z.infer<typeof stockQuerySchema>;

export const stockRowSchema = z.object({
  itemId: idSchema,
  name: z.string(),
  code: z.string().nullable(),
  categoryId: idSchema,
  unit: z.string(),
  packName: z.string().nullable(),
  packSize: z.number().int().nullable(),
  tracksExpiry: z.boolean(),
  active: z.boolean(),
  usualSupplierId: idSchema.nullable(),
  onHand: z.number().int(),
  /** The level that applies in this branch. */
  reorderLevel: z.number().int().nullable(),
  labels: z.array(stockLabelSchema),
  /** Null without `inventory:money_read`. */
  value: aggregateAmountSchema.nullable(),
});
export type StockRow = z.infer<typeof stockRowSchema>;

export const stockListSchema = z.object({
  branchId: idSchema,
  currency: currencySchema,
  today: isoDateSchema,
  rows: z.array(stockRowSchema),
  value: aggregateAmountSchema.nullable(),
  unpriced: unpricedSchema.nullable(),
});
export type StockList = z.infer<typeof stockListSchema>;

export const batchSchema = z.object({
  id: idSchema,
  branchId: idSchema,
  source: z.enum(BATCH_SOURCES),
  receiptId: idSchema.nullable(),
  receiptNumber: z.number().int().nullable(),
  lot: z.string().nullable(),
  expiresOn: isoDateSchema.nullable(),
  receivedOn: isoDateSchema,
  quantity: z.number().int(),
  quantityLeft: z.number().int(),
  /** As typed, per pack or per unit; null when not priced or without money. */
  price: decimalAmountSchema.nullable(),
  pricePer: pricePerSchema.nullable(),
  priced: z.boolean(),
  value: aggregateAmountSchema.nullable(),
});
export type Batch = z.infer<typeof batchSchema>;

export const itemBranchStateSchema = z.object({
  branchId: idSchema,
  onHand: z.number().int(),
  /** The branch's own level (null = the item's). */
  ownReorderLevel: z.number().int().nullable(),
  labels: z.array(stockLabelSchema),
  orderedOn: isoDateSchema.nullable(),
  orderedNote: z.string().nullable(),
  toCount: z.boolean(),
});
export type ItemBranchState = z.infer<typeof itemBranchStateSchema>;

export const itemDetailSchema = z.object({
  item: inventoryItemSchema,
  currency: currencySchema,
  branches: z.array(itemBranchStateSchema),
  /** Batches with stock left first, then the emptied ones (the last 20). */
  batches: z.array(batchSchema),
});
export type ItemDetail = z.infer<typeof itemDetailSchema>;

export const movementSchema = z.object({
  id: idSchema,
  actionId: idSchema,
  kind: movementKindSchema,
  itemId: idSchema,
  itemName: z.string(),
  unit: z.string(),
  packName: z.string().nullable(),
  packSize: z.number().int().nullable(),
  branchId: idSchema,
  /** Signed: what it added (+) or took (−). */
  quantity: z.number().int(),
  reason: z.enum(MOVEMENT_REASONS).nullable(),
  note: z.string().nullable(),
  occurredOn: isoDateSchema,
  createdAt: isoDateTimeSchema,
  createdByName: z.string().nullable(),
  receiptId: idSchema.nullable(),
  receiptNumber: z.number().int().nullable(),
  countId: idSchema.nullable(),
  reversesId: idSchema.nullable(),
  reversedAt: isoDateTimeSchema.nullable(),
  reversalReason: z.string().nullable(),
  /** Signed like the quantity; null without money or when a batch it touched is not priced. */
  cost: aggregateAmountSchema.nullable(),
  /** The caller's own take-out of today, not reversed. */
  canUndo: z.boolean(),
});
export type Movement = z.infer<typeof movementSchema>;

export const movementListQuerySchema = cursorPageQuerySchema.extend({
  itemId: blankToUndefined(idSchema.optional()),
  branchId: blankToUndefined(idSchema.optional()),
  categoryId: blankToUndefined(idSchema.optional()),
  supplierId: blankToUndefined(idSchema.optional()),
  kinds: blankToUndefined(z.string().optional()).transform((value) =>
    value === undefined
      ? undefined
      : value
          .split(',')
          .map((kind) => kind.trim())
          .filter((kind): kind is MovementKind =>
            (MOVEMENT_KINDS as readonly string[]).includes(kind),
          ),
  ),
  reason: blankToUndefined(z.enum(MOVEMENT_REASONS).optional()),
  from: blankToUndefined(isoDateSchema.optional()),
  to: blankToUndefined(isoDateSchema.optional()),
});
export type MovementListQuery = z.infer<typeof movementListQuerySchema>;

export const movementPageSchema = cursorPageSchema(movementSchema).extend({
  currency: currencySchema,
});
export type MovementPage = z.infer<typeof movementPageSchema>;

/** `POST /inventory/take-outs` (Idempotency-Key). */
export const takeOutSchema = z.object({
  branchId: idSchema,
  items: z
    .array(
      z.object({
        itemId: idSchema,
        quantity: quantitySchema,
        batchId: nullableId,
        note: optionalText(300),
      }),
    )
    .min(1)
    .max(TAKE_OUT_ITEMS_MAX)
    .refine(
      (items) => new Set(items.map((item) => item.itemId)).size === items.length,
      'An item is listed twice',
    ),
  /** Goes through the warning of a batch past its expiry. */
  allowExpired: z.boolean().default(false),
});
export type TakeOut = z.infer<typeof takeOutSchema>;
export type TakeOutRequest = z.input<typeof takeOutSchema>;

export const takeOutResultSchema = z.object({ movements: z.array(movementSchema) });
export type TakeOutResult = z.infer<typeof takeOutResultSchema>;

export const reverseMovementSchema = z.object({ reason: reasonSchema });
export type ReverseMovement = z.infer<typeof reverseMovementSchema>;

/** `POST /inventory/adjustments` (Idempotency-Key): only a correction may add (B4). */
export const adjustStockSchema = z
  .object({
    branchId: idSchema,
    itemId: idSchema,
    batchId: idSchema,
    reason: adjustReasonSchema,
    quantity: z
      .number()
      .int()
      .min(-QUANTITY_MAX)
      .max(QUANTITY_MAX)
      .refine((value) => value !== 0, 'Must not be zero'),
    note: optionalText(300),
  })
  .refine((input) => input.quantity < 0 || input.reason === 'correction', {
    path: ['quantity'],
    message: 'Only a correction may add',
  })
  .refine((input) => input.reason !== 'correction' || input.note !== null, {
    path: ['note'],
    message: 'Say what the correction is for',
  });
export type AdjustStock = z.infer<typeof adjustStockSchema>;
export type AdjustStockRequest = z.input<typeof adjustStockSchema>;

export const stockTodayQuerySchema = z.object({ branchId: idSchema });
export const stockTodaySchema = z.object({
  branchId: idSchema,
  out: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
  expiring: z.number().int().nonnegative(),
  toCount: z.number().int().nonnegative(),
  /** Receipts of the branch to price; null without `inventory:money_manage`. */
  toPrice: z.number().int().nonnegative().nullable(),
});
export type StockToday = z.infer<typeof stockTodaySchema>;

export const reorderQuerySchema = z.object({ branchId: idSchema });
export const reorderListSchema = z.object({
  branchId: idSchema,
  groups: z.array(
    z.object({
      supplierId: idSchema.nullable(),
      supplierName: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      items: z.array(
        z.object({
          itemId: idSchema,
          name: z.string(),
          code: z.string().nullable(),
          unit: z.string(),
          packName: z.string().nullable(),
          packSize: z.number().int().nullable(),
          onHand: z.number().int(),
          reorderLevel: z.number().int().nullable(),
          /** The usual order quantity, in packs (in units without a pack). */
          proposed: z.number().int().nullable(),
        }),
      ),
    }),
  ),
});
export type ReorderList = z.infer<typeof reorderListSchema>;

// --- Receipts (B1) ---

export const receiptLineInputSchema = z.object({
  itemId: idSchema,
  quantity: quantitySchema,
  /** Left out at receiving by whoever may not price; zero is a cost. */
  price: nullableAmount,
  pricePer: pricePerSchema.default('unit'),
  lot: optionalText(LOT_MAX),
  expiresOn: nullableDate,
});
export type ReceiptLineInput = z.infer<typeof receiptLineInputSchema>;
export type ReceiptLineInputRequest = z.input<typeof receiptLineInputSchema>;

export const paidNowSchema = z.object({
  paidOn: isoDateSchema,
  method: paymentMethodSchema,
  reference: optionalText(100),
});
export type PaidNow = z.infer<typeof paidNowSchema>;

/**
 * `POST /inventory/receipts` (Idempotency-Key): the whole receipt as one input (D12, run b's
 * door). A registered supplier, or a one-off purchase's payee.
 */
export const receiveSchema = z
  .object({
    supplierId: nullableId,
    payee: optionalText(120),
    branchId: idSchema,
    receivedOn: isoDateSchema,
    invoiceNumber: optionalText(60),
    invoiceDate: nullableDate,
    note: optionalText(500),
    lines: z.array(receiptLineInputSchema).min(1).max(RECEIPT_LINES_MAX),
    discount: nullableAmount,
    charges: nullableAmount,
    paidNow: paidNowSchema.nullish().transform((value) => value ?? null),
    /** Goes through the warning of the same supplier and invoice number. */
    allowDuplicateInvoice: z.boolean().default(false),
  })
  .refine((input) => (input.supplierId === null) !== (input.payee === null), {
    path: ['supplierId'],
    message: 'Choose a supplier, or name who was paid for a one-off purchase',
  });
export type Receive = z.infer<typeof receiveSchema>;
export type ReceiveRequest = z.input<typeof receiveSchema>;

export const receiptLineSchema = z.object({
  batchId: idSchema,
  position: z.number().int(),
  itemId: idSchema,
  itemName: z.string(),
  unit: z.string(),
  packName: z.string().nullable(),
  packSize: z.number().int().nullable(),
  tracksExpiry: z.boolean(),
  quantity: z.number().int(),
  quantityLeft: z.number().int(),
  lot: z.string().nullable(),
  expiresOn: isoDateSchema.nullable(),
  priced: z.boolean(),
  /** Null without money. */
  price: decimalAmountSchema.nullable(),
  pricePer: pricePerSchema.nullable(),
  amount: decimalAmountSchema.nullable(),
});
export type ReceiptLine = z.infer<typeof receiptLineSchema>;

export const receiptFileSchema = z.object({
  id: idSchema,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});
export type ReceiptFile = z.infer<typeof receiptFileSchema>;

export const stockReceiptSummarySchema = z.object({
  id: idSchema,
  number: z.number().int(),
  branchId: idSchema,
  receivedOn: isoDateSchema,
  supplierId: idSchema.nullable(),
  supplierName: z.string().nullable(),
  /** A one-off purchase's payee. */
  payee: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  lineCount: z.number().int(),
  toPrice: z.boolean(),
  /** Lines − discount + charges; null while to price or without money. */
  total: aggregateAmountSchema.nullable(),
  voided: z.boolean(),
});
export type StockReceiptSummary = z.infer<typeof stockReceiptSummarySchema>;

export const stockReceiptSchema = stockReceiptSummarySchema.extend({
  invoiceDate: isoDateSchema.nullable(),
  note: z.string().nullable(),
  currency: currencySchema,
  lines: z.array(receiptLineSchema),
  discount: decimalAmountSchema.nullable(),
  charges: decimalAmountSchema.nullable(),
  /** Σ line amounts; null while to price or without money. */
  linesTotal: aggregateAmountSchema.nullable(),
  /** A one-off purchase's payment, voided with the receipt. */
  paymentId: idSchema.nullable(),
  /** Some of its stock has changed since: it can't be voided. */
  touched: z.boolean(),
  files: z.array(receiptFileSchema),
  createdAt: isoDateTimeSchema,
  createdByName: z.string().nullable(),
  voidedAt: isoDateTimeSchema.nullable(),
  voidReason: z.string().nullable(),
});
export type StockReceipt = z.infer<typeof stockReceiptSchema>;

export const receiptListQuerySchema = cursorPageQuerySchema.extend({
  branchId: blankToUndefined(idSchema.optional()),
  supplierId: blankToUndefined(idSchema.optional()),
  from: blankToUndefined(isoDateSchema.optional()),
  to: blankToUndefined(isoDateSchema.optional()),
  toPrice: blankToUndefined(queryBooleanSchema),
  q: blankToUndefined(z.string().trim().max(100).optional()),
});
export type ReceiptListQuery = z.infer<typeof receiptListQuerySchema>;

export const receiptPageSchema = cursorPageSchema(stockReceiptSummarySchema).extend({
  currency: currencySchema,
});
export type ReceiptPage = z.infer<typeof receiptPageSchema>;

/** `PUT /inventory/receipts/:id/prices` (`inventory:money_manage`). */
export const priceReceiptSchema = z.object({
  lines: z
    .array(
      z.object({ batchId: idSchema, price: nonNegativeAmountSchema, pricePer: pricePerSchema }),
    )
    .max(RECEIPT_LINES_MAX),
  discount: nullableAmount,
  charges: nullableAmount,
});
export type PriceReceipt = z.infer<typeof priceReceiptSchema>;
export type PriceReceiptRequest = z.input<typeof priceReceiptSchema>;

/** `PATCH /inventory/receipts/:id` (`inventory:manage`). */
export const editReceiptSchema = z.object({
  receivedOn: isoDateSchema.optional(),
  invoiceNumber: optionalText(60).optional(),
  invoiceDate: nullableDate.optional(),
  note: optionalText(500).optional(),
  lines: z
    .array(
      z.object({
        batchId: idSchema,
        quantity: quantitySchema.optional(),
        lot: optionalText(LOT_MAX).optional(),
        expiresOn: nullableDate.optional(),
      }),
    )
    .max(RECEIPT_LINES_MAX)
    .default([]),
  addLines: z.array(receiptLineInputSchema).max(RECEIPT_LINES_MAX).default([]),
});
export type EditReceipt = z.infer<typeof editReceiptSchema>;
export type EditReceiptRequest = z.input<typeof editReceiptSchema>;

/** `PUT /inventory/batches/:id/price`: the cost of opening stock entered without one (E). */
export const priceBatchSchema = z.object({
  price: nonNegativeAmountSchema,
  pricePer: pricePerSchema,
});
export type PriceBatch = z.infer<typeof priceBatchSchema>;

export const voidReceiptSchema = z.object({ reason: reasonSchema });
export type VoidReceipt = z.infer<typeof voidReceiptSchema>;

/** Photos or PDFs of the supplier's invoice (B1): the image types patient files take, and PDF. */
export const RECEIPT_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
] as const;

export const receiptUploadIntentSchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(255),
        mimeType: z.enum(RECEIPT_FILE_TYPES),
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(25 * 1024 * 1024),
      }),
    )
    .min(1)
    .max(RECEIPT_FILES_MAX),
});
export type ReceiptUploadIntent = z.infer<typeof receiptUploadIntentSchema>;

export const receiptUploadTargetsSchema = z.object({
  uploads: z.array(z.object({ id: idSchema, url: z.string(), mimeType: z.string() })),
});
export type ReceiptUploadTargets = z.infer<typeof receiptUploadTargetsSchema>;

export const saveReceiptFilesSchema = z.object({
  ids: z.array(idSchema).min(1).max(RECEIPT_FILES_MAX),
});
export type SaveReceiptFiles = z.infer<typeof saveReceiptFilesSchema>;

export const receiptFileUrlSchema = z.object({ url: z.string() });
export type ReceiptFileUrl = z.infer<typeof receiptFileUrlSchema>;

// --- Counts (B5) ---

export const startCountSchema = z.object({
  branchId: idSchema,
  /** Empty: every active item. */
  categoryIds: z.array(idSchema).max(50).default([]),
});
export type StartCount = z.infer<typeof startCountSchema>;
export type StartCountRequest = z.input<typeof startCountSchema>;

/** What an item that never had stock in the branch starts with (B8, D6). */
export const countOpeningSchema = z.object({
  price: nullableAmount,
  pricePer: pricePerSchema.default('unit'),
  lot: optionalText(LOT_MAX),
  expiresOn: nullableDate,
});
export type CountOpening = z.infer<typeof countOpeningSchema>;

export const saveCountLineSchema = z.object({
  counted: z.number().int().min(0).max(QUANTITY_MAX).nullable(),
  opening: countOpeningSchema.nullish().transform((value) => value ?? null),
});
export type SaveCountLine = z.infer<typeof saveCountLineSchema>;
export type SaveCountLineRequest = z.input<typeof saveCountLineSchema>;

export const countSummarySchema = z.object({
  id: idSchema,
  branchId: idSchema,
  categoryIds: z.array(idSchema),
  status: z.enum(COUNT_STATUSES),
  startedAt: isoDateTimeSchema,
  startedByName: z.string().nullable(),
  closedAt: isoDateTimeSchema.nullable(),
  closedByName: z.string().nullable(),
  lineCount: z.number().int(),
  countedCount: z.number().int(),
  differenceCount: z.number().int(),
  /** Σ value of the differences; null without money. */
  differenceValue: aggregateAmountSchema.nullable(),
});
export type CountSummary = z.infer<typeof countSummarySchema>;

export const countLineSchema = z.object({
  itemId: idSchema,
  name: z.string(),
  code: z.string().nullable(),
  categoryId: idSchema,
  unit: z.string(),
  packName: z.string().nullable(),
  packSize: z.number().int().nullable(),
  tracksExpiry: z.boolean(),
  /** On hand now (open), or what the system had when counted. */
  onHand: z.number().int(),
  counted: z.number().int().nullable(),
  systemThen: z.number().int().nullable(),
  /** counted − systemThen, or what was applied. */
  difference: z.number().int().nullable(),
  value: aggregateAmountSchema.nullable(),
  /** No batch ever in this branch: the count is its opening stock. */
  opening: z.boolean(),
  /** What was typed for the opening stock; the price null without money. */
  openingDetails: z
    .object({
      price: decimalAmountSchema.nullable(),
      pricePer: pricePerSchema,
      lot: z.string().nullable(),
      expiresOn: isoDateSchema.nullable(),
    })
    .nullable(),
  countedByName: z.string().nullable(),
});
export type CountLine = z.infer<typeof countLineSchema>;

export const countSchema = countSummarySchema.extend({
  currency: currencySchema,
  lines: z.array(countLineSchema),
});
export type Count = z.infer<typeof countSchema>;

export const countListQuerySchema = z.object({ branchId: idSchema });
export const countListSchema = z.object({ items: z.array(countSummarySchema) });
export type CountList = z.infer<typeof countListSchema>;

// --- Suppliers and their money (Part D) ---

const supplierFields = {
  name: z.string().trim().min(1).max(SUPPLIER_NAME_MAX),
  contactPerson: optionalText(120),
  phone: optionalText(40),
  email: optionalText(200),
  address: optionalText(300),
  note: optionalText(1000),
};

export const createSupplierSchema = z.object(supplierFields);
export type CreateSupplier = z.infer<typeof createSupplierSchema>;
export type CreateSupplierRequest = z.input<typeof createSupplierSchema>;
export const updateSupplierSchema = z
  .object(supplierFields)
  .partial()
  .extend({ active: z.boolean().optional() });
export type UpdateSupplier = z.infer<typeof updateSupplierSchema>;
export type UpdateSupplierRequest = z.input<typeof updateSupplierSchema>;

export const supplierSchema = z.object({
  id: idSchema,
  name: z.string(),
  contactPerson: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  note: z.string().nullable(),
  active: z.boolean(),
  /** Null without money, or when none was set. */
  openingBalance: decimalAmountSchema.nullable(),
  openingBalanceOn: isoDateSchema.nullable(),
});
export type Supplier = z.infer<typeof supplierSchema>;

export const supplierListQuerySchema = z.object({
  includeInactive: blankToUndefined(queryBooleanSchema),
});

export const supplierOpeningBalanceSchema = z.object({
  /** What the clinic already owed; negative when it was in credit. */
  amount: decimalAmountSchema,
  asOf: isoDateSchema,
});
export type SupplierOpeningBalance = z.infer<typeof supplierOpeningBalanceSchema>;

export const recordSupplierPaymentSchema = z.object({
  paidOn: isoDateSchema,
  amount: positiveAmountSchema,
  method: paymentMethodSchema,
  reference: optionalText(100),
  note: optionalText(500),
});
export type RecordSupplierPayment = z.infer<typeof recordSupplierPaymentSchema>;
export type RecordSupplierPaymentRequest = z.input<typeof recordSupplierPaymentSchema>;

export const supplierPaymentSchema = z.object({
  id: idSchema,
  supplierId: idSchema.nullable(),
  receiptId: idSchema.nullable(),
  payee: z.string().nullable(),
  paidOn: isoDateSchema,
  amount: decimalAmountSchema,
  currency: currencySchema,
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  voidedAt: isoDateTimeSchema.nullable(),
  voidReason: z.string().nullable(),
});
export type SupplierPayment = z.infer<typeof supplierPaymentSchema>;

export const voidSupplierPaymentSchema = z.object({ reason: reasonSchema });

export const recordSupplierAdjustmentSchema = z.object({
  onDate: isoDateSchema,
  kind: supplierAdjustmentKindSchema,
  amount: positiveAmountSchema,
  reason: reasonSchema,
});
export type RecordSupplierAdjustment = z.infer<typeof recordSupplierAdjustmentSchema>;

export const supplierAdjustmentSchema = z.object({
  id: idSchema,
  supplierId: idSchema,
  onDate: isoDateSchema,
  kind: supplierAdjustmentKindSchema,
  amount: decimalAmountSchema,
  currency: currencySchema,
  reason: z.string(),
  createdAt: isoDateTimeSchema,
});
export type SupplierAdjustment = z.infer<typeof supplierAdjustmentSchema>;

const accountFigures = {
  /** Opening balance, priced receipts, charges, minus credits. */
  owed: aggregateAmountSchema,
  /** Live payments. */
  paid: aggregateAmountSchema,
  /** Owed minus paid; negative when the clinic is in credit. */
  outstanding: aggregateAmountSchema,
  /** Receipts still to price: not part of what is owed. */
  toPrice: z.number().int().nonnegative(),
};

export const supplierAccountSchema = z.object({
  supplierId: idSchema,
  name: z.string(),
  active: z.boolean(),
  ...accountFigures,
});
export type SupplierAccount = z.infer<typeof supplierAccountSchema>;

export const supplierAccountsSchema = z.object({
  currency: currencySchema,
  suppliers: z.array(supplierAccountSchema),
  total: z.object(accountFigures),
});
export type SupplierAccounts = z.infer<typeof supplierAccountsSchema>;

export const SUPPLIER_STATEMENT_KINDS = ['opening', 'receipt', 'adjustment', 'payment'] as const;
export type SupplierStatementKind = (typeof SUPPLIER_STATEMENT_KINDS)[number];

export const supplierStatementLineSchema = z.object({
  date: isoDateSchema,
  kind: z.enum(SUPPLIER_STATEMENT_KINDS),
  sourceId: idSchema,
  receiptNumber: z.number().int().nullable(),
  /** The invoice number, the reason, the payment's reference. */
  description: z.string().nullable(),
  adjustmentKind: supplierAdjustmentKindSchema.nullable(),
  method: paymentMethodSchema.nullable(),
  /** Positive adds to what the clinic owes; a payment or a credit is negative. */
  amount: aggregateAmountSchema,
  balance: aggregateAmountSchema,
  voided: z.boolean(),
  voidReason: z.string().nullable(),
});
export type SupplierStatementLine = z.infer<typeof supplierStatementLineSchema>;

export const supplierStatementQuerySchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  lang: blankToUndefined(exportLanguageSchema.optional()),
});
export type SupplierStatementQuery = z.infer<typeof supplierStatementQuerySchema>;

export const supplierStatementSchema = z.object({
  supplier: z.object({ id: idSchema, name: z.string() }),
  from: isoDateSchema,
  to: isoDateSchema,
  currency: currencySchema,
  balanceBefore: aggregateAmountSchema,
  lines: z.array(supplierStatementLineSchema),
  balanceAfter: aggregateAmountSchema,
  /** Receipts not priced yet, listed apart with no amount. */
  toPrice: z.array(
    z.object({
      id: idSchema,
      number: z.number().int(),
      receivedOn: isoDateSchema,
      invoiceNumber: z.string().nullable(),
    }),
  ),
});
export type SupplierStatement = z.infer<typeof supplierStatementSchema>;

// --- Reports (Part E) ---

export const inventoryReportQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    branchId: blankToUndefined(idSchema.optional()),
  })
  .refine((query) => query.from <= query.to, {
    path: ['to'],
    message: 'The end is before the start',
  });
export type InventoryReportQuery = z.infer<typeof inventoryReportQuerySchema>;

const reportAmount = aggregateAmountSchema.nullable();
export const inventoryReportSchema = z.object({
  currency: currencySchema,
  consumption: z.object({
    items: z.array(
      z.object({
        itemId: idSchema,
        name: z.string(),
        categoryId: idSchema,
        unit: z.string(),
        packName: z.string().nullable(),
        packSize: z.number().int().nullable(),
        quantity: z.number().int(),
        cost: reportAmount,
        /** Some of it left a batch not priced yet. */
        unpriced: z.boolean(),
      }),
    ),
    categories: z.array(
      z.object({ categoryId: idSchema, quantity: z.number().int(), cost: reportAmount }),
    ),
    total: reportAmount,
  }),
  adjustments: z.array(
    z.object({ reason: z.enum(MOVEMENT_REASONS), quantity: z.number().int(), cost: reportAmount }),
  ),
  /** Null without money. */
  purchases: z
    .array(
      z.object({
        supplierId: idSchema.nullable(),
        name: z.string(),
        receipts: z.number().int(),
        total: aggregateAmountSchema,
      }),
    )
    .nullable(),
  value: z
    .object({
      total: aggregateAmountSchema,
      categories: z.array(z.object({ categoryId: idSchema, value: aggregateAmountSchema })),
    })
    .nullable(),
  unpriced: unpricedSchema,
});
export type InventoryReport = z.infer<typeof inventoryReportSchema>;
