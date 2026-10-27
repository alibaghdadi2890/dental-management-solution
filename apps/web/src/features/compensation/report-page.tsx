import {
  type CompensationReport,
  type CompensationReportRow,
  exportLanguageSchema,
  toCents,
} from '@dcm/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  Pill,
  SkeletonRows,
  TableCard,
  TableHead,
} from '@/components/ui/list';
import { useToast } from '@/components/ui/toast-context';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { downloadReport, reportQuery } from './compensation-api';
import { MonthPicker } from './month-picker';

const COLUMNS = 'minmax(180px,1.4fr) 64px 120px 120px 120px 112px 112px 128px 120px';

const STATUS_TONES = {
  provisional: 'warning',
  closed: 'success',
  none: 'neutral',
} as const;

const FIGURE = 'block text-end font-mono tabular-nums';

function Kpis({ report, locale }: { report: CompensationReport | undefined; locale: string }) {
  const { t } = useTranslation('compensation');
  const money = (amount: string | undefined) =>
    report && amount !== undefined
      ? formatMoney({ amount, currency: report.currency }, locale)
      : '—';
  const cards = [
    { key: 'production', value: money(report?.kpis.production) },
    { key: 'collections', value: money(report?.kpis.collections) },
    { key: 'earned', value: money(report?.kpis.earned) },
    { key: 'balanceOwed', value: money(report?.kpis.balanceOwed) },
  ] as const;
  return (
    <div className="mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
      {cards.map((card) => (
        <section key={card.key} className="rounded-xl border border-border bg-surface px-4 py-3.5">
          <h2 className="m-0 text-[12px] font-medium text-ink-muted">{t(`kpi.${card.key}`)}</h2>
          <p dir="ltr" className="m-0 mt-2 font-mono text-[22px] font-semibold tabular-nums">
            {card.value}
          </p>
        </section>
      ))}
    </div>
  );
}

function Row({
  row,
  month,
  money,
}: {
  row: CompensationReportRow;
  month: string;
  money: (amount: string) => string;
}) {
  const { t } = useTranslation('compensation');
  const balance = toCents(row.balance);
  return (
    <Link
      role="row"
      to="/compensation/$profileId"
      params={{ profileId: row.profileId }}
      search={{ month }}
      className="grid min-h-14 items-center gap-2.5 border-t border-row-divider px-3 text-[13px] text-ink no-underline hover:bg-faint"
      style={{ gridTemplateColumns: COLUMNS }}
    >
      <span role="cell" className="truncate font-medium">
        {row.name}
        {!row.active && (
          <span className="ms-1.5 text-[12px] font-normal text-ink-muted">
            {t('report.inactive')}
          </span>
        )}
      </span>
      <span role="cell" className={FIGURE}>
        {row.visits}
      </span>
      <span role="cell" dir="ltr" className={FIGURE}>
        {money(row.production)}
      </span>
      <span role="cell" dir="ltr" className={FIGURE}>
        {money(row.collections)}
      </span>
      <span role="cell" dir="ltr" className={FIGURE}>
        {row.earned === null ? '—' : money(row.earned)}
      </span>
      <span role="cell" dir="ltr" className={FIGURE}>
        {money(row.adjustments)}
      </span>
      <span role="cell" dir="ltr" className={FIGURE}>
        {money(row.payouts)}
      </span>
      <span
        role="cell"
        dir="ltr"
        className={cn(FIGURE, 'font-semibold', balance < 0n && 'text-danger')}
      >
        {money(row.balance)}
      </span>
      <span role="cell">
        <Pill tone={STATUS_TONES[row.status]}>{t(`status.${row.status}`)}</Pill>
      </span>
    </Link>
  );
}

/**
 * Compensation (prompt §2, `compensation:manage`): a month of every dentist — four KPI cards, one
 * row per dentist (a row opens their statement), the collections of no visit last and muted, and
 * the CSV export. The month lives in the URL.
 */
export function ReportPage({
  month,
  latest,
  onMonth,
}: {
  month: string;
  latest: string;
  onMonth: (month: string) => void;
}) {
  const { t, i18n } = useTranslation(['compensation', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const report = useQuery({ ...reportQuery(month), placeholderData: keepPreviousData });
  const [exporting, setExporting] = useState(false);
  const money = (amount: string) =>
    formatMoney({ amount, currency: report.data?.currency ?? 'USD' }, locale);

  const runExport = () => {
    setExporting(true);
    downloadReport(month, exportLanguageSchema.safeParse(locale).data)
      .catch((error: unknown) => {
        toast(apiErrorMessage(error, i18n), { tone: 'danger' });
      })
      .finally(() => {
        setExporting(false);
      });
  };

  return (
    <Page
      title={t('compensation:report.title')}
      subtitle={t('compensation:report.subtitle')}
      actions={
        <>
          <MonthPicker month={month} latest={latest} onChange={onMonth} />
          <Button variant="outline" busy={exporting} onClick={runExport}>
            {t('compensation:exportCsv')}
          </Button>
        </>
      }
    >
      <Kpis report={report.data} locale={locale} />
      <TableCard minWidth={1120}>
        <div
          role="table"
          aria-label={t('compensation:report.title')}
          aria-busy={report.isPlaceholderData}
        >
          <TableHead
            columns={COLUMNS}
            labels={[
              t('compensation:report.columns.dentist'),
              <span key="visits" className="block text-end">
                {t('compensation:report.columns.visits')}
              </span>,
              ...(
                [
                  'production',
                  'collections',
                  'earned',
                  'adjustments',
                  'payouts',
                  'balance',
                ] as const
              ).map((key) => (
                <span key={key} className="block text-end">
                  {t(`compensation:report.columns.${key}`)}
                </span>
              )),
              t('compensation:report.columns.status'),
            ]}
          />
          {report.isPending ? (
            <SkeletonRows columns={COLUMNS} label={t('compensation:report.loading')} />
          ) : report.isError && !report.data ? (
            <ErrorState
              title={t('compensation:report.errorTitle')}
              body={t('compensation:report.errorBody')}
              requestId={report.error instanceof ApiError ? report.error.requestId : undefined}
              error={report.error}
              onRetry={() => void report.refetch()}
            />
          ) : report.data.rows.length === 0 ? (
            <EmptyState
              title={t('compensation:report.emptyTitle')}
              body={t('compensation:report.emptyBody')}
            />
          ) : (
            <>
              {report.data.rows.map((row) => (
                <Row key={row.profileId} row={row} month={month} money={money} />
              ))}
              <div
                role="row"
                className="grid min-h-12 items-center gap-2.5 border-t border-row-divider bg-faint px-3 text-[13px] text-ink-muted"
                style={{ gridTemplateColumns: COLUMNS }}
              >
                <span role="cell">{t('compensation:report.unattributed')}</span>
                <span role="cell" />
                <span role="cell" />
                <span role="cell" dir="ltr" className={FIGURE}>
                  {money(report.data.unattributed.collections)}
                </span>
              </div>
            </>
          )}
        </div>
      </TableCard>
    </Page>
  );
}
