import {
  exportLanguageSchema,
  type Lab,
  type LabService,
  type LabStatementLine,
  type Session,
} from '@dcm/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardSkeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-context';
import { DateInput } from '@/components/ui/date-input';
import { Field } from '@/components/ui/field';
import {
  EmptyState,
  ErrorState,
  FilterChip,
  Pill,
  SkeletonRows,
  TableCard,
  TableHead,
  ViewTabs,
} from '@/components/ui/list';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { usePermission } from '@/features/auth/use-permission';
import { lastDayOf } from '@/features/compensation/months';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { dateInputOrder, formatCalendarDate, formatMoney, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LabFormPanel } from './lab-form-panel';
import { type LabMoneyKind, LabMoneyPanel } from './lab-money-panel';
import { LabOrderLabelPill } from './lab-order-label';
import { LabOrderPanel } from './lab-order-panel';
import type { LabDetailSearch, LabDetailTab } from './lab-search';
import { LabServicePanel } from './lab-service-panel';
import { orderNumber, useItemText } from './lab-words';
import {
  downloadLabStatement,
  invalidateLabs,
  labAccountsQuery,
  labOrdersQuery,
  labsQuery,
  labStatementQuery,
  updateLabService,
  voidLabPayment,
} from './labs-api';

type Tenant = NonNullable<Session['tenant']>;

const FIGURE = 'text-end font-mono tabular-nums';

/**
 * One lab's screen (Parts A and D), from the Labs tab: its figures, the statement of a period
 * with its running balance (for whoever sees lab money), the price list, and the lab's orders;
 * its details at the side. Editing the lab, its services and its account happens in right
 * panels over this page. The tab, the period and an open order are in the URL.
 */
export function LabDetailPage({
  labId,
  session,
  search,
  onSearch,
}: {
  labId: string;
  session: Session;
  search: LabDetailSearch;
  onSearch: (next: LabDetailSearch) => void;
}) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const canMoney = usePermission('lab:money_read');
  const canManage = usePermission('lab:money_manage');
  const labs = useQuery(labsQuery(true));
  const accounts = useQuery(labAccountsQuery(canMoney));
  const [editing, setEditing] = useState(false);
  const [moneyForm, setMoneyForm] = useState<LabMoneyKind | null>(null);
  const tenant = session.tenant;
  if (!tenant) return null;
  const lab = labs.data?.find((row) => row.id === labId);
  const account = accounts.data?.labs.find((row) => row.labId === labId);
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);
  const tab: LabDetailTab =
    search.tab && (search.tab !== 'statement' || canMoney)
      ? search.tab
      : canMoney
        ? 'statement'
        : 'services';
  const patch = (next: Partial<LabDetailSearch>) => {
    onSearch({ ...search, ...next });
  };
  const back = (
    <Link
      to="/lab"
      search={{ tab: 'labs' }}
      className="mb-3 inline-block text-[12.5px] font-medium text-primary hover:underline print:hidden"
    >
      {t('labs:labPage.back')}
    </Link>
  );

  if (!lab) {
    return (
      <Page title={t('labs:lab.eyebrow')} subtitle="">
        {back}
        {labs.isPending ? (
          <CardSkeleton label={t('labs:loading')} />
        ) : labs.isError ? (
          <ErrorState
            title={t('labs:errorTitle')}
            body={t('labs:errorBody')}
            requestId={labs.error instanceof ApiError ? labs.error.requestId : undefined}
            error={labs.error}
            onRetry={() => void labs.refetch()}
          />
        ) : (
          <EmptyState title={t('labs:labPage.notFound')} body={t('labs:labPage.notFoundBody')} />
        )}
      </Page>
    );
  }

  const subtitle = [
    lab.contactPerson,
    lab.phone,
    lab.deliveryMethods.map((method) => t(`labs:delivery.${method}`)).join(' · '),
    t('labs:labPage.turnaround', { count: lab.turnaroundDays }),
  ]
    .filter(Boolean)
    .join(' · ');
  const activeServices = lab.services.filter((service) => service.active).length;

  return (
    <>
      <Page
        title={lab.name}
        subtitle={subtitle}
        actions={
          canManage ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setEditing(true);
                }}
              >
                {t('labs:labPage.edit')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setMoneyForm('payment');
                }}
              >
                {t('labs:money.payment.title')}
              </Button>
            </>
          ) : undefined
        }
      >
        {back}
        {!lab.active && (
          <p
            role="status"
            className="mb-3.5 rounded-lg border border-border bg-faint px-3.5 py-2.5 text-[13px] text-ink-secondary"
          >
            {t('labs:labPage.inactive')}
          </p>
        )}
        {canMoney && (
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Figure
              label={t('labs:money.outstanding')}
              value={account ? money(account.outstanding) : '—'}
              hint={
                account && account.outstanding.startsWith('-')
                  ? t('labs:money.credit')
                  : t('labs:labPage.outstandingHint')
              }
              strong
            />
            <Figure
              label={t('labs:money.owed')}
              value={account ? money(account.owed) : '—'}
              hint={t('labs:labPage.owedHint')}
            />
            <Figure
              label={t('labs:money.paid')}
              value={account ? money(account.paid) : '—'}
              hint={t('labs:labPage.paidHint')}
            />
            <Figure
              label={t('labs:money.inProgress')}
              value={account ? money(account.inProgressAmount) : '—'}
              hint={
                account
                  ? t('labs:labPage.inProgressOrders', { count: account.inProgressCount })
                  : undefined
              }
            />
          </div>
        )}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <ViewTabs
              label={t('labs:labPage.tabsLabel')}
              active={tab}
              onChange={(key) => {
                patch({ tab: key });
              }}
              tabs={[
                ...(canMoney
                  ? [{ key: 'statement' as const, label: t('labs:money.statement') }]
                  : []),
                {
                  key: 'services' as const,
                  label: t('labs:lab.services'),
                  count: String(activeServices),
                },
                { key: 'orders' as const, label: t('labs:tabs.orders') },
              ]}
            />
            {tab === 'statement' && (
              <StatementTab
                lab={lab}
                tenant={tenant}
                canManage={canManage}
                search={search}
                onSearch={patch}
                onMoney={setMoneyForm}
              />
            )}
            {tab === 'services' && (
              <ServicesTab lab={lab} tenant={tenant} canManage={canManage} canMoney={canMoney} />
            )}
            {tab === 'orders' && (
              <OrdersTab
                lab={lab}
                onOpen={(id) => {
                  patch({ order: id });
                }}
              />
            )}
          </div>
          <DetailsCard
            lab={lab}
            canManage={canManage}
            onEdit={() => {
              setEditing(true);
            }}
          />
        </div>
      </Page>
      {editing && (
        <LabFormPanel
          lab={lab}
          onClose={() => {
            setEditing(false);
          }}
        />
      )}
      {moneyForm && (
        <LabMoneyPanel
          kind={moneyForm}
          lab={lab}
          outstanding={account?.outstanding}
          tenant={tenant}
          onClose={() => {
            setMoneyForm(null);
          }}
        />
      )}
      {search.order && (
        <LabOrderPanel
          orderId={search.order}
          session={session}
          onClose={() => {
            patch({ order: undefined });
          }}
        />
      )}
    </>
  );
}

function Figure({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  strong?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-[12px] text-ink-muted">{label}</div>
      <div
        dir="ltr"
        className={cn(
          'mt-1 font-mono tabular-nums [text-align:start]',
          strong ? 'text-[20px] font-semibold' : 'text-[16px] font-medium',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11.5px] text-ink-muted">{hint}</div>}
    </div>
  );
}

/** The lab's details at the side of its page: how to reach it and how cases go. */
function DetailsCard({
  lab,
  canManage,
  onEdit,
}: {
  lab: Lab;
  canManage: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation('labs');
  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="m-0 min-w-0 break-words">{value ?? '—'}</dd>
    </>
  );
  return (
    <Card
      title={t('lab.details')}
      action={
        canManage ? (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            {t('labPage.edit')}
          </Button>
        ) : undefined
      }
    >
      <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
        {row(t('lab.contactPerson'), lab.contactPerson)}
        {row(
          t('lab.phone'),
          lab.phone ? (
            <a dir="ltr" href={`tel:${lab.phone}`} className="text-primary hover:underline">
              {lab.phone}
            </a>
          ) : null,
        )}
        {row(
          t('lab.email'),
          lab.email ? (
            <a dir="ltr" href={`mailto:${lab.email}`} className="text-primary hover:underline">
              {lab.email}
            </a>
          ) : null,
        )}
        {row(t('lab.address'), lab.address)}
        {row(
          t('lab.deliveryMethods'),
          lab.deliveryMethods.map((method) => t(`delivery.${method}`)).join(', '),
        )}
        {row(
          t('lab.portal'),
          lab.portalUrl ? (
            <a
              dir="ltr"
              href={lab.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {t('lab.openPortal')}
            </a>
          ) : null,
        )}
        {row(t('lab.standardTurnaround'), t('labPage.turnaround', { count: lab.turnaroundDays }))}
        {lab.note && row(t('lab.note'), <span className="whitespace-pre-line">{lab.note}</span>)}
      </dl>
    </Card>
  );
}

type Preset = 'this_month' | 'last_month' | 'last_3_months' | 'this_year' | 'custom';

function presetRange(preset: Exclude<Preset, 'custom'>, today: string): [string, string] {
  const [year = '', month = ''] = today.split('-');
  const monthStart = (offset: number) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1 + offset, 1));
    return date.toISOString().slice(0, 10);
  };
  switch (preset) {
    case 'this_month':
      return [monthStart(0), lastDayOf(today.slice(0, 7))];
    case 'last_month':
      return [monthStart(-1), lastDayOf(monthStart(-1).slice(0, 7))];
    case 'last_3_months':
      return [monthStart(-2), lastDayOf(today.slice(0, 7))];
    case 'this_year':
      return [`${year}-01-01`, `${year}-12-31`];
  }
}

/** The statement of a period: the balance before, every movement with the running balance, the
 * balance after; payments can be voided, order lines open their order. */
function StatementTab({
  lab,
  tenant,
  canManage,
  search,
  onSearch,
  onMoney,
}: {
  lab: Lab;
  tenant: Tenant;
  canManage: boolean;
  search: LabDetailSearch;
  onSearch: (next: Partial<LabDetailSearch>) => void;
  onMoney: (kind: LabMoneyKind) => void;
}) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = todayIn(tenant.timeZone);
  const [defaultFrom, defaultTo] = presetRange('this_month', today);
  const from = search.from ?? defaultFrom;
  const to = search.to ?? defaultTo;
  const presets = (['this_month', 'last_month', 'last_3_months', 'this_year'] as const).map(
    (key) => [key, ...presetRange(key, today)] as const,
  );
  const preset: Preset =
    presets.find(([, start, end]) => start === from && end === to)?.[0] ?? 'custom';
  const [custom, setCustom] = useState(preset === 'custom');
  const statement = useQuery({
    ...labStatementQuery(lab.id, from, to),
    placeholderData: keepPreviousData,
  });
  const money = (amount: string) => formatMoney({ amount, currency: tenant.currency }, locale);
  const date = (value: string) => formatCalendarDate(value, locale);
  const columns = 'minmax(88px,100px) minmax(0,1fr) 110px 110px 80px';

  const choose = (key: Preset) => {
    if (key === 'custom') {
      setCustom(true);
      return;
    }
    setCustom(false);
    const [start, end] = presetRange(key, today);
    onSearch(key === 'this_month' ? { from: undefined, to: undefined } : { from: start, to: end });
  };

  const voidPayment = (line: LabStatementLine) => {
    confirm({
      title: t('labs:money.voidTitle'),
      body: t('labs:money.voidBody', { amount: money(line.amount.replace(/^-/, '')) }),
      okLabel: t('labs:money.voidPayment'),
      tone: 'danger',
      reasonLabel: t('labs:money.voidReason'),
      onConfirm: async (reason) => {
        try {
          await voidLabPayment(line.sourceId, reason);
        } catch (failure) {
          throw new Error(apiErrorMessage(failure, i18n), { cause: failure });
        }
        await invalidateLabs(queryClient);
        toast(t('labs:money.voidDone'), { tone: 'success' });
      },
    });
  };

  const exportCsv = () => {
    downloadLabStatement(lab.id, from, to, exportLanguageSchema.safeParse(locale).data).catch(
      (failure: unknown) => {
        toast(apiErrorMessage(failure, i18n), { tone: 'danger' });
      },
    );
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        <FilterChip
          label={t('labs:money.period')}
          value={custom ? 'custom' : preset === 'this_month' ? '' : preset}
          options={[
            { value: '', label: t('labs:labPage.periods.this_month') },
            { value: 'last_month', label: t('labs:labPage.periods.last_month') },
            { value: 'last_3_months', label: t('labs:labPage.periods.last_3_months') },
            { value: 'this_year', label: t('labs:labPage.periods.this_year') },
            { value: 'custom', label: t('labs:labPage.periods.custom') },
          ]}
          onChange={(value) => {
            choose(value === '' ? 'this_month' : (value as Preset));
          }}
        />
        {custom && (
          <>
            <Field label={t('labs:orders.from')} className="w-[150px]">
              {(props) => (
                <DateInput
                  {...props}
                  value={from}
                  onChange={(value) => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) onSearch({ from: value, to });
                  }}
                  order={dateInputOrder(tenant.country)}
                  today={today}
                  pickerLabel={t('labs:dialogs.chooseDate')}
                />
              )}
            </Field>
            <Field label={t('labs:orders.to')} className="w-[150px]">
              {(props) => (
                <DateInput
                  {...props}
                  value={to}
                  onChange={(value) => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) onSearch({ from, to: value });
                  }}
                  order={dateInputOrder(tenant.country)}
                  today={today}
                  max="2100-12-31"
                  pickerLabel={t('labs:dialogs.chooseDate')}
                />
              )}
            </Field>
          </>
        )}
        <span className="ms-auto flex flex-wrap gap-2">
          {canManage && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  onMoney('adjustment');
                }}
              >
                {t('labs:money.adjustment.title')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onMoney('opening');
                }}
              >
                {t('labs:money.opening.title')}
              </Button>
            </>
          )}
          <Button variant="outline" onClick={exportCsv}>
            {t('labs:money.export')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.print();
            }}
          >
            {t('labs:money.print')}
          </Button>
        </span>
      </div>
      <TableCard minWidth={640}>
        <div
          role="table"
          aria-label={t('labs:money.statement')}
          aria-busy={statement.isPlaceholderData}
        >
          <TableHead
            columns={columns}
            labels={[
              t('labs:money.columns.date'),
              t('labs:money.columns.entry'),
              <span key="amount" className="block text-end">
                {t('labs:money.columns.amount')}
              </span>,
              <span key="balance" className="block text-end">
                {t('labs:money.columns.balance')}
              </span>,
              <span key="actions" className="sr-only">
                {t('labs:labPage.actions')}
              </span>,
            ]}
          />
          {statement.isPending ? (
            <SkeletonRows columns={columns} label={t('labs:loading')} />
          ) : !statement.data ? (
            <ErrorState
              title={t('labs:errorTitle')}
              body={t('labs:errorBody')}
              requestId={
                statement.error instanceof ApiError ? statement.error.requestId : undefined
              }
              error={statement.error}
              onRetry={() => void statement.refetch()}
            />
          ) : (
            <>
              <div
                role="row"
                className="grid min-h-10 items-center gap-2.5 border-t border-row-divider bg-faint px-3 text-[13px] text-ink-secondary"
                style={{ gridTemplateColumns: columns }}
              >
                <span role="cell">{date(from)}</span>
                <span role="cell">{t('labs:money.balanceBefore', { date: date(from) })}</span>
                <span role="cell" />
                <span role="cell" dir="ltr" className={FIGURE}>
                  {money(statement.data.balanceBefore)}
                </span>
                <span role="cell" />
              </div>
              {statement.data.lines.length === 0 ? (
                <p className="m-0 border-t border-row-divider px-3 py-4 text-[13px] text-ink-muted">
                  {t('labs:labPage.noMovements')}
                </p>
              ) : (
                statement.data.lines.map((line) => (
                  <StatementRow
                    key={`${line.kind}-${line.sourceId}-${line.date}`}
                    line={line}
                    columns={columns}
                    money={money}
                    date={date}
                    canVoid={canManage && line.kind === 'payment' && !line.voided}
                    onVoid={() => {
                      voidPayment(line);
                    }}
                  />
                ))
              )}
              <div
                role="row"
                className="grid min-h-11 items-center gap-2.5 border-t border-border bg-faint px-3 text-[13px] font-semibold"
                style={{ gridTemplateColumns: columns }}
              >
                <span role="cell">{date(to)}</span>
                <span role="cell">{t('labs:money.balanceAfter', { date: date(to) })}</span>
                <span role="cell" />
                <span role="cell" dir="ltr" className={FIGURE}>
                  {money(statement.data.balanceAfter)}
                </span>
                <span role="cell" />
              </div>
            </>
          )}
        </div>
      </TableCard>
    </>
  );
}

function StatementRow({
  line,
  columns,
  money,
  date,
  canVoid,
  onVoid,
}: {
  line: LabStatementLine;
  columns: string;
  money: (amount: string) => string;
  date: (value: string) => string;
  canVoid: boolean;
  onVoid: () => void;
}) {
  const { t } = useTranslation(['labs', 'billing']);
  const detail = [
    line.orderNumber !== null ? `L-${String(line.orderNumber).padStart(6, '0')}` : null,
    line.patientName,
    line.method ? t(`billing:methods.${line.method}`) : null,
    line.description,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      role="row"
      className={cn(
        'grid min-h-11 items-center gap-2.5 border-t border-row-divider px-3 py-1.5 text-[13px]',
        line.voided && 'text-ink-muted',
      )}
      style={{ gridTemplateColumns: columns }}
    >
      <span role="cell">{date(line.date)}</span>
      <span role="cell" className="flex min-w-0 flex-col">
        <span className={cn('font-medium', line.voided && 'line-through')}>
          {t(`labs:money.kinds.${line.kind}`)}
          {line.adjustmentKind && ` · ${t(`labs:money.adjustment.${line.adjustmentKind}`)}`}
        </span>
        {detail && <span className="truncate text-[12px] text-ink-muted">{detail}</span>}
        {line.voided && (
          <span className="text-[12px]">
            {t('labs:money.voidedBecause', { reason: line.voidReason ?? '' })}
          </span>
        )}
      </span>
      <span role="cell" dir="ltr" className={cn(FIGURE, line.voided && 'line-through')}>
        {money(line.amount)}
      </span>
      <span role="cell" dir="ltr" className={FIGURE}>
        {money(line.balance)}
      </span>
      <span role="cell" className="text-end">
        {canVoid && (
          <Button size="sm" variant="ghost" onClick={onVoid}>
            {t('labs:money.voidPayment')}
          </Button>
        )}
      </span>
    </div>
  );
}

/** The price list: each service's price (with lab money) and turnaround; add, edit, deactivate. */
function ServicesTab({
  lab,
  tenant,
  canManage,
  canMoney,
}: {
  lab: Lab;
  tenant: Tenant;
  canManage: boolean;
  canMoney: boolean;
}) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [panel, setPanel] = useState<LabService | 'new' | null>(null);
  const [busy, setBusy] = useState<string>();
  const rows = lab.services.filter((service) => showInactive || service.active);
  const inactive = lab.services.length - lab.services.filter((s) => s.active).length;
  const columns = `minmax(0,1fr)${canMoney ? ' 110px' : ''} 190px 90px${canManage ? ' 170px' : ''}`;

  const toggle = async (service: LabService) => {
    setBusy(service.id);
    try {
      await updateLabService(lab.id, service.id, { active: !service.active });
      await invalidateLabs(queryClient);
      toast(
        service.active
          ? t('labs:service.deactivated', { name: service.name })
          : t('labs:service.reactivated', { name: service.name }),
        { tone: 'success' },
      );
    } catch (failure) {
      toast(apiErrorMessage(failure, i18n), { tone: 'danger' });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {inactive > 0 && (
          <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
            <Switch
              checked={showInactive}
              onCheckedChange={setShowInactive}
              label={t('labs:service.showInactive', { count: inactive })}
            />
            {t('labs:service.showInactive', { count: inactive })}
          </label>
        )}
        {canManage && (
          <Button
            variant="primary"
            className="ms-auto"
            onClick={() => {
              setPanel('new');
            }}
          >
            {t('labs:service.add')}
          </Button>
        )}
      </div>
      <TableCard minWidth={canManage ? 620 : 420}>
        <div role="table" aria-label={t('labs:lab.services')}>
          <TableHead
            columns={columns}
            labels={[
              t('labs:service.name'),
              ...(canMoney
                ? [
                    <span key="price" className="block text-end">
                      {t('labs:service.price')}
                    </span>,
                  ]
                : []),
              // Clear of the right-aligned price before it.
              <span key="turnaround" className={cn(canMoney && 'block ps-6')}>
                {t('labs:service.turnaround')}
              </span>,
              t('labs:labsTab.columns.status'),
              ...(canManage
                ? [
                    <span key="actions" className="sr-only">
                      {t('labs:labPage.actions')}
                    </span>,
                  ]
                : []),
            ]}
          />
          {rows.length === 0 ? (
            <EmptyState title={t('labs:lab.noServices')} body={t('labs:service.emptyBody')} />
          ) : (
            rows.map((service) => (
              <div
                key={service.id}
                role="row"
                className={cn(
                  'grid min-h-12 items-center gap-2.5 border-t border-row-divider px-3 text-[13px]',
                  !service.active && 'text-ink-muted',
                )}
                style={{ gridTemplateColumns: columns }}
              >
                <span role="cell" className="truncate font-medium">
                  {service.name}
                </span>
                {canMoney && (
                  <span role="cell" dir="ltr" className={FIGURE}>
                    {service.price !== null
                      ? formatMoney({ amount: service.price, currency: service.currency }, locale)
                      : '—'}
                  </span>
                )}
                <span role="cell" className={cn(canMoney && 'ps-6')}>
                  {service.turnaroundDays !== null ? (
                    t('labs:labPage.turnaround', { count: service.turnaroundDays })
                  ) : (
                    <span className="text-ink-muted">
                      {t('labs:service.standard', { count: lab.turnaroundDays })}
                    </span>
                  )}
                </span>
                <span role="cell">
                  <Pill tone={service.active ? 'success' : 'neutral'}>
                    {service.active ? t('labs:labsTab.active') : t('labs:labsTab.inactive')}
                  </Pill>
                </span>
                {canManage && (
                  <span role="cell" className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('labs:service.editNamed', { name: service.name })}
                      onClick={() => {
                        setPanel(service);
                      }}
                    >
                      {t('labs:labPage.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      busy={busy === service.id}
                      onClick={() => void toggle(service)}
                    >
                      {service.active ? t('labs:lab.deactivate') : t('labs:lab.reactivate')}
                    </Button>
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </TableCard>
      {canManage && (
        <p className="m-0 mt-2 text-[12px] text-ink-muted">{t('labs:lab.priceHint')}</p>
      )}
      {panel && (
        <LabServicePanel
          lab={lab}
          tenant={tenant}
          {...(panel === 'new' ? {} : { service: panel })}
          onClose={() => {
            setPanel(null);
          }}
        />
      )}
    </>
  );
}

/** This lab's orders, open by default; a row opens the order over the page. */
function OrdersTab({ lab, onOpen }: { lab: Lab; onOpen: (id: string) => void }) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const itemText = useItemText();
  const [all, setAll] = useState(false);
  const list = useQuery({
    ...labOrdersQuery({ labId: lab.id, status: all ? undefined : 'open' }),
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.items ?? [];
  const columns = '84px minmax(120px,1fr) minmax(140px,1.4fr) 176px 92px 92px';
  const date = (value: string | null) => (value ? formatCalendarDate(value, locale) : '—');

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label={t('labs:orders.status')}
          value={all ? 'all' : ''}
          options={[
            { value: '', label: t('labs:orders.open') },
            { value: 'all', label: t('labs:orders.allStatuses') },
          ]}
          onChange={(value) => {
            setAll(value === 'all');
          }}
        />
        <Link
          to="/lab"
          search={{ lab: lab.id, ...(all ? { status: 'all' as const } : {}) }}
          className="ms-auto text-[12.5px] font-medium text-primary hover:underline"
        >
          {t('labs:labPage.allOrders')}
        </Link>
      </div>
      <TableCard minWidth={720}>
        <div role="table" aria-label={t('labs:tabs.orders')} aria-busy={list.isPlaceholderData}>
          <TableHead
            columns={columns}
            labels={[
              t('labs:orders.columns.number'),
              t('labs:orders.columns.patient'),
              t('labs:orders.columns.items'),
              t('labs:orders.columns.status'),
              t('labs:orders.columns.sent'),
              t('labs:orders.columns.expected'),
            ]}
          />
          {list.isPending ? (
            <SkeletonRows columns={columns} label={t('labs:loading')} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={t('labs:labPage.noOrders')}
              body={all ? t('labs:labPage.noOrdersBody') : t('labs:labPage.noOpenOrdersBody')}
            />
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                role="row"
                className="grid min-h-12 cursor-pointer items-center gap-2.5 border-t border-row-divider px-3 text-[13px] hover:bg-faint"
                style={{ gridTemplateColumns: columns }}
                onClick={() => {
                  onOpen(row.id);
                }}
              >
                <span role="cell" dir="ltr" className="font-mono text-[12.5px]">
                  {orderNumber(row)}
                </span>
                <span role="cell" className="truncate font-medium">
                  {row.patient.fullName}
                </span>
                <span role="cell" className="truncate">
                  {row.items.map(itemText).join(', ')}
                </span>
                <span role="cell">
                  {row.label ? (
                    <LabOrderLabelPill label={row.label} />
                  ) : (
                    <Pill tone="neutral">{t(`labs:status.${row.status}`)}</Pill>
                  )}
                </span>
                <span role="cell">{date(row.sentOn)}</span>
                <span role="cell" className={cn(row.label?.kind === 'late' && 'text-danger')}>
                  {date(row.expectedOn)}
                </span>
              </div>
            ))
          )}
        </div>
      </TableCard>
    </>
  );
}
