import type { PaymentKind, PaymentMethod } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { DateIdCursor } from '../domain/payment-cursor';
import type { Payment } from '../domain/payment';
import { paymentCounters, payments } from './schema';

type PaymentRow = typeof payments.$inferSelect;

export type NewPayment = Omit<Payment, 'id' | 'createdAt'> & { id?: string };

function toDomain(row: PaymentRow): Payment {
  return {
    id: row.id,
    patientId: row.patientId,
    kind: row.kind,
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    paidAt: row.paidAt,
    reference: row.reference,
    note: row.note,
    reason: row.reason,
    receiptNumber: row.receiptNumber,
    householdGroupId: row.householdGroupId,
    payerContactId: row.payerContactId,
    reversesPaymentId: row.reversesPaymentId,
    ledgerEntryId: row.ledgerEntryId,
    idempotencyKey: row.idempotencyKey,
    balanceAfter: row.balanceAfter,
    branchId: row.branchId,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt,
  };
}

/** The Transactions filters, resolved: `match` ORs a patient, receipt or visit search (q). */
export interface TransactionCriteria {
  from?: string;
  method?: PaymentMethod;
  kind?: PaymentKind;
  patientId?: string;
  match?: { patientIds: readonly string[]; receiptNumber?: number; paymentIds: readonly string[] };
}

function whereFor(criteria: TransactionCriteria): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    criteria.from === undefined ? undefined : gte(payments.paidAt, criteria.from),
    criteria.method === undefined ? undefined : eq(payments.method, criteria.method),
    criteria.kind === undefined ? undefined : eq(payments.kind, criteria.kind),
    criteria.patientId === undefined ? undefined : eq(payments.patientId, criteria.patientId),
  ];
  if (criteria.match) {
    const { patientIds, receiptNumber, paymentIds } = criteria.match;
    conditions.push(
      or(
        patientIds.length > 0 ? inArray(payments.patientId, [...patientIds]) : sql`false`,
        receiptNumber === undefined ? sql`false` : eq(payments.receiptNumber, receiptNumber),
        paymentIds.length > 0
          ? or(
              inArray(payments.id, [...paymentIds]),
              inArray(payments.reversesPaymentId, [...paymentIds]),
            )
          : sql`false`,
      ),
    );
  }
  return and(...conditions);
}

/**
 * The tenant's `payments` (RLS-scoped through `TenantDb`). Append-only: the one update is
 * `repointPatient`, which only the merge job calls (P15).
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(payment: NewPayment): Promise<Payment> {
    const [row] = await this.db.run((tx) => tx.insert(payments).values(payment).returning());
    if (!row) throw new Error('payment insert returned no row');
    return toDomain(row);
  }

  /**
   * Serialises requests that share an `Idempotency-Key` (P11): a transaction advisory lock, so a
   * retry waits for the first request and then finds its rows. Keys are uuids, unique enough.
   */
  async lockIdempotencyKey(key: string): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`payment-key:${key}`}, 0))`),
    );
  }

  /** The rows a request with this `Idempotency-Key` wrote (several for a household). */
  async findByIdempotencyKey(key: string): Promise<Payment[]> {
    const rows = await this.db.run((tx) =>
      tx.select().from(payments).where(eq(payments.idempotencyKey, key)).orderBy(asc(payments.id)),
    );
    return rows.map(toDomain);
  }

  async findById(id: string): Promise<Payment | undefined> {
    const [row] = await this.db.run((tx) => tx.select().from(payments).where(eq(payments.id, id)));
    return row && toDomain(row);
  }

  /** The payment rows (not refunds/voids) that share `receiptNumber`. */
  async receiptRows(receiptNumber: number): Promise<Payment[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.receiptNumber, receiptNumber),
            sql`${payments.reversesPaymentId} is null`,
          ),
        )
        .orderBy(asc(payments.id)),
    );
    return rows.map(toDomain);
  }

  /** The refunds and voids of `paymentIds`, oldest first. */
  async reversalsOf(paymentIds: readonly string[]): Promise<Payment[]> {
    if (paymentIds.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(payments)
        .where(inArray(payments.reversesPaymentId, [...paymentIds]))
        .orderBy(asc(payments.id)),
    );
    return rows.map(toDomain);
  }

  /** Every row of a patient (payments, refunds, voids), oldest first. */
  async forPatient(patientId: string): Promise<Payment[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(payments)
        .where(eq(payments.patientId, patientId))
        .orderBy(asc(payments.paidAt), asc(payments.id)),
    );
    return rows.map(toDomain);
  }

  /** The rows posting `ledgerEntryIds`. */
  async byLedgerEntries(ledgerEntryIds: readonly string[]): Promise<Payment[]> {
    if (ledgerEntryIds.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(payments)
        .where(inArray(payments.ledgerEntryId, [...ledgerEntryIds])),
    );
    return rows.map(toDomain);
  }

  /** A Transactions page, newest first by (`paid_at`, id), one row past `limit`. */
  async page(
    criteria: TransactionCriteria,
    after: DateIdCursor | undefined,
    limit: number,
  ): Promise<Payment[]> {
    const position = after
      ? or(
          lt(payments.paidAt, after.date),
          and(eq(payments.paidAt, after.date), lt(payments.id, after.id)),
        )
      : undefined;
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(payments)
        .where(and(whereFor(criteria), position))
        .orderBy(desc(payments.paidAt), desc(payments.id))
        .limit(limit + 1),
    );
    return rows.map(toDomain);
  }

  /**
   * The KPI sums since `from` in `currency` (P14): payments not voided, and refunds. Summed by
   * Postgres on `numeric`.
   */
  async kpis(from: string, currency: string): Promise<{ collected: string; refunds: string }> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({
          collected: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.kind} = 'payment' and not exists (
            select 1 from payments v where v.reverses_payment_id = ${payments.id} and v.kind = 'void'
          )), 0)::text`,
          refunds: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.kind} = 'refund'), 0)::text`,
        })
        .from(payments)
        .where(and(gte(payments.paidAt, from), eq(payments.currency, currency))),
    );
    return row ?? { collected: '0', refunds: '0' };
  }

  /** Moves every row of `fromPatientId` to `toPatientId` (the merge re-point, P15). */
  async repointPatient(fromPatientId: string, toPatientId: string): Promise<number> {
    const rows = await this.db.run((tx) =>
      tx
        .update(payments)
        .set({ patientId: toPatientId, updatedAt: sql`now()` })
        .where(eq(payments.patientId, fromPatientId))
        .returning({ id: payments.id }),
    );
    return rows.length;
  }

  /**
   * The next receipt number (P10), starting at 1. The upsert's row lock serialises concurrent
   * payments; a rolled-back payment frees its number.
   */
  async nextReceiptNumber(): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .insert(paymentCounters)
        .values({ lastValue: 1 })
        .onConflictDoUpdate({
          target: paymentCounters.tenantId,
          set: { lastValue: sql`${paymentCounters.lastValue} + 1`, updatedAt: sql`now()` },
        })
        .returning({ lastValue: paymentCounters.lastValue }),
    );
    if (!row) throw new Error('payment counter upsert returned no row');
    return row.lastValue;
  }
}
