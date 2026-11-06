import type { EmployeeListQuery, EmployeeStatus } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { employees, employeeSalaries } from './schema';

export type StoredEmployee = typeof employees.$inferSelect;
export type StoredSalary = typeof employeeSalaries.$inferSelect;

export interface NewEmployee {
  fullName: string;
  jobTitle: string | null;
  phone: string | null;
  email: string | null;
  hireDate: string;
  payrollFrom: string;
  branchId: string | null;
  note: string | null;
  staffProfileId: string | null;
  createdBy: string;
}

export type EmployeePatch = Partial<
  Omit<NewEmployee, 'createdBy'> & { status: EmployeeStatus; endDate: string | null }
>;

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (match) => `\\${match}`);

/** The clinic's employees (never hard-deleted) and their salary history (append-only). */
@Injectable()
export class EmployeesRepository {
  constructor(private readonly db: TenantDb) {}

  /** One employee's payroll writes run one at a time, to the end of the transaction. */
  async lock(employeeId: string): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`payroll:${employeeId}`}, 0))`,
      ),
    );
  }

  insert(employee: NewEmployee): Promise<StoredEmployee> {
    return this.db.run(async (tx) => {
      const [row] = await tx.insert(employees).values(employee).returning();
      if (!row) throw new Error('Employee insert returned nothing');
      return row;
    });
  }

  /** A live (not removed) employee. */
  find(id: string): Promise<StoredEmployee | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, id), isNull(employees.deletedAt)));
      return row;
    });
  }

  /** Live employees, by name. */
  list(query: Partial<EmployeeListQuery> = {}): Promise<StoredEmployee[]> {
    const conditions: SQL[] = [isNull(employees.deletedAt)];
    if (query.status) conditions.push(eq(employees.status, query.status));
    if (query.branchId) conditions.push(eq(employees.branchId, query.branchId));
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      const text = or(ilike(employees.fullName, pattern), ilike(employees.jobTitle, pattern));
      if (text) conditions.push(text);
    }
    return this.db.run((tx) =>
      tx
        .select()
        .from(employees)
        .where(and(...conditions))
        .orderBy(asc(employees.fullName), asc(employees.id)),
    );
  }

  /** The live employee linked to a staff profile, if any. */
  byStaffProfile(profileId: string): Promise<StoredEmployee | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.staffProfileId, profileId), isNull(employees.deletedAt)));
      return row;
    });
  }

  update(id: string, patch: EmployeePatch): Promise<StoredEmployee> {
    return this.db.run(async (tx) => {
      const [row] = await tx.update(employees).set(patch).where(eq(employees.id, id)).returning();
      if (!row) throw new Error('Employee update returned nothing');
      return row;
    });
  }

  remove(id: string, at: Date): Promise<void> {
    return this.db.run(async (tx) => {
      await tx
        .update(employees)
        .set({ deletedAt: at, staffProfileId: null })
        .where(eq(employees.id, id));
    });
  }

  insertSalary(salary: {
    employeeId: string;
    amount: string;
    currency: string;
    effectiveMonth: string;
    reason: string | null;
    createdBy: string;
  }): Promise<StoredSalary> {
    return this.db.run(async (tx) => {
      const [row] = await tx.insert(employeeSalaries).values(salary).returning();
      if (!row) throw new Error('Salary insert returned nothing');
      return row;
    });
  }

  /** Each employee's salary entries in creation order (uuid v7 ids are time-ordered). */
  async salariesOf(employeeIds: readonly string[]): Promise<Map<string, StoredSalary[]>> {
    const grouped = new Map<string, StoredSalary[]>();
    if (employeeIds.length === 0) return grouped;
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(employeeSalaries)
        .where(inArray(employeeSalaries.employeeId, [...employeeIds]))
        .orderBy(asc(employeeSalaries.id)),
    );
    for (const row of rows) {
      grouped.set(row.employeeId, [...(grouped.get(row.employeeId) ?? []), row]);
    }
    return grouped;
  }

  /** Any salary at all: the clinic's currency is locked. */
  async anySalary(): Promise<boolean> {
    const [row] = await this.db.run((tx) =>
      tx.select({ id: employeeSalaries.id }).from(employeeSalaries).limit(1),
    );
    return row !== undefined;
  }
}
