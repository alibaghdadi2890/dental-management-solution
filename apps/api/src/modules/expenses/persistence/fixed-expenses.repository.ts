import type { FixedExpenseStatus, PaymentMethod } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { fixedExpenseItems, fixedExpenses } from './schema';

export type StoredFixedExpense = typeof fixedExpenses.$inferSelect;
export type StoredItem = typeof fixedExpenseItems.$inferSelect;

export interface NewFixedExpense {
  name: string;
  categoryId: string;
  amount: string;
  currency: string;
  method: PaymentMethod | null;
  payee: string | null;
  branchId: string | null;
  note: string | null;
  firstMonth: string;
  createdBy: string;
}

export type FixedExpensePatch = Partial<
  Pick<NewFixedExpense, 'name' | 'categoryId' | 'amount' | 'method' | 'payee' | 'branchId' | 'note'>
>;

/** Fixed expenses and their monthly items (ADR-0078); neither is ever deleted. */
@Injectable()
export class FixedExpensesRepository {
  constructor(private readonly db: TenantDb) {}

  /** One catch-up per clinic at a time, to the end of the transaction. */
  async lockCatchUp(): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('expenses-catch-up:' || current_setting('app.tenant_id'), 0))`,
      ),
    );
  }

  insert(template: NewFixedExpense): Promise<StoredFixedExpense> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .insert(fixedExpenses)
        .values({ ...template, nextMonth: template.firstMonth })
        .returning();
      if (!row) throw new Error('Fixed expense insert returned nothing');
      return row;
    });
  }

  findForUpdate(id: string): Promise<StoredFixedExpense | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(fixedExpenses)
        .where(eq(fixedExpenses.id, id))
        .for('update');
      return row;
    });
  }

  list(): Promise<StoredFixedExpense[]> {
    return this.db.run((tx) =>
      tx.select().from(fixedExpenses).orderBy(asc(fixedExpenses.name), asc(fixedExpenses.id)),
    );
  }

  /** Active templates with a month due by `currentMonth`, locked for the catch-up. */
  due(currentMonth: string): Promise<StoredFixedExpense[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(fixedExpenses)
        .where(and(eq(fixedExpenses.status, 'active'), lte(fixedExpenses.nextMonth, currentMonth)))
        .orderBy(asc(fixedExpenses.id))
        .for('update'),
    );
  }

  update(
    id: string,
    patch: FixedExpensePatch & { status?: FixedExpenseStatus; nextMonth?: string },
  ): Promise<StoredFixedExpense> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .update(fixedExpenses)
        .set(patch)
        .where(eq(fixedExpenses.id, id))
        .returning();
      if (!row) throw new Error('Fixed expense update returned nothing');
      return row;
    });
  }

  /** One item per month, a snapshot of the template; a month already there is kept. */
  insertItems(template: StoredFixedExpense, months: readonly string[]): Promise<void> {
    if (months.length === 0) return Promise.resolve();
    return this.db.run(async (tx) => {
      await tx
        .insert(fixedExpenseItems)
        .values(
          months.map((month) => ({
            fixedExpenseId: template.id,
            month,
            name: template.name,
            categoryId: template.categoryId,
            amount: template.amount,
            currency: template.currency,
            method: template.method,
            payee: template.payee,
            branchId: template.branchId,
          })),
        )
        .onConflictDoNothing();
    });
  }

  /** Every pending item, oldest month first, then by name. */
  pending(): Promise<StoredItem[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(fixedExpenseItems)
        .where(eq(fixedExpenseItems.status, 'pending'))
        .orderBy(
          asc(fixedExpenseItems.month),
          asc(fixedExpenseItems.name),
          asc(fixedExpenseItems.id),
        ),
    );
  }

  pendingCounts(): Promise<Map<string, number>> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({ id: fixedExpenseItems.fixedExpenseId, count: sql<number>`count(*)::int` })
        .from(fixedExpenseItems)
        .where(eq(fixedExpenseItems.status, 'pending'))
        .groupBy(fixedExpenseItems.fixedExpenseId);
      return new Map(rows.map((row) => [row.id, row.count]));
    });
  }

  /** A template's items, newest month first. */
  itemsOf(fixedExpenseId: string): Promise<StoredItem[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(fixedExpenseItems)
        .where(eq(fixedExpenseItems.fixedExpenseId, fixedExpenseId))
        .orderBy(desc(fixedExpenseItems.month)),
    );
  }

  /** The items among `ids`, locked in id order (so two batches never deadlock). */
  lockItems(ids: readonly string[]): Promise<StoredItem[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(fixedExpenseItems)
        .where(inArray(fixedExpenseItems.id, [...ids]))
        .orderBy(asc(fixedExpenseItems.id))
        .for('update'),
    );
  }

  confirm(id: string, expenseId: string): Promise<void> {
    return this.setItem(id, { status: 'confirmed', expenseId });
  }

  skip(id: string, mark: { at: Date; by: string; reason: string | null }): Promise<void> {
    return this.setItem(id, {
      status: 'skipped',
      skipReason: mark.reason,
      skippedAt: mark.at,
      skippedBy: mark.by,
    });
  }

  /** Back to pending: an undone skip, or the voided expense that confirmed it. */
  reopen(id: string): Promise<void> {
    return this.setItem(id, {
      status: 'pending',
      expenseId: null,
      skipReason: null,
      skippedAt: null,
      skippedBy: null,
    });
  }

  async any(): Promise<boolean> {
    const [row] = await this.db.run((tx) =>
      tx.select({ id: fixedExpenses.id }).from(fixedExpenses).limit(1),
    );
    return row !== undefined;
  }

  private setItem(id: string, values: Partial<typeof fixedExpenseItems.$inferInsert>) {
    return this.db.run(async (tx) => {
      await tx.update(fixedExpenseItems).set(values).where(eq(fixedExpenseItems.id, id));
    });
  }
}
