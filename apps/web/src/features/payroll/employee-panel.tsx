import { type EmployeeDetail, exportLanguageSchema, type Session } from '@dcm/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/date-input';
import { Eyebrow, Field, Select, TextInput } from '@/components/ui/field';
import { Pill } from '@/components/ui/list';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { MoneyInput } from '@/features/billing/money-input';
import { formatMonth, monthOf, shiftMonth } from '@/features/compensation/months';
import { parseAmount } from '@/lib/amount';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatCalendarDate, formatDate, formatMoney, todayIn } from '@/lib/format';
import {
  changeSalary,
  createEmployee,
  downloadEmployeeHistory,
  employeeQuery,
  invalidatePayroll,
  linkableStaffQuery,
  removeEmployee,
  updateEmployee,
} from './payroll-api';
import { LINE_TONES } from './line-tones';

type Tenant = NonNullable<Session['tenant']>;

/** Months offered for a first payroll month or a salary's start: three years back to next month. */
function monthChoices(currentMonth: string): string[] {
  const months: string[] = [];
  for (let month = shiftMonth(currentMonth, 1); months.length < 38; month = shiftMonth(month, -1)) {
    months.push(month);
  }
  return months;
}

/**
 * An employee (B1, B2): add one, or read and edit one — details, the linked staff user (never a
 * dentist; linking changes no access), Mark as left and its undo, Remove while they have no
 * payroll — with the salary history (Change salary adds an entry; the old ones stay) and the
 * payroll history, exported as CSV.
 */
export function EmployeePanel({
  employeeId,
  session,
  tenant,
  canManage,
  onClose,
}: {
  /** Null to add one. */
  employeeId: string | null;
  session: Session;
  tenant: Tenant;
  canManage: boolean;
  onClose: () => void;
}) {
  const detail = useQuery({ ...employeeQuery(employeeId ?? ''), enabled: employeeId !== null });
  if (employeeId !== null && !detail.data) return null;
  return (
    <Panel
      key={detail.data?.employee.id ?? 'new'}
      detail={detail.data}
      session={session}
      tenant={tenant}
      canManage={canManage}
      onClose={onClose}
    />
  );
}

function Panel({
  detail,
  session,
  tenant,
  canManage,
  onClose,
}: {
  detail: EmployeeDetail | undefined;
  session: Session;
  tenant: Tenant;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['payroll', 'billing', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const staff = useQuery({ ...linkableStaffQuery(), enabled: canManage });
  const today = todayIn(tenant.timeZone);
  const currentMonth = monthOf(today);
  const employee = detail?.employee;
  const [fullName, setFullName] = useState(employee?.fullName ?? '');
  const [jobTitle, setJobTitle] = useState(employee?.jobTitle ?? '');
  const [phone, setPhone] = useState(employee?.phone ?? '');
  const [email, setEmail] = useState(employee?.email ?? '');
  const [hireDate, setHireDate] = useState(employee?.hireDate ?? today);
  const [payrollFrom, setPayrollFrom] = useState(employee?.payrollFrom ?? currentMonth);
  const [branchId, setBranchId] = useState(employee?.branchId ?? '');
  const [note, setNote] = useState(employee?.note ?? '');
  const [staffProfileId, setStaffProfileId] = useState(employee?.staffProfileId ?? '');
  const [salaryText, setSalaryText] = useState('');
  const [salaryFrom, setSalaryFrom] = useState(currentMonth);
  const [salaryReason, setSalaryReason] = useState('');
  const [changingSalary, setChangingSalary] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [endDate, setEndDate] = useState(today);
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const touch = () => {
    setDirty(true);
    setError(undefined);
  };
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);
  const choices = monthChoices(currentMonth);
  const salary = parseAmount(salaryText, locale);
  const salaryProblem =
    salary === '' ? 'required' : salary === null || Number(salary) <= 0 ? 'amount' : undefined;
  const problems = {
    fullName: fullName.trim() === '' ? 'required' : undefined,
    payrollFrom: payrollFrom < monthOf(hireDate) ? 'payrollFrom' : undefined,
    salary: employee ? undefined : salaryProblem,
  } as const;
  const problem = (key: 'required' | 'amount' | 'payrollFrom' | 'endDate' | undefined) =>
    tried && key !== undefined ? t(`payroll:employee.problems.${key}`) : undefined;

  const act = async (work: () => Promise<unknown>, message: string): Promise<boolean> => {
    setSaving(true);
    setError(undefined);
    try {
      await work();
      await invalidatePayroll(queryClient);
      toast(message, { tone: 'success' });
      return true;
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  const details = () => ({
    fullName: fullName.trim(),
    jobTitle: text(jobTitle),
    phone: text(phone),
    email: text(email),
    hireDate,
    payrollFrom,
    branchId: branchId === '' ? null : branchId,
    note: text(note),
    staffProfileId: staffProfileId === '' ? null : staffProfileId,
  });

  const save = async () => {
    setTried(true);
    if (Object.values(problems).some(Boolean)) return;
    if (!employee) {
      if (salary === null || salary === '') return;
      const created = await act(
        () =>
          createEmployee({
            ...details(),
            salary: {
              amount: salary,
              effectiveMonth: salaryFrom < payrollFrom ? salaryFrom : payrollFrom,
            },
          }),
        t('payroll:employee.created'),
      );
      if (created) onClose();
      return;
    }
    if (await act(() => updateEmployee(employee.id, details()), t('payroll:employee.updated'))) {
      setDirty(false);
    }
  };

  const saveSalary = async () => {
    setTried(true);
    if (!employee || salary === null || salary === '' || salaryProblem) return;
    const saved = await act(
      () =>
        changeSalary(employee.id, {
          amount: salary,
          effectiveMonth: salaryFrom,
          reason: text(salaryReason),
        }),
      t('payroll:salary.saved'),
    );
    if (saved) {
      setChangingSalary(false);
      setSalaryText('');
      setSalaryReason('');
      setTried(false);
    }
  };

  const linkable = (staff.data ?? []).filter(
    (row) => row.linkedEmployeeId === null || row.linkedEmployeeId === employee?.id,
  );
  const footer = canManage ? (
    <>
      {employee?.removable && (
        <Button
          variant="danger"
          disabled={saving}
          onClick={() => {
            confirm({
              title: t('payroll:employee.removeTitle', { name: employee.fullName }),
              body: t('payroll:employee.removeBody'),
              okLabel: t('payroll:employee.removeOk'),
              tone: 'danger',
              onConfirm: async () => {
                try {
                  await removeEmployee(employee.id);
                } catch (failure) {
                  throw new Error(apiErrorMessage(failure, i18n), { cause: failure });
                }
                await invalidatePayroll(queryClient);
                toast(t('payroll:employee.removed'), { tone: 'success' });
                onClose();
              },
            });
          }}
        >
          {t('payroll:employee.remove')}
        </Button>
      )}
      <Button disabled={saving} onClick={onClose} className="ms-auto">
        {t('common:cancel')}
      </Button>
      <Button variant="primary" busy={saving} onClick={() => void save()}>
        {employee ? t('payroll:employee.saveEdit') : t('payroll:employee.save')}
      </Button>
    </>
  ) : undefined;

  return (
    <>
      <div
        aria-hidden
        onClick={saving ? undefined : onClose}
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
      />
      <RightPanel
        modal
        eyebrow={t('payroll:employee.eyebrow')}
        title={employee ? employee.fullName : t('payroll:employee.createTitle')}
        dirty={dirty}
        onClose={onClose}
        closeDisabled={saving}
        initialFocus={employee ? 'heading' : 'field'}
        className="fixed inset-y-0 end-0 z-40 w-[600px] max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={footer}
      >
        <div className="flex flex-col gap-5">
          {employee?.linkNotice && employee.linkedUserName && (
            <p
              role="status"
              className="m-0 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] text-warning"
            >
              {t(`payroll:employee.notice.${employee.linkNotice}`, {
                user: employee.linkedUserName,
              })}
            </p>
          )}
          {employee && (
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={employee.status === 'active' ? 'success' : 'neutral'}>
                {t(`payroll:employeeStatus.${employee.status}`)}
              </Pill>
              {employee.endDate && (
                <span className="text-[12.5px] text-ink-muted">
                  {t('payroll:run.left', { date: formatCalendarDate(employee.endDate, locale) })}
                </span>
              )}
              {canManage && employee.status === 'active' && !leaving && (
                <Button
                  size="sm"
                  className="ms-auto"
                  onClick={() => {
                    setLeaving(true);
                  }}
                >
                  {t('payroll:employee.leave')}
                </Button>
              )}
              {canManage && employee.status === 'left' && (
                <Button
                  size="sm"
                  className="ms-auto"
                  busy={saving}
                  onClick={() =>
                    void act(
                      () => updateEmployee(employee.id, { status: 'active' }),
                      t('payroll:employee.rejoined'),
                    )
                  }
                >
                  {t('payroll:employee.rejoin')}
                </Button>
              )}
            </div>
          )}
          {employee && leaving && (
            <section className="rounded-lg border border-border bg-faint p-3">
              <p className="m-0 mb-2 text-[12.5px] text-ink-secondary">
                {t('payroll:employee.leaveBody')}
              </p>
              <div className="flex items-end gap-2">
                <Field label={t('payroll:employee.endDate')} className="flex-1">
                  {(props) => (
                    <DateInput
                      {...props}
                      value={endDate}
                      onChange={setEndDate}
                      order={dateInputOrder(tenant.country)}
                      today={today}
                      max={shiftMonth(currentMonth, 12) + '-28'}
                      pickerLabel={t('payroll:employee.chooseEndDate')}
                    />
                  )}
                </Field>
                <Button
                  variant="primary"
                  busy={saving}
                  onClick={() =>
                    void act(
                      () => updateEmployee(employee.id, { status: 'left', endDate }),
                      t('payroll:employee.left'),
                    ).then((done) => {
                      if (done) setLeaving(false);
                    })
                  }
                >
                  {t('payroll:employee.leaveOk')}
                </Button>
                <Button
                  onClick={() => {
                    setLeaving(false);
                  }}
                >
                  {t('common:cancel')}
                </Button>
              </div>
            </section>
          )}

          <fieldset disabled={!canManage} className="m-0 grid grid-cols-2 gap-3 border-0 p-0">
            <Field
              label={t('payroll:employee.fullName')}
              error={problem(problems.fullName)}
              className="col-span-2"
            >
              {(props) => (
                <TextInput
                  {...props}
                  value={fullName}
                  maxLength={120}
                  onChange={(event) => {
                    setFullName(event.target.value);
                    touch();
                  }}
                />
              )}
            </Field>
            <Field label={t('payroll:employee.jobTitle')} hint={t('payroll:employee.optional')}>
              {(props) => (
                <TextInput
                  {...props}
                  value={jobTitle}
                  maxLength={80}
                  onChange={(event) => {
                    setJobTitle(event.target.value);
                    touch();
                  }}
                />
              )}
            </Field>
            <Field label={t('payroll:employee.phone')} hint={t('payroll:employee.optional')}>
              {(props) => (
                <TextInput
                  {...props}
                  dir="ltr"
                  value={phone}
                  maxLength={40}
                  onChange={(event) => {
                    setPhone(event.target.value);
                    touch();
                  }}
                />
              )}
            </Field>
            <Field
              label={t('payroll:employee.email')}
              hint={t('payroll:employee.optional')}
              className="col-span-2"
            >
              {(props) => (
                <TextInput
                  {...props}
                  type="email"
                  dir="ltr"
                  value={email}
                  maxLength={254}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    touch();
                  }}
                />
              )}
            </Field>
            <Field label={t('payroll:employee.hireDate')}>
              {(props) => (
                <DateInput
                  {...props}
                  value={hireDate}
                  onChange={(value) => {
                    setHireDate(value);
                    touch();
                  }}
                  order={dateInputOrder(tenant.country)}
                  today={today}
                  max={`${shiftMonth(currentMonth, 12)}-28`}
                  pickerLabel={t('payroll:employee.chooseHireDate')}
                />
              )}
            </Field>
            <Field label={t('payroll:employee.payrollFrom')} error={problem(problems.payrollFrom)}>
              {(props) => (
                <Select
                  {...props}
                  value={payrollFrom}
                  onChange={(event) => {
                    setPayrollFrom(event.target.value);
                    touch();
                  }}
                >
                  {choices.map((month) => (
                    <option key={month} value={month}>
                      {formatMonth(month, locale)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {session.branches.length > 1 && (
              <Field label={t('payroll:employee.branch')} hint={t('payroll:employee.optional')}>
                {(props) => (
                  <Select
                    {...props}
                    value={branchId}
                    onChange={(event) => {
                      setBranchId(event.target.value);
                      touch();
                    }}
                  >
                    <option value="">{t('payroll:employees.clinicWide')}</option>
                    {session.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label={t('payroll:employee.user')} className="col-span-2">
              {(props) => (
                <Select
                  {...props}
                  value={staffProfileId}
                  onChange={(event) => {
                    setStaffProfileId(event.target.value);
                    touch();
                  }}
                >
                  <option value="">{t('payroll:employee.noUser')}</option>
                  {employee?.staffProfileId &&
                    !linkable.some((row) => row.profileId === employee.staffProfileId) && (
                      <option value={employee.staffProfileId}>
                        {employee.linkedUserName ?? '—'}
                      </option>
                    )}
                  {linkable.map((row) => (
                    <option key={row.profileId} value={row.profileId}>
                      {row.displayName}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label={t('payroll:employee.note')}
              hint={t('payroll:employee.optional')}
              className="col-span-2"
            >
              {(props) => (
                <TextInput
                  {...props}
                  value={note}
                  maxLength={500}
                  onChange={(event) => {
                    setNote(event.target.value);
                    touch();
                  }}
                />
              )}
            </Field>
            {!employee && (
              <>
                <Field label={t('payroll:employee.salary')} error={problem(problems.salary)}>
                  {(props) => (
                    <MoneyInput
                      {...props}
                      value={salaryText}
                      onChange={(value) => {
                        setSalaryText(value);
                        touch();
                      }}
                      currency={tenant.currency}
                      locale={locale}
                    />
                  )}
                </Field>
                <Field label={t('payroll:employee.salaryFrom')}>
                  {(props) => (
                    <Select
                      {...props}
                      value={salaryFrom < payrollFrom ? salaryFrom : payrollFrom}
                      onChange={(event) => {
                        setSalaryFrom(event.target.value);
                        touch();
                      }}
                    >
                      {choices
                        .filter((month) => month <= payrollFrom)
                        .map((month) => (
                          <option key={month} value={month}>
                            {formatMonth(month, locale)}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
              </>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="m-0 text-[12.5px] font-medium text-danger">
              {error}
            </p>
          )}

          {detail && employee && (
            <>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <Eyebrow>{t('payroll:salary.title')}</Eyebrow>
                  {canManage && !changingSalary && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setChangingSalary(true);
                        setTried(false);
                      }}
                    >
                      {t('payroll:salary.change')}
                    </Button>
                  )}
                </div>
                {changingSalary && (
                  <div className="mb-3 flex flex-col gap-3 rounded-lg border border-border bg-faint p-3">
                    <p className="m-0 text-[12.5px] text-ink-secondary">
                      {t('payroll:salary.changeBody')}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t('payroll:salary.amount')} error={problem(salaryProblem)}>
                        {(props) => (
                          <MoneyInput
                            {...props}
                            value={salaryText}
                            onChange={setSalaryText}
                            currency={tenant.currency}
                            locale={locale}
                          />
                        )}
                      </Field>
                      <Field label={t('payroll:salary.from')}>
                        {(props) => (
                          <Select
                            {...props}
                            value={salaryFrom}
                            onChange={(event) => {
                              setSalaryFrom(event.target.value);
                            }}
                          >
                            {choices.map((month) => (
                              <option key={month} value={month}>
                                {formatMonth(month, locale)}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <Field
                        label={t('payroll:salary.reason')}
                        hint={t('payroll:employee.optional')}
                        className="col-span-2"
                      >
                        {(props) => (
                          <TextInput
                            {...props}
                            value={salaryReason}
                            maxLength={500}
                            onChange={(event) => {
                              setSalaryReason(event.target.value);
                            }}
                          />
                        )}
                      </Field>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        onClick={() => {
                          setChangingSalary(false);
                        }}
                      >
                        {t('common:cancel')}
                      </Button>
                      <Button variant="primary" busy={saving} onClick={() => void saveSalary()}>
                        {t('payroll:salary.save')}
                      </Button>
                    </div>
                  </div>
                )}
                <ul className="m-0 list-none overflow-hidden rounded-lg border border-border p-0">
                  {detail.salaries.map((entry, index) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-row-divider px-3 py-2 text-[13px] first:border-t-0"
                    >
                      <span className="font-medium">
                        {t('payroll:salary.entry', {
                          amount: money(entry.amount),
                          month: formatMonth(entry.effectiveMonth, locale),
                        })}
                      </span>
                      {index === 0 && <Pill tone="indigo">{t('payroll:salary.current')}</Pill>}
                      <span className="text-[12px] text-ink-muted">
                        {t('payroll:salary.by', {
                          name: entry.createdByName ?? '—',
                          date: formatDate(entry.createdAt, { timeZone: tenant.timeZone, locale }),
                        })}
                      </span>
                      {entry.reason && (
                        <span className="w-full text-[12px] text-ink-secondary">
                          {entry.reason}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <Eyebrow>{t('payroll:history.title')}</Eyebrow>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      downloadEmployeeHistory(
                        employee.id,
                        employee.fullName,
                        exportLanguageSchema.safeParse(locale).data,
                      ).catch((failure: unknown) => {
                        toast(apiErrorMessage(failure, i18n), { tone: 'danger' });
                      });
                    }}
                  >
                    {t('payroll:history.export')}
                  </Button>
                </div>
                {detail.history.length === 0 ? (
                  <p className="m-0 text-[12.5px] text-ink-muted">{t('payroll:history.empty')}</p>
                ) : (
                  <ul className="m-0 list-none overflow-hidden rounded-lg border border-border p-0">
                    {detail.history.map((line) => (
                      <li
                        key={line.month}
                        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-row-divider px-3 py-2 text-[13px] first:border-t-0"
                      >
                        <span className="w-[120px] font-medium">
                          {formatMonth(line.month, locale)}
                        </span>
                        <Pill tone={LINE_TONES[line.status]}>
                          {t(`payroll:status.${line.status}`)}
                        </Pill>
                        <span dir="ltr" className="ms-auto font-mono tabular-nums">
                          {money(line.net)}
                        </span>
                        {line.payment && (
                          <span className="w-full text-[12px] text-ink-muted">
                            {t('payroll:run.paidOn', {
                              date: formatCalendarDate(line.payment.paidOn, locale),
                              method: t(`billing:methods.${line.payment.method}`),
                            })}
                          </span>
                        )}
                        {line.voidedPayments.map((payment) => (
                          <span
                            key={payment.id}
                            className="w-full text-[12px] text-ink-muted line-through"
                          >
                            {t('payroll:run.voidedPayment', {
                              amount: money(payment.net),
                              date: formatCalendarDate(payment.paidOn, locale),
                              reason: payment.voidReason ?? '',
                            })}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </RightPanel>
    </>
  );
}
