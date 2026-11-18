import { OPEN_LAB_ORDER_STATUSES, type LabOrderStatus } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import {
  type AnyColumn,
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { labOrderCounters, labOrderFiles, labOrderItems, labOrders, labOrderTrips } from './schema';

export type StoredOrder = typeof labOrders.$inferSelect;
export type NewOrder = Omit<
  typeof labOrders.$inferInsert,
  'tenantId' | 'createdAt' | 'updatedAt' | 'displayNumber'
>;
export type OrderPatch = Partial<
  Omit<NewOrder, 'id' | 'createdBy' | 'idempotencyKey' | 'idempotencyHash' | 'currency'>
>;
export type StoredItem = typeof labOrderItems.$inferSelect;
export type NewItem = Omit<
  typeof labOrderItems.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'orderId' | 'position'
>;
export type StoredTrip = typeof labOrderTrips.$inferSelect;
export type NewTrip = Omit<
  typeof labOrderTrips.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt'
>;
export type TripPatch = Partial<Omit<NewTrip, 'orderId' | 'seq'>>;

export interface OrderFilter {
  statuses?: readonly LabOrderStatus[] | undefined;
  labId?: string | undefined;
  dentistId?: string | undefined;
  branchId?: string | undefined;
  patientId?: string | undefined;
  /** At the lab with the current trip's expected date before this day. */
  lateBefore?: string | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
  /** A number typed or patients whose name matched (either). */
  match?: { number: number | null; patientIds: readonly string[] } | undefined;
  ids?: readonly string[] | undefined;
}

const OPEN = [...OPEN_LAB_ORDER_STATUSES];

/** Orders, their items, trips and attachments, and the per-clinic counter (Part B). */
@Injectable()
export class OrdersRepository {
  constructor(private readonly db: TenantDb) {}

  /** The next order number, starting at 1; a rolled-back create frees it (D7). */
  async nextNumber(): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .insert(labOrderCounters)
        .values({ lastValue: 1 })
        .onConflictDoUpdate({
          target: labOrderCounters.tenantId,
          set: { lastValue: sql`${labOrderCounters.lastValue} + 1`, updatedAt: sql`now()` },
        })
        .returning({ lastValue: labOrderCounters.lastValue }),
    );
    if (!row) throw new Error('lab order counter upsert returned no row');
    return row.lastValue;
  }

  async insert(order: NewOrder & { displayNumber: number }): Promise<StoredOrder> {
    const [row] = await this.db.run((tx) => tx.insert(labOrders).values(order).returning());
    if (!row) throw new Error('lab order insert returned no row');
    return row;
  }

  async update(id: string, patch: OrderPatch): Promise<StoredOrder> {
    const [row] = await this.db.run((tx) =>
      tx.update(labOrders).set(patch).where(eq(labOrders.id, id)).returning(),
    );
    if (!row) throw new Error('lab order update returned no row');
    return row;
  }

  async byId(id: string): Promise<StoredOrder | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(labOrders).where(eq(labOrders.id, id)),
    );
    return row;
  }

  /** `FOR UPDATE` in id order: one order's writes run one at a time. */
  lock(ids: readonly string[]): Promise<StoredOrder[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(labOrders)
        .where(inArray(labOrders.id, [...ids]))
        .orderBy(asc(labOrders.id))
        .for('update'),
    );
  }

  async lockKey(key: string): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`lab-orders-key:${key}`}, 0))`,
      ),
    );
  }

  async byKey(key: string): Promise<StoredOrder | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(labOrders).where(eq(labOrders.idempotencyKey, key)),
    );
    return row;
  }

  /** Newest first (uuid v7 ids are time-ordered), after `afterId` when paging. */
  list(filter: OrderFilter, limit: number, afterId?: string): Promise<StoredOrder[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(labOrders)
        .where(and(this.where(filter), afterId ? lt(labOrders.id, afterId) : undefined))
        .orderBy(desc(labOrders.id))
        .limit(limit),
    );
  }

  open(filter: Omit<OrderFilter, 'statuses'> = {}): Promise<StoredOrder[]> {
    return this.list({ ...filter, statuses: OPEN }, 100_000);
  }

  /** Every order of the labs (all labs when omitted): the accounts and the reports. */
  forLabs(labIds?: readonly string[]): Promise<StoredOrder[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(labOrders)
        .where(labIds ? inArray(labOrders.labId, [...labIds]) : undefined)
        .orderBy(asc(labOrders.id)),
    );
  }

  /** Orders with something in the period: a trip sent, received or sent back, done, cancelled. */
  touchedBetween(from: string, to: string): Promise<StoredOrder[]> {
    const between = (column: AnyColumn) => and(gte(column, from), lte(column, to));
    return this.db.run((tx) =>
      tx
        .select()
        .from(labOrders)
        .where(
          or(
            between(labOrders.doneOn),
            between(labOrders.cancelledOn),
            between(labOrders.firstReceivedOn),
            inArray(
              labOrders.id,
              tx
                .select({ id: labOrderTrips.orderId })
                .from(labOrderTrips)
                .where(
                  or(
                    between(labOrderTrips.sentOn),
                    between(labOrderTrips.receivedOn),
                    between(labOrderTrips.outcomeOn),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(labOrders.id)),
    );
  }

  linkedTo(appointmentId: string): Promise<StoredOrder[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(labOrders)
        .where(and(eq(labOrders.appointmentId, appointmentId), inArray(labOrders.status, OPEN)))
        .orderBy(asc(labOrders.id))
        .for('update'),
    );
  }

  /** The patient's open orders without an appointment, locked: a booking links them (D4). */
  unlinkedOpenOf(patientId: string): Promise<StoredOrder[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(labOrders)
        .where(
          and(
            eq(labOrders.patientId, patientId),
            inArray(labOrders.status, OPEN),
            isNull(labOrders.appointmentId),
          ),
        )
        .orderBy(asc(labOrders.id))
        .for('update'),
    );
  }

  async countOpenOf(patientId: string): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(labOrders)
        .where(and(eq(labOrders.patientId, patientId), inArray(labOrders.status, OPEN))),
    );
    return row?.count ?? 0;
  }

  async patientIdsWithOpen(): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .selectDistinct({ patientId: labOrders.patientId })
        .from(labOrders)
        .where(inArray(labOrders.status, OPEN)),
    );
    return rows.map((row) => row.patientId);
  }

  async repointPatient(droppedId: string, keptId: string): Promise<number> {
    const rows = await this.db.run((tx) =>
      tx
        .update(labOrders)
        .set({ patientId: keptId })
        .where(eq(labOrders.patientId, droppedId))
        .returning({ id: labOrders.id }),
    );
    return rows.length;
  }

  // --- Items ---

  items(orderIds: readonly string[]): Promise<StoredItem[]> {
    if (orderIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(labOrderItems)
        .where(inArray(labOrderItems.orderId, [...orderIds]))
        .orderBy(asc(labOrderItems.orderId), asc(labOrderItems.position)),
    );
  }

  async replaceItems(orderId: string, items: readonly NewItem[]): Promise<void> {
    await this.db.run(async (tx) => {
      await tx.delete(labOrderItems).where(eq(labOrderItems.orderId, orderId));
      if (items.length > 0) {
        await tx
          .insert(labOrderItems)
          .values(items.map((item, position) => ({ ...item, orderId, position })));
      }
    });
  }

  // --- Trips ---

  trips(orderIds: readonly string[]): Promise<StoredTrip[]> {
    if (orderIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(labOrderTrips)
        .where(inArray(labOrderTrips.orderId, [...orderIds]))
        .orderBy(asc(labOrderTrips.orderId), asc(labOrderTrips.seq)),
    );
  }

  async insertTrip(trip: NewTrip): Promise<StoredTrip> {
    const [row] = await this.db.run((tx) => tx.insert(labOrderTrips).values(trip).returning());
    if (!row) throw new Error('lab trip insert returned no row');
    return row;
  }

  async updateTrip(orderId: string, seq: number, patch: TripPatch): Promise<StoredTrip> {
    const [row] = await this.db.run((tx) =>
      tx
        .update(labOrderTrips)
        .set(patch)
        .where(and(eq(labOrderTrips.orderId, orderId), eq(labOrderTrips.seq, seq)))
        .returning(),
    );
    if (!row) throw new Error('lab trip update returned no row');
    return row;
  }

  async deleteTrip(orderId: string, seq: number): Promise<void> {
    await this.db.run((tx) =>
      tx
        .delete(labOrderTrips)
        .where(and(eq(labOrderTrips.orderId, orderId), eq(labOrderTrips.seq, seq))),
    );
  }

  // --- Attachments ---

  files(orderIds: readonly string[]): Promise<{ orderId: string; fileId: string }[]> {
    if (orderIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select({ orderId: labOrderFiles.orderId, fileId: labOrderFiles.fileId })
        .from(labOrderFiles)
        .where(inArray(labOrderFiles.orderId, [...orderIds]))
        .orderBy(asc(labOrderFiles.createdAt), asc(labOrderFiles.fileId)),
    );
  }

  async replaceFiles(orderId: string, fileIds: readonly string[]): Promise<void> {
    await this.db.run(async (tx) => {
      await tx.delete(labOrderFiles).where(eq(labOrderFiles.orderId, orderId));
      if (fileIds.length > 0) {
        await tx.insert(labOrderFiles).values(fileIds.map((fileId) => ({ orderId, fileId })));
      }
    });
  }

  private where(filter: OrderFilter) {
    const late = filter.lateBefore
      ? and(
          eq(labOrders.status, 'at_lab'),
          inArray(
            labOrders.id,
            sql`(select ${labOrderTrips.orderId} from ${labOrderTrips} where ${labOrderTrips.receivedOn} is null and ${labOrderTrips.expectedOn} < ${filter.lateBefore})`,
          ),
        )
      : undefined;
    const match = filter.match
      ? (or(
          filter.match.number !== null
            ? eq(labOrders.displayNumber, filter.match.number)
            : undefined,
          filter.match.patientIds.length > 0
            ? inArray(labOrders.patientId, [...filter.match.patientIds])
            : undefined,
        ) ?? sql`false`)
      : undefined;
    return and(
      filter.statuses ? inArray(labOrders.status, [...filter.statuses]) : undefined,
      filter.labId ? eq(labOrders.labId, filter.labId) : undefined,
      filter.dentistId ? eq(labOrders.dentistId, filter.dentistId) : undefined,
      filter.branchId ? eq(labOrders.branchId, filter.branchId) : undefined,
      filter.patientId ? eq(labOrders.patientId, filter.patientId) : undefined,
      filter.createdFrom ? gte(labOrders.createdAt, filter.createdFrom) : undefined,
      filter.createdTo ? lt(labOrders.createdAt, filter.createdTo) : undefined,
      filter.ids ? inArray(labOrders.id, [...filter.ids]) : undefined,
      late,
      match,
    );
  }
}
