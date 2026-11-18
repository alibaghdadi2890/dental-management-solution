import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { labAdjustments, labOrders, labPayments, labs, labServices } from './schema';

export type StoredLab = typeof labs.$inferSelect;
export type NewLab = Omit<typeof labs.$inferInsert, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type LabPatch = Partial<Omit<NewLab, 'currency' | 'createdBy'>>;
export type StoredService = typeof labServices.$inferSelect;
export type NewService = Omit<
  typeof labServices.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt'
>;
export type ServicePatch = Partial<
  Pick<NewService, 'name' | 'price' | 'turnaroundDays' | 'active'>
>;
export type StoredPayment = typeof labPayments.$inferSelect;
export type NewPayment = Omit<
  typeof labPayments.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'voidedAt' | 'voidedBy' | 'voidReason'
>;
export type StoredAdjustment = typeof labAdjustments.$inferSelect;
export type NewAdjustment = Omit<
  typeof labAdjustments.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt'
>;

const lowerName = (column: typeof labs.name | typeof labServices.name, name: string) =>
  sql`lower(${column}) = lower(${name})`;

/** Labs, their price lists and their accounts' payments and adjustments (Parts A and D). */
@Injectable()
export class LabsRepository {
  constructor(private readonly db: TenantDb) {}

  list(includeInactive: boolean): Promise<StoredLab[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(labs)
        .where(includeInactive ? undefined : eq(labs.active, true))
        .orderBy(sql`lower(${labs.name})`, asc(labs.id)),
    );
  }

  byIds(ids: readonly string[]): Promise<StoredLab[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(labs)
        .where(inArray(labs.id, [...ids])),
    );
  }

  async byId(id: string): Promise<StoredLab | undefined> {
    const [row] = await this.byIds([id]);
    return row;
  }

  async lock(id: string): Promise<StoredLab | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(labs).where(eq(labs.id, id)).for('update'),
    );
    return row;
  }

  async nameTaken(name: string, exceptId?: string): Promise<boolean> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ id: labs.id })
        .from(labs)
        .where(and(lowerName(labs.name, name), exceptId ? ne(labs.id, exceptId) : undefined)),
    );
    return rows.length > 0;
  }

  async insert(values: NewLab): Promise<StoredLab> {
    const [row] = await this.db.run((tx) => tx.insert(labs).values(values).returning());
    if (!row) throw new Error('lab insert returned no row');
    return row;
  }

  async update(id: string, patch: LabPatch): Promise<StoredLab> {
    const [row] = await this.db.run((tx) =>
      tx.update(labs).set(patch).where(eq(labs.id, id)).returning(),
    );
    if (!row) throw new Error('lab update returned no row');
    return row;
  }

  // --- Services ---

  services(labIds: readonly string[]): Promise<StoredService[]> {
    if (labIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(labServices)
        .where(inArray(labServices.labId, [...labIds]))
        .orderBy(sql`lower(${labServices.name})`, asc(labServices.id)),
    );
  }

  servicesByIds(ids: readonly string[]): Promise<StoredService[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(labServices)
        .where(inArray(labServices.id, [...ids])),
    );
  }

  async serviceNameTaken(labId: string, name: string, exceptId?: string): Promise<boolean> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ id: labServices.id })
        .from(labServices)
        .where(
          and(
            eq(labServices.labId, labId),
            lowerName(labServices.name, name),
            exceptId ? ne(labServices.id, exceptId) : undefined,
          ),
        ),
    );
    return rows.length > 0;
  }

  async insertService(values: NewService): Promise<StoredService> {
    const [row] = await this.db.run((tx) => tx.insert(labServices).values(values).returning());
    if (!row) throw new Error('lab service insert returned no row');
    return row;
  }

  async updateService(id: string, patch: ServicePatch): Promise<StoredService> {
    const [row] = await this.db.run((tx) =>
      tx.update(labServices).set(patch).where(eq(labServices.id, id)).returning(),
    );
    if (!row) throw new Error('lab service update returned no row');
    return row;
  }

  // --- Money ---

  /** Serialises a retried request with its first attempt (CLAUDE.md §12). */
  async lockKey(scope: string, key: string): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`labs-${scope}:${key}`}, 0))`),
    );
  }

  async paymentByKey(key: string): Promise<StoredPayment | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(labPayments).where(eq(labPayments.idempotencyKey, key)),
    );
    return row;
  }

  async adjustmentByKey(key: string): Promise<StoredAdjustment | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(labAdjustments).where(eq(labAdjustments.idempotencyKey, key)),
    );
    return row;
  }

  async insertPayment(values: NewPayment): Promise<StoredPayment> {
    const [row] = await this.db.run((tx) => tx.insert(labPayments).values(values).returning());
    if (!row) throw new Error('lab payment insert returned no row');
    return row;
  }

  async lockPayment(id: string): Promise<StoredPayment | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(labPayments).where(eq(labPayments.id, id)).for('update'),
    );
    return row;
  }

  async voidPayment(
    id: string,
    voided: { at: Date; by: string; reason: string },
  ): Promise<StoredPayment> {
    const [row] = await this.db.run((tx) =>
      tx
        .update(labPayments)
        .set({ voidedAt: voided.at, voidedBy: voided.by, voidReason: voided.reason })
        .where(eq(labPayments.id, id))
        .returning(),
    );
    if (!row) throw new Error('lab payment void returned no row');
    return row;
  }

  /** Every payment of the labs (all labs when omitted), voided ones included. */
  payments(labIds?: readonly string[]): Promise<StoredPayment[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(labPayments)
        .where(labIds ? inArray(labPayments.labId, [...labIds]) : undefined)
        .orderBy(asc(labPayments.paidOn), asc(labPayments.id)),
    );
  }

  async insertAdjustment(values: NewAdjustment): Promise<StoredAdjustment> {
    const [row] = await this.db.run((tx) => tx.insert(labAdjustments).values(values).returning());
    if (!row) throw new Error('lab adjustment insert returned no row');
    return row;
  }

  adjustments(labIds?: readonly string[]): Promise<StoredAdjustment[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(labAdjustments)
        .where(labIds ? inArray(labAdjustments.labId, [...labIds]) : undefined)
        .orderBy(asc(labAdjustments.onDate), asc(labAdjustments.id)),
    );
  }

  /** The currency lock: an opening balance, a price, an order, a payment or an adjustment. */
  async anyMoney(): Promise<boolean> {
    const exists = async (query: Promise<unknown[]>) => (await query).length > 0;
    return this.db.run(
      async (tx) =>
        (await exists(tx.select({ id: labServices.id }).from(labServices).limit(1))) ||
        (await exists(tx.select({ id: labOrders.id }).from(labOrders).limit(1))) ||
        (await exists(tx.select({ id: labPayments.id }).from(labPayments).limit(1))) ||
        (await exists(tx.select({ id: labAdjustments.id }).from(labAdjustments).limit(1))) ||
        (await exists(
          tx.select({ id: labs.id }).from(labs).where(isNotNull(labs.openingBalance)).limit(1),
        )),
    );
  }
}
