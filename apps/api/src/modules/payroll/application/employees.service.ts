import type {
  ChangeSalary,
  CreateEmployee,
  Employee,
  EmployeeDetail,
  EmployeeListQuery,
  LinkableStaff,
  SalaryEntry,
  UpdateEmployee,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { monthOf } from '../../../platform/kernel/months';
import { AuditService } from '../../audit';
import { UsersService } from '../../users';
import {
  DentistNotLinkableError,
  EmployeeNotFoundError,
  InvalidEmploymentError,
  NotRemovableError,
  StaffNotFoundError,
  UserAlreadyLinkedError,
} from '../domain/payroll-errors';
import {
  assertEffectiveMonth,
  assertPaidInside,
  employedMonths,
  type Employment,
  salaryFor,
} from '../domain/payroll-rules';
import {
  type EmployeePatch,
  EmployeesRepository,
  type StoredEmployee,
} from '../persistence/employees.repository';
import { LinesRepository } from '../persistence/lines.repository';
import { PayrollReader } from './payroll-reader';

const DETAILS = [
  'fullName',
  'jobTitle',
  'phone',
  'email',
  'hireDate',
  'payrollFrom',
  'branchId',
  'note',
] as const;

/**
 * The clinic's employees and their salaries (feature 17, B1–B2, ADR-0077, ADR-0079). Reads need
 * `payroll:read`, changes `payroll:manage`; a platform admin holds neither (ADR-0080). An
 * employee's writes run one at a time (an advisory lock on them) and are audited.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly reader: PayrollReader,
    private readonly employees: EmployeesRepository,
    private readonly lines: LinesRepository,
  ) {}

  list(query: EmployeeListQuery): Promise<Employee[]> {
    this.context.requirePermission('payroll:read');
    return this.tenantDb.run(async () => {
      const rows = await this.employees.list(query);
      return this.reader.present(rows, await this.reader.snapshot(rows.map((row) => row.id)));
    });
  }

  /** Who may be linked: active staff who are not dentists (ADR-0077). */
  staff(): Promise<LinkableStaff[]> {
    this.context.requirePermission('payroll:read');
    return this.tenantDb.run(async () => {
      const linked = new Map(
        (await this.employees.list()).flatMap((row) =>
          row.staffProfileId ? [[row.staffProfileId, row.id] as const] : [],
        ),
      );
      return (await this.users.staffSummaries())
        .filter((summary) => summary.active && summary.practitionerType !== 'dentist')
        .map((summary) => ({
          profileId: summary.profileId,
          displayName: summary.displayName,
          practitionerType: summary.practitionerType,
          linkedEmployeeId: linked.get(summary.profileId) ?? null,
        }));
    });
  }

  detail(id: string): Promise<EmployeeDetail> {
    this.context.requirePermission('payroll:read');
    return this.tenantDb.run(async () => this.read(await this.require(id)));
  }

  create(input: CreateEmployee): Promise<EmployeeDetail> {
    this.context.requirePermission('payroll:manage');
    return this.tenantDb.run(async () => {
      await this.reader.assertBranch(input.branchId);
      if (input.staffProfileId !== null) await this.assertLinkable(input.staffProfileId, null);
      const { salary, ...details } = input;
      const by = this.context.requireUserId();
      const created = await this.employees
        .insert({ ...details, createdBy: by })
        .catch((error: unknown) => {
          throw isUniqueViolation(error) ? this.alreadyLinked() : error;
        });
      const currency = await this.reader.currency();
      await this.employees.insertSalary({
        employeeId: created.id,
        amount: salary.amount,
        currency,
        effectiveMonth: salary.effectiveMonth,
        reason: null,
        createdBy: by,
      });
      await this.record('create', created, undefined, {
        fullName: created.fullName,
        jobTitle: created.jobTitle,
        hireDate: created.hireDate,
        payrollFrom: created.payrollFrom,
        branchId: created.branchId,
        staffProfileId: created.staffProfileId,
        salary: salary.amount,
        currency,
        effectiveMonth: salary.effectiveMonth,
      });
      return this.read(created);
    });
  }

  /**
   * Details, the link and the status in one patch. Each kind of change has its own audit action:
   * `update`, `link` / `unlink`, `leave` / `rejoin`. Dates never leave a paid month outside.
   */
  update(id: string, patch: UpdateEmployee): Promise<EmployeeDetail> {
    this.context.requirePermission('payroll:manage');
    return this.tenantDb.run(async () => {
      await this.employees.lock(id);
      const row = await this.require(id);
      const changes: EmployeePatch = {};
      const before: Record<string, unknown> = {};
      for (const field of DETAILS) {
        const value = patch[field];
        if (value !== undefined && value !== row[field]) {
          (changes as Record<string, unknown>)[field] = value;
          before[field] = row[field];
        }
      }
      const status = patch.status ?? row.status;
      const endDate =
        status === 'active' ? null : patch.endDate !== undefined ? patch.endDate : row.endDate;
      const employment: Employment = {
        hireDate: changes.hireDate ?? row.hireDate,
        payrollFrom: changes.payrollFrom ?? row.payrollFrom,
        endDate,
      };
      if (employment.payrollFrom < monthOf(employment.hireDate)) {
        throw new InvalidEmploymentError('Payroll starts on or after the hire month');
      }
      if (status === 'left' && (endDate === null || endDate < employment.hireDate)) {
        throw new InvalidEmploymentError('They left on or after the day they were hired');
      }
      const snapshot = await this.reader.snapshot([id]);
      assertPaidInside(employment, this.reader.paidMonths(row, snapshot));
      if (changes.branchId !== undefined) await this.reader.assertBranch(changes.branchId);

      const link =
        patch.staffProfileId !== undefined && patch.staffProfileId !== row.staffProfileId
          ? patch.staffProfileId
          : undefined;
      if (link) await this.assertLinkable(link, id);
      const leaving = status !== row.status || endDate !== row.endDate;

      const updated = await this.employees
        .update(id, {
          ...changes,
          ...(link !== undefined ? { staffProfileId: link } : {}),
          ...(leaving ? { status, endDate } : {}),
        })
        .catch((error: unknown) => {
          throw isUniqueViolation(error) ? this.alreadyLinked() : error;
        });
      if (Object.keys(changes).length > 0) await this.record('update', updated, before, changes);
      if (link !== undefined) {
        await this.record(
          link === null ? 'unlink' : 'link',
          updated,
          { staffProfileId: row.staffProfileId },
          { staffProfileId: link },
        );
      }
      if (leaving) {
        await this.record(
          status === 'left' ? 'leave' : 'rejoin',
          updated,
          { status: row.status, endDate: row.endDate },
          { status, endDate },
        );
      }
      return this.read(updated);
    });
  }

  /** Someone created by mistake, before any payroll (D8): removed softly, audited. */
  remove(id: string): Promise<void> {
    this.context.requirePermission('payroll:manage');
    return this.tenantDb.run(async () => {
      await this.employees.lock(id);
      const row = await this.require(id);
      if (await this.lines.anyLine(id)) {
        throw new NotRemovableError('This employee has payroll; mark them as left instead');
      }
      await this.employees.remove(id, this.reader.now());
      await this.record('remove', row, { fullName: row.fullName }, undefined);
    });
  }

  /** A new salary entry; the old ones stay as history (ADR-0079). */
  changeSalary(id: string, input: ChangeSalary): Promise<EmployeeDetail> {
    this.context.requirePermission('payroll:manage');
    return this.tenantDb.run(async () => {
      await this.employees.lock(id);
      const row = await this.require(id);
      const snapshot = await this.reader.snapshot([id]);
      assertEffectiveMonth(
        input.effectiveMonth,
        this.reader.paidMonths(row, snapshot).at(-1) ?? null,
      );
      const previous = salaryFor(snapshot.salaries.get(id) ?? [], input.effectiveMonth);
      const created = await this.employees.insertSalary({
        employeeId: id,
        amount: input.amount,
        currency: snapshot.currency,
        effectiveMonth: input.effectiveMonth,
        reason: input.reason,
        createdBy: this.context.requireUserId(),
      });
      await this.audit.record({
        action: 'employee_salary.change',
        resourceType: 'employee_salary',
        resourceId: created.id,
        before: { amount: previous?.amount ?? null },
        after: {
          employeeId: id,
          employee: row.fullName,
          from: previous?.amount ?? null,
          to: created.amount,
          amount: created.amount,
          currency: created.currency,
          effectiveMonth: created.effectiveMonth,
        },
        reason: input.reason ?? undefined,
      });
      return this.read(row);
    });
  }

  private async read(row: StoredEmployee): Promise<EmployeeDetail> {
    const snapshot = await this.reader.snapshot([row.id]);
    const [employee] = await this.reader.present([row], snapshot);
    if (!employee) throw new Error('Employee presentation returned nothing');
    const salaries = [...(snapshot.salaries.get(row.id) ?? [])].reverse();
    const names = await this.users.namesByUserIds(salaries.map((salary) => salary.createdBy));
    return {
      employee,
      salaries: salaries.map((salary): SalaryEntry => ({
        id: salary.id,
        amount: salary.amount,
        currency: salary.currency,
        effectiveMonth: salary.effectiveMonth,
        reason: salary.reason,
        createdAt: salary.createdAt.toISOString(),
        createdByName: names.get(salary.createdBy) ?? null,
      })),
      history: employedMonths(row, snapshot.currentMonth)
        .reverse()
        .map((month) => this.reader.line(row, month, snapshot)),
    };
  }

  private async require(id: string): Promise<StoredEmployee> {
    const row = await this.employees.find(id);
    if (!row) throw new EmployeeNotFoundError('No such employee', { id });
    return row;
  }

  /** A staff profile of the clinic, not a dentist, linked to no other employee. */
  private async assertLinkable(profileId: string, employeeId: string | null): Promise<void> {
    const [summary] = await this.users.staffSummaries([profileId]);
    if (!summary) throw new StaffNotFoundError('No such staff user', { profileId });
    if (summary.practitionerType === 'dentist') {
      throw new DentistNotLinkableError('Dentists are paid through compensation, not payroll');
    }
    const holder = await this.employees.byStaffProfile(profileId);
    if (holder && holder.id !== employeeId) throw this.alreadyLinked();
  }

  private alreadyLinked(): UserAlreadyLinkedError {
    return new UserAlreadyLinkedError('This user is linked to another employee');
  }

  private record(
    verb: 'create' | 'update' | 'link' | 'unlink' | 'leave' | 'rejoin' | 'remove',
    row: StoredEmployee,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined,
  ): Promise<void> {
    return this.audit.record({
      action: `employee.${verb}`,
      resourceType: 'employee',
      resourceId: row.id,
      before,
      after: { employee: row.fullName, ...after },
    });
  }
}
