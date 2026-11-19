import {
  type Batch,
  fromCents,
  type InventoryCategory,
  type InventoryItem,
  type StockReceipt,
  type StockReceiptSummary,
  type Supplier,
  type SupplierAdjustment,
  type SupplierPayment,
  toCents,
} from '@dcm/contracts';
import { valueOf } from '../domain/stock';
import { receiptTotal } from '../domain/supplier-account';
import type { StoredCategory, StoredItem, StoredSupplier } from '../persistence/catalog.repository';
import type {
  StoredAdjustment,
  StoredPayment,
  StoredReceiptFile,
} from '../persistence/money.repository';
import type { StoredBatch, StoredReceipt } from '../persistence/stock.repository';

export const centsOf = (amount: string | null): bigint | null =>
  amount === null ? null : toCents(amount);

/** A batch as the valuation sees it (D4). */
export const valued = (batch: Pick<StoredBatch, 'quantity' | 'amount'>) => ({
  quantity: batch.quantity,
  amountCents: centsOf(batch.amount),
});

export function toCategory(row: StoredCategory, inUse: boolean): InventoryCategory {
  return { id: row.id, key: row.key, name: row.name, active: row.active, inUse };
}

export function toItem(row: StoredItem, moved: boolean): InventoryItem {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    categoryId: row.categoryId,
    unit: row.unit,
    packName: row.packName,
    packSize: row.packSize,
    reorderLevel: row.reorderLevel,
    usualSupplierId: row.usualSupplierId,
    usualOrderPacks: row.usualOrderPacks,
    tracksExpiry: row.tracksExpiry,
    note: row.note,
    active: row.active,
    moved,
  };
}

export function toSupplier(row: StoredSupplier, money: boolean): Supplier {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contactPerson,
    phone: row.phone,
    email: row.email,
    address: row.address,
    note: row.note,
    active: row.active,
    openingBalance: money ? row.openingBalance : null,
    openingBalanceOn: money ? row.openingBalanceOn : null,
  };
}

export function toBatch(row: StoredBatch, receiptNumber: number | null, money: boolean): Batch {
  const value = valueOf(valued(row), row.quantityLeft);
  return {
    id: row.id,
    branchId: row.branchId,
    source: row.source,
    receiptId: row.receiptId,
    receiptNumber,
    lot: row.lot,
    expiresOn: row.expiresOn,
    receivedOn: row.receivedOn,
    quantity: row.quantity,
    quantityLeft: row.quantityLeft,
    price: money ? row.price : null,
    pricePer: money ? row.pricePer : null,
    priced: row.amount !== null,
    value: money && value !== null ? fromCents(value) : null,
  };
}

export function toPayment(row: StoredPayment): SupplierPayment {
  return {
    id: row.id,
    supplierId: row.supplierId,
    receiptId: row.receiptId,
    payee: row.payee,
    paidOn: row.paidOn,
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    reference: row.reference,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  };
}

export function toAdjustment(row: StoredAdjustment): SupplierAdjustment {
  return {
    id: row.id,
    supplierId: row.supplierId,
    onDate: row.onDate,
    kind: row.kind,
    amount: row.amount,
    currency: row.currency,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A receipt's lines − discount + charges; null while a line is to price (B1). */
export function totalOf(receipt: StoredReceipt, batches: readonly StoredBatch[]) {
  return receiptTotal(
    batches.map((batch) => batch.amount),
    receipt.discount,
    receipt.charges,
  );
}

export function toReceiptSummary(
  receipt: StoredReceipt,
  batches: readonly StoredBatch[],
  supplierName: string | null,
  money: boolean,
): StockReceiptSummary {
  const totals = totalOf(receipt, batches);
  return {
    id: receipt.id,
    number: receipt.displayNumber,
    branchId: receipt.branchId,
    receivedOn: receipt.receivedOn,
    supplierId: receipt.supplierId,
    supplierName,
    payee: receipt.payee,
    invoiceNumber: receipt.invoiceNumber,
    lineCount: batches.length,
    toPrice: totals === null,
    total: money && totals ? totals.total : null,
    voided: receipt.voidedAt !== null,
  };
}

export interface ReceiptContext {
  supplierName: string | null;
  items: ReadonlyMap<string, StoredItem>;
  files: readonly StoredReceiptFile[];
  paymentId: string | null;
  createdByName: string | null;
  money: boolean;
}

export function toReceipt(
  receipt: StoredReceipt,
  batches: readonly StoredBatch[],
  context: ReceiptContext,
): StockReceipt {
  const totals = totalOf(receipt, batches);
  const { money } = context;
  return {
    ...toReceiptSummary(receipt, batches, context.supplierName, money),
    invoiceDate: receipt.invoiceDate,
    note: receipt.note,
    currency: receipt.currency,
    lines: batches.map((batch) => {
      const item = context.items.get(batch.itemId);
      return {
        batchId: batch.id,
        position: batch.position ?? 0,
        itemId: batch.itemId,
        itemName: item?.name ?? '',
        unit: item?.unit ?? '',
        packName: item?.packName ?? null,
        packSize: item?.packSize ?? null,
        tracksExpiry: item?.tracksExpiry ?? false,
        quantity: batch.quantity,
        quantityLeft: batch.quantityLeft,
        lot: batch.lot,
        expiresOn: batch.expiresOn,
        priced: batch.amount !== null,
        price: money ? batch.price : null,
        pricePer: money ? batch.pricePer : null,
        amount: money ? batch.amount : null,
      };
    }),
    discount: money ? receipt.discount : null,
    charges: money ? receipt.charges : null,
    linesTotal: money && totals ? totals.lines : null,
    paymentId: context.paymentId,
    touched: batches.some((batch) => batch.quantityLeft !== batch.quantity),
    files: context.files.map((file) => ({
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })),
    createdAt: receipt.createdAt.toISOString(),
    createdByName: context.createdByName,
    voidedAt: receipt.voidedAt?.toISOString() ?? null,
    voidReason: receipt.voidReason,
  };
}
