import type { MovementKind } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import {
  inventoryBatches,
  inventoryItems,
  inventoryMovementBatches,
  inventoryMovements,
  inventoryReceiptCounters,
  inventoryReceipts,
} from './schema';

export type StoredReceipt = typeof inventoryReceipts.$inferSelect;
export type NewReceipt = Omit<
  typeof inventoryReceipts.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'voidedAt' | 'voidedBy' | 'voidReason'
>;
export type ReceiptPatch = Partial<
  Pick<
    StoredReceipt,
    'receivedOn' | 'invoiceNumber' | 'invoiceDate' | 'note' | 'discount' | 'charges'
  >
>;
export type StoredBatch = typeof inventoryBatches.$inferSelect;
export type NewBatch = Omit<
  typeof inventoryBatches.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt'
>;
export type BatchPatch = Partial<
  Pick<
    StoredBatch,
    'lot' | 'expiresOn' | 'quantity' | 'price' | 'pricePer' | 'amount' | 'receivedOn'
  >
>;
export type StoredMovement = typeof inventoryMovements.$inferSelect;
export type NewMovement = Omit<
  typeof inventoryMovements.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'reversedAt' | 'reversedBy' | 'reversalReason'
>;
export type StoredShare = typeof inventoryMovementBatches.$inferSelect;

export interface MovementFilter {
  itemId?: string | undefined;
  itemIds?: readonly string[] | undefined;
  branchId?: string | undefined;
  kinds?: readonly MovementKind[] | undefined;
  reason?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  receiptIds?: readonly string[] | undefined;
  countIds?: readonly string[] | undefined;
  /** Strictly older than this id (uuid v7): the next page. */
  before?: string | undefined;
}

export interface ReceiptFilter {
  branchId?: string | undefined;
  supplierId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  number?: number | undefined;
  q?: string | undefined;
  before?: string | undefined;
}

/**
 * Receipts, batches and movements (Part B, ADR-0095). A batch's `quantity_left` changes only
 * through `applyShares`, in the transaction that writes the movement's lines.
 */
@Injectable()
export class StockRepository {
  constructor(private readonly db: TenantDb) {}

  // --- Receipts ---

  async nextReceiptNumber(): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .insert(inventoryReceiptCounters)
        .values({ lastValue: 1 })
        .onConflictDoUpdate({
          target: inventoryReceiptCounters.tenantId,
          set: { lastValue: sql`${inventoryReceiptCounters.lastValue} + 1` },
        })
        .returning({ value: inventoryReceiptCounters.lastValue }),
    );
    if (!row) throw new Error('receipt counter returned no row');
    return row.value;
  }

  async insertReceipt(values: NewReceipt): Promise<StoredReceipt> {
    const [row] = await this.db.run((tx) =>
      tx.insert(inventoryReceipts).values(values).returning(),
    );
    if (!row) throw new Error('receipt insert returned no row');
    return row;
  }

  async receipt(id: string, lock = false): Promise<StoredReceipt | undefined> {
    const [row] = await this.db.run((tx) => {
      const query = tx.select().from(inventoryReceipts).where(eq(inventoryReceipts.id, id));
      return lock ? query.for('update') : query;
    });
    return row;
  }

  receiptsByIds(ids: readonly string[]): Promise<StoredReceipt[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryReceipts)
        .where(inArray(inventoryReceipts.id, [...ids])),
    );
  }

  async receiptByKey(key: string): Promise<StoredReceipt | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(inventoryReceipts).where(eq(inventoryReceipts.idempotencyKey, key)),
    );
    return row;
  }

  /** A live receipt of the supplier with the same invoice number (trimmed, case ignored). */
  async sameInvoice(
    supplierId: string,
    invoiceNumber: string,
    exceptId?: string,
  ): Promise<StoredReceipt | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(inventoryReceipts)
        .where(
          and(
            eq(inventoryReceipts.supplierId, supplierId),
            isNull(inventoryReceipts.voidedAt),
            sql`lower(btrim(${inventoryReceipts.invoiceNumber})) = lower(btrim(${invoiceNumber}))`,
            exceptId ? sql`${inventoryReceipts.id} <> ${exceptId}` : undefined,
          ),
        )
        .orderBy(asc(inventoryReceipts.displayNumber))
        .limit(1),
    );
    return row;
  }

  async updateReceipt(id: string, patch: ReceiptPatch): Promise<StoredReceipt> {
    const [row] = await this.db.run((tx) =>
      tx.update(inventoryReceipts).set(patch).where(eq(inventoryReceipts.id, id)).returning(),
    );
    if (!row) throw new Error('receipt update returned no row');
    return row;
  }

  async voidReceipt(id: string, at: Date, by: string, reason: string): Promise<StoredReceipt> {
    const [row] = await this.db.run((tx) =>
      tx
        .update(inventoryReceipts)
        .set({ voidedAt: at, voidedBy: by, voidReason: reason })
        .where(eq(inventoryReceipts.id, id))
        .returning(),
    );
    if (!row) throw new Error('receipt void returned no row');
    return row;
  }

  /** Newest first; `toPrice` filters on a line without a price. */
  listReceipts(filter: ReceiptFilter, toPrice: boolean, limit: number): Promise<StoredReceipt[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryReceipts)
        .where(
          and(
            filter.branchId ? eq(inventoryReceipts.branchId, filter.branchId) : undefined,
            filter.supplierId ? eq(inventoryReceipts.supplierId, filter.supplierId) : undefined,
            filter.from ? gte(inventoryReceipts.receivedOn, filter.from) : undefined,
            filter.to ? lte(inventoryReceipts.receivedOn, filter.to) : undefined,
            filter.number !== undefined
              ? eq(inventoryReceipts.displayNumber, filter.number)
              : undefined,
            filter.q
              ? sql`(${inventoryReceipts.invoiceNumber} ilike ${`%${filter.q}%`} or ${inventoryReceipts.payee} ilike ${`%${filter.q}%`})`
              : undefined,
            filter.before ? lt(inventoryReceipts.id, filter.before) : undefined,
            toPrice
              ? sql`${inventoryReceipts.voidedAt} is null and exists (select 1 from ${inventoryBatches} b where b.receipt_id = ${inventoryReceipts.id} and b.amount is null)`
              : undefined,
          ),
        )
        .orderBy(desc(inventoryReceipts.id))
        .limit(limit),
    );
  }

  /** Live receipts with a line to price, by branch or all. */
  async toPriceCount(branchId?: string, supplierId?: string): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryReceipts)
        .where(
          and(
            isNull(inventoryReceipts.voidedAt),
            branchId ? eq(inventoryReceipts.branchId, branchId) : undefined,
            supplierId ? eq(inventoryReceipts.supplierId, supplierId) : undefined,
            sql`exists (select 1 from ${inventoryBatches} b where b.receipt_id = ${inventoryReceipts.id} and b.amount is null)`,
          ),
        ),
    );
    return row?.count ?? 0;
  }

  /** Live receipts of registered suppliers (the accounts). */
  supplierReceipts(supplierIds: readonly string[]): Promise<StoredReceipt[]> {
    if (supplierIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryReceipts)
        .where(
          and(
            inArray(inventoryReceipts.supplierId, [...supplierIds]),
            isNull(inventoryReceipts.voidedAt),
          ),
        ),
    );
  }

  /** Live receipts received in a period (purchases). */
  receiptsBetween(from: string, to: string, branchId?: string): Promise<StoredReceipt[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryReceipts)
        .where(
          and(
            isNull(inventoryReceipts.voidedAt),
            gte(inventoryReceipts.receivedOn, from),
            lte(inventoryReceipts.receivedOn, to),
            branchId ? eq(inventoryReceipts.branchId, branchId) : undefined,
          ),
        ),
    );
  }

  // --- Batches ---

  async insertBatch(values: NewBatch): Promise<StoredBatch> {
    const [row] = await this.db.run((tx) => tx.insert(inventoryBatches).values(values).returning());
    if (!row) throw new Error('batch insert returned no row');
    return row;
  }

  async updateBatch(id: string, patch: BatchPatch): Promise<StoredBatch> {
    const [row] = await this.db.run((tx) =>
      tx.update(inventoryBatches).set(patch).where(eq(inventoryBatches.id, id)).returning(),
    );
    if (!row) throw new Error('batch update returned no row');
    return row;
  }

  batchesOfReceipts(receiptIds: readonly string[]): Promise<StoredBatch[]> {
    if (receiptIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryBatches)
        .where(inArray(inventoryBatches.receiptId, [...receiptIds]))
        .orderBy(asc(inventoryBatches.position), asc(inventoryBatches.id)),
    );
  }

  lockBatchesOfReceipt(receiptId: string): Promise<StoredBatch[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryBatches)
        .where(eq(inventoryBatches.receiptId, receiptId))
        .orderBy(asc(inventoryBatches.id))
        .for('update'),
    );
  }

  /** The item's batches in the branch, locked in id order (D2: the last box). */
  lockBatches(itemId: string, branchId: string): Promise<StoredBatch[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryBatches)
        .where(and(eq(inventoryBatches.itemId, itemId), eq(inventoryBatches.branchId, branchId)))
        .orderBy(asc(inventoryBatches.id))
        .for('update'),
    );
  }

  lockBatchesByIds(ids: readonly string[]): Promise<StoredBatch[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryBatches)
        .where(inArray(inventoryBatches.id, [...ids]))
        .orderBy(asc(inventoryBatches.id))
        .for('update'),
    );
  }

  batchesByIds(ids: readonly string[]): Promise<StoredBatch[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryBatches)
        .where(inArray(inventoryBatches.id, [...ids])),
    );
  }

  /** Every batch of a branch (or all), with or without stock left. */
  batches(filter: {
    branchId?: string;
    itemId?: string;
    withStock?: boolean;
  }): Promise<StoredBatch[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryBatches)
        .where(
          and(
            filter.branchId ? eq(inventoryBatches.branchId, filter.branchId) : undefined,
            filter.itemId ? eq(inventoryBatches.itemId, filter.itemId) : undefined,
            filter.withStock ? sql`${inventoryBatches.quantityLeft} > 0` : undefined,
          ),
        )
        .orderBy(asc(inventoryBatches.id)),
    );
  }

  /**
   * Per item of a branch: whether it was ever stocked there, and the batches with stock left
   * (for the labels and the value). One pass over the branch's batches.
   */
  everStocked(branchId?: string): Promise<{ itemId: string; branchId: string }[]> {
    return this.db.run((tx) =>
      tx
        .selectDistinct({ itemId: inventoryBatches.itemId, branchId: inventoryBatches.branchId })
        .from(inventoryBatches)
        .where(branchId ? eq(inventoryBatches.branchId, branchId) : undefined),
    );
  }

  /** Opening batches with stock left and no cost (E: shown beside every value). */
  async unpricedOpeningBatches(branchId?: string): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryBatches)
        .where(
          and(
            sql`${inventoryBatches.source} <> 'receipt'`,
            isNull(inventoryBatches.amount),
            sql`${inventoryBatches.quantityLeft} > 0`,
            branchId ? eq(inventoryBatches.branchId, branchId) : undefined,
          ),
        ),
    );
    return row?.count ?? 0;
  }

  /** Adds the shares to the batches they name; the CHECK keeps every batch at or above zero. */
  async applyShares(shares: readonly { batchId: string; quantity: number }[]): Promise<void> {
    for (const share of shares) {
      await this.db.run((tx) =>
        tx
          .update(inventoryBatches)
          .set({ quantityLeft: sql`${inventoryBatches.quantityLeft} + ${share.quantity}` })
          .where(eq(inventoryBatches.id, share.batchId)),
      );
    }
  }

  // --- Movements ---

  async insertMovement(
    values: NewMovement,
    shares: readonly { batchId: string; quantity: number }[],
  ): Promise<StoredMovement> {
    return this.db.run(async (tx) => {
      const [row] = await tx.insert(inventoryMovements).values(values).returning();
      if (!row) throw new Error('movement insert returned no row');
      const lines = shares.filter((share) => share.quantity !== 0);
      if (lines.length > 0) {
        await tx
          .insert(inventoryMovementBatches)
          .values(lines.map((share) => ({ movementId: row.id, ...share })));
      }
      return row;
    });
  }

  async movement(id: string, lock = false): Promise<StoredMovement | undefined> {
    const [row] = await this.db.run((tx) => {
      const query = tx.select().from(inventoryMovements).where(eq(inventoryMovements.id, id));
      return lock ? query.for('update') : query;
    });
    return row;
  }

  movementsByKey(key: string): Promise<StoredMovement[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.idempotencyKey, key))
        .orderBy(asc(inventoryMovements.id)),
    );
  }

  movementsByIds(ids: readonly string[]): Promise<StoredMovement[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryMovements)
        .where(inArray(inventoryMovements.id, [...ids]))
        .orderBy(asc(inventoryMovements.id)),
    );
  }

  async markReversed(id: string, at: Date, by: string, reason: string | null): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(inventoryMovements)
        .set({ reversedAt: at, reversedBy: by, reversalReason: reason })
        .where(eq(inventoryMovements.id, id)),
    );
  }

  /** Newest first. */
  movements(filter: MovementFilter, limit?: number): Promise<StoredMovement[]> {
    return this.db.run((tx) => {
      const query = tx
        .select()
        .from(inventoryMovements)
        .where(
          and(
            filter.itemId ? eq(inventoryMovements.itemId, filter.itemId) : undefined,
            filter.itemIds ? inArray(inventoryMovements.itemId, [...filter.itemIds]) : undefined,
            filter.branchId ? eq(inventoryMovements.branchId, filter.branchId) : undefined,
            filter.kinds && filter.kinds.length > 0
              ? inArray(inventoryMovements.kind, [...filter.kinds])
              : undefined,
            filter.reason ? sql`${inventoryMovements.reason} = ${filter.reason}` : undefined,
            filter.from ? gte(inventoryMovements.occurredOn, filter.from) : undefined,
            filter.to ? lte(inventoryMovements.occurredOn, filter.to) : undefined,
            filter.receiptIds
              ? inArray(inventoryMovements.receiptId, [...filter.receiptIds])
              : undefined,
            filter.countIds ? inArray(inventoryMovements.countId, [...filter.countIds]) : undefined,
            filter.before ? lt(inventoryMovements.id, filter.before) : undefined,
          ),
        )
        .orderBy(desc(inventoryMovements.id));
      return limit === undefined ? query : query.limit(limit);
    });
  }

  sharesOf(movementIds: readonly string[]): Promise<StoredShare[]> {
    if (movementIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryMovementBatches)
        .where(inArray(inventoryMovementBatches.movementId, [...movementIds])),
    );
  }

  /** The items of a category (movements of a category). */
  async itemIdsOfCategory(categoryId: string): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(eq(inventoryItems.categoryId, categoryId)),
    );
    return rows.map((row) => row.id);
  }

  /** The currency lock: a priced batch is inventory money. */
  async anyPricedBatch(): Promise<boolean> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ id: inventoryBatches.id })
        .from(inventoryBatches)
        .where(sql`${inventoryBatches.amount} is not null`)
        .limit(1),
    );
    return rows.length > 0;
  }
}
