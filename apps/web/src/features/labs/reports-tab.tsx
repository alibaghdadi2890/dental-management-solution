import type { LabReportFigures, LabReportGroup, Session } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DateInput } from '@/components/ui/date-input';
import { Field } from '@/components/ui/field';
import { EmptyState, FilterChip, SkeletonRows, TableCard, TableHead } from '@/components/ui/list';
import { lastDayOf } from '@/features/compensation/months';
import { dateInputOrder, formatMoney, todayIn } from '@/lib/format';
import type { LabSearch } from './lab-search';
import { labReportsQuery } from './labs-api';

type Tenant = NonNullable<Session['tenant']>;

/**
 * The lab reports (Part E) for a period, by lab, dentist or service, with the clinic's totals:
 * orders sent, received, done, cancelled; average turnaround; on time against the promised date
 * and the average delay; remakes (lab- and clinic-borne) and adjustments; and with lab money the
 * cost. Every count opens the orders behind it.
 */
export function ReportsTab({
  tenant,
  search,
  onSearch,
  onOrders,
}: {
  tenant: Tenant;
  search: LabSearch;
  onSearch: (patch: Partial<LabSearch>) => void;
  onOrders: (ids: string[]) => void;
}) {
  const { t, i18n } = useTranslation('labs');
  const locale = i18n.resolvedLanguage ?? 'en';
  const today = todayIn(tenant.timeZone);
  const from = search.rfrom ?? `${today.slice(0, 7)}-01`;
  const to = search.rto ?? lastDayOf(today.slice(0, 7));
  const groupBy: LabReportGroup = search.group ?? 'lab';
  const report = useQuery(labReportsQuery(from, to, groupBy));
  const money = report.data?.total.totalCost !== null;
  const columns = `minmax(120px,1fr) repeat(4, 72px) 84px 72px 76px 88px 96px${money ? ' 96px 90px' : ''}`;
  const percent = (value: number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value);
  const days = (value: number | null) =>
    value === null ? '—' : t('reports.days', { count: value });
  const cash = (value: string | null) =>
    value === null ? '—' : formatMoney({ amount: value, currency: tenant.currency }, locale);
  const count = (value: number, ids: string[]) =>
    value === 0 ? (
      <span className="text-ink-muted">0</span>
    ) : (
      <button
        type="button"
        title={t('orders.behind', { count: ids.length })}
        className="cursor-pointer border-none bg-transparent p-0 text-start text-primary hover:underline"
        onClick={() => {
          onOrders(ids);
        }}
      >
        {value}
      </button>
    );
  const row = (key: string, name: string, figures: LabReportFigures, total = false) => (
    <div
      key={key}
      role="row"
      className={`grid min-h-11 items-center gap-2.5 border-t border-row-divider px-3 text-[13px] ${total ? 'bg-faint font-medium' : ''}`}
      style={{ gridTemplateColumns: columns }}
    >
      <span role="cell" className="truncate">
        {name}
      </span>
      <span role="cell">{count(figures.sent, figures.orderIds.sent)}</span>
      <span role="cell">{count(figures.received, figures.orderIds.received)}</span>
      <span role="cell">{count(figures.done, figures.orderIds.done)}</span>
      <span role="cell">{count(figures.cancelled, figures.orderIds.cancelled)}</span>
      <span role="cell">{days(figures.avgTurnaroundDays)}</span>
      <span role="cell">
        {percent(figures.onTimeRate)}{' '}
        {figures.orderIds.late.length > 0 &&
          count(figures.orderIds.late.length, figures.orderIds.late)}
      </span>
      <span role="cell">{days(figures.avgDelayDays)}</span>
      <span
        role="cell"
        title={t('reports.remakeSplit', {
          lab: percent(figures.remakeLabRate),
          clinic: percent(figures.remakeClinicRate),
        })}
      >
        {figures.orderIds.remakes.length > 0
          ? count(figures.orderIds.remakes.length, figures.orderIds.remakes)
          : null}{' '}
        <span className="text-ink-muted">{percent(figures.remakeRate)}</span>
      </span>
      <span role="cell">
        {figures.orderIds.adjustments.length > 0
          ? count(figures.orderIds.adjustments.length, figures.orderIds.adjustments)
          : null}{' '}
        <span className="text-ink-muted">{percent(figures.adjustmentRate)}</span>
      </span>
      {money && (
        <>
          <span role="cell" dir="ltr" className="text-end font-mono">
            {cash(figures.totalCost)}
          </span>
          <span role="cell" dir="ltr" className="text-end font-mono">
            {cash(figures.avgCost)}
          </span>
        </>
      )}
    </div>
  );

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label={t('orders.from')}>
          {(props) => (
            <DateInput
              {...props}
              value={from}
              onChange={(value) => {
                onSearch({ rfrom: value });
              }}
              order={dateInputOrder(tenant.country)}
              today={today}
              pickerLabel={t('dialogs.chooseDate')}
            />
          )}
        </Field>
        <Field label={t('orders.to')}>
          {(props) => (
            <DateInput
              {...props}
              value={to}
              onChange={(value) => {
                onSearch({ rto: value });
              }}
              order={dateInputOrder(tenant.country)}
              today={today}
              max="2100-12-31"
              pickerLabel={t('dialogs.chooseDate')}
            />
          )}
        </Field>
        <FilterChip
          label={t('reports.groupBy')}
          value={groupBy === 'lab' ? '' : groupBy}
          options={[
            { value: '', label: t('reports.groups.lab') },
            { value: 'dentist', label: t('reports.groups.dentist') },
            { value: 'service', label: t('reports.groups.service') },
          ]}
          onChange={(value) => {
            onSearch({ group: value === 'dentist' || value === 'service' ? value : undefined });
          }}
        />
      </div>
      <TableCard minWidth={money ? 1120 : 930}>
        <div role="table" aria-label={t('tabs.reports')}>
          <TableHead
            columns={columns}
            labels={[
              t(`reports.groups.${groupBy}`),
              t('reports.columns.sent'),
              t('reports.columns.received'),
              t('reports.columns.done'),
              t('reports.columns.cancelled'),
              t('reports.columns.turnaround'),
              t('reports.columns.onTime'),
              t('reports.columns.delay'),
              t('reports.columns.remakes'),
              t('reports.columns.adjustments'),
              ...(money
                ? [
                    <span key="cost" className="block text-end">
                      {t('reports.columns.cost')}
                    </span>,
                    <span key="avg" className="block text-end">
                      {t('reports.columns.avgCost')}
                    </span>,
                  ]
                : []),
            ]}
          />
          {report.isPending ? (
            <SkeletonRows columns={columns} label={t('loading')} />
          ) : !report.data || report.data.rows.length === 0 ? (
            <EmptyState title={t('reports.empty.title')} body={t('reports.empty.body')} />
          ) : (
            <>
              {report.data.rows.map((item) => row(item.key, item.name, item.figures))}
              {row('total', t('reports.total'), report.data.total, true)}
            </>
          )}
        </div>
      </TableCard>
    </>
  );
}
