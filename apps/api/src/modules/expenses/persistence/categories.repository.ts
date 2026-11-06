import { EXPENSE_CATEGORY_KEYS, type ExpenseCategoryKey } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { expenseCategories, expenses, fixedExpenseItems, fixedExpenses } from './schema';

export interface StoredCategory {
  id: string;
  key: ExpenseCategoryKey | null;
  name: string | null;
  active: boolean;
}

const toCategory = (row: typeof expenseCategories.$inferSelect): StoredCategory => ({
  id: row.id,
  key: row.key,
  name: row.name,
  active: row.active,
});

/** The clinic's expense categories (D7). */
@Injectable()
export class CategoriesRepository {
  constructor(private readonly db: TenantDb) {}

  /** Keyed rows first in catalog order is the SPA's job; here, oldest first. */
  list(): Promise<StoredCategory[]> {
    return this.db.run(async (tx) =>
      (await tx.select().from(expenseCategories).orderBy(asc(expenseCategories.createdAt))).map(
        toCategory,
      ),
    );
  }

  find(id: string): Promise<StoredCategory | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, id));
      return row ? toCategory(row) : undefined;
    });
  }

  byKey(key: ExpenseCategoryKey): Promise<StoredCategory | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx.select().from(expenseCategories).where(eq(expenseCategories.key, key));
      return row ? toCategory(row) : undefined;
    });
  }

  /** The starting list, added where missing; returns how many rows were created. */
  insertMissingKeys(): Promise<number> {
    return this.db.run(async (tx) => {
      const created = await tx
        .insert(expenseCategories)
        .values(EXPENSE_CATEGORY_KEYS.map((key) => ({ key })))
        .onConflictDoNothing()
        .returning({ id: expenseCategories.id });
      return created.length;
    });
  }

  insertCustom(name: string, createdBy: string): Promise<StoredCategory> {
    return this.db.run(async (tx) => {
      const [row] = await tx.insert(expenseCategories).values({ name, createdBy }).returning();
      if (!row) throw new Error('Category insert returned nothing');
      return toCategory(row);
    });
  }

  update(id: string, patch: { name?: string; active?: boolean }): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.update(expenseCategories).set(patch).where(eq(expenseCategories.id, id));
    });
  }

  delete(id: string): Promise<void> {
    return this.db.run(async (tx) => {
      await tx.delete(expenseCategories).where(eq(expenseCategories.id, id));
    });
  }

  /** The categories some expense, fixed expense or item uses. */
  usedIds(): Promise<Set<string>> {
    return this.db.run(async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        select ${expenses.categoryId} as id from ${expenses}
        union select ${fixedExpenses.categoryId} from ${fixedExpenses}
        union select ${fixedExpenseItems.categoryId} from ${fixedExpenseItems}`);
      return new Set(rows.rows.map((row) => row.id));
    });
  }
}
