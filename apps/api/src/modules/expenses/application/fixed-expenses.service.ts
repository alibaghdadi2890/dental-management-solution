import {
  type ConfirmItems,
  type CreateFixedExpense,
  type Expense,
  type FixedExpense,
  type FixedExpenseDetail,
  type FixedItem,
  fromCents,
  type SkipItem,
  toCents,
  type UpdateFixedExpense,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { requestHash } from '../../../platform/kernel/request-hash';
import { AuditService } from '../../audit';
import { catchUp, resumedNextMonth } from '../domain/catch-up';
import { assertDescribed } from '../domain/categories';
import {
  ExpenseIdempotencyMismatchError,
  ExpenseNotFoundError,
  FixedExpenseStatusError,
  ItemNotPendingError,
} from '../domain/expense-errors';
import { ExpensesRepository } from '../persistence/expenses.repository';
import {
  type FixedExpensePatch,
  FixedExpensesRepository,
  type StoredFixedExpense,
  type StoredItem,
} from '../persistence/fixed-expenses.repository';
import { CategoriesService } from './categories.service';
import { ClinicCalendar } from './clinic-calendar';
import { categoryLabel, toExpense, toFixedExpense, toItem } from './presenter';

type Change = 'pause' | 'resume' | 'end';

/**
 * Fixed monthly expenses and the items waiting for confirmation (A3, ADR-0078). There is no job:
 * every read or write here first runs the catch-up, which gives each active template its items up
 * to the current month. An item becomes an expense only when a person confirms it, one by one, the
 * amount editable; a skip closes it, an undo reopens it, and voiding its expense reopens it too.
 */
@Injectable()
export class FixedExpensesService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly calendar: ClinicCalendar,
    private readonly categories: CategoriesService,
    private readonly templates: FixedExpensesRepository,
    private readonly expenses: ExpensesRepository,
  ) {}

  list(): Promise<FixedExpense[]> {
    this.context.requirePermission('expense:read');
    return this.tenantDb.run(async () => {
      await this.catchUp();
      const counts = await this.templates.pendingCounts();
      return (await this.templates.list()).map((row) =>
        toFixedExpense(row, counts.get(row.id) ?? 0),
      );
    });
  }

  get(id: string): Promise<FixedExpenseDetail> {
    this.context.requirePermission('expense:read');
    return this.tenantDb.run(async () => {
      await this.catchUp();
      return this.detail(await this.require(id));
    });
  }

  create(input: CreateFixedExpense): Promise<FixedExpenseDetail> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      const category = await this.categories.requireSelectable(input.categoryId);
      await this.calendar.assertBranch(input.branchId);
      const created = await this.templates.insert({
        ...input,
        currency: await this.calendar.currency(),
        createdBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: 'fixed_expense.create',
        resourceType: 'fixed_expense',
        resourceId: created.id,
        after: {
          name: created.name,
          ...categoryLabel(category),
          amount: created.amount,
          currency: created.currency,
          firstMonth: created.firstMonth,
        },
      });
      await this.catchUp();
      return this.detail(await this.require(created.id));
    });
  }

  /** A change applies to the months generated after it, never to an item already there. */
  update(id: string, patch: UpdateFixedExpense): Promise<FixedExpenseDetail> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      await this.catchUp();
      const row = await this.require(id);
      if (row.status === 'ended') throw new FixedExpenseStatusError('This fixed expense has ended');
      const changed = changedFields(row, patch);
      if (Object.keys(changed).length === 0) return this.detail(row);
      if (changed.categoryId !== undefined)
        await this.categories.requireSelectable(changed.categoryId);
      if (changed.branchId !== undefined) await this.calendar.assertBranch(changed.branchId);
      const updated = await this.templates.update(id, changed);
      await this.audit.record({
        action: 'fixed_expense.update',
        resourceType: 'fixed_expense',
        resourceId: id,
        before: pick(row, Object.keys(changed)),
        after: { name: updated.name, currency: updated.currency, ...changed },
      });
      return this.detail(updated);
    });
  }

  pause(id: string): Promise<FixedExpenseDetail> {
    return this.change(id, 'pause');
  }

  resume(id: string): Promise<FixedExpenseDetail> {
    return this.change(id, 'resume');
  }

  end(id: string): Promise<FixedExpenseDetail> {
    return this.change(id, 'end');
  }

  /** Every item waiting for confirmation, oldest month first. */
  pending(): Promise<FixedItem[]> {
    this.context.requirePermission('expense:read');
    return this.tenantDb.run(async () => {
      await this.catchUp();
      return (await this.templates.pending()).map(toItem);
    });
  }

  /**
   * Confirms 1–50 pending items as expenses, each as the user set it (amount, date, method …), in
   * one transaction. A retry with the same `Idempotency-Key` returns the same expenses.
   */
  confirm(input: ConfirmItems, idempotencyKey: string): Promise<Expense[]> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      const hash = requestHash({ confirm: input });
      await this.expenses.lockIdempotencyKey(idempotencyKey);
      const replayed = await this.expenses.byIdempotencyKey(idempotencyKey);
      if (replayed.length > 0) {
        if (replayed.some((row) => row.source !== 'fixed' || row.idempotencyHash !== hash)) {
          throw new ExpenseIdempotencyMismatchError(
            'This Idempotency-Key was used for a different request',
          );
        }
        const byItem = new Map(replayed.map((row) => [row.sourceId, row]));
        return input.items.flatMap((item) => {
          const row = byItem.get(item.itemId);
          return row ? [toExpense(row)] : [];
        });
      }
      await this.catchUp();
      const locked = new Map(
        (await this.templates.lockItems(input.items.map((item) => item.itemId))).map((item) => [
          item.id,
          item,
        ]),
      );
      const currency = await this.calendar.currency();
      const by = this.context.requireUserId();
      const confirmed: Expense[] = [];
      for (const request of input.items) {
        const item = locked.get(request.itemId);
        if (!item) throw new ExpenseNotFoundError('No such item', { itemId: request.itemId });
        if (item.status !== 'pending') {
          throw new ItemNotPendingError('This month is no longer waiting', { itemId: item.id });
        }
        await this.calendar.assertNotFuture(request.spentOn);
        const category = await this.categories.requireSelectable(request.categoryId);
        assertDescribed(category.kind, request.description);
        await this.calendar.assertBranch(request.branchId);
        const created = await this.expenses.insert({
          spentOn: request.spentOn,
          categoryId: request.categoryId,
          amount: request.amount,
          currency,
          method: request.method,
          payee: request.payee,
          reference: request.reference,
          description: request.description,
          branchId: request.branchId,
          source: 'fixed',
          sourceId: item.id,
          sourceMonth: item.month,
          createdBy: by,
          idempotency: { key: idempotencyKey, hash },
        });
        await this.templates.confirm(item.id, created.id);
        const facts = {
          name: item.name,
          month: item.month,
          ...categoryLabel(category),
          amount: created.amount,
          currency,
        };
        await this.audit.record({
          action: 'fixed_expense_item.confirm',
          resourceType: 'fixed_expense_item',
          resourceId: item.id,
          before: { status: 'pending', amount: item.amount },
          after: { ...facts, status: 'confirmed', expenseId: created.id },
        });
        // The expense itself, kept in the log but said once on the Activity screen.
        await this.audit.record({
          action: 'expense.record',
          resourceType: 'expense',
          resourceId: created.id,
          after: { ...facts, spentOn: created.spentOn, method: created.method },
          hidden: true,
        });
        confirmed.push(toExpense(created));
      }
      return confirmed;
    });
  }

  skip(id: string, input: SkipItem): Promise<FixedItem> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      await this.catchUp();
      const item = await this.lockItem(id);
      if (item.status !== 'pending') {
        throw new ItemNotPendingError('This month is no longer waiting', { itemId: id });
      }
      const mark = {
        at: this.calendar.now(),
        by: this.context.requireUserId(),
        reason: input.reason,
      };
      await this.templates.skip(id, mark);
      await this.recordItem('skip', item, input.reason ?? undefined);
      return toItem({
        ...item,
        status: 'skipped',
        skipReason: mark.reason,
        skippedAt: mark.at,
        skippedBy: mark.by,
      });
    });
  }

  unskip(id: string): Promise<FixedItem> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      const item = await this.lockItem(id);
      if (item.status !== 'skipped') {
        throw new ItemNotPendingError('This month was not skipped', { itemId: id });
      }
      await this.templates.reopen(id);
      await this.recordItem('unskip', item);
      return toItem({
        ...item,
        status: 'pending',
        skipReason: null,
        skippedAt: null,
        skippedBy: null,
      });
    });
  }

  /**
   * The catch-up (ADR-0078): gives every active template its items up to the current month in the
   * clinic's time zone. One per clinic at a time; idempotent (one item per template and month).
   */
  async catchUp(): Promise<void> {
    await this.tenantDb.run(async () => {
      const currentMonth = await this.calendar.currentMonth();
      await this.templates.lockCatchUp();
      for (const template of await this.templates.due(currentMonth)) {
        const { months, nextMonth } = catchUp(template, currentMonth);
        await this.templates.insertItems(template, months);
        await this.templates.update(template.id, { nextMonth });
      }
    });
  }

  private change(id: string, change: Change): Promise<FixedExpenseDetail> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      await this.catchUp();
      const row = await this.require(id);
      const allowed =
        change === 'pause'
          ? row.status === 'active'
          : change === 'resume'
            ? row.status === 'paused'
            : row.status !== 'ended';
      if (!allowed) {
        throw new FixedExpenseStatusError(`A ${row.status} fixed expense can't ${change}`);
      }
      const updated = await this.templates.update(
        id,
        change === 'resume'
          ? {
              status: 'active',
              nextMonth: resumedNextMonth(row.nextMonth, await this.calendar.currentMonth()),
            }
          : { status: change === 'pause' ? 'paused' : 'ended' },
      );
      await this.audit.record({
        action: `fixed_expense.${change}`,
        resourceType: 'fixed_expense',
        resourceId: id,
        before: { status: row.status },
        after: { name: row.name, status: updated.status },
      });
      if (change === 'resume') await this.catchUp();
      return this.detail(await this.require(id));
    });
  }

  private async require(id: string): Promise<StoredFixedExpense> {
    const row = await this.templates.findForUpdate(id);
    if (!row) throw new ExpenseNotFoundError('No such fixed expense', { id });
    return row;
  }

  private async lockItem(id: string): Promise<StoredItem> {
    const [item] = await this.templates.lockItems([id]);
    if (!item) throw new ExpenseNotFoundError('No such item', { itemId: id });
    return item;
  }

  private async detail(row: StoredFixedExpense): Promise<FixedExpenseDetail> {
    const items = await this.templates.itemsOf(row.id);
    return {
      ...toFixedExpense(row, items.filter((item) => item.status === 'pending').length),
      items: items.map(toItem),
    };
  }

  private recordItem(verb: 'skip' | 'unskip', item: StoredItem, reason?: string): Promise<void> {
    return this.audit.record({
      action: `fixed_expense_item.${verb}`,
      resourceType: 'fixed_expense_item',
      resourceId: item.id,
      before: { status: item.status },
      after: {
        name: item.name,
        month: item.month,
        amount: item.amount,
        currency: item.currency,
        status: verb === 'skip' ? 'skipped' : 'pending',
      },
      reason,
    });
  }
}

const FIELDS = ['name', 'categoryId', 'amount', 'method', 'payee', 'branchId', 'note'] as const;

/** The fields of `patch` that differ from the stored template (amounts compared in cents). */
function changedFields(row: StoredFixedExpense, patch: UpdateFixedExpense): FixedExpensePatch {
  const changed: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    const same =
      field === 'amount' ? toCents(String(value)) === toCents(row.amount) : value === row[field];
    if (!same) changed[field] = field === 'amount' ? fromCents(toCents(String(value))) : value;
  }
  return changed;
}

function pick(row: StoredFixedExpense, fields: readonly string[]): Record<string, unknown> {
  const record = row as unknown as Record<string, unknown>;
  return Object.fromEntries(fields.map((field) => [field, record[field]]));
}
