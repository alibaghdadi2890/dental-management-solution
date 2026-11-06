import {
  adjustmentEffect,
  type ConfirmLines,
  type ExportLanguage,
  fromCents,
  type PayrollAdjustment,
  type PayrollLine,
  type PayrollMonths,
  type PayrollRun,
  type SetAdjustments,
  toCents,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { csvRow, UTF8_BOM } from '../../../platform/kernel/csv';
import { monthOf, monthsBetween } from '../../../platform/kernel/months';
import { requestHash } from '../../../platform/kernel/request-hash';
import { AuditService } from '../../audit';
import { TenancyService } from '../../tenancy';
import {
  EmployeeNotFoundError,
  LineNotPendingError,
  NotEmployedError,
  PayrollFutureDateError,
  PayrollIdempotencyMismatchError,
} from '../domain/payroll-errors';
import {
  assertAdjustable,
  assertConfirmable,
  employedMonths,
  isEmployedIn,
} from '../domain/payroll-rules';
import {
  PAYROLL_PAYMENT_CONFIRMED,
  PAYROLL_PAYMENT_VOIDED,
  type PayrollPaymentConfirmed,
  type PayrollPaymentVoided,
} from '../events/payroll-events';
import { EmployeesRepository, type StoredEmployee } from '../persistence/employees.repository';
import { LinesRepository, type StoredLine } from '../persistence/lines.repository';
import { PAYROLL_EXPORT_LABELS } from './export-labels';
import { PayrollReader, type PayrollSnapshot } from './payroll-reader';

/** A CSV export, built in memory: bounded by one clinic's employees and months. */
export interface CsvFile {
  fileName: string;
  body: string;
}

const sum = (amounts: readonly string[]) =>
  fromCents(amounts.reduce((total, amount) => total + toCents(amount), 0n));

/** What a line's adjustments add up to (a deduction subtracts). */
const adjustmentsTotal = (adjustments: readonly PayrollAdjustment[]) =>
  fromCents(adjustments.reduce((total, adjustment) => total + adjustmentEffect(adjustment), 0n));

/**
 * The monthly payroll run (feature 17, B3–B4, ADR-0078). Lines are derived: one per employee per
 * employed month, stored once touched. A pending line is not an expense; confirming it records a
 * salary payment and publishes `PayrollPaymentConfirmed`, which `expenses` turns into a
 * *Salaries* row in the same transaction. Reads need `payroll:read`, changes `payroll:manage`.
 */
@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly tenancy: TenancyService,
    private readonly reader: PayrollReader,
    private readonly employees: EmployeesRepository,
    private readonly lines: LinesRepository,
  ) {}

  run(month: string): Promise<PayrollRun> {
    this.context.requirePermission('payroll:read');
    return this.tenantDb.run(async () => {
      const everyone = await this.employees.list();
      const snapshot = await this.reader.snapshot(everyone.map((row) => row.id));
      const lines = everyone
        .filter((row) => isEmployedIn(row, month, snapshot.currentMonth))
        .map((row) => this.reader.line(row, month, snapshot));
      const earlier = new Map<string, number>();
      for (const row of everyone) {
        for (const earlierMonth of employedMonths(row, snapshot.currentMonth)) {
          if (earlierMonth >= month) break;
          if (this.reader.line(row, earlierMonth, snapshot).status === 'pending') {
            earlier.set(earlierMonth, (earlier.get(earlierMonth) ?? 0) + 1);
          }
        }
      }
      return {
        month,
        lines,
        totals: {
          employees: lines.length,
          paidNet: sum(lines.filter((line) => line.status === 'paid').map((line) => line.net)),
          pendingNet: sum(
            lines.filter((line) => line.status === 'pending').map((line) => line.net),
          ),
          skipped: lines.filter((line) => line.status === 'skipped').length,
        },
        earlierPending: [...earlier.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([pendingMonth, count]) => ({ month: pendingMonth, count })),
      };
    });
  }

  /** Replaces a pending line's adjustments; the net may never fall below zero. */
  setAdjustments(employeeId: string, month: string, input: SetAdjustments): Promise<PayrollLine> {
    this.context.requirePermission('payroll:manage');
    return this.tenantDb.run(async () => {
      const { employee, line, current } = await this.touch(employeeId, month);
      assertAdjustable(line.status, current.base, input.adjustments);
      await this.lines.replaceAdjustments(line.id, input.adjustments, this.context.requireUserId());
      const after = await this.lineOf(employee, month);
      await this.record('adjust', line, employee, {
        before: { adjustments: current.adjustments, net: current.net },
        after: {
          adjustments: input.adjustments,
          net: after.net,
          amount: after.net,
          currency: after.currency,
        },
      });
      return after;
    });
  }

  /**
   * Confirms 1–50 lines as salary payments, each at the net the user saw, in one transaction.
   * A retry with the same `Idempotency-Key` returns the same lines.
   */
  confirm(input: ConfirmLines, idempotencyKey: string): Promise<PayrollLine[]> {
    this.context.requirePermission('payroll:manage');
    return this.tenantDb.run(async () => {
      const hash = requestHash({ confirm: input });
      await this.lines.lockIdempotencyKey(idempotencyKey);
      const replayed = await this.lines.paymentsByIdempotencyKey(idempotencyKey);
      if (replayed.length > 0) {
        if (replayed.some((payment) => payment.idempotencyHash !== hash)) {
          throw new PayrollIdempotencyMismatchError(
            'This Idempotency-Key was used for a different request',
          );
        }
        return Promise.all(
          input.lines.map(async (request) =>
            this.lineOf(await this.require(request.employeeId), request.month),
          ),
        );
      }
      const today = await this.reader.today();
      const confirmed: PayrollLine[] = [];
      const ordered = [...input.lines].sort((a, b) => a.employeeId.localeCompare(b.employeeId));
      for (const request of ordered) {
        if (request.paidOn > today) {
          throw new PayrollFutureDateError('This date is in the future', { date: request.paidOn });
        }
        const { employee, line, current } = await this.touch(request.employeeId, request.month);
        const net = assertConfirmable({
          status: line.status,
          base: current.base,
          adjustments: current.adjustments,
          expectedNet: request.net,
        });
        const payment = await this.lines.insertPayment({
          lineId: line.id,
          employeeId: employee.id,
          month: request.month,
          base: current.base ?? '0.00',
          adjustments: current.adjustments,
          net: fromCents(net),
          currency: current.currency,
          paidOn: request.paidOn,
          method: request.method,
          note: request.note,
          createdBy: this.context.requireUserId(),
          idempotency: { key: idempotencyKey, hash },
        });
        await this.lines.setStatus(line.id, 'paid');
        await this.record('confirm', line, employee, {
          before: { status: 'pending' },
          after: {
            status: 'paid',
            base: payment.base,
            adjustments: payment.adjustments,
            net: payment.net,
            amount: payment.net,
            currency: payment.currency,
            paidOn: payment.paidOn,
            method: payment.method,
            paymentId: payment.id,
          },
        });
        const event: PayrollPaymentConfirmed = this.events.create(PAYROLL_PAYMENT_CONFIRMED, {
          paymentId: payment.id,
          employeeId: employee.id,
          employeeName: employee.fullName,
          month: request.month,
          net: payment.net,
          currency: payment.currency,
          paidOn: payment.paidOn,
          method: payment.method,
          branchId: employee.branchId,
        });
        await this.events.publish(event);
        confirmed.push(await this.lineOf(employee, request.month));
      }
      const byKey = new Map(confirmed.map((line) => [`${line.employeeId}:${line.month}`, line]));
      return input.lines.flatMap((request) => {
        const line = byKey.get(`${request.employeeId}:${request.month}`);
        return line ? [line] : [];
      });
    });
  }

  /** Closes a pending line without a payment (unpaid leave, paid elsewhere). */
  skip(employeeId: string, month: string, reason: string): Promise<PayrollLine> {
    this.context.requirePermission('payroll:manage');
    return this.tenantDb.run(async () => {
      const { employee, line, current } = await this.touch(employeeId, month);
      if (line.status !== 'pending') throw new LineNotPendingError('This line is not pending');
      await this.lines.setStatus(line.id, 'skipped', {
        reason,
        at: this.reader.now(),
        by: this.context.requireUserId(),
      });
      await this.record('skip', line, employee, {
        before: { status: 'pending' },
        after: { status: 'skipped', amount: current.net, currency: current.currency },
        reason,
      });
      return this.lineOf(employee, month);
    });
  }

  unskip(employeeId: string, month: string): Promise<PayrollLine> {
    this.context.requirePermission('payroll:manage');
    return this.tenantDb.run(async () => {
      const { employee, line } = await this.touch(employeeId, month);
      if (line.status !== 'skipped') throw new LineNotPendingError('This line was not skipped');
      await this.lines.setStatus(line.id, 'pending');
      await this.record('unskip', line, employee, {
        before: { status: 'skipped' },
        after: { status: 'pending' },
      });
      return this.lineOf(employee, month);
    });
  }

  /** Voids a paid line's payment (and so its expense); the line is pending again. */
  void(employeeId: string, month: string, reason: string): Promise<PayrollLine> {
    this.context.requirePermission('payroll:manage');
    return this.tenantDb.run(async () => {
      const { employee, line } = await this.touch(employeeId, month);
      const payment = line.status === 'paid' ? await this.lines.livePayment(line.id) : undefined;
      if (!payment) throw new LineNotPendingError('This line is not paid');
      await this.lines.voidPayment(payment.id, {
        at: this.reader.now(),
        by: this.context.requireUserId(),
        reason,
      });
      await this.lines.setStatus(line.id, 'pending');
      await this.record('void', line, employee, {
        before: { status: 'paid' },
        after: {
          status: 'pending',
          amount: payment.net,
          currency: payment.currency,
          paymentId: payment.id,
        },
        reason,
      });
      const event: PayrollPaymentVoided = this.events.create(PAYROLL_PAYMENT_VOIDED, {
        paymentId: payment.id,
        employeeId: employee.id,
        month,
        reason,
      });
      await this.events.publish(event);
      return this.lineOf(employee, month);
    });
  }

  /** The net paid per payroll month of a year, and what is still pending. */
  months(year: number): Promise<PayrollMonths> {
    this.context.requirePermission('payroll:read');
    return this.tenantDb.run(async () => {
      const everyone = await this.employees.list();
      const snapshot = await this.reader.snapshot(everyone.map((row) => row.id));
      const months = monthsBetween(`${String(year)}-01`, `${String(year)}-12`).map((month) => {
        const lines = everyone
          .filter((row) => isEmployedIn(row, month, snapshot.currentMonth))
          .map((row) => this.reader.line(row, month, snapshot));
        const paid = lines.filter((line) => line.status === 'paid');
        return {
          month,
          paidNet: sum(paid.map((line) => line.net)),
          paidCount: paid.length,
          pendingCount: lines.filter((line) => line.status === 'pending').length,
        };
      });
      return { year, months, paidNet: sum(months.map((row) => row.paidNet)) };
    });
  }

  async exportMonths(year: number, lang: ExportLanguage | undefined): Promise<CsvFile> {
    const result = await this.months(year);
    const labels = PAYROLL_EXPORT_LABELS[await this.language(lang)];
    const header = csvRow([
      labels.year.month,
      labels.year.paidNet,
      labels.year.paid,
      labels.year.pending,
    ]);
    const body = result.months.map((row) =>
      csvRow([row.month, row.paidNet, String(row.paidCount), String(row.pendingCount)], {
        numericColumns: [1, 2, 3],
      }),
    );
    return { fileName: `payroll-${String(year)}.csv`, body: UTF8_BOM + header + body.join('') };
  }

  /** One employee's payroll history, every employed month and every voided payment. */
  async exportEmployee(employeeId: string, lang: ExportLanguage | undefined): Promise<CsvFile> {
    this.context.requirePermission('payroll:read');
    return this.tenantDb.run(async () => {
      const employee = await this.require(employeeId);
      const snapshot = await this.reader.snapshot([employeeId]);
      const labels = PAYROLL_EXPORT_LABELS[await this.language(lang)];
      const header = csvRow([
        labels.history.month,
        labels.history.base,
        labels.history.adjustments,
        labels.history.net,
        labels.history.currency,
        labels.history.paidOn,
        labels.history.method,
        labels.history.status,
        labels.history.note,
      ]);
      const numeric = { numericColumns: [1, 2, 3] };
      const rows: string[] = [];
      for (const month of employedMonths(employee, snapshot.currentMonth)) {
        const line = this.reader.line(employee, month, snapshot);
        for (const voided of line.voidedPayments) {
          rows.push(
            csvRow(
              [
                month,
                voided.base,
                adjustmentsTotal(voided.adjustments),
                voided.net,
                voided.currency,
                voided.paidOn,
                labels.methods[voided.method],
                labels.statuses.voided,
                voided.voidReason ?? '',
              ],
              numeric,
            ),
          );
        }
        rows.push(
          csvRow(
            [
              month,
              line.base ?? '',
              adjustmentsTotal(line.adjustments),
              line.net,
              line.currency,
              line.payment?.paidOn ?? '',
              line.payment ? labels.methods[line.payment.method] : '',
              labels.statuses[line.status],
              line.payment?.note ?? line.skipReason ?? '',
            ],
            numeric,
          ),
        );
      }
      return {
        // ASCII only: a header can't carry an Arabic name (the SPA names the saved file itself).
        fileName: `payroll-history-${employee.id}.csv`,
        body: UTF8_BOM + header + rows.join(''),
      };
    });
  }

  /**
   * The (employee, month) line made and locked for a change, with what it currently reads as.
   * One employee's writes run one at a time; the month must be one they are employed in.
   */
  private async touch(employeeId: string, month: string) {
    await this.employees.lock(employeeId);
    const employee = await this.require(employeeId);
    if (!isEmployedIn(employee, month, monthOf(await this.reader.today()))) {
      throw new NotEmployedError('No payroll line for this month', { employeeId, month });
    }
    const line: StoredLine = await this.lines.touch(employeeId, month);
    const current = await this.lineOf(employee, month);
    return { employee, line, current };
  }

  private async lineOf(employee: StoredEmployee, month: string): Promise<PayrollLine> {
    const snapshot: PayrollSnapshot = await this.reader.snapshot([employee.id]);
    return this.reader.line(employee, month, snapshot);
  }

  private async require(id: string): Promise<StoredEmployee> {
    const row = await this.employees.find(id);
    if (!row) throw new EmployeeNotFoundError('No such employee', { id });
    return row;
  }

  private async language(lang: ExportLanguage | undefined): Promise<ExportLanguage> {
    return lang ?? (await this.tenantDb.run(() => this.tenancy.currentTenant())).locale;
  }

  private record(
    verb: 'adjust' | 'confirm' | 'skip' | 'unskip' | 'void',
    line: StoredLine,
    employee: StoredEmployee,
    entry: { before: unknown; after: Record<string, unknown>; reason?: string },
  ): Promise<void> {
    return this.audit.record({
      action: `payroll_line.${verb}`,
      resourceType: 'payroll_line',
      resourceId: line.id,
      before: entry.before,
      after: {
        employeeId: employee.id,
        employee: employee.fullName,
        month: line.month,
        ...entry.after,
      },
      reason: entry.reason,
    });
  }
}
