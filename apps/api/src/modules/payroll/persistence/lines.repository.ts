import type { PaymentMethod, PayrollAdjustment, PayrollLineStatus } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { payrollAdjustments, payrollLines, payrollPayments } from './schema';

export type StoredLine = typeof payrollLines.$inferSelect;
export type StoredAdjustment = typeof payrollAdjustments.$inferSelect;
export type StoredPayment = typeof payrollPayments.$inferSelect;

export interface NewPayment {
  lineId: string;
  employeeId: string;
  month: string;
  base: string;
  adjustments: PayrollAdjustment[];
  net: string;
  currency: string;
  paidOn: string;
  method: PaymentMethod;
  note: string | null;
  createdBy: string;
  idempotency: { key: string; hash: string };
}

/** What is stored about lines: the touched ones, their adjustments and their payments. */
export interface StoredLines {
  lines: StoredLine[];
  adjustments: Map<string, StoredAdjustment[]>;
  payments: Map<string, StoredPayment[]>;
}

/**
 * Payroll lines someone touched, their adjustments and payments (ADR-0078). A line row is made
 * on its first touch; payments are voided, never deleted.
 */
@Injectable()
export class LinesRepository {
  constructor(private readonly db: TenantDb) {}

  async lockIdempotencyKey(key: string): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`payroll-key:${key}`}, 0))`),
    );
  }

  paymentsByIdempotencyKey(key: string): Promise<StoredPayment[]> {
    return this.db.run((tx) =>
      tx.select().from(payrollPayments).where(eq(payrollPayments.idempotencyKey, key)),
    );
  }

  /** The line of (employee, month), made if it was never touched, locked for the change. */
  touch(employeeId: string, month: string): Promise<StoredLine> {
    return this.db.run(async (tx) => {
      await tx.insert(payrollLines).values({ employeeId, month }).onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(payrollLines)
        .where(and(eq(payrollLines.employeeId, employeeId), eq(payrollLines.month, month)))
        .for('update');
      if (!row) throw new Error('Payroll line missing after insert');
      return row;
    });
  }

  setStatus(
    id: string,
    status: PayrollLineStatus,
    skip: { reason: string; at: Date; by: string } | null = null,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      await tx
        .update(payrollLines)
        .set({
          status,
          skipReason: skip?.reason ?? null,
          skippedAt: skip?.at ?? null,
          skippedBy: skip?.by ?? null,
        })
        .where(eq(payrollLines.id, id));
    });
  }

  replaceAdjustments(
    lineId: string,
    adjustments: readonly PayrollAdjustment[],
    createdBy: string,
  ): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.delete(payrollAdjustments).where(eq(payrollAdjustments.lineId, lineId));
      if (adjustments.length === 0) return;
      await tx
        .insert(payrollAdjustments)
        .values(adjustments.map((adjustment) => ({ lineId, ...adjustment, createdBy })));
    });
  }

  insertPayment(payment: NewPayment): Promise<StoredPayment> {
    const { idempotency, ...values } = payment;
    return this.db.run(async (tx) => {
      const [row] = await tx
        .insert(payrollPayments)
        .values({
          ...values,
          idempotencyKey: idempotency.key,
          idempotencyHash: idempotency.hash,
        })
        .returning();
      if (!row) throw new Error('Payment insert returned nothing');
      return row;
    });
  }

  livePayment(lineId: string): Promise<StoredPayment | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(payrollPayments)
        .where(and(eq(payrollPayments.lineId, lineId), isNull(payrollPayments.voidedAt)))
        .for('update');
      return row;
    });
  }

  voidPayment(id: string, mark: { at: Date; by: string; reason: string }): Promise<void> {
    return this.db.run(async (tx) => {
      await tx
        .update(payrollPayments)
        .set({ voidedAt: mark.at, voidedBy: mark.by, voidReason: mark.reason })
        .where(eq(payrollPayments.id, id));
    });
  }

  /** Everything stored for `employeeIds`, every month. */
  async of(employeeIds: readonly string[]): Promise<StoredLines> {
    const stored: StoredLines = { lines: [], adjustments: new Map(), payments: new Map() };
    if (employeeIds.length === 0) return stored;
    stored.lines = await this.db.run((tx) =>
      tx
        .select()
        .from(payrollLines)
        .where(inArray(payrollLines.employeeId, [...employeeIds])),
    );
    const lineIds = stored.lines.map((line) => line.id);
    if (lineIds.length === 0) return stored;
    const adjustments = await this.db.run((tx) =>
      tx
        .select()
        .from(payrollAdjustments)
        .where(inArray(payrollAdjustments.lineId, lineIds))
        .orderBy(asc(payrollAdjustments.id)),
    );
    for (const row of adjustments) {
      stored.adjustments.set(row.lineId, [...(stored.adjustments.get(row.lineId) ?? []), row]);
    }
    const payments = await this.db.run((tx) =>
      tx
        .select()
        .from(payrollPayments)
        .where(inArray(payrollPayments.lineId, lineIds))
        .orderBy(asc(payrollPayments.id)),
    );
    for (const row of payments) {
      stored.payments.set(row.lineId, [...(stored.payments.get(row.lineId) ?? []), row]);
    }
    return stored;
  }

  /** Whether the employee has any stored line: then they are never removed (D8). */
  async anyLine(employeeId: string): Promise<boolean> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ id: payrollLines.id })
        .from(payrollLines)
        .where(eq(payrollLines.employeeId, employeeId))
        .limit(1),
    );
    return row !== undefined;
  }

  /** The employees among `employeeIds` with a stored line. */
  async employeesWithLines(employeeIds: readonly string[]): Promise<Set<string>> {
    if (employeeIds.length === 0) return new Set();
    const rows = await this.db.run((tx) =>
      tx
        .selectDistinct({ id: payrollLines.employeeId })
        .from(payrollLines)
        .where(inArray(payrollLines.employeeId, [...employeeIds])),
    );
    return new Set(rows.map((row) => row.id));
  }
}
