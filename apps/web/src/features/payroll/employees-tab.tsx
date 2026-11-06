import { EMPLOYEE_STATUSES, type EmployeeStatus, type Session } from '@dcm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  FilterChip,
  Pill,
  SearchInput,
  SkeletonRows,
  TableCard,
  TableHead,
} from '@/components/ui/list';
import { formatMonth } from '@/features/compensation/months';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { EmployeePanel } from './employee-panel';
import { employeesQuery } from './payroll-api';

type Tenant = NonNullable<Session['tenant']>;

const COLUMNS = 'minmax(170px,1.3fr) minmax(130px,1fr) 130px 140px 90px minmax(130px,1fr)';

/** Employees (B4): search and filters, their current salary, status and linked user. */
export function EmployeesTab({
  session,
  tenant,
  canManage,
}: {
  session: Session;
  tenant: Tenant;
  canManage: boolean;
}) {
  const { t, i18n } = useTranslation('payroll');
  const locale = i18n.resolvedLanguage ?? 'en';
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<EmployeeStatus | ''>('');
  const [branchId, setBranchId] = useState('');
  const query = {
    q: useDebouncedValue(q, 250).trim() || undefined,
    status: status || undefined,
    branchId: branchId || undefined,
  };
  const list = useQuery({ ...employeesQuery(query), placeholderData: keepPreviousData });
  const [open, setOpen] = useState<string | null>();
  const branches = new Map(session.branches.map((branch) => [branch.id, branch.name]));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder={t('employees.search')}
          label={t('employees.searchLabel')}
          maxLength={100}
        />
        <FilterChip
          label={t('employees.status')}
          value={status}
          options={[
            { value: '', label: t('employees.anyStatus') },
            ...EMPLOYEE_STATUSES.map((value) => ({ value, label: t(`employeeStatus.${value}`) })),
          ]}
          onChange={(value) => {
            setStatus(EMPLOYEE_STATUSES.find((candidate) => candidate === value) ?? '');
          }}
        />
        {session.branches.length > 1 && (
          <FilterChip
            label={t('employees.branch')}
            value={branchId}
            options={[
              { value: '', label: t('employees.allBranches') },
              ...session.branches.map((branch) => ({ value: branch.id, label: branch.name })),
            ]}
            onChange={setBranchId}
          />
        )}
        {canManage && (
          <Button
            variant="primary"
            className="ms-auto"
            onClick={() => {
              setOpen(null);
            }}
          >
            {t('employees.add')}
          </Button>
        )}
      </div>
      <TableCard minWidth={860}>
        <div role="table" aria-label={t('tabs.employees')} aria-busy={list.isPlaceholderData}>
          <TableHead
            columns={COLUMNS}
            labels={[
              t('employees.columns.name'),
              t('employees.columns.title'),
              t('employees.columns.branch'),
              <span key="salary" className="block text-end">
                {t('employees.columns.salary')}
              </span>,
              t('employees.columns.status'),
              t('employees.columns.user'),
            ]}
          />
          {list.isPending ? (
            <SkeletonRows columns={COLUMNS} label={t('loading')} />
          ) : list.isError && !list.data ? (
            <ErrorState
              title={t('errorTitle')}
              body={t('errorBody')}
              requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
              error={list.error}
              onRetry={() => void list.refetch()}
            />
          ) : list.data.length === 0 ? (
            <EmptyState title={t('employees.emptyTitle')} body={t('employees.emptyBody')} />
          ) : (
            list.data.map((employee) => (
              <button
                key={employee.id}
                type="button"
                role="row"
                onClick={() => {
                  setOpen(employee.id);
                }}
                className="grid min-h-12 w-full cursor-pointer items-center gap-2.5 border-0 border-t border-row-divider bg-transparent px-3 text-start text-[13px] text-ink hover:bg-faint"
                style={{ gridTemplateColumns: COLUMNS }}
              >
                <span role="cell" className="truncate font-medium">
                  {employee.fullName}
                </span>
                <span role="cell" className="truncate">
                  {employee.jobTitle ?? '—'}
                </span>
                <span role="cell" className="truncate">
                  {employee.branchId
                    ? (branches.get(employee.branchId) ?? '—')
                    : t('employees.clinicWide')}
                </span>
                <span role="cell" dir="ltr" className="block text-end font-mono tabular-nums">
                  {employee.currentSalary
                    ? formatMoney(
                        {
                          amount: employee.currentSalary.amount,
                          currency: employee.currentSalary.currency,
                        },
                        locale,
                      )
                    : t('employees.noSalaryYet', {
                        month: formatMonth(employee.payrollFrom, locale),
                      })}
                </span>
                <span role="cell">
                  <Pill tone={employee.status === 'active' ? 'success' : 'neutral'}>
                    {t(`employeeStatus.${employee.status}`)}
                  </Pill>
                </span>
                <span role="cell" className="flex items-center gap-1.5 truncate">
                  {employee.linkedUserName ?? '—'}
                  {employee.linkNotice && (
                    <span aria-hidden className="text-warning">
                      ⚠
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </TableCard>
      {open !== undefined && (
        <EmployeePanel
          employeeId={open}
          session={session}
          tenant={tenant}
          canManage={canManage}
          onClose={() => {
            setOpen(undefined);
          }}
        />
      )}
    </>
  );
}
