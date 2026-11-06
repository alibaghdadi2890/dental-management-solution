import {
  type Employee,
  type LinkNotice,
  netPay,
  type PayrollAdjustment,
  type PayrollLine,
  type PayrollPayment,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import type { Clock } from '../../../platform/kernel/clock';
import { localDate } from '../../../platform/kernel/local-date';
import { monthOf } from '../../../platform/kernel/months';
import { BranchNotFoundError, TenancyService } from '../../tenancy';
import { type StaffSummary, UsersService } from '../../users';
import { lineNotes, salaryFor } from '../domain/payroll-rules';
import {
  EmployeesRepository,
  type StoredEmployee,
  type StoredSalary,
} from '../persistence/employees.repository';
import {
  LinesRepository,
  type StoredAdjustment,
  type StoredLine,
  type StoredPayment,
} from '../persistence/lines.repository';

/** Everything the derived lines of some employees are read from (ADR-0078). */
export interface PayrollSnapshot {
  currentMonth: string;
  currency: string;
  salaries: Map<string, StoredSalary[]>;
  lines: Map<string, StoredLine>;
  adjustments: Map<string, StoredAdjustment[]>;
  payments: Map<string, StoredPayment[]>;
}

const lineKey = (employeeId: string, month: string) => `${employeeId}:${month}`;

export const toAdjustment = (row: StoredAdjustment): PayrollAdjustment => ({
  kind: row.kind,
  label: row.label,
  amount: row.amount,
});

export function toPayment(row: StoredPayment): PayrollPayment {
  return {
    id: row.id,
    paidOn: row.paidOn,
    method: row.method,
    note: row.note,
    base: row.base,
    adjustments: row.adjustments,
    net: row.net,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  };
}

/**
 * Reads payroll the way it is derived (ADR-0078): a line exists for every employed month; only
 * a touched one has a row. A pending line follows the salary in force; a paid one shows what was
 * paid. Also the clinic's "today", "this month" and currency.
 */
@Injectable()
export class PayrollReader {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly users: UsersService,
    private readonly employees: EmployeesRepository,
    private readonly lines: LinesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  async today(): Promise<string> {
    const { timeZone } = await this.tenancy.currentTenant();
    return localDate(this.clock.now(), timeZone);
  }

  async currency(): Promise<string> {
    return (await this.tenancy.currentTenant()).currency;
  }

  async assertBranch(branchId: string | null): Promise<void> {
    if (branchId === null) return;
    if ((await this.tenancy.activeBranches([branchId])).length === 0) {
      throw new BranchNotFoundError('No such branch', { branchId });
    }
  }

  async snapshot(employeeIds: readonly string[]): Promise<PayrollSnapshot> {
    const stored = await this.lines.of(employeeIds);
    return {
      currentMonth: monthOf(await this.today()),
      currency: await this.currency(),
      salaries: await this.employees.salariesOf(employeeIds),
      lines: new Map(stored.lines.map((line) => [lineKey(line.employeeId, line.month), line])),
      adjustments: stored.adjustments,
      payments: stored.payments,
    };
  }

  /** The line of `employee` for `month`, as it stands. */
  line(employee: StoredEmployee, month: string, snapshot: PayrollSnapshot): PayrollLine {
    const stored = snapshot.lines.get(lineKey(employee.id, month));
    const payments = stored ? (snapshot.payments.get(stored.id) ?? []) : [];
    const live = payments.find((payment) => payment.voidedAt === null);
    const status = live ? 'paid' : stored?.status === 'skipped' ? 'skipped' : 'pending';
    const salary = salaryFor(snapshot.salaries.get(employee.id) ?? [], month);
    const base = live ? live.base : (salary?.amount ?? null);
    const adjustments = live
      ? live.adjustments
      : (stored ? (snapshot.adjustments.get(stored.id) ?? []) : []).map(toAdjustment);
    return {
      employeeId: employee.id,
      employeeName: employee.fullName,
      jobTitle: employee.jobTitle,
      branchId: employee.branchId,
      month,
      status,
      base,
      adjustments,
      net: live ? live.net : netPay(base, adjustments),
      currency: live?.currency ?? salary?.currency ?? snapshot.currency,
      ...lineNotes(employee, month),
      skipReason: status === 'skipped' ? (stored?.skipReason ?? null) : null,
      payment: live ? toPayment(live) : null,
      voidedPayments: payments.filter((payment) => payment.voidedAt !== null).map(toPayment),
    };
  }

  /** The months of `employee` with a live payment, oldest first. */
  paidMonths(employee: StoredEmployee, snapshot: PayrollSnapshot): string[] {
    return [...snapshot.lines.values()]
      .filter(
        (line) =>
          line.employeeId === employee.id &&
          (snapshot.payments.get(line.id) ?? []).some((payment) => payment.voidedAt === null),
      )
      .map((line) => line.month)
      .sort();
  }

  /** Employees as the list shows them: current salary, linked user and its notice. */
  async present(rows: readonly StoredEmployee[], snapshot: PayrollSnapshot): Promise<Employee[]> {
    const linked = rows.flatMap((row) => (row.staffProfileId ? [row.staffProfileId] : []));
    const staff = new Map(
      (linked.length > 0 ? await this.users.staffSummaries(linked) : []).map((summary) => [
        summary.profileId,
        summary,
      ]),
    );
    const touched = new Set([...snapshot.lines.values()].map((line) => line.employeeId));
    return rows.map((row) => {
      const summary = row.staffProfileId ? staff.get(row.staffProfileId) : undefined;
      const salary = salaryFor(snapshot.salaries.get(row.id) ?? [], snapshot.currentMonth);
      return {
        id: row.id,
        fullName: row.fullName,
        jobTitle: row.jobTitle,
        phone: row.phone,
        email: row.email,
        hireDate: row.hireDate,
        payrollFrom: row.payrollFrom,
        branchId: row.branchId,
        status: row.status,
        endDate: row.endDate,
        note: row.note,
        staffProfileId: row.staffProfileId,
        linkedUserName: summary?.displayName ?? null,
        linkNotice: summary ? noticeOf(summary) : null,
        currentSalary: salary
          ? {
              amount: salary.amount,
              currency: salary.currency,
              effectiveMonth: salary.effectiveMonth,
            }
          : null,
        removable: !touched.has(row.id),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}

function noticeOf(summary: StaffSummary): LinkNotice | null {
  if (!summary.active) return 'deactivated';
  return summary.practitionerType === 'dentist' ? 'dentist' : null;
}
