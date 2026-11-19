import {
  type CreateInventoryCategory,
  type InventoryCategory,
  type InventoryItem,
  type InventorySettings,
  type ItemBranchLevel,
  type ItemInput,
  type MarkOrdered,
  type MarkOrderedMany,
  type SaveItems,
  type UpdateInventoryCategory,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { newId } from '../../../platform/kernel/id';
import {
  type ValidationIssue,
  ValidationFailedError,
} from '../../../platform/kernel/validation-failed.error';
import { AuditService } from '../../audit';
import {
  CategoryLockedError,
  InventoryInactiveError,
  InventoryNameTakenError,
  InventoryNotFoundError,
} from '../domain/inventory-errors';
import {
  CatalogRepository,
  type StoredCategory,
  type StoredItem,
} from '../persistence/catalog.repository';
import { categoryKeyByName, KEYED_CATEGORY_NAMES } from './export-labels';
import { InventoryCalendar } from './inventory-calendar';
import { toCategory, toItem } from './presenter';

const ITEM_FIELDS = [
  'name',
  'code',
  'categoryId',
  'unit',
  'packName',
  'packSize',
  'reorderLevel',
  'usualSupplierId',
  'usualOrderPacks',
  'tracksExpiry',
  'note',
  'active',
] as const;

const folded = (text: string) => text.trim().toLocaleLowerCase();

/**
 * What the clinic stocks (feature 20a, Part A; docs/modules/inventory.md): categories, items, an
 * item's own reorder level per branch, _Ordered_ and _To count_, and the expiring window. Reads
 * need `inventory:read`; changes `inventory:manage`, except _Report wrong count_
 * (`inventory:write`). Every change is audited in its transaction.
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly calendar: InventoryCalendar,
    private readonly catalog: CatalogRepository,
  ) {}

  // --- Categories ---

  categories(): Promise<InventoryCategory[]> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      await this.catalog.insertMissingKeys();
      const used = await this.catalog.usedCategoryIds();
      return (await this.catalog.categories()).map((row) => toCategory(row, used.has(row.id)));
    });
  }

  createCategory(input: CreateInventoryCategory): Promise<InventoryCategory> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      await this.assertCategoryNameFree(input.name);
      const row = await this.catalog.insertCategory(input.name, this.context.requireUserId());
      await this.recordCategory('create', row, undefined, { name: row.name });
      return toCategory(row, false);
    });
  }

  /** The expense categories' rules: a predefined one only (re)activates; a custom one also renames. */
  updateCategory(id: string, patch: UpdateInventoryCategory): Promise<InventoryCategory> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      const row = await this.requireCategory(id);
      const inUse = (await this.catalog.usedCategoryIds()).has(id);
      let current = row;
      if (patch.name !== undefined && patch.name !== row.name) {
        if (row.key !== null) throw new CategoryLockedError('A predefined category keeps its name');
        await this.assertCategoryNameFree(patch.name, id);
        await this.catalog.updateCategory(id, { name: patch.name });
        current = { ...current, name: patch.name };
        await this.recordCategory('rename', current, { name: row.name }, { name: patch.name });
      }
      if (patch.active !== undefined && patch.active !== row.active) {
        await this.catalog.updateCategory(id, { active: patch.active });
        current = { ...current, active: patch.active };
        await this.recordCategory(
          patch.active ? 'reactivate' : 'deactivate',
          current,
          { active: row.active },
          { active: patch.active },
        );
      }
      return toCategory(current, inUse);
    });
  }

  deleteCategory(id: string): Promise<void> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      const row = await this.requireCategory(id);
      if (row.key !== null) throw new CategoryLockedError('A predefined category is never deleted');
      if ((await this.catalog.usedCategoryIds()).has(id)) {
        throw new CategoryLockedError('This category is used; deactivate it instead');
      }
      await this.catalog.deleteCategory(id);
      await this.recordCategory('delete', row, { name: row.name }, undefined);
    });
  }

  /** The starting list for a new clinic (a system task, after provisioning). */
  seedCategories(): Promise<number> {
    return this.tenantDb.run(() => this.catalog.insertMissingKeys());
  }

  // --- Items ---

  items(): Promise<InventoryItem[]> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      const rows = await this.catalog.items();
      const moved = await this.catalog.movedItemIds();
      return rows.map((row) => toItem(row, moved.has(row.id)));
    });
  }

  /**
   * `PUT /inventory/items`: the Catalog's save (Part A). Every row is created or updated in one
   * transaction; what a row breaks is reported at `items.<index>.<field>`, nothing is saved.
   */
  saveItems(input: SaveItems): Promise<InventoryItem[]> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      await this.catalog.insertMissingKeys();
      const stored = await this.catalog.items();
      const byId = new Map(stored.map((row) => [row.id, row] as const));
      const categories = new Map(
        (await this.catalog.categories()).map((row) => [row.id, row] as const),
      );
      const suppliers = new Map(
        (await this.catalog.suppliers(true)).map((row) => [row.id, row] as const),
      );
      const ids = input.items.map((item) => item.id ?? newId());
      const moved = await this.catalog.movedItemIds(ids.filter((id) => byId.has(id)));
      const issues = await this.check(input.items, ids, byId, categories, suppliers, moved);
      if (issues.length > 0) {
        const rows = new Set(issues.map((issue) => issue.path.split('.')[1])).size;
        throw new ValidationFailedError(
          rows === 1 ? '1 row needs a change' : `${String(rows)} rows need a change`,
          issues,
        );
      }
      const saved: StoredItem[] = [];
      for (const [index, item] of input.items.entries()) {
        const id = ids[index] as string;
        const before = byId.get(id);
        const { id: _id, ...values } = item;
        if (!before) {
          const row = await this.catalog.insertItem({
            id,
            ...values,
            createdBy: this.context.requireUserId(),
          });
          await this.audit.record({
            action: 'inventory_item.create',
            resourceType: 'inventory_item',
            resourceId: row.id,
            after: {
              name: row.name,
              unit: row.unit,
              packName: row.packName,
              packSize: row.packSize,
            },
          });
          saved.push(row);
          continue;
        }
        const changed = this.changes(before, item);
        if (Object.keys(changed).length === 0) {
          saved.push(before);
          continue;
        }
        const row = await this.catalog.updateItem(id, changed);
        const record = before as unknown as Record<string, unknown>;
        await this.audit.record({
          action: 'inventory_item.update',
          resourceType: 'inventory_item',
          resourceId: id,
          before: {
            name: before.name,
            ...Object.fromEntries(Object.keys(changed).map((field) => [field, record[field]])),
          },
          after: { name: row.name, ...changed },
        });
        saved.push(row);
      }
      const movedAfter = await this.catalog.movedItemIds(saved.map((row) => row.id));
      return saved.map((row) => toItem(row, movedAfter.has(row.id)));
    });
  }

  /** An item's own reorder level in one branch; null goes back to the item's (Part A). */
  setBranchLevel(itemId: string, branchId: string, input: ItemBranchLevel): Promise<void> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      const item = await this.requireItem(itemId);
      await this.calendar.assertBranch(branchId);
      const state = await this.catalog.lockItemBranch(itemId, branchId);
      if (state.reorderLevel === input.reorderLevel) return;
      await this.catalog.updateItemBranch(state.id, { reorderLevel: input.reorderLevel });
      await this.audit.record({
        action: 'inventory_item.branch_level',
        resourceType: 'inventory_item',
        resourceId: itemId,
        before: { name: item.name, branchId, reorderLevel: state.reorderLevel },
        after: { name: item.name, branchId, reorderLevel: input.reorderLevel },
      });
    });
  }

  /** _Mark ordered_ (B6): replaces Low or Out until the item is received or unmarked. */
  markOrdered(itemId: string, branchId: string, input: MarkOrdered): Promise<void> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      await this.calendar.assertNotFuture(input.orderedOn);
      await this.calendar.assertBranch(branchId);
      await this.order(await this.requireItem(itemId), branchId, input);
    });
  }

  /** _Mark ordered_ for a supplier's items of the reorder list (B7). */
  markOrderedMany(input: MarkOrderedMany): Promise<void> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      await this.calendar.assertNotFuture(input.orderedOn);
      await this.calendar.assertBranch(input.branchId);
      const items = await this.catalog.itemsByIds(input.itemIds);
      if (items.length !== new Set(input.itemIds).size) {
        throw new InventoryNotFoundError('No such item');
      }
      for (const item of items) await this.order(item, input.branchId, input);
    });
  }

  unmarkOrdered(itemId: string, branchId: string): Promise<void> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      const item = await this.requireItem(itemId);
      const state = await this.catalog.lockItemBranch(itemId, branchId);
      if (state.orderedOn === null) return;
      await this.catalog.updateItemBranch(state.id, {
        orderedOn: null,
        orderedNote: null,
        orderedBy: null,
      });
      await this.audit.record({
        action: 'inventory_item.unordered',
        resourceType: 'inventory_item',
        resourceId: itemId,
        before: { name: item.name, branchId, orderedOn: state.orderedOn },
        after: { name: item.name, branchId, orderedOn: null },
      });
    });
  }

  /** _Report wrong count_ (B3): the item is _To count_ in that branch until a count counts it. */
  reportCount(itemId: string, branchId: string): Promise<void> {
    this.context.requirePermission('inventory:write');
    return this.tenantDb.run(async () => {
      const item = await this.requireItem(itemId);
      await this.calendar.assertBranch(branchId);
      const state = await this.catalog.lockItemBranch(itemId, branchId);
      if (state.toCountAt !== null) return;
      await this.catalog.updateItemBranch(state.id, {
        toCountAt: this.calendar.now(),
        toCountBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: 'inventory_item.report_count',
        resourceType: 'inventory_item',
        resourceId: itemId,
        after: { name: item.name, branchId },
      });
    });
  }

  // --- Settings ---

  settings(): Promise<InventorySettings> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => ({ expiringDays: await this.calendar.expiringDays() }));
  }

  updateSettings(input: InventorySettings): Promise<InventorySettings> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      const before = await this.calendar.expiringDays();
      if (before !== input.expiringDays) {
        await this.catalog.setExpiringDays(input.expiringDays);
        await this.audit.record({
          action: 'inventory_settings.update',
          resourceType: 'inventory_settings',
          resourceId: this.context.requireTenantId(),
          before: { expiringDays: before },
          after: { expiringDays: input.expiringDays },
        });
      }
      return { expiringDays: input.expiringDays };
    });
  }

  // --- The import (B8) ---

  /** The item an imported row is: by code, else by name (case ignored). */
  async findForImport(code: string | null, name: string): Promise<InventoryItem | null> {
    this.context.requirePermission('inventory:read');
    return this.tenantDb.run(async () => {
      const row =
        (code === null ? undefined : await this.catalog.itemByCode(code)) ??
        (await this.catalog.itemByName(name));
      if (!row) return null;
      return toItem(row, (await this.catalog.movedItemIds([row.id])).has(row.id));
    });
  }

  /**
   * The category an imported row names: a predefined one by any of its translations, else the
   * clinic's own by name, created when new.
   */
  async categoryForImport(name: string): Promise<string> {
    this.context.requirePermission('inventory:manage');
    return this.tenantDb.run(async () => {
      await this.catalog.insertMissingKeys();
      const rows = await this.catalog.categories();
      const key = categoryKeyByName(name);
      const found =
        key !== null
          ? rows.find((row) => row.key === key)
          : rows.find((row) => row.name !== null && folded(row.name) === folded(name));
      if (found) return found.id;
      return (await this.createCategory({ name })).id;
    });
  }

  // --- Helpers ---

  async requireItem(id: string): Promise<StoredItem> {
    const [row] = await this.catalog.itemsByIds([id]);
    if (!row) throw new InventoryNotFoundError('No such item', { id });
    return row;
  }

  private async order(item: StoredItem, branchId: string, input: MarkOrdered): Promise<void> {
    const state = await this.catalog.lockItemBranch(item.id, branchId);
    await this.catalog.updateItemBranch(state.id, {
      orderedOn: input.orderedOn,
      orderedNote: input.note,
      orderedBy: this.context.requireUserId(),
    });
    await this.audit.record({
      action: 'inventory_item.ordered',
      resourceType: 'inventory_item',
      resourceId: item.id,
      before: { name: item.name, branchId, orderedOn: state.orderedOn },
      after: { name: item.name, branchId, orderedOn: input.orderedOn, note: input.note },
    });
  }

  private changes(before: StoredItem, item: ItemInput): Record<string, unknown> {
    const changed: Record<string, unknown> = {};
    const record = before as unknown as Record<string, unknown>;
    for (const field of ITEM_FIELDS) {
      if (item[field] !== record[field]) changed[field] = item[field];
    }
    return changed;
  }

  /** What each row breaks, against the stored items and the other rows (Part A). */
  private async check(
    rows: readonly ItemInput[],
    ids: readonly string[],
    stored: ReadonlyMap<string, StoredItem>,
    categories: ReadonlyMap<string, StoredCategory>,
    suppliers: ReadonlyMap<string, { active: boolean }>,
    moved: ReadonlySet<string>,
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const after = new Map(stored);
    rows.forEach((row, index) => {
      const id = ids[index] as string;
      after.set(id, { ...(stored.get(id) ?? ({} as StoredItem)), ...row, id });
    });
    const issue = (index: number, field: string, code: string, message: string) =>
      issues.push({ path: `items.${String(index)}.${field}`, code, message });
    for (const [index, row] of rows.entries()) {
      const id = ids[index] as string;
      const before = stored.get(id);
      if (row.id !== undefined && !before) {
        issue(index, 'id', 'not_found', 'No such item');
        continue;
      }
      for (const other of after.values()) {
        if (other.id === id) continue;
        if (folded(other.name) === folded(row.name)) {
          issue(index, 'name', 'duplicate', `"${other.name}" already has this name`);
        }
        if (row.code !== null && other.code && folded(other.code) === folded(row.code)) {
          issue(index, 'code', 'duplicate', `Code ${row.code} is already used by "${other.name}"`);
        }
      }
      const category = categories.get(row.categoryId);
      if (!category) issue(index, 'categoryId', 'not_found', 'No such category');
      else if (!category.active && before?.categoryId !== row.categoryId) {
        issue(index, 'categoryId', 'inactive', 'This category is deactivated');
      }
      if (row.usualSupplierId !== null) {
        const supplier = suppliers.get(row.usualSupplierId);
        if (!supplier) issue(index, 'usualSupplierId', 'not_found', 'No such supplier');
      }
      if (before && moved.has(id)) {
        if (before.unit !== row.unit || before.packSize !== row.packSize) {
          issue(
            index,
            before.unit !== row.unit ? 'unit' : 'packSize',
            'locked',
            'This item has moved: its unit and pack size stay',
          );
        }
      }
      if (before?.active && !row.active && (await this.catalog.heldAnywhere(id)) > 0) {
        issue(index, 'active', 'in_stock', 'Some branch still holds this item');
      }
    }
    return issues;
  }

  private async requireCategory(id: string): Promise<StoredCategory> {
    const row = await this.catalog.category(id);
    if (!row) throw new InventoryNotFoundError('No such category', { id });
    return row;
  }

  /** A category the item list may use: known and active. */
  async requireActiveCategory(id: string): Promise<StoredCategory> {
    const row = await this.requireCategory(id);
    if (!row.active) throw new InventoryInactiveError('This category is deactivated');
    return row;
  }

  private async assertCategoryNameFree(name: string, exceptId?: string): Promise<void> {
    const taken = [
      ...(await this.catalog.categories())
        .filter((row) => row.id !== exceptId && row.name !== null)
        .map((row) => row.name as string),
      ...KEYED_CATEGORY_NAMES,
    ];
    if (taken.some((other) => folded(other) === folded(name))) {
      throw new InventoryNameTakenError('Another category has this name', { name });
    }
  }

  private recordCategory(
    verb: 'create' | 'rename' | 'deactivate' | 'reactivate' | 'delete',
    row: StoredCategory,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined,
  ): Promise<void> {
    return this.audit.record({
      action: `inventory_category.${verb}`,
      resourceType: 'inventory_category',
      resourceId: row.id,
      before,
      after: { key: row.key, name: row.name, ...after },
    });
  }
}
