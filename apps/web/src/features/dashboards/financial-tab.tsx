import {
  amountRatio,
  changeOf,
  type CostGroup,
  type DashboardQuery,
  EXPENSE_CATEGORY_KEYS,
  fromCents,
  type FinancialCosts,
  type FinancialMoney,
  planPhases,
  type ResolvedPeriod,
  type Session,
  toCents,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarList,
  ChartCard,
  type ChartTable,
  ColumnChart,
  PairedBars,
  rampOf,
  SegmentedBar,
  SERIES,
} from '@/components/charts';
import { ChangeChip, FigureTile } from '@/components/ui/figure-tile';
import type { GoodWhen } from '@/components/ui/figure-tone';
import {
  formatCompact,
  formatCount,
  formatMoney,
  formatMoneyWhole,
  formatPercent,
} from '@/lib/format';
import { useOpenContact } from '@/features/patients/contact-panel/contact-panel-context';
import { cn } from '@/lib/utils';
import { amountOf, stateOf, tileState } from './card-state';
import { formatSpan } from './format-span';
import { cardQuery } from './dashboards-api';
import * as drill from './drill';
import { monthLabel, monthTitle } from './months';

/** Ranked charts show the top eight; the rest is _Other_ (D5). */
const TOP = 8;
const RECEIVABLE_RAMP = ['d0_30', 'd31_60', 'd61_90', 'd90_plus'] as const;

/**
 * The Financial tab (feature 19, Part B): what the clinic produced, collected, spent, is owed and
 * owes. Every card is its own request and the figure its home screen totals. Cost figures need
 * complete cost (expenses, salaries, dentist pay: ADR-0088) and every clinic-wide money card
 * steps aside with a branch selected (_All branches only_).
 */
export function FinancialTab({
  session,
  query,
  period,
}: {
  session: Session;
  query: DashboardQuery;
  period: ResolvedPeriod;
}) {
  const { t, i18n } = useTranslation('dashboards');
  const { t: billingT } = useTranslation('billing');
  const { t: clinicalT } = useTranslation('clinical');
  const { t: expensesT } = useTranslation('expenses');
  const navigate = useNavigate();
  const openContact = useOpenContact();
  const locale = i18n.language;
  const currency = session.tenant?.currency ?? 'USD';
  const can = (permission: Session['permissions'][number]) =>
    session.permissions.includes(permission);
  const completeCost = can('expense:read') && can('payroll:read') && can('compensation:manage');
  const branch = query.branchId !== undefined;
  const aside = t('allBranchesOnly');

  const money = useQuery(cardQuery('financial/money', query));
  const costs = useQuery({
    ...cardQuery('financial/costs', query),
    enabled: can('expense:read') && !branch,
  });
  const receivables = useQuery({ ...cardQuery('financial/receivables', query), enabled: !branch });
  const dentists = useQuery(cardQuery('financial/dentists', query));
  const services = useQuery(cardQuery('financial/services', query));
  const plans = useQuery({ ...cardQuery('financial/plans', query), enabled: !branch });
  const owes = useQuery({ ...cardQuery('financial/owes', query), enabled: !branch });

  const whole = (amount: string) => formatMoneyWhole({ amount, currency }, locale);
  const exact = (amount: string) => formatMoney({ amount, currency }, locale);
  const against = t('vs', { span: formatSpan(period.compare, locale) });
  const chip = (current: number | null, previous: number | null, goodWhen: GoodWhen) => (
    <ChangeChip change={changeOf(current, previous)} goodWhen={goodWhen} against={against} />
  );
  const m = money.data;
  const c = costs.data;
  const net = (data: FinancialMoney, cost: FinancialCosts, which: 'current' | 'previous') =>
    cost.total ? fromCents(toCents(data.collected[which]) - toCents(cost.total[which])) : null;
  const span = { from: period.from, to: period.to };
  const months = m?.months ?? [];
  const costByMonth = new Map((c?.months ?? []).map((row) => [row.month, row.amount]));
  const spark = (values: (number | null)[], color: string, format: (value: number) => string) => ({
    color,
    points: months.map((row, index) => ({
      label: monthTitle(row.month, locale),
      value: values[index] ?? null,
      display: values[index] === null || values[index] === undefined ? '—' : format(values[index]),
    })),
  });

  // --- Tiles ---
  const tiles: { key: string; node: (first: boolean) => ReactNode }[] = [];
  tiles.push({
    key: 'production',
    node: (first) => (
      <FigureTile
        label={t('tiles.production')}
        info={t('info.production')}
        state={tileState(money)}
        value={m ? whole(m.production.current) : ''}
        exact={m ? exact(m.production.current) : undefined}
        change={m && chip(amountOf(m.production.current), amountOf(m.production.previous), 'up')}
        spark={
          first && m
            ? spark(
                months.map((row) => amountOf(row.production)),
                SERIES.production,
                (value) => exact(value.toFixed(2)),
              )
            : undefined
        }
        link={drill.linkTo(drill.chargedVisits(span, query))}
        onRetry={() => void money.refetch()}
      />
    ),
  });
  tiles.push({
    key: 'collected',
    node: (first) => (
      <FigureTile
        label={t('tiles.collected')}
        info={t('info.collected')}
        state={tileState(money)}
        value={m ? whole(m.collected.current) : ''}
        exact={m ? exact(m.collected.current) : undefined}
        change={m && chip(amountOf(m.collected.current), amountOf(m.collected.previous), 'up')}
        spark={
          first && m
            ? spark(
                months.map((row) => amountOf(row.collected)),
                SERIES.collected,
                (value) => exact(value.toFixed(2)),
              )
            : undefined
        }
        link={drill.linkTo(drill.payments(span, query))}
        onRetry={() => void money.refetch()}
      />
    ),
  });
  const rate = (data: FinancialMoney, which: 'current' | 'previous') =>
    amountRatio(data.collected[which], data.production[which]);
  tiles.push({
    key: 'rate',
    node: (first) => (
      <FigureTile
        label={t('tiles.collectionRate')}
        info={t('info.collectionRate')}
        state={tileState(money)}
        value={m ? formatPercent(rate(m, 'current'), locale) : ''}
        change={m && chip(rate(m, 'current'), rate(m, 'previous'), 'up')}
        spark={
          first && m
            ? spark(
                months.map((row) => amountRatio(row.collected, row.production)),
                SERIES.collected,
                (value) => formatPercent(value, locale),
              )
            : undefined
        }
        link={drill.linkTo(drill.payments(span, query))}
        onRetry={() => void money.refetch()}
      />
    ),
  });
  if (completeCost) {
    const netNow = m && c ? net(m, c, 'current') : null;
    tiles.push({
      key: 'net',
      node: (first) => (
        <FigureTile
          label={t('tiles.netResult')}
          info={t('info.netResult')}
          state={
            branch
              ? 'aside'
              : m && c
                ? 'ready'
                : money.isError || costs.isError
                  ? 'error'
                  : 'loading'
          }
          aside={aside}
          value={netNow === null ? '—' : whole(netNow)}
          exact={netNow === null ? undefined : exact(netNow)}
          tone={netNow !== null && toCents(netNow) < 0n ? 'bad' : undefined}
          change={
            m && c
              ? chip(
                  netNow === null ? null : amountOf(netNow),
                  (() => {
                    const before = net(m, c, 'previous');
                    return before === null ? null : amountOf(before);
                  })(),
                  'up',
                )
              : undefined
          }
          spark={
            first && m && c?.months
              ? spark(
                  months.map(
                    (row) => amountOf(row.collected) - amountOf(costByMonth.get(row.month) ?? '0'),
                  ),
                  SERIES.collected,
                  (value) => exact(value.toFixed(2)),
                )
              : undefined
          }
          link={drill.linkTo(drill.expenses(span))}
          onRetry={() => {
            void money.refetch();
            void costs.refetch();
          }}
        />
      ),
    });
    tiles.push({
      key: 'expenses',
      node: () => (
        <FigureTile
          label={t('tiles.expenses')}
          info={t('info.expenses')}
          state={branch ? 'aside' : tileState(costs)}
          aside={aside}
          value={c?.total ? whole(c.total.current) : '—'}
          exact={c?.total ? exact(c.total.current) : undefined}
          change={c?.total && chip(amountOf(c.total.current), amountOf(c.total.previous), 'down')}
          link={drill.linkTo(drill.expenses(span))}
          onRetry={() => void costs.refetch()}
        />
      ),
    });
  }
  tiles.push({
    key: 'receivables',
    node: () => (
      <FigureTile
        label={t('tiles.receivables')}
        info={t('info.receivables')}
        now
        state={branch ? 'aside' : tileState(receivables)}
        aside={aside}
        value={receivables.data ? whole(receivables.data.total) : ''}
        exact={receivables.data ? exact(receivables.data.total) : undefined}
        link={drill.linkTo(drill.receivables())}
        onRetry={() => void receivables.refetch()}
      />
    ),
  });
  const discountShare = (data: FinancialMoney) =>
    amountRatio(data.discounts.current, data.gross.current);
  tiles.push({
    key: 'discounts',
    node: () => (
      <FigureTile
        label={t('tiles.discounts')}
        info={t('info.discounts')}
        state={tileState(money)}
        value={m ? whole(m.discounts.current) : ''}
        exact={m ? exact(m.discounts.current) : undefined}
        change={
          m && (
            <>
              <span className="font-mono text-[11.5px] text-ink-muted tabular-nums" dir="ltr">
                {formatPercent(discountShare(m), locale)}
              </span>
              {chip(amountOf(m.discounts.current), amountOf(m.discounts.previous), 'neutral')}
            </>
          )
        }
        link={drill.linkTo(drill.chargedVisits(span, query, { discounted: true }))}
        onRetry={() => void money.refetch()}
      />
    ),
  });
  const average = (data: FinancialMoney, which: 'current' | 'previous') =>
    data.visitsCharged[which] === 0
      ? null
      : amountOf(data.production[which]) / data.visitsCharged[which];
  tiles.push({
    key: 'average',
    node: () => {
      const value = m ? average(m, 'current') : null;
      return (
        <FigureTile
          label={t('tiles.average')}
          info={t('info.average')}
          state={tileState(money)}
          value={value === null ? '—' : whole(value.toFixed(2))}
          exact={value === null ? undefined : exact(value.toFixed(2))}
          change={m && chip(value, average(m, 'previous'), 'up')}
          link={drill.linkTo(drill.chargedVisits(span, query))}
          onRetry={() => void money.refetch()}
        />
      );
    },
  });

  // --- Money in and out ---
  const series = [
    { key: 'production', label: t('series.production'), color: SERIES.production },
    { key: 'collected', label: t('series.collected'), color: SERIES.collected },
    ...(completeCost && c?.months && !branch
      ? [{ key: 'expenses', label: t('series.expenses'), color: SERIES.expenses }]
      : []),
  ];
  const monthRows = months.map((row) => ({
    label: monthLabel(row.month, locale),
    title: monthTitle(row.month, locale),
    values: {
      production: amountOf(row.production),
      collected: amountOf(row.collected),
      ...(completeCost && c?.months
        ? { expenses: amountOf(costByMonth.get(row.month) ?? '0') }
        : {}),
    },
  }));
  const moneyTable: ChartTable = {
    columns: [t('table.month'), ...series.map((item) => item.label)],
    rows: months.map((row) => ({
      cells: [
        monthTitle(row.month, locale),
        exact(row.production),
        exact(row.collected),
        ...(series.length > 2 ? [exact(costByMonth.get(row.month) ?? '0.00')] : []),
      ],
      exact: [
        null,
        row.production,
        row.collected,
        ...(series.length > 2 ? [costByMonth.get(row.month) ?? '0.00'] : []),
      ],
    })),
  };

  // --- Breakdowns ---
  const r = receivables.data;
  const dentistData = dentists.data;
  const [serviceView, setServiceView] = useState<'service' | 'category'>('service');
  const [allServices, setAllServices] = useState(false);
  const serviceItems = (() => {
    const data = services.data;
    if (!data) return [];
    const rows: { key: string; label: string; amount: string; code: string | null }[] =
      serviceView === 'service'
        ? data.services.map((row) => ({
            key: row.code,
            label: row.name,
            amount: row.amount,
            code: row.code,
          }))
        : data.categories.map((row) => ({
            key: row.category ?? '—',
            label: row.category ?? t('uncategorised'),
            amount: row.amount,
            code: null,
          }));
    if (allServices || rows.length <= TOP + 1) return rows;
    const rest = rows.slice(TOP).reduce((total, row) => total + toCents(row.amount), 0n);
    return [
      ...rows.slice(0, TOP),
      { key: 'other', label: t('other'), amount: fromCents(rest), code: null },
    ];
  })();
  const collectedNow = m?.collected.current ?? '0.00';
  const groupCategory = (group: CostGroup) =>
    c?.categories.find((row) => row.key === group)?.categoryId;
  const expenseName = (row: FinancialCosts['categories'][number]) => {
    const key = EXPENSE_CATEGORY_KEYS.find((candidate) => candidate === row.key);
    return key ? expensesT(`category.${key}`) : (row.name ?? '');
  };

  const canExportMoney = can('finance:read');
  const cards: ReactNode[] = [];

  cards.push(
    <ChartCard
      key="receivables"
      className="col-span-12 lg:col-span-6"
      title={t('cards.receivables')}
      info={t('info.receivablesByAge')}
      state={
        branch
          ? { kind: 'aside', text: aside }
          : stateOf(receivables, (data) => toCents(data.total) === 0n)
      }
      summary={r ? t('summary.receivables', { amount: whole(r.total) }) : undefined}
      table={
        r && {
          columns: [t('table.age'), t('table.amount')],
          rows: r.buckets.map((row) => ({
            cells: [t(`buckets.${row.bucket}`), exact(row.amount)],
            exact: [null, row.amount],
          })),
        }
      }
      exportName="receivables"
      canExport={canExportMoney}
    >
      {r && (
        <div className="grid gap-4 sm:grid-cols-2">
          <BarList
            items={r.buckets.map((row, index) => ({
              key: row.bucket,
              label: t(`buckets.${row.bucket}`),
              value: amountOf(row.amount),
              display: whole(row.amount),
              title: exact(row.amount),
              color: rampOf(index + 2, RECEIVABLE_RAMP.length + 1),
              link: drill.linkTo(drill.receivables(row.bucket)),
            }))}
          />
          <div>
            <h3 className="mb-1.5 text-[12px] font-medium text-ink-muted">{t('largest')}</h3>
            <ul className="flex flex-col">
              {r.largest.map((row) => {
                // A family of two or more reads as its payer and opens the contact panel.
                const payerId = row.members > 1 ? (row.payer?.contactId ?? null) : null;
                const content = (
                  <span className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-1 py-1 text-[12.5px]">
                    <span className="min-w-0">
                      <span className="block truncate">
                        {payerId && row.payer ? row.payer.name : row.fullName}
                      </span>
                      {payerId && (
                        <span className="block truncate text-[11.5px] text-ink-muted">
                          {t('familyMembers', { count: row.members })}
                        </span>
                      )}
                    </span>
                    <span className="text-[11.5px] text-ink-muted">
                      {t(`buckets.${row.bucket}`)}
                    </span>
                    <span dir="ltr" className="font-mono tabular-nums" title={exact(row.amount)}>
                      {whole(row.amount)}
                    </span>
                  </span>
                );
                const rowClass =
                  'block w-full rounded-md text-start hover:bg-faint focus-visible:outline-2 focus-visible:outline-ring';
                return (
                  <li key={payerId ?? row.patientId}>
                    {payerId && openContact ? (
                      <button
                        type="button"
                        onClick={() => {
                          openContact(payerId);
                        }}
                        className={cn(rowClass, 'cursor-pointer border-0 bg-transparent p-0')}
                      >
                        {content}
                      </button>
                    ) : (
                      drill.linkTo(drill.patient(row.patientId))?.(content, rowClass)
                    )}
                  </li>
                );
              })}
            </ul>
            {drill.linkTo(drill.receivables())?.(
              <span>{t('seeAll')}</span>,
              'mt-1 inline-block text-[12.5px] font-medium text-primary hover:underline',
            )}
          </div>
        </div>
      )}
    </ChartCard>,
  );

  cards.push(
    <ChartCard
      key="dentists"
      className="col-span-12 lg:col-span-6"
      title={t('cards.dentists')}
      info={t('info.dentists')}
      keyItems={[
        { label: t('series.production'), color: SERIES.production },
        { label: t('series.collected'), color: SERIES.collected },
      ]}
      state={stateOf(dentists, (data) =>
        data.rows.every((row) => toCents(row.production) === 0n && toCents(row.collected) === 0n),
      )}
      table={
        dentistData && {
          columns: [
            t('table.dentist'),
            t('series.production'),
            t('series.collected'),
            ...(dentistData.earnedShown ? [t('table.earned')] : []),
          ],
          rows: [
            ...dentistData.rows.map((row) => ({
              cells: [
                row.name,
                exact(row.production),
                exact(row.collected),
                ...(dentistData.earnedShown ? [row.earned ? exact(row.earned) : '—'] : []),
              ],
              exact: [
                null,
                row.production,
                row.collected,
                ...(dentistData.earnedShown ? [row.earned] : []),
              ],
            })),
            {
              cells: [t('unallocated'), '', exact(dentistData.unallocated)],
              exact: [null, null, dentistData.unallocated],
            },
          ],
        }
      }
      exportName="dentists"
      canExport={canExportMoney}
    >
      {dentistData && (
        <>
          <PairedBars
            rows={dentistData.rows.map((row) => ({
              key: row.profileId,
              label: row.name,
              bars: [
                {
                  label: t('series.production'),
                  value: amountOf(row.production),
                  display: whole(row.production),
                  title: exact(row.production),
                  color: SERIES.production,
                },
                {
                  label: t('series.collected'),
                  value: amountOf(row.collected),
                  display: whole(row.collected),
                  title: exact(row.collected),
                  color: SERIES.collected,
                },
              ],
              trailing:
                dentistData.earnedShown && row.earned !== null ? (
                  <span className="flex flex-col items-end text-[11.5px]">
                    <span dir="ltr" className="font-mono tabular-nums" title={exact(row.earned)}>
                      {whole(row.earned)}
                    </span>
                    <span className="text-ink-muted" dir="ltr">
                      {formatPercent(amountRatio(row.earned, row.collected), locale)}
                    </span>
                  </span>
                ) : undefined,
              link: drill.linkTo(drill.chargedVisits(span, query, { dentist: row.profileId })),
            }))}
          />
          <p className="mt-2 flex items-center justify-between px-1 text-[12px] text-ink-muted">
            <span>{t('unallocated')}</span>
            <span
              dir="ltr"
              className="font-mono tabular-nums"
              title={exact(dentistData.unallocated)}
            >
              {whole(dentistData.unallocated)}
            </span>
          </p>
        </>
      )}
    </ChartCard>,
  );

  cards.push(
    <ChartCard
      key="services"
      className="col-span-12 lg:col-span-6"
      title={t('cards.services')}
      info={t('info.services')}
      state={stateOf(services, (data) => data.services.length === 0)}
      action={
        <span className="flex rounded-md border border-border-control p-0.5 text-[11.5px]">
          {(['service', 'category'] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={serviceView === view}
              onClick={() => {
                setServiceView(view);
              }}
              className={cn(
                'cursor-pointer rounded-[4px] px-2 py-0.5',
                serviceView === view ? 'bg-subtle font-medium text-ink' : 'text-ink-muted',
              )}
            >
              {t(`switch.${view}`)}
            </button>
          ))}
        </span>
      }
      table={
        services.data && {
          columns: [
            serviceView === 'service' ? t('table.service') : t('table.category'),
            t('series.production'),
          ],
          rows: serviceItems.map((row) => ({
            cells: [row.label, exact(row.amount)],
            exact: [null, row.amount],
          })),
        }
      }
      exportName="services"
      canExport={canExportMoney}
    >
      <BarList
        items={serviceItems.map((row) => ({
          key: row.key,
          label: row.label,
          value: amountOf(row.amount),
          display: whole(row.amount),
          title: exact(row.amount),
          color: row.key === 'other' ? SERIES.other : SERIES.production,
          link: row.code
            ? drill.linkTo(drill.chargedVisits(span, query, { q: row.code }))
            : undefined,
        }))}
      />
      {services.data &&
        !allServices &&
        (serviceView === 'service' ? services.data.services : services.data.categories).length >
          TOP + 1 && (
          <button
            type="button"
            onClick={() => {
              setAllServices(true);
            }}
            className="mt-1 cursor-pointer text-[12.5px] font-medium text-primary hover:underline"
          >
            {t('seeAll')}
          </button>
        )}
    </ChartCard>,
  );

  if (can('expense:read')) {
    cards.push(
      <ChartCard
        key="expenses"
        className="col-span-12 lg:col-span-6"
        title={t('cards.expenses')}
        info={completeCost ? t('info.expensesByCategory') : undefined}
        state={
          branch
            ? { kind: 'aside', text: aside }
            : stateOf(costs, (data) => data.categories.length === 0)
        }
        table={
          c && {
            columns: [t('table.category'), t('table.amount')],
            rows: c.categories.map((row) => ({
              cells: [expenseName(row), exact(row.amount)],
              exact: [null, row.amount],
            })),
          }
        }
        exportName="expenses"
        canExport
      >
        {c && (
          <BarList
            items={c.categories
              .slice()
              .sort((a, b) => amountOf(b.amount) - amountOf(a.amount))
              .slice(0, TOP)
              .map((row) => ({
                key: row.categoryId,
                label: c.completeCost
                  ? `${expenseName(row)} · ${formatPercent(amountRatio(row.amount, collectedNow), locale)}`
                  : expenseName(row),
                value: amountOf(row.amount),
                display: whole(row.amount),
                title: exact(row.amount),
                color: SERIES.expenses,
                link: drill.linkTo(drill.expenses(span, row.categoryId)),
              }))}
          />
        )}
      </ChartCard>,
    );
  }

  if (completeCost) {
    cards.push(
      <ChartCard
        key="where"
        className="col-span-12 lg:col-span-6"
        title={t('cards.where')}
        info={t('info.where')}
        state={branch ? { kind: 'aside', text: aside } : stateOf(costs)}
        table={
          c?.groups
            ? {
                columns: [t('table.cost'), t('table.shareOfCollected')],
                rows: c.groups.map((row) => ({
                  cells: [
                    t(`groups.${row.group}`),
                    formatPercent(amountRatio(row.amount, collectedNow), locale),
                  ],
                })),
              }
            : undefined
        }
        exportName="cost-shares"
        canExport
      >
        {c?.groups && (
          <BarList
            max={1}
            items={c.groups.map((row) => {
              const share = amountRatio(row.amount, collectedNow);
              const category = row.group === 'other' ? undefined : groupCategory(row.group);
              return {
                key: row.group,
                label: t(`groups.${row.group}`),
                value: share ?? 0,
                display: formatPercent(share, locale),
                title: exact(row.amount),
                color: SERIES.expenses,
                link: drill.linkTo(drill.expenses(span, category)),
              };
            })}
          />
        )}
      </ChartCard>,
    );
  }

  cards.push(
    <ChartCard
      key="methods"
      className="col-span-12 lg:col-span-6"
      title={t('cards.methods')}
      info={t('info.methods')}
      state={stateOf(money, (data) => data.methods.every((row) => toCents(row.amount) === 0n))}
      table={
        m && {
          columns: [t('table.method'), t('table.amount')],
          rows: m.methods.map((row) => ({
            cells: [billingT(`methods.${row.method}`), exact(row.amount)],
            exact: [null, row.amount],
          })),
        }
      }
      exportName="payment-methods"
      canExport={canExportMoney}
    >
      {m && (
        <SegmentedBar
          segments={m.methods.map((row, index) => ({
            key: row.method,
            label: billingT(`methods.${row.method}`),
            value: amountOf(row.amount),
            display: whole(row.amount),
            color: rampOf(5 - index, 5),
            link: drill.linkTo(drill.payments(span, query, { method: row.method })),
          }))}
        />
      )}
    </ChartCard>,
  );

  const p = plans.data;
  cards.push(
    <ChartCard
      key="plans"
      className="col-span-12 lg:col-span-6"
      title={t('cards.planValue')}
      info={t('info.planValue')}
      state={
        branch
          ? { kind: 'aside', text: aside }
          : stateOf(
              plans,
              (data) => data.accepted.every((row) => row.items === 0) && data.proposed.items === 0,
            )
      }
      table={
        p && {
          columns: [t('table.priority'), t('table.amount')],
          rows: [
            ...p.accepted.map((row) => ({
              cells: [clinicalT(`flow.priority.${row.priority}`), exact(row.amount)],
              exact: [null, row.amount],
            })),
            { cells: [t('proposed'), exact(p.proposed.amount)], exact: [null, p.proposed.amount] },
          ],
        }
      }
      exportName="plan-value"
      canExport={canExportMoney}
    >
      {p && (
        <>
          <BarList
            items={planPhases(
              p.accepted.map((row) => ({
                ...row,
                status: 'planned' as const,
                price: { amount: row.amount, currency },
              })),
            ).flatMap((phase) =>
              phase.open.map((row) => ({
                key: row.priority,
                label: `${clinicalT(`flow.priority.${row.priority}`)} · ${formatCount(row.items, locale)}`,
                value: amountOf(row.amount),
                display: whole(row.amount),
                title: exact(row.amount),
                color: SERIES.production,
                link: drill.linkTo(drill.cohort('accepted')),
              })),
            )}
          />
          {drill.linkTo(drill.cohort('proposed'))?.(
            <span className="flex items-center justify-between text-[12.5px]">
              <span className="text-ink-muted">
                {t('proposed')} · {formatCount(p.proposed.items, locale)}
              </span>
              <span dir="ltr" className="font-mono tabular-nums" title={exact(p.proposed.amount)}>
                {whole(p.proposed.amount)}
              </span>
            </span>,
            'mt-2 block rounded-md px-1 py-1 hover:bg-faint focus-visible:outline-2 focus-visible:outline-ring',
          )}
        </>
      )}
    </ChartCard>,
  );

  const o = owes.data;
  const oweLines = o
    ? [
        o.labs !== null && {
          key: 'labs',
          label: t('owes.labs'),
          amount: o.labs,
          target: { to: '/lab', search: { tab: 'labs' } },
        },
        o.salaries !== null && {
          key: 'salaries',
          label: t('owes.salaries'),
          amount: o.salaries,
          target: { to: '/payroll' },
        },
        o.dentists !== null && {
          key: 'dentists',
          label: t('owes.dentists'),
          amount: o.dentists,
          target: { to: '/compensation' },
        },
        o.fixed !== null && {
          key: 'fixed',
          label: t('owes.fixed', { count: o.fixed.count }),
          amount: o.fixed.amount,
          target: { to: '/expenses', search: { tab: 'fixed' } },
        },
        { key: 'credit', label: t('owes.credit'), amount: o.credit, target: null },
      ].filter((line) => line !== false)
    : [];
  cards.push(
    <ChartCard
      key="owes"
      className="col-span-12 lg:col-span-6"
      title={t('cards.owes')}
      info={t('info.owes')}
      state={branch ? { kind: 'aside', text: aside } : stateOf(owes)}
      table={{
        columns: [t('table.line'), t('table.amount')],
        rows: oweLines.map((line) => ({
          cells: [line.label, exact(line.amount)],
          exact: [null, line.amount],
        })),
      }}
      exportName="owes"
      canExport={canExportMoney}
    >
      <ul className="flex flex-col">
        {oweLines.map((line) => {
          const content = (
            <span className="flex items-center justify-between gap-3 px-1 py-1.5 text-[13px]">
              <span>{line.label}</span>
              <span dir="ltr" className="font-mono tabular-nums" title={exact(line.amount)}>
                {whole(line.amount)}
              </span>
            </span>
          );
          const link = drill.linkTo(line.target);
          return (
            <li key={line.key} className="border-b border-row-divider last:border-0">
              {link
                ? link(
                    content,
                    'block rounded-md hover:bg-faint focus-visible:outline-2 focus-visible:outline-ring',
                  )
                : content}
            </li>
          );
        })}
      </ul>
      <span className="sr-only">{t('now')}</span>
    </ChartCard>,
  );

  return (
    <div className="grid grid-cols-12 gap-3">
      {tiles.map((tile, index) => (
        <div key={tile.key} className="col-span-12 sm:col-span-6 xl:col-span-3">
          {tile.node(index < 4)}
        </div>
      ))}
      <ChartCard
        className="col-span-12"
        title={t('cards.moneyInOut')}
        info={t('info.moneyInOut')}
        keyItems={series}
        state={stateOf(money, (data) =>
          data.months.every(
            (row) =>
              toCents(row.production) === 0n &&
              toCents(row.collected) === 0n &&
              toCents(costByMonth.get(row.month) ?? '0') === 0n,
          ),
        )}
        summary={
          m
            ? t('summary.money', {
                production: whole(m.production.current),
                collected: whole(m.collected.current),
              })
            : undefined
        }
        table={moneyTable}
        exportName="money-in-and-out"
        canExport={canExportMoney}
      >
        <ColumnChart
          rows={monthRows}
          series={series}
          format={(value) => exact(value.toFixed(2))}
          formatTick={(value) => formatCompact(value, locale)}
          onSelect={(index) => {
            const row = months[index];
            if (!row) return;
            const target = drill.chargedVisits(drill.monthSpan(row.month), query);
            void navigate({ to: target.to as never, search: target.search as never });
          }}
          extra={(index) => {
            const row = months[index];
            if (!row) return null;
            const spent = costByMonth.get(row.month);
            return (
              <div className="mt-1 border-t border-white/20 pt-1">
                {spent !== undefined && series.length > 2 && (
                  <div className="flex justify-between gap-3">
                    <span>{t('tiles.netResult')}</span>
                    <span dir="ltr" className="font-mono">
                      {exact(fromCents(toCents(row.collected) - toCents(spent)))}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span>{t('tiles.collectionRate')}</span>
                  <span dir="ltr" className="font-mono">
                    {formatPercent(amountRatio(row.collected, row.production), locale)}
                  </span>
                </div>
              </div>
            );
          }}
        />
      </ChartCard>
      {cards}
    </div>
  );
}
