import type { ExpenseSource, PaymentMethod } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { expenses } from './schema';

export type StoredExpense = typeof expenses.$inferSelect;

export interface ExpenseFilter {
  from: string;
  to: string;
  /** The sources the caller may see (ADR-0080). */
  sources: readonly ExpenseSource[];
  categoryId?: string | undefined;
  branchId?: string | undefined;
  method?: PaymentMethod | undefined;
  q?: string | undefined;
  includeVoided?: boolean | undefined;
}

export interface ExpenseCursor {
  spentOn: string;
  id: string;
}

export interface NewExpense {
  spentOn: string;
  categoryId: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  payee: string | null;
  reference: string | null;
  description: string | null;
  branchId: string | null;
  source: ExpenseSource;
  sourceId: string | null;
  sourceMonth: string | null;
  createdBy: string;
  idempotency?: { key: string; hash: string } | undefined;
}

export interface Totals {
  amount: string;
  count: number;
}

export type ExpensePatch = Partial<
  Pick<
    NewExpense,
    | 'spentOn'
    | 'categoryId'
    | 'amount'
    | 'method'
    | 'payee'
    | 'reference'
    | 'description'
    | 'branchId'
  >
>;

/** `numeric(12,2)` sums, two decimals even when nothing is summed. */
const SUM = sql<string>`coalesce(sum(${expenses.amount}), 0)::numeric(18, 2)::text`;
const COUNT = sql<number>`count(*)::int`;

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (match) => `\\${match}`);

function filterConditions(filter: ExpenseFilter, withVoided: boolean): SQL[] {
  const conditions: SQL[] = [
    gte(expenses.spentOn, filter.from),
    lte(expenses.spentOn, filter.to),
    filter.sources.length > 0 ? inArray(expenses.source, [...filter.sources]) : sql`false`,
  ];
  if (!withVoided) conditions.push(isNull(expenses.voidedAt));
  if (filter.categoryId) conditions.push(eq(expenses.categoryId, filter.categoryId));
  if (filter.branchId) conditions.push(eq(expenses.branchId, filter.branchId));
  if (filter.method) conditions.push(eq(expenses.method, filter.method));
  if (filter.q) {
    const pattern = `%${escapeLike(filter.q)}%`;
    const text = or(
      ilike(expenses.payee, pattern),
      ilike(expenses.description, pattern),
      ilike(expenses.reference, pattern),
    );
    if (text) conditions.push(text);
  }
  return conditions;
}

/** Expenses (ADR-0076): typed, confirmed and mirrored rows; edited, voided, never deleted. */
@Injectable()
export class ExpensesRepository {
  constructor(private readonly db: TenantDb) {}

  /** Requests sharing an `Idempotency-Key` run one at a time, to the end of the transaction. */
  async lockIdempotencyKey(key: string): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`expenses-key:${key}`}, 0))`),
    );
  }

  byIdempotencyKey(key: string): Promise<StoredExpense[]> {
    return this.db.run((tx) => tx.select().from(expenses).where(eq(expenses.idempotencyKey, key)));
  }

  findForUpdate(id: string): Promise<StoredExpense | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update');
      return row;
    });
  }

  insert(expense: NewExpense): Promise<StoredExpense> {
    const { idempotency, ...values } = expense;
    return this.db.run(async (tx) => {
      const [row] = await tx
        .insert(expenses)
        .values({
          ...values,
          idempotencyKey: idempotency?.key ?? null,
          idempotencyHash: idempotency?.hash ?? null,
        })
        .returning();
      if (!row) throw new Error('Expense insert returned nothing');
      return row;
    });
  }

  /** A mirror is written once per payment or payout: a replayed event changes nothing. */
  insertMirror(expense: NewExpense): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.insert(expenses).values(expense).onConflictDoNothing();
    });
  }

  update(id: string, patch: ExpensePatch, by: string): Promise<StoredExpense> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .update(expenses)
        .set({ ...patch, updatedBy: by })
        .where(eq(expenses.id, id))
        .returning();
      if (!row) throw new Error('Expense update returned nothing');
      return row;
    });
  }

  void(id: string, mark: { at: Date; by: string; reason: string }): Promise<StoredExpense> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .update(expenses)
        .set({ voidedAt: mark.at, voidedBy: mark.by, voidReason: mark.reason })
        .where(eq(expenses.id, id))
        .returning();
      if (!row) throw new Error('Expense void returned nothing');
      return row;
    });
  }

  /** Voids the live mirror of a payment or payout, if any. */
  voidMirror(
    source: 'payroll' | 'compensation',
    sourceId: string,
    mark: { at: Date; by: string; reason: string },
  ): Promise<void> {
    return this.db.run(async (tx) => {
      await tx
        .update(expenses)
        .set({ voidedAt: mark.at, voidedBy: mark.by, voidReason: mark.reason })
        .where(
          and(
            eq(expenses.source, source),
            eq(expenses.sourceId, sourceId),
            isNull(expenses.voidedAt),
          ),
        );
    });
  }

  /** Newest first (date, then id), after `cursor`. */
  list(filter: ExpenseFilter, limit: number, cursor?: ExpenseCursor): Promise<StoredExpense[]> {
    const conditions = filterConditions(filter, filter.includeVoided === true);
    if (cursor) {
      const older = or(
        lt(expenses.spentOn, cursor.spentOn),
        and(eq(expenses.spentOn, cursor.spentOn), lt(expenses.id, cursor.id)),
      );
      if (older) conditions.push(older);
    }
    return this.db.run((tx) =>
      tx
        .select()
        .from(expenses)
        .where(and(...conditions))
        .orderBy(desc(expenses.spentOn), desc(expenses.id))
        .limit(limit),
    );
  }

  /** What the filter adds up to, voided rows never counted. */
  totals(filter: ExpenseFilter): Promise<Totals> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select({ amount: SUM, count: COUNT })
        .from(expenses)
        .where(and(...filterConditions(filter, false)));
      return row ?? { amount: '0.00', count: 0 };
    });
  }

  byCategory(filter: ExpenseFilter): Promise<(Totals & { categoryId: string })[]> {
    return this.db.run((tx) =>
      tx
        .select({ categoryId: expenses.categoryId, amount: SUM, count: COUNT })
        .from(expenses)
        .where(and(...filterConditions(filter, false)))
        .groupBy(expenses.categoryId)
        .orderBy(sql`sum(${expenses.amount}) desc`),
    );
  }

  byMonth(filter: ExpenseFilter): Promise<(Totals & { month: string })[]> {
    const month = sql<string>`to_char(${expenses.spentOn}, 'YYYY-MM')`;
    return this.db.run((tx) =>
      tx
        .select({ month, amount: SUM, count: COUNT })
        .from(expenses)
        .where(and(...filterConditions(filter, false)))
        .groupBy(month),
    );
  }

  /** Any expense at all: the clinic's currency is locked. */
  async any(): Promise<boolean> {
    const [row] = await this.db.run((tx) => tx.select({ id: expenses.id }).from(expenses).limit(1));
    return row !== undefined;
  }
}
