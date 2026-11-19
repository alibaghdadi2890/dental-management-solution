import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import {
  inventoryCountLines,
  inventoryCounts,
  inventoryReceiptFiles,
  inventorySupplierAdjustments,
  inventorySupplierPayments,
  inventorySuppliers,
} from './schema';

export type StoredPayment = typeof inventorySupplierPayments.$inferSelect;
export type NewPayment = Omit<
  typeof inventorySupplierPayments.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'voidedAt' | 'voidedBy' | 'voidReason'
>;
export type StoredAdjustment = typeof inventorySupplierAdjustments.$inferSelect;
export type NewAdjustment = Omit<
  typeof inventorySupplierAdjustments.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt'
>;
export type StoredCount = typeof inventoryCounts.$inferSelect;
export type StoredCountLine = typeof inventoryCountLines.$inferSelect;
export type CountLinePatch = Partial<
  Omit<StoredCountLine, 'id' | 'tenantId' | 'countId' | 'itemId' | 'createdAt' | 'updatedAt'>
>;
export type StoredReceiptFile = typeof inventoryReceiptFiles.$inferSelect;

/** Supplier payments and adjustments (Part D), counts (B5) and receipt attachments (B1). */
@Injectable()
export class MoneyRepository {
  constructor(private readonly db: TenantDb) {}

  // --- Payments ---

  async insertPayment(values: NewPayment): Promise<StoredPayment> {
    const [row] = await this.db.run((tx) =>
      tx.insert(inventorySupplierPayments).values(values).returning(),
    );
    if (!row) throw new Error('supplier payment insert returned no row');
    return row;
  }

  async paymentByKey(key: string): Promise<StoredPayment | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(inventorySupplierPayments)
        .where(eq(inventorySupplierPayments.idempotencyKey, key)),
    );
    return row;
  }

  async lockPayment(id: string): Promise<StoredPayment | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(inventorySupplierPayments)
        .where(eq(inventorySupplierPayments.id, id))
        .for('update'),
    );
    return row;
  }

  async paymentOfReceipt(receiptId: string): Promise<StoredPayment | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(inventorySupplierPayments)
        .where(
          and(
            eq(inventorySupplierPayments.receiptId, receiptId),
            isNull(inventorySupplierPayments.supplierId),
          ),
        ),
    );
    return row;
  }

  paymentsOfReceipts(receiptIds: readonly string[]): Promise<StoredPayment[]> {
    if (receiptIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventorySupplierPayments)
        .where(inArray(inventorySupplierPayments.receiptId, [...receiptIds])),
    );
  }

  async voidPayment(id: string, at: Date, by: string, reason: string): Promise<StoredPayment> {
    const [row] = await this.db.run((tx) =>
      tx
        .update(inventorySupplierPayments)
        .set({ voidedAt: at, voidedBy: by, voidReason: reason })
        .where(eq(inventorySupplierPayments.id, id))
        .returning(),
    );
    if (!row) throw new Error('supplier payment void returned no row');
    return row;
  }

  payments(supplierIds: readonly string[]): Promise<StoredPayment[]> {
    if (supplierIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventorySupplierPayments)
        .where(inArray(inventorySupplierPayments.supplierId, [...supplierIds]))
        .orderBy(asc(inventorySupplierPayments.id)),
    );
  }

  // --- Adjustments ---

  async insertAdjustment(values: NewAdjustment): Promise<StoredAdjustment> {
    const [row] = await this.db.run((tx) =>
      tx.insert(inventorySupplierAdjustments).values(values).returning(),
    );
    if (!row) throw new Error('supplier adjustment insert returned no row');
    return row;
  }

  async adjustmentByKey(key: string): Promise<StoredAdjustment | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(inventorySupplierAdjustments)
        .where(eq(inventorySupplierAdjustments.idempotencyKey, key)),
    );
    return row;
  }

  adjustments(supplierIds: readonly string[]): Promise<StoredAdjustment[]> {
    if (supplierIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventorySupplierAdjustments)
        .where(inArray(inventorySupplierAdjustments.supplierId, [...supplierIds]))
        .orderBy(asc(inventorySupplierAdjustments.id)),
    );
  }

  /** The currency lock: an opening balance, a payment or an adjustment is inventory money. */
  async anyAccountMoney(): Promise<boolean> {
    const exists = async (query: Promise<unknown[]>) => (await query).length > 0;
    return this.db.run(
      async (tx) =>
        (await exists(
          tx.select({ id: inventorySupplierPayments.id }).from(inventorySupplierPayments).limit(1),
        )) ||
        (await exists(
          tx
            .select({ id: inventorySupplierAdjustments.id })
            .from(inventorySupplierAdjustments)
            .limit(1),
        )) ||
        (await exists(
          tx
            .select({ id: inventorySuppliers.id })
            .from(inventorySuppliers)
            .where(sql`${inventorySuppliers.openingBalance} is not null`)
            .limit(1),
        )),
    );
  }

  // --- Counts ---

  async insertCount(values: {
    branchId: string;
    categoryIds: string[];
    startedBy: string;
  }): Promise<StoredCount> {
    const [row] = await this.db.run((tx) => tx.insert(inventoryCounts).values(values).returning());
    if (!row) throw new Error('count insert returned no row');
    return row;
  }

  async insertCountLines(countId: string, itemIds: readonly string[]): Promise<void> {
    if (itemIds.length === 0) return;
    await this.db.run((tx) =>
      tx.insert(inventoryCountLines).values(itemIds.map((itemId) => ({ countId, itemId }))),
    );
  }

  async count(id: string, lock = false): Promise<StoredCount | undefined> {
    const [row] = await this.db.run((tx) => {
      const query = tx.select().from(inventoryCounts).where(eq(inventoryCounts.id, id));
      return lock ? query.for('update') : query;
    });
    return row;
  }

  async openCount(branchId: string): Promise<StoredCount | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(inventoryCounts)
        .where(and(eq(inventoryCounts.branchId, branchId), eq(inventoryCounts.status, 'open'))),
    );
    return row;
  }

  counts(branchId: string): Promise<StoredCount[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryCounts)
        .where(eq(inventoryCounts.branchId, branchId))
        .orderBy(sql`${inventoryCounts.id} desc`)
        .limit(100),
    );
  }

  async closeCount(
    id: string,
    status: 'applied' | 'discarded',
    at: Date,
    by: string,
    key: string | null,
  ): Promise<StoredCount> {
    const [row] = await this.db.run((tx) =>
      tx
        .update(inventoryCounts)
        .set({ status, closedAt: at, closedBy: by, applyIdempotencyKey: key })
        .where(eq(inventoryCounts.id, id))
        .returning(),
    );
    if (!row) throw new Error('count close returned no row');
    return row;
  }

  countLines(countIds: readonly string[]): Promise<StoredCountLine[]> {
    if (countIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryCountLines)
        .where(inArray(inventoryCountLines.countId, [...countIds]))
        .orderBy(asc(inventoryCountLines.id)),
    );
  }

  async lockCountLine(countId: string, itemId: string): Promise<StoredCountLine | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(inventoryCountLines)
        .where(
          and(eq(inventoryCountLines.countId, countId), eq(inventoryCountLines.itemId, itemId)),
        )
        .for('update'),
    );
    return row;
  }

  async updateCountLine(id: string, patch: CountLinePatch): Promise<StoredCountLine> {
    const [row] = await this.db.run((tx) =>
      tx.update(inventoryCountLines).set(patch).where(eq(inventoryCountLines.id, id)).returning(),
    );
    if (!row) throw new Error('count line update returned no row');
    return row;
  }

  // --- Receipt files ---

  async insertFiles(
    rows: readonly Omit<StoredReceiptFile, 'tenantId' | 'createdAt' | 'updatedAt' | 'savedAt'>[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.db.run((tx) => tx.insert(inventoryReceiptFiles).values([...rows]));
  }

  files(receiptIds: readonly string[], savedOnly = true): Promise<StoredReceiptFile[]> {
    if (receiptIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryReceiptFiles)
        .where(
          and(
            inArray(inventoryReceiptFiles.receiptId, [...receiptIds]),
            savedOnly ? sql`${inventoryReceiptFiles.savedAt} is not null` : undefined,
          ),
        )
        .orderBy(asc(inventoryReceiptFiles.id)),
    );
  }

  filesByIds(ids: readonly string[]): Promise<StoredReceiptFile[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryReceiptFiles)
        .where(inArray(inventoryReceiptFiles.id, [...ids])),
    );
  }

  async saveFile(id: string, storageKey: string, sizeBytes: number, at: Date): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(inventoryReceiptFiles)
        .set({ storageKey, sizeBytes, savedAt: at })
        .where(eq(inventoryReceiptFiles.id, id)),
    );
  }

  async deleteFiles(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.run((tx) =>
      tx.delete(inventoryReceiptFiles).where(inArray(inventoryReceiptFiles.id, [...ids])),
    );
  }
}
