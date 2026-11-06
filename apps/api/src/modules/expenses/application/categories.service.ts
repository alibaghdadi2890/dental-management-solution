import {
  categoryKindOf,
  type CreateExpenseCategory,
  type ExpenseCategory,
  type ExpenseCategoryKind,
  type ReservedCategoryKey,
  type UpdateExpenseCategory,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { AuditService } from '../../audit';
import { assertCategoryChange, assertNameFree, assertSelectable } from '../domain/categories';
import { CategoryNameTakenError, CategoryNotFoundError } from '../domain/expense-errors';
import { CategoriesRepository, type StoredCategory } from '../persistence/categories.repository';
import { KEYED_CATEGORY_NAMES } from './export-labels';
import { categoryLabel, toCategory } from './presenter';

export type KnownCategory = StoredCategory & { kind: ExpenseCategoryKind };

/**
 * The clinic's expense categories (feature 17, D7): the starting list (seeded at provisioning,
 * and added again wherever it is missing), *Other*, the reserved *Salaries* and *Dentist
 * compensation*, and the clinic's own. Reads need `expense:read`, changes `expense:manage`.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly categories: CategoriesRepository,
  ) {}

  list(): Promise<ExpenseCategory[]> {
    this.context.requirePermission('expense:read');
    return this.tenantDb.run(async () => {
      await this.categories.insertMissingKeys();
      const rows = await this.categories.list();
      const used = await this.categories.usedIds();
      // A reserved category never says whether salaries or payouts exist (ADR-0080): it is never
      // deleted anyway.
      return rows.map((row) =>
        toCategory(row, categoryKindOf(row.key) !== 'reserved' && used.has(row.id)),
      );
    });
  }

  create(input: CreateExpenseCategory): Promise<ExpenseCategory> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      await this.categories.insertMissingKeys();
      assertNameFree(input.name, await this.takenNames());
      const created = await this.insert(input.name);
      await this.record('create', created, undefined, { name: created.name });
      return toCategory(created, false);
    });
  }

  update(id: string, patch: UpdateExpenseCategory): Promise<ExpenseCategory> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      const row = await this.require(id);
      const kind = categoryKindOf(row.key);
      const inUse = (await this.categories.usedIds()).has(id);
      let current = row;
      if (patch.name !== undefined && patch.name !== row.name) {
        assertCategoryChange(kind, 'rename', inUse);
        assertNameFree(patch.name, await this.takenNames(id));
        await this.categories.update(id, { name: patch.name }).catch((error: unknown) => {
          throw isUniqueViolation(error) ? this.nameTaken() : error;
        });
        current = { ...current, name: patch.name };
        await this.record('rename', current, { name: row.name }, { name: patch.name });
      }
      if (patch.active !== undefined && patch.active !== row.active) {
        assertCategoryChange(kind, patch.active ? 'reactivate' : 'deactivate', inUse);
        await this.categories.update(id, { active: patch.active });
        current = { ...current, active: patch.active };
        await this.record(
          patch.active ? 'reactivate' : 'deactivate',
          current,
          { active: row.active },
          { active: patch.active },
        );
      }
      return toCategory(current, inUse);
    });
  }

  delete(id: string): Promise<void> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      const row = await this.require(id);
      assertCategoryChange(
        categoryKindOf(row.key),
        'delete',
        (await this.categories.usedIds()).has(id),
      );
      await this.categories.delete(id);
      await this.record('delete', row, { name: row.name }, undefined);
    });
  }

  /** The starting list for a new clinic (a system task, after provisioning). */
  async seedDefaults(): Promise<number> {
    return this.tenantDb.run(() => this.categories.insertMissingKeys());
  }

  /** A category a new expense, fixed expense or confirmation may use (not reserved, active). */
  async requireSelectable(id: string): Promise<KnownCategory> {
    const category = await this.requireKnown(id);
    assertSelectable(category);
    return category;
  }

  async requireKnown(id: string): Promise<KnownCategory> {
    const row = await this.require(id);
    return { ...row, kind: categoryKindOf(row.key) };
  }

  /** A reserved category's row, created first if the clinic has lost it. */
  async reserved(key: ReservedCategoryKey): Promise<StoredCategory> {
    const found = await this.categories.byKey(key);
    if (found) return found;
    await this.categories.insertMissingKeys();
    const created = await this.categories.byKey(key);
    if (!created) throw new Error(`Reserved category ${key} is missing`);
    return created;
  }

  private async require(id: string): Promise<StoredCategory> {
    const row = await this.categories.find(id);
    if (!row) throw new CategoryNotFoundError('No such category', { id });
    return row;
  }

  /** Every name a custom category may not take: the others' and every translation. */
  private async takenNames(exceptId?: string): Promise<string[]> {
    const custom = (await this.categories.list())
      .filter((row) => row.id !== exceptId && row.name !== null)
      .map((row) => row.name ?? '');
    return [...custom, ...KEYED_CATEGORY_NAMES];
  }

  private insert(name: string): Promise<StoredCategory> {
    return this.categories
      .insertCustom(name, this.context.requireUserId())
      .catch((error: unknown) => {
        throw isUniqueViolation(error) ? this.nameTaken() : error;
      });
  }

  private nameTaken(): CategoryNameTakenError {
    return new CategoryNameTakenError('Another category has this name');
  }

  private record(
    verb: 'create' | 'rename' | 'deactivate' | 'reactivate' | 'delete',
    row: StoredCategory,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined,
  ): Promise<void> {
    return this.audit.record({
      action: `expense_category.${verb}`,
      resourceType: 'expense_category',
      resourceId: row.id,
      before,
      after: { ...categoryLabel(row), ...after },
    });
  }
}
