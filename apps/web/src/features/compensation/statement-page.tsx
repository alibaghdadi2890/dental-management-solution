import { exportLanguageSchema } from '@dcm/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-context';
import { ErrorState } from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import {
  closeMonth,
  downloadStatement,
  invalidateCompensation,
  reopenMonth,
  statementQuery,
  voidAdjustment,
  voidPayout,
} from './compensation-api';
import { MonthPicker } from './month-picker';
import { formatMonth } from './months';
import { type MoneyRowKind, MoneyRowPanel } from './money-row-panel';
import { StatementView } from './statement-view';

/**
 * A dentist's statement for the owner (prompt §2): the statement, and Add adjustment, Record
 * payout, Close month / Reopen (a confirm; reopening asks why) and Export. The month is in the
 * URL; the back link returns to the Compensation report of that month.
 */
export function StatementPage({
  profileId,
  month,
  latest,
  onMonth,
}: {
  profileId: string;
  month: string;
  latest: string;
  onMonth: (month: string) => void;
}) {
  const { t, i18n } = useTranslation(['compensation', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const { data: session } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const statement = useQuery({
    ...statementQuery(profileId, month),
    placeholderData: keepPreviousData,
  });
  const [panel, setPanel] = useState<MoneyRowKind | null>(null);
  const [exporting, setExporting] = useState(false);
  const tenant = session?.tenant;
  // The previous month stays on screen while the next one loads: no actions on it meanwhile.
  const data = statement.data;
  const actionable = data !== undefined && !statement.isPlaceholderData;

  const afterWrite = async (message: string) => {
    await invalidateCompensation(queryClient);
    toast(message, { tone: 'success' });
  };
  // The confirm dialog shows the error and stays open when the action throws.
  const run = (action: () => Promise<unknown>, message: string) => async () => {
    try {
      await action();
    } catch (error) {
      throw new Error(apiErrorMessage(error, i18n), { cause: error });
    }
    await afterWrite(message);
  };

  const closeOrReopen = () => {
    if (!data) return;
    const name = formatMonth(month, locale);
    if (data.status === 'closed') {
      confirm({
        title: t('compensation:close.reopenTitle', { month: name }),
        body: t('compensation:close.reopenBody'),
        okLabel: t('compensation:close.reopen'),
        tone: 'warn',
        reasonLabel: t('compensation:close.reason'),
        onConfirm: (reason) =>
          run(() => reopenMonth(profileId, month, { reason }), t('compensation:close.reopened'))(),
      });
      return;
    }
    confirm({
      title: t('compensation:close.title', { month: name }),
      body: t('compensation:close.body', { name: data.dentistName }),
      okLabel: t('compensation:close.close'),
      onConfirm: run(() => closeMonth(profileId, month), t('compensation:close.closed')),
    });
  };

  const runExport = () => {
    setExporting(true);
    downloadStatement(profileId, month, exportLanguageSchema.safeParse(locale).data)
      .catch((error: unknown) => {
        toast(apiErrorMessage(error, i18n), { tone: 'danger' });
      })
      .finally(() => {
        setExporting(false);
      });
  };

  return (
    <>
      <Page
        title={data?.dentistName ?? t('compensation:statement.title')}
        subtitle={t('compensation:statement.subtitle', { month: formatMonth(month, locale) })}
        actions={<MonthPicker month={month} latest={latest} onChange={onMonth} />}
      >
        <Link
          to="/compensation"
          search={{ month }}
          className="mb-3 inline-block text-[12.5px] font-medium text-primary hover:underline print:hidden"
        >
          {t('compensation:statement.back')}
        </Link>
        {data && actionable && (
          <div className="mb-3.5 flex flex-wrap gap-2 print:hidden">
            {data.status !== 'closed' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPanel('adjustment');
                  }}
                >
                  {t('compensation:statement.addAdjustment')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPanel('payout');
                  }}
                >
                  {t('compensation:statement.recordPayout')}
                </Button>
              </>
            )}
            <Button
              variant={data.status === 'closed' ? 'outline' : 'primary'}
              onClick={closeOrReopen}
            >
              {t(
                data.status === 'closed' ? 'compensation:close.reopen' : 'compensation:close.close',
              )}
            </Button>
            <Button variant="outline" busy={exporting} onClick={runExport}>
              {t('compensation:exportCsv')}
            </Button>
          </div>
        )}
        {data ? (
          <StatementView
            statement={data}
            onVoidAdjustment={
              !actionable
                ? undefined
                : (row) => {
                    confirm({
                      title: t('compensation:void.adjustmentTitle'),
                      body: t('compensation:void.body'),
                      okLabel: t('compensation:void.ok'),
                      tone: 'danger',
                      reasonLabel: t('compensation:void.reason'),
                      onConfirm: (reason) =>
                        run(
                          () => voidAdjustment(profileId, row.id, { reason }),
                          t('compensation:void.done'),
                        )(),
                    });
                  }
            }
            onVoidPayout={
              !actionable
                ? undefined
                : (row) => {
                    confirm({
                      title: t('compensation:void.payoutTitle'),
                      body: t('compensation:void.body'),
                      okLabel: t('compensation:void.ok'),
                      tone: 'danger',
                      reasonLabel: t('compensation:void.reason'),
                      onConfirm: (reason) =>
                        run(
                          () => voidPayout(profileId, row.id, { reason }),
                          t('compensation:void.done'),
                        )(),
                    });
                  }
            }
          />
        ) : statement.isError ? (
          <ErrorState
            title={t('compensation:statement.errorTitle')}
            body={t('compensation:statement.errorBody')}
            requestId={statement.error instanceof ApiError ? statement.error.requestId : undefined}
            error={statement.error}
            onRetry={() => void statement.refetch()}
          />
        ) : (
          <CardSkeleton label={t('compensation:statement.loading')} />
        )}
      </Page>
      {panel && tenant && (
        <MoneyRowPanel
          kind={panel}
          profileId={profileId}
          month={month}
          tenant={tenant}
          onClose={() => {
            setPanel(null);
          }}
        />
      )}
    </>
  );
}
