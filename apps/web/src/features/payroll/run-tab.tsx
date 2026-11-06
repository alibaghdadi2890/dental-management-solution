import { adjustmentEffect, fromCents, type PayrollLine, type Session } from '@dcm/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-context';
import {
  EmptyState,
  ErrorState,
  Pill,
  SkeletonRows,
  TableCard,
  TableHead,
} from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { MonthPicker } from '@/features/compensation/month-picker';
import { formatMonth } from '@/features/compensation/months';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AdjustmentsDialog } from './adjustments-dialog';
import { ConfirmLinesDialog } from './confirm-lines-dialog';
import { LINE_TONES } from './line-tones';
import { invalidatePayroll, runQuery, skipLine, unskipLine, voidLine } from './payroll-api';

type Tenant = NonNullable<Session['tenant']>;

const COLUMNS = '32px minmax(180px,1.4fr) 120px minmax(150px,1fr) 120px 96px 240px';
const FIGURE = 'block text-end font-mono tabular-nums';

/**
 * The monthly run (B3, B4): one line per employee employed that month, its status, base,
 * adjustments and net; the month's totals; a banner for earlier months still pending. Pending
 * lines are adjusted, confirmed (one or several), skipped; a paid line's payment is voided, which
 * makes it pending again. A voided payment stays visible under its line, struck through.
 */
export function RunTab({
  month,
  currentMonth,
  tenant,
  canManage,
  onMonth,
}: {
  month: string;
  currentMonth: string;
  tenant: Tenant;
  canManage: boolean;
  onMonth: (month: string) => void;
}) {
  const { t, i18n } = useTranslation(['payroll', 'billing', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const run = useQuery({ ...runQuery(month), placeholderData: keepPreviousData });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [adjusting, setAdjusting] = useState<PayrollLine>();
  const [confirming, setConfirming] = useState<readonly PayrollLine[]>();
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);
  const lines = run.data?.lines ?? [];
  const pending = lines.filter((line) => line.status === 'pending' && line.base !== null);
  const chosen = pending.filter((line) => selected.has(line.employeeId));

  const ask = (
    line: PayrollLine,
    kind: 'skip' | 'void',
    action: (reason: string) => Promise<unknown>,
  ) => {
    const values = { name: line.employeeName, month: formatMonth(line.month, locale) };
    confirm({
      title: t(kind === 'skip' ? 'payroll:run.skipTitle' : 'payroll:run.voidTitle', values),
      body: t(kind === 'skip' ? 'payroll:run.skipBody' : 'payroll:run.voidBody'),
      okLabel: t(kind === 'skip' ? 'payroll:run.skipOk' : 'payroll:run.voidOk'),
      tone: kind === 'void' ? 'danger' : 'warn',
      reasonLabel: t(kind === 'skip' ? 'payroll:run.skipReason' : 'payroll:run.voidReason'),
      onConfirm: async (reason) => {
        try {
          await action(reason);
        } catch (failure) {
          throw new Error(apiErrorMessage(failure, i18n), { cause: failure });
        }
        await invalidatePayroll(queryClient);
        toast(t(kind === 'skip' ? 'payroll:run.skipped_done' : 'payroll:run.voided'), {
          tone: 'success',
        });
      },
    });
  };

  const unskip = async (line: PayrollLine) => {
    try {
      await unskipLine(line.month, line.employeeId);
      await invalidatePayroll(queryClient);
      toast(t('payroll:run.unskipped'), { tone: 'success' });
    } catch (failure) {
      toast(apiErrorMessage(failure, i18n), { tone: 'danger' });
    }
  };

  const totals = run.data?.totals;
  const kpis = totals
    ? [
        { key: 'employees', value: String(totals.employees) },
        { key: 'paidNet', value: money(totals.paidNet) },
        { key: 'pendingNet', value: money(totals.pendingNet) },
        { key: 'skipped', value: String(totals.skipped) },
      ]
    : [];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MonthPicker
          month={month}
          latest={currentMonth}
          onChange={(next) => {
            setSelected(new Set());
            onMonth(next);
          }}
        />
        {canManage && chosen.length > 0 && (
          <Button
            variant="primary"
            className="ms-auto"
            onClick={() => {
              setConfirming(chosen);
            }}
          >
            {t('payroll:run.confirmSelected', { count: chosen.length })}
          </Button>
        )}
      </div>
      {run.data && run.data.earlierPending.length > 0 && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] text-warning"
        >
          <span>{t('payroll:run.earlier', { count: run.data.earlierPending.length })}</span>
          {run.data.earlierPending.map((row) => (
            <button
              key={row.month}
              type="button"
              onClick={() => {
                onMonth(row.month);
              }}
              className="cursor-pointer rounded-full border border-warning-border bg-surface px-2.5 py-0.5 font-medium text-warning hover:underline"
            >
              {formatMonth(row.month, locale)} · {row.count}
            </button>
          ))}
        </div>
      )}
      {kpis.length > 0 && (
        <div className="mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          {kpis.map((kpi) => (
            <section key={kpi.key} className="rounded-xl border border-border bg-surface px-4 py-3">
              <h2 className="m-0 text-[12px] font-medium text-ink-muted">
                {t(`payroll:run.${kpi.key as 'employees' | 'paidNet' | 'pendingNet' | 'skipped'}`)}
              </h2>
              <p dir="ltr" className="m-0 mt-1.5 font-mono text-[20px] font-semibold tabular-nums">
                {kpi.value}
              </p>
            </section>
          ))}
        </div>
      )}
      <TableCard minWidth={1000}>
        <div role="table" aria-label={t('payroll:tabs.run')} aria-busy={run.isPlaceholderData}>
          <TableHead
            columns={COLUMNS}
            labels={[
              <span key="select" className="sr-only">
                {t('payroll:run.columns.actions')}
              </span>,
              t('payroll:run.columns.employee'),
              <span key="base" className="block text-end">
                {t('payroll:run.columns.base')}
              </span>,
              t('payroll:run.columns.adjustments'),
              <span key="net" className="block text-end">
                {t('payroll:run.columns.net')}
              </span>,
              t('payroll:run.columns.status'),
              <span key="actions" className="sr-only">
                {t('payroll:run.columns.actions')}
              </span>,
            ]}
          />
          {run.isPending ? (
            <SkeletonRows columns={COLUMNS} label={t('payroll:loading')} />
          ) : run.isError && !run.data ? (
            <ErrorState
              title={t('payroll:errorTitle')}
              body={t('payroll:errorBody')}
              requestId={run.error instanceof ApiError ? run.error.requestId : undefined}
              error={run.error}
              onRetry={() => void run.refetch()}
            />
          ) : lines.length === 0 ? (
            <EmptyState title={t('payroll:run.emptyTitle')} body={t('payroll:run.emptyBody')} />
          ) : (
            lines.map((line) => {
              const selectable = canManage && line.status === 'pending' && line.base !== null;
              return (
                <div
                  key={line.employeeId}
                  role="row"
                  className="grid min-h-14 items-center gap-2.5 border-t border-row-divider px-3 py-2 text-[13px]"
                  style={{ gridTemplateColumns: COLUMNS }}
                >
                  <span role="cell">
                    {selectable && (
                      <input
                        type="checkbox"
                        aria-label={t('payroll:run.select', { name: line.employeeName })}
                        checked={selected.has(line.employeeId)}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(line.employeeId);
                          else next.delete(line.employeeId);
                          setSelected(next);
                        }}
                        className="size-4 cursor-pointer accent-primary"
                      />
                    )}
                  </span>
                  <span role="cell" className="min-w-0">
                    <span className="block truncate font-medium">{line.employeeName}</span>
                    <span className="block truncate text-[12px] text-ink-muted">
                      {[
                        line.jobTitle,
                        line.joinedOn &&
                          t('payroll:run.joined', {
                            date: formatCalendarDate(line.joinedOn, locale),
                          }),
                        line.leftOn &&
                          t('payroll:run.left', { date: formatCalendarDate(line.leftOn, locale) }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {line.voidedPayments.map((payment) => (
                      <span
                        key={payment.id}
                        className="block truncate text-[12px] text-ink-muted line-through"
                      >
                        {t('payroll:run.voidedPayment', {
                          amount: money(payment.net),
                          date: formatCalendarDate(payment.paidOn, locale),
                          reason: payment.voidReason ?? '',
                        })}
                      </span>
                    ))}
                  </span>
                  <span role="cell" dir="ltr" className={FIGURE}>
                    {line.base === null ? (
                      <span className="text-[12px] text-danger">{t('payroll:run.noSalary')}</span>
                    ) : (
                      money(line.base)
                    )}
                  </span>
                  <span
                    role="cell"
                    className="flex min-w-0 flex-col text-[12px] text-ink-secondary"
                  >
                    {line.adjustments.length === 0
                      ? '—'
                      : line.adjustments.map((adjustment, index) => (
                          <span key={index} className="truncate">
                            {adjustment.label}{' '}
                            <span dir="ltr" className="font-mono">
                              {money(fromCents(adjustmentEffect(adjustment)))}
                            </span>
                          </span>
                        ))}
                  </span>
                  <span role="cell" dir="ltr" className={cn(FIGURE, 'font-semibold')}>
                    {money(line.net)}
                  </span>
                  <span role="cell" className="flex flex-col items-start gap-0.5">
                    <Pill tone={LINE_TONES[line.status]}>{t(`payroll:status.${line.status}`)}</Pill>
                    {line.payment && (
                      <span className="text-[11.5px] text-ink-muted">
                        {t('payroll:run.paidOn', {
                          date: formatCalendarDate(line.payment.paidOn, locale),
                          method: t(`billing:methods.${line.payment.method}`),
                        })}
                      </span>
                    )}
                    {line.status === 'skipped' && line.skipReason && (
                      <span className="truncate text-[11.5px] text-ink-muted">
                        {line.skipReason}
                      </span>
                    )}
                  </span>
                  <span role="cell" className="flex flex-wrap justify-end gap-1.5">
                    {canManage && line.status === 'pending' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => {
                            setAdjusting(line);
                          }}
                        >
                          {t('payroll:run.adjust')}
                        </Button>
                        {line.base !== null && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setConfirming([line]);
                            }}
                          >
                            {t('payroll:run.confirm')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => {
                            ask(line, 'skip', (reason) =>
                              skipLine(line.month, line.employeeId, reason),
                            );
                          }}
                        >
                          {t('payroll:run.skip')}
                        </Button>
                      </>
                    )}
                    {canManage && line.status === 'skipped' && (
                      <Button size="sm" onClick={() => void unskip(line)}>
                        {t('payroll:run.unskip')}
                      </Button>
                    )}
                    {canManage && line.status === 'paid' && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          ask(line, 'void', (reason) =>
                            voidLine(line.month, line.employeeId, reason),
                          );
                        }}
                      >
                        {t('payroll:run.void')}
                      </Button>
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </TableCard>
      {adjusting && (
        <AdjustmentsDialog
          line={adjusting}
          onClose={() => {
            setAdjusting(undefined);
          }}
        />
      )}
      {confirming && (
        <ConfirmLinesDialog
          lines={confirming}
          tenant={tenant}
          onClose={() => {
            setConfirming(undefined);
            setSelected(new Set());
          }}
        />
      )}
    </>
  );
}
