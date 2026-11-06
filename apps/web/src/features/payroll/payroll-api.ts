import {
  type ChangeSalaryRequest,
  type ConfirmLinesRequest,
  type CreateEmployeeRequest,
  employeeDetailSchema,
  type EmployeeListQuery,
  employeeSchema,
  type ExportLanguage,
  linkableStaffSchema,
  type PayrollAdjustment,
  payrollLineSchema,
  payrollMonthsSchema,
  payrollRunSchema,
  type UpdateEmployeeRequest,
} from '@dcm/contracts';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { apiFetch } from '@/lib/api';
import { downloadCsv } from '@/lib/download';
import { IDEMPOTENCY_HEADER } from '@/lib/idempotency';

/**
 * Employees, salaries and the monthly run (feature 17, `payroll` module). Keys are scoped under
 * the acting tenant like the other features'. Confirming or voiding a line also changes Expenses
 * (its *Salaries* row), so writes invalidate both.
 */
export const payrollKeys = {
  all: (tenantId: string | null) => ['payroll', tenantId] as const,
  employees: (tenantId: string | null, query: Partial<EmployeeListQuery>) =>
    [...payrollKeys.all(tenantId), 'employees', query] as const,
  employee: (tenantId: string | null, id: string) =>
    [...payrollKeys.all(tenantId), 'employee', id] as const,
  staff: (tenantId: string | null) => [...payrollKeys.all(tenantId), 'staff'] as const,
  run: (tenantId: string | null, month: string) =>
    [...payrollKeys.all(tenantId), 'run', month] as const,
  months: (tenantId: string | null, year: number) =>
    [...payrollKeys.all(tenantId), 'months', year] as const,
};

const line = (month: string, employeeId: string) => `/payroll/runs/${month}/lines/${employeeId}`;

export function employeesQuery(query: Partial<EmployeeListQuery>) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.branchId) params.set('branchId', query.branchId);
  return queryOptions({
    queryKey: payrollKeys.employees(actingTenantId(), query),
    queryFn: () => apiFetch(`/payroll/employees?${params.toString()}`, z.array(employeeSchema)),
  });
}

export function employeeQuery(id: string) {
  return queryOptions({
    queryKey: payrollKeys.employee(actingTenantId(), id),
    queryFn: () => apiFetch(`/payroll/employees/${id}`, employeeDetailSchema),
  });
}

export function linkableStaffQuery() {
  return queryOptions({
    queryKey: payrollKeys.staff(actingTenantId()),
    queryFn: () => apiFetch('/payroll/staff', z.array(linkableStaffSchema)),
  });
}

export function runQuery(month: string) {
  return queryOptions({
    queryKey: payrollKeys.run(actingTenantId(), month),
    queryFn: () => apiFetch(`/payroll/runs/${month}`, payrollRunSchema),
  });
}

export function payrollMonthsQuery(year: number) {
  return queryOptions({
    queryKey: payrollKeys.months(actingTenantId(), year),
    queryFn: () => apiFetch(`/payroll/months?year=${String(year)}`, payrollMonthsSchema),
  });
}

/** Every payroll read, and Expenses (the *Salaries* rows), after any write. */
export async function invalidatePayroll(queryClient: QueryClient): Promise<void> {
  const tenantId = actingTenantId();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: payrollKeys.all(tenantId) }),
    queryClient.invalidateQueries({ queryKey: ['expenses', tenantId] }),
  ]);
}

export function createEmployee(input: CreateEmployeeRequest) {
  return apiFetch('/payroll/employees', employeeDetailSchema, { method: 'POST', json: input });
}

export function updateEmployee(id: string, input: UpdateEmployeeRequest) {
  return apiFetch(`/payroll/employees/${id}`, employeeDetailSchema, {
    method: 'PATCH',
    json: input,
  });
}

export function removeEmployee(id: string) {
  return apiFetch(`/payroll/employees/${id}`, z.undefined(), { method: 'DELETE' });
}

export function changeSalary(id: string, input: ChangeSalaryRequest) {
  return apiFetch(`/payroll/employees/${id}/salaries`, employeeDetailSchema, {
    method: 'POST',
    json: input,
  });
}

export function setAdjustments(
  month: string,
  employeeId: string,
  adjustments: readonly PayrollAdjustment[],
) {
  return apiFetch(`${line(month, employeeId)}/adjustments`, payrollLineSchema, {
    method: 'PUT',
    json: { adjustments },
  });
}

export function confirmLines(input: ConfirmLinesRequest, idempotencyKey: string) {
  return apiFetch('/payroll/confirm', z.array(payrollLineSchema), {
    method: 'POST',
    json: input,
    headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
  });
}

export function skipLine(month: string, employeeId: string, reason: string) {
  return apiFetch(`${line(month, employeeId)}/skip`, payrollLineSchema, {
    method: 'POST',
    json: { reason },
  });
}

export function unskipLine(month: string, employeeId: string) {
  return apiFetch(`${line(month, employeeId)}/unskip`, payrollLineSchema, { method: 'POST' });
}

export function voidLine(month: string, employeeId: string, reason: string) {
  return apiFetch(`${line(month, employeeId)}/void`, payrollLineSchema, {
    method: 'POST',
    json: { reason },
  });
}

const lang = (value: ExportLanguage | undefined) => (value ? `lang=${value}` : '');

export function downloadEmployeeHistory(
  id: string,
  name: string,
  value: ExportLanguage | undefined,
): Promise<void> {
  return downloadCsv(`/payroll/employees/${id}/export?${lang(value)}`, `payroll-${name}.csv`);
}

export function downloadPayrollYear(year: number, value: ExportLanguage | undefined) {
  return downloadCsv(
    `/payroll/months/export?year=${String(year)}&${lang(value)}`,
    `payroll-${String(year)}.csv`,
  );
}
