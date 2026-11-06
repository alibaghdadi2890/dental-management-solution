import {
  DASHBOARD_RECENT,
  type Expense,
  type ExpenseDashboard,
  type ExpenseExportQuery,
  type ExpenseListQuery,
  type ExpensePage,
  type ExpenseReason,
  type ExpenseSource,
  type ExpenseYear,
  type ExportLanguage,
  type PaymentMethod,
  type RecordExpense,
  fromCents,
  toCents,
  type UpdateExpense,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { csvRow, UTF8_BOM } from '../../../platform/kernel/csv';
import { lastDay, monthsBetween } from '../../../platform/kernel/months';
import { requestHash } from '../../../platform/kernel/request-hash';
import { AuditService } from '../../audit';
import { TenancyService } from '../../tenancy';
import { assertDescribed } from '../domain/categories';
import {
  ExpenseIdempotencyMismatchError,
  ExpenseNotFoundError,
  ExpenseVoidedError,
  SystemRowError,
} from '../domain/expense-errors';
import { CategoriesRepository } from '../persistence/categories.repository';
import {
  type ExpenseCursor,
  type ExpenseFilter,
  type ExpensePatch,
  ExpensesRepository,
  type StoredExpense,
} from '../persistence/expenses.repository';
import { FixedExpensesRepository } from '../persistence/fixed-expenses.repository';
import { CategoriesService } from './categories.service';
import { ClinicCalendar } from './clinic-calendar';
import { EXPENSE_EXPORT_LABELS } from './export-labels';
import { FixedExpensesService } from './fixed-expenses.service';
import { categoryLabel, toExpense } from './presenter';

/** A CSV export, built in memory: an expense list is bounded by one clinic's range. */
export interface CsvFile {
  fileName: string;
  body: string;
}

/** A salary payment or dentist payout, as `expenses` mirrors it (ADR-0076). */
export interface Mirror {
  source: 'payroll' | 'compensation';
  sourceId: string;
  spentOn: string;
  amount: string;
  currency: string;
  method: PaymentMethod;
  payee: string | null;
  reference: string | null;
  description: string | null;
  branchId: string | null;
  sourceMonth: string | null;
}

const EDITABLE = [
  'spentOn',
  'categoryId',
  'amount',
  'method',
  'payee',
  'reference',
  'description',
  'branchId',
] as const;

const encodeCursor = (cursor: ExpenseCursor) =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url');

function decodeCursor(value: string | undefined): ExpenseCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as Partial<ExpenseCursor>;
    return typeof parsed.spentOn === 'string' && typeof parsed.id === 'string'
      ? { spentOn: parsed.spentOn, id: parsed.id }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What the clinic spends (feature 17, docs/modules/expenses.md). Reads need `expense:read`,
 * writes `expense:manage`. Which rows a caller sees depends on the source (ADR-0080): typed and
 * fixed rows for everyone who may read expenses, salary rows only with `payroll:read`, dentist
 * payouts only with `compensation:manage`. The rows a caller can't see are left out of lists,
 * totals and exports without a trace. Every change is audited in its transaction.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly calendar: ClinicCalendar,
    private readonly categories: CategoriesService,
    private readonly categoryRows: CategoriesRepository,
    private readonly expenses: ExpensesRepository,
    private readonly templates: FixedExpensesRepository,
    private readonly fixed: FixedExpensesService,
  ) {}

  /** `POST /expenses`: a payment already made. A retry with the same key returns it. */
  record(input: RecordExpense, idempotencyKey: string): Promise<Expense> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      const hash = requestHash({ record: input });
      await this.expenses.lockIdempotencyKey(idempotencyKey);
      const [first] = await this.expenses.byIdempotencyKey(idempotencyKey);
      if (first) {
        if (first.source !== 'manual' || first.idempotencyHash !== hash) throw this.mismatch();
        return toExpense(first);
      }
      await this.calendar.assertNotFuture(input.spentOn);
      const category = await this.categories.requireSelectable(input.categoryId);
      assertDescribed(category.kind, input.description);
      await this.calendar.assertBranch(input.branchId);
      const created = await this.expenses.insert({
        ...input,
        currency: await this.calendar.currency(),
        source: 'manual',
        sourceId: null,
        sourceMonth: null,
        createdBy: this.context.requireUserId(),
        idempotency: { key: idempotencyKey, hash },
      });
      await this.audit.record({
        action: 'expense.record',
        resourceType: 'expense',
        resourceId: created.id,
        after: {
          ...categoryLabel(category),
          amount: created.amount,
          currency: created.currency,
          spentOn: created.spentOn,
          method: created.method,
          payee: created.payee,
          description: created.description,
        },
      });
      return toExpense(created);
    });
  }

  /** An edit of a typed or confirmed row, audited field by field (P7). */
  update(id: string, patch: UpdateExpense): Promise<Expense> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      const row = await this.editable(id);
      const changed = changedFields(row, patch);
      const fields = Object.keys(changed);
      if (fields.length === 0) return toExpense(row);
      if (changed.spentOn !== undefined) await this.calendar.assertNotFuture(changed.spentOn);
      const category =
        changed.categoryId !== undefined
          ? await this.categories.requireSelectable(changed.categoryId)
          : await this.categories.requireKnown(row.categoryId);
      assertDescribed(
        category.kind,
        changed.description !== undefined ? changed.description : row.description,
      );
      if (changed.branchId !== undefined) await this.calendar.assertBranch(changed.branchId);
      const updated = await this.expenses.update(id, changed, this.context.requireUserId());
      const record = row as unknown as Record<string, unknown>;
      await this.audit.record({
        action: 'expense.update',
        resourceType: 'expense',
        resourceId: id,
        before: Object.fromEntries(fields.map((field) => [field, record[field]])),
        after: { ...changed, ...categoryLabel(category), currency: updated.currency },
      });
      return toExpense(updated);
    });
  }

  /** A void keeps the row, struck through, out of every total. A fixed month waits again. */
  void(id: string, input: ExpenseReason): Promise<Expense> {
    this.context.requirePermission('expense:manage');
    return this.tenantDb.run(async () => {
      const row = await this.editable(id);
      const voided = await this.expenses.void(id, {
        at: this.calendar.now(),
        by: this.context.requireUserId(),
        reason: input.reason,
      });
      if (row.source === 'fixed' && row.sourceId !== null)
        await this.templates.reopen(row.sourceId);
      const category = await this.categories.requireKnown(row.categoryId);
      await this.audit.record({
        action: 'expense.void',
        resourceType: 'expense',
        resourceId: id,
        before: { voided: false },
        after: {
          voided: true,
          ...categoryLabel(category),
          amount: row.amount,
          currency: row.currency,
          spentOn: row.spentOn,
          month: row.sourceMonth,
        },
        reason: input.reason,
      });
      return toExpense(voided);
    });
  }

  list(query: ExpenseListQuery): Promise<ExpensePage> {
    this.context.requirePermission('expense:read');
    return this.tenantDb.run(async () => {
      const filter = this.filter(query);
      const rows = await this.expenses.list(filter, query.limit + 1, decodeCursor(query.cursor));
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toExpense),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor({ spentOn: last.spentOn, id: last.id })
            : null,
        total: await this.expenses.totals(filter),
        byCategory: await this.expenses.byCategory(filter),
      };
    });
  }

  /** Month by month for a calendar year, voided rows never counted. */
  year(year: number): Promise<ExpenseYear> {
    this.context.requirePermission('expense:read');
    return this.tenantDb.run(async () => {
      const filter = this.filter({ from: `${String(year)}-01-01`, to: `${String(year)}-12-31` });
      const totals = new Map(
        (await this.expenses.byMonth(filter)).map((row) => [row.month, row] as const),
      );
      const months = monthsBetween(`${String(year)}-01`, `${String(year)}-12`).map((month) => ({
        month,
        amount: totals.get(month)?.amount ?? '0.00',
        count: totals.get(month)?.count ?? 0,
      }));
      return { year, months, total: await this.expenses.totals(filter) };
    });
  }

  async export(query: ExpenseExportQuery): Promise<CsvFile> {
    this.context.requirePermission('expense:read');
    return this.tenantDb.run(async () => {
      const filter = this.filter(query);
      const rows = await this.expenses.list(filter, 100_000);
      const labels = EXPENSE_EXPORT_LABELS[await this.language(query.lang)];
      const categories = new Map(
        (await this.categoryRows.list()).map((row) => [
          row.id,
          row.key === null ? (row.name ?? '') : labels.categories[row.key],
        ]),
      );
      const branchIds = [...new Set(rows.flatMap((row) => (row.branchId ? [row.branchId] : [])))];
      const branches = new Map(
        (await this.tenancy.branchesByIds(branchIds)).map((branch) => [branch.id, branch.name]),
      );
      const columns = labels.columns;
      const header = csvRow([
        columns.date,
        columns.category,
        columns.payee,
        columns.description,
        columns.reference,
        columns.branch,
        columns.method,
        columns.amount,
        columns.currency,
        columns.source,
        columns.month,
        columns.status,
        columns.voidReason,
      ]);
      const body = rows.map((row) =>
        csvRow(
          [
            row.spentOn,
            categories.get(row.categoryId) ?? '',
            row.payee ?? '',
            row.description ?? '',
            row.reference ?? '',
            row.branchId ? (branches.get(row.branchId) ?? '') : '',
            labels.methods[row.method],
            row.amount,
            row.currency,
            labels.sources[row.source],
            row.sourceMonth ?? '',
            row.voidedAt ? labels.status.voided : labels.status.recorded,
            row.voidReason ?? '',
          ],
          { numericColumns: [7] },
        ),
      );
      return {
        fileName: `expenses-${query.from}-${query.to}.csv`,
        body: UTF8_BOM + header + body.join(''),
      };
    });
  }

  /**
   * Today's card (A5, P9): this month's typed and confirmed expenses (never a salary or a
   * payout, whoever asks), the latest few, and every fixed month waiting for confirmation.
   */
  dashboard(): Promise<ExpenseDashboard> {
    this.context.requirePermission('expense:read');
    return this.tenantDb.run(async () => {
      const month = await this.calendar.currentMonth();
      const filter: ExpenseFilter = {
        from: `${month}-01`,
        to: lastDay(month),
        sources: ['manual', 'fixed'],
      };
      return {
        month,
        total: await this.expenses.totals(filter),
        recent: (await this.expenses.list(filter, DASHBOARD_RECENT)).map(toExpense),
        pending: await this.fixed.pending(),
      };
    });
  }

  /**
   * Writes the read-only row of a salary payment or a dentist payout, in the transaction that made
   * it (ADR-0076). Called by the mirror subscriber; not permission-gated (the payment was).
   */
  async recordMirror(mirror: Mirror): Promise<void> {
    await this.tenantDb.run(async () => {
      const category = await this.categories.reserved(
        mirror.source === 'payroll' ? 'salaries' : 'dentist_compensation',
      );
      await this.expenses.insertMirror({
        ...mirror,
        categoryId: category.id,
        createdBy: this.context.requireUserId(),
      });
    });
  }

  async voidMirror(source: Mirror['source'], sourceId: string, reason: string): Promise<void> {
    await this.tenantDb.run(() =>
      this.expenses.voidMirror(source, sourceId, {
        at: this.calendar.now(),
        by: this.context.requireUserId(),
        reason,
      }),
    );
  }

  /** The currency lock (ADR-0035): any expense or fixed expense keeps the clinic's currency. */
  async hasMoney(): Promise<boolean> {
    return this.tenantDb.run(
      async () => (await this.expenses.any()) || (await this.templates.any()),
    );
  }

  /** The sources the caller may see (ADR-0080). */
  private sources(): ExpenseSource[] {
    return [
      'manual',
      'fixed',
      ...(this.context.hasPermission('payroll:read') ? (['payroll'] as const) : []),
      ...(this.context.hasPermission('compensation:manage') ? (['compensation'] as const) : []),
    ];
  }

  private filter(
    query: Omit<ExpenseFilter, 'sources'> & { from: string; to: string },
  ): ExpenseFilter {
    return {
      from: query.from,
      to: query.to,
      sources: this.sources(),
      categoryId: query.categoryId,
      branchId: query.branchId,
      method: query.method,
      q: query.q,
      includeVoided: query.includeVoided,
    };
  }

  /** A row the caller may change: visible to them (else 404), not a mirror, not voided. */
  private async editable(id: string): Promise<StoredExpense> {
    const row = await this.expenses.findForUpdate(id);
    if (!row || !this.sources().includes(row.source)) {
      throw new ExpenseNotFoundError('No such expense', { id });
    }
    if (row.source === 'payroll' || row.source === 'compensation') {
      throw new SystemRowError(
        row.source === 'payroll'
          ? 'Salary rows are changed from Payroll'
          : 'Dentist compensation rows are changed from Compensation',
      );
    }
    if (row.voidedAt !== null) throw new ExpenseVoidedError('This expense is voided');
    return row;
  }

  private async language(lang: ExportLanguage | undefined): Promise<ExportLanguage> {
    return lang ?? (await this.tenancy.currentTenant()).locale;
  }

  private mismatch(): ExpenseIdempotencyMismatchError {
    return new ExpenseIdempotencyMismatchError(
      'This Idempotency-Key was used for a different request',
    );
  }
}

/** The fields of `patch` that differ from the row (amounts compared in cents). */
function changedFields(row: StoredExpense, patch: UpdateExpense): ExpensePatch {
  const changed: Record<string, unknown> = {};
  for (const field of EDITABLE) {
    const value = patch[field];
    if (value === undefined) continue;
    const same =
      field === 'amount' ? toCents(String(value)) === toCents(row.amount) : value === row[field];
    if (!same) changed[field] = field === 'amount' ? fromCents(toCents(String(value))) : value;
  }
  return changed;
}
