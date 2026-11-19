import { DomainError } from '../../../platform/kernel/domain-error';

export class InventoryNotFoundError extends DomainError {
  readonly code = 'inventory.not_found';
  readonly kind = 'not_found';
}

/** Two items, suppliers or categories of a clinic with the same name, or two items' codes. */
export class InventoryNameTakenError extends DomainError {
  readonly code = 'inventory.name_taken';
  readonly kind = 'conflict';
}

export class ItemCodeTakenError extends DomainError {
  readonly code = 'inventory.code_taken';
  readonly kind = 'conflict';
}

/** The unit or pack size of an item that has moved (Part A). */
export class ItemUnitLockedError extends DomainError {
  readonly code = 'inventory.item_unit_locked';
  readonly kind = 'conflict';
}

/** Made inactive while some branch holds it (Part A). */
export class ItemInStockError extends DomainError {
  readonly code = 'inventory.item_in_stock';
  readonly kind = 'conflict';
}

/** Received or taken out while inactive; a supplier or category not offered. */
export class InventoryInactiveError extends DomainError {
  readonly code = 'inventory.inactive';
  readonly kind = 'invalid';
}

/** A predefined category renamed or deleted, a used one deleted (the expense rules). */
export class CategoryLockedError extends DomainError {
  readonly code = 'inventory.category_locked';
  readonly kind = 'conflict';
}

/** More than is on hand (B3). `onHand` is what the system has. */
export class NotEnoughStockError extends DomainError {
  readonly code = 'inventory.not_enough_stock';
  readonly kind = 'conflict';
  override readonly extensions: Readonly<{ itemId: string; onHand: number }>;
  constructor(itemId: string, onHand: number) {
    super('There is not that much on hand', { itemId, onHand });
    this.extensions = { itemId, onHand };
  }
}

/** Taking from a batch past its expiry: a warning `allowExpired` goes through (B3). */
export class ExpiredBatchError extends DomainError {
  readonly code = 'inventory.expired_batch';
  readonly kind = 'conflict';
  override readonly extensions: Readonly<{ itemId: string; batchId: string; expiresOn: string }>;
  constructor(itemId: string, batchId: string, expiresOn: string) {
    super('This stock is past its expiry date', { itemId, batchId, expiresOn });
    this.extensions = { itemId, batchId, expiresOn };
  }
}

/** The same supplier's invoice number again: a warning `allowDuplicateInvoice` goes through. */
export class DuplicateInvoiceError extends DomainError {
  readonly code = 'inventory.duplicate_invoice';
  readonly kind = 'conflict';
  override readonly extensions: Readonly<{ receiptId: string; receiptNumber: number }>;
  constructor(receiptId: string, receiptNumber: number) {
    super('This supplier invoice was already received', { receiptId, receiptNumber });
    this.extensions = { receiptId, receiptNumber };
  }
}

/** A one-off purchase not fully priced and paid, or Paid now on a receipt to price (B1). */
export class ReceiptUnpricedError extends DomainError {
  readonly code = 'inventory.receipt_unpriced';
  readonly kind = 'invalid';
}

/** A discount larger than the lines and charges (B1): a receipt never owes less than nothing. */
export class ReceiptTotalError extends DomainError {
  readonly code = 'inventory.negative_total';
  readonly kind = 'invalid';
}

/** A one-off purchase's payment is voided with its receipt, never alone (B1). */
export class OneOffPaymentError extends DomainError {
  readonly code = 'inventory.one_off_payment';
  readonly kind = 'conflict';
}

/** A tracked item's line with no expiry date (B1). */
export class ExpiryRequiredError extends DomainError {
  readonly code = 'inventory.expiry_required';
  readonly kind = 'invalid';
}

/** A line's quantity below what already left it, a void after stock left (B1). */
export class ReceiptTouchedError extends DomainError {
  readonly code = 'inventory.receipt_touched';
  readonly kind = 'conflict';
}

/** A one-off purchase was priced and paid when recorded: its money stays (B1). */
export class OneOffLockedError extends DomainError {
  readonly code = 'inventory.one_off_locked';
  readonly kind = 'conflict';
}

export class ReceiptVoidedError extends DomainError {
  readonly code = 'inventory.receipt_voided';
  readonly kind = 'conflict';
}

/** Undo or reversal that is not possible (B3). */
export class MovementNotReversibleError extends DomainError {
  readonly code = 'inventory.not_reversible';
  readonly kind = 'conflict';
}

/** One open count per branch; a change to a count that is closed (B5). */
export class CountOpenError extends DomainError {
  readonly code = 'inventory.count_open';
  readonly kind = 'conflict';
}

export class CountClosedError extends DomainError {
  readonly code = 'inventory.count_closed';
  readonly kind = 'conflict';
}

/** A date that may not be ahead of today (B1, D). */
export class InventoryFutureDateError extends DomainError {
  readonly code = 'inventory.future_date';
  readonly kind = 'invalid';
}

export class SupplierPaymentVoidedError extends DomainError {
  readonly code = 'inventory.payment_voided';
  readonly kind = 'conflict';
}

/** Too many attachments, an upload that is not there or not what it says (ADR-0100). */
export class ReceiptFileError extends DomainError {
  readonly code = 'inventory.file_invalid';
  readonly kind = 'invalid';
}

export class InventoryIdempotencyMismatchError extends DomainError {
  readonly code = 'inventory.idempotency_mismatch';
  readonly kind = 'conflict';
}

/** `tenancy`'s currency change refused once inventory money exists. */
export class InventoryCurrencyLockedError extends DomainError {
  readonly code = 'tenant.currency_locked';
  readonly kind = 'conflict';
}
