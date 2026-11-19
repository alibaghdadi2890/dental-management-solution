import { INVENTORY_CATEGORY_KEYS } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import {
  inventoryBatches,
  inventoryCategories,
  inventoryItemBranches,
  inventoryItems,
  inventoryMovements,
  inventorySettings,
  inventorySuppliers,
} from './schema';

export type StoredCategory = typeof inventoryCategories.$inferSelect;
export type StoredItem = typeof inventoryItems.$inferSelect;
export type NewItem = Omit<
  typeof inventoryItems.$inferInsert,
  'tenantId' | 'createdAt' | 'updatedAt'
>;
export type ItemPatch = Partial<Omit<NewItem, 'id' | 'createdBy'>>;
export type StoredItemBranch = typeof inventoryItemBranches.$inferSelect;
export type ItemBranchPatch = Partial<
  Pick<
    StoredItemBranch,
    'reorderLevel' | 'orderedOn' | 'orderedNote' | 'orderedBy' | 'toCountAt' | 'toCountBy'
  >
>;
export type StoredSupplier = typeof inventorySuppliers.$inferSelect;
export type NewSupplier = Omit<
  typeof inventorySuppliers.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt'
>;
export type SupplierPatch = Partial<Omit<NewSupplier, 'currency' | 'createdBy'>>;

/** Categories, items, an item's state per branch, suppliers and the settings (Parts A, D). */
@Injectable()
export class CatalogRepository {
  constructor(private readonly db: TenantDb) {}

  // --- Categories ---

  /** Adds the predefined categories the clinic does not have; returns how many were added. */
  async insertMissingKeys(): Promise<number> {
    const rows = await this.db.run((tx) =>
      tx
        .insert(inventoryCategories)
        .values(INVENTORY_CATEGORY_KEYS.map((key) => ({ key })))
        .onConflictDoNothing()
        .returning({ id: inventoryCategories.id }),
    );
    return rows.length;
  }

  categories(): Promise<StoredCategory[]> {
    return this.db.run((tx) =>
      tx.select().from(inventoryCategories).orderBy(asc(inventoryCategories.id)),
    );
  }

  async category(id: string): Promise<StoredCategory | undefined> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(inventoryCategories).where(eq(inventoryCategories.id, id)),
    );
    return row;
  }

  async usedCategoryIds(): Promise<Set<string>> {
    const rows = await this.db.run((tx) =>
      tx.selectDistinct({ id: inventoryItems.categoryId }).from(inventoryItems),
    );
    return new Set(rows.map((row) => row.id));
  }

  async insertCategory(name: string, createdBy: string): Promise<StoredCategory> {
    const [row] = await this.db.run((tx) =>
      tx.insert(inventoryCategories).values({ name, createdBy }).returning(),
    );
    if (!row) throw new Error('inventory category insert returned no row');
    return row;
  }

  async updateCategory(
    id: string,
    patch: Partial<Pick<StoredCategory, 'name' | 'active'>>,
  ): Promise<void> {
    await this.db.run((tx) =>
      tx.update(inventoryCategories).set(patch).where(eq(inventoryCategories.id, id)),
    );
  }

  async deleteCategory(id: string): Promise<void> {
    await this.db.run((tx) => tx.delete(inventoryCategories).where(eq(inventoryCategories.id, id)));
  }

  // --- Items ---

  items(): Promise<StoredItem[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryItems)
        .orderBy(sql`lower(${inventoryItems.name})`, asc(inventoryItems.id)),
    );
  }

  itemsByIds(ids: readonly string[]): Promise<StoredItem[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryItems)
        .where(inArray(inventoryItems.id, [...ids])),
    );
  }

  /** Locks the items in id order, so two writers never wait on each other in a circle. */
  lockItems(ids: readonly string[]): Promise<StoredItem[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryItems)
        .where(inArray(inventoryItems.id, [...ids]))
        .orderBy(asc(inventoryItems.id))
        .for('update'),
    );
  }

  async itemByName(name: string, exceptId?: string): Promise<StoredItem | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(inventoryItems)
        .where(
          and(
            sql`lower(${inventoryItems.name}) = lower(${name})`,
            exceptId ? ne(inventoryItems.id, exceptId) : undefined,
          ),
        ),
    );
    return row;
  }

  async itemByCode(code: string, exceptId?: string): Promise<StoredItem | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(inventoryItems)
        .where(
          and(
            sql`lower(${inventoryItems.code}) = lower(${code})`,
            exceptId ? ne(inventoryItems.id, exceptId) : undefined,
          ),
        ),
    );
    return row;
  }

  async insertItem(values: NewItem): Promise<StoredItem> {
    const [row] = await this.db.run((tx) => tx.insert(inventoryItems).values(values).returning());
    if (!row) throw new Error('inventory item insert returned no row');
    return row;
  }

  async updateItem(id: string, patch: ItemPatch): Promise<StoredItem> {
    const [row] = await this.db.run((tx) =>
      tx.update(inventoryItems).set(patch).where(eq(inventoryItems.id, id)).returning(),
    );
    if (!row) throw new Error('inventory item update returned no row');
    return row;
  }

  /** The items that ever moved: their unit and pack size are locked. */
  async movedItemIds(ids?: readonly string[]): Promise<Set<string>> {
    if (ids?.length === 0) return new Set();
    const rows = await this.db.run((tx) =>
      tx
        .selectDistinct({ id: inventoryMovements.itemId })
        .from(inventoryMovements)
        .where(ids ? inArray(inventoryMovements.itemId, [...ids]) : undefined),
    );
    return new Set(rows.map((row) => row.id));
  }

  /** What any branch holds of an item. */
  async heldAnywhere(itemId: string): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ left: sql<number>`coalesce(sum(${inventoryBatches.quantityLeft}), 0)::int` })
        .from(inventoryBatches)
        .where(eq(inventoryBatches.itemId, itemId)),
    );
    return row?.left ?? 0;
  }

  // --- An item in a branch ---

  itemBranches(filter: { branchId?: string; itemId?: string }): Promise<StoredItemBranch[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventoryItemBranches)
        .where(
          and(
            filter.branchId ? eq(inventoryItemBranches.branchId, filter.branchId) : undefined,
            filter.itemId ? eq(inventoryItemBranches.itemId, filter.itemId) : undefined,
          ),
        ),
    );
  }

  /** The row of an item in a branch, created when missing, locked. */
  async lockItemBranch(itemId: string, branchId: string): Promise<StoredItemBranch> {
    return this.db.run(async (tx) => {
      await tx.insert(inventoryItemBranches).values({ itemId, branchId }).onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(inventoryItemBranches)
        .where(
          and(
            eq(inventoryItemBranches.itemId, itemId),
            eq(inventoryItemBranches.branchId, branchId),
          ),
        )
        .for('update');
      if (!row) throw new Error('inventory item branch row is missing');
      return row;
    });
  }

  async updateItemBranch(id: string, patch: ItemBranchPatch): Promise<StoredItemBranch> {
    const [row] = await this.db.run((tx) =>
      tx
        .update(inventoryItemBranches)
        .set(patch)
        .where(eq(inventoryItemBranches.id, id))
        .returning(),
    );
    if (!row) throw new Error('inventory item branch update returned no row');
    return row;
  }

  /** Receiving an item clears _Ordered_ for it in that branch (B6). */
  async clearOrdered(itemIds: readonly string[], branchId: string): Promise<string[]> {
    if (itemIds.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .update(inventoryItemBranches)
        .set({ orderedOn: null, orderedNote: null, orderedBy: null })
        .where(
          and(
            eq(inventoryItemBranches.branchId, branchId),
            inArray(inventoryItemBranches.itemId, [...itemIds]),
            isNotNull(inventoryItemBranches.orderedOn),
          ),
        )
        .returning({ itemId: inventoryItemBranches.itemId }),
    );
    return rows.map((row) => row.itemId);
  }

  /** Applying a count clears _To count_ for the items it counted (B5). */
  async clearToCount(itemIds: readonly string[], branchId: string): Promise<void> {
    if (itemIds.length === 0) return;
    await this.db.run((tx) =>
      tx
        .update(inventoryItemBranches)
        .set({ toCountAt: null, toCountBy: null })
        .where(
          and(
            eq(inventoryItemBranches.branchId, branchId),
            inArray(inventoryItemBranches.itemId, [...itemIds]),
          ),
        ),
    );
  }

  // --- Suppliers ---

  suppliers(includeInactive: boolean): Promise<StoredSupplier[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventorySuppliers)
        .where(includeInactive ? undefined : eq(inventorySuppliers.active, true))
        .orderBy(sql`lower(${inventorySuppliers.name})`, asc(inventorySuppliers.id)),
    );
  }

  suppliersByIds(ids: readonly string[]): Promise<StoredSupplier[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(inventorySuppliers)
        .where(inArray(inventorySuppliers.id, [...ids])),
    );
  }

  async supplier(id: string, lock = false): Promise<StoredSupplier | undefined> {
    const [row] = await this.db.run((tx) => {
      const query = tx.select().from(inventorySuppliers).where(eq(inventorySuppliers.id, id));
      return lock ? query.for('update') : query;
    });
    return row;
  }

  async supplierByName(name: string, exceptId?: string): Promise<StoredSupplier | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(inventorySuppliers)
        .where(
          and(
            sql`lower(${inventorySuppliers.name}) = lower(${name})`,
            exceptId ? ne(inventorySuppliers.id, exceptId) : undefined,
          ),
        ),
    );
    return row;
  }

  async insertSupplier(values: NewSupplier): Promise<StoredSupplier> {
    const [row] = await this.db.run((tx) =>
      tx.insert(inventorySuppliers).values(values).returning(),
    );
    if (!row) throw new Error('supplier insert returned no row');
    return row;
  }

  async updateSupplier(id: string, patch: SupplierPatch): Promise<StoredSupplier> {
    const [row] = await this.db.run((tx) =>
      tx.update(inventorySuppliers).set(patch).where(eq(inventorySuppliers.id, id)).returning(),
    );
    if (!row) throw new Error('supplier update returned no row');
    return row;
  }

  // --- Settings ---

  async expiringDays(): Promise<number | null> {
    const [row] = await this.db.run((tx) => tx.select().from(inventorySettings));
    return row?.expiringDays ?? null;
  }

  async setExpiringDays(days: number): Promise<void> {
    await this.db.run((tx) =>
      tx
        .insert(inventorySettings)
        .values({ expiringDays: days })
        .onConflictDoUpdate({ target: inventorySettings.tenantId, set: { expiringDays: days } }),
    );
  }

  /** Advisory lock on an idempotency key of one kind of write. */
  async lockKey(scope: string, key: string): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`inventory-${scope}:${key}`}, 0))`,
      ),
    );
  }
}
