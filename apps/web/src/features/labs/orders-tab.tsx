import { LAB_ORDER_STATUSES, type Session } from '@dcm/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast-context';
import { useStaffNames } from '@/features/users/use-staff-names';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { LabOrderLabelPill } from './lab-order-label';
import { filterOf, type LabSearch } from './lab-search';
import { orderNumber, useItemText } from './lab-words';
import {
  downloadLabOrders,
  invalidateLabs,
  labOrdersQuery,
  labsQuery,
  receiveLabOrders,
} from './labs-api';

const COLUMNS =
  '28px 84px minmax(130px,1.2fr) minmax(120px,1fr) minmax(160px,1.6fr) 176px 88px 88px 100px';

/**
 * The clinic's lab orders (C2): open ones by default, filtered by status, lab, dentist, branch,
 * late only, period and a search that finds an order number or a patient at once. Several
 * orders can be marked received together, so an arriving parcel takes seconds. CSV export.
 */
export function OrdersTab({
  session,
  search,
  onSearch,
  canManage,
  onNew,
}: {
  session: Session;
  search: LabSearch;
  onSearch: (patch: Partial<LabSearch>) => void;
  canManage: boolean;
  onNew: () => void;
}) {
  const { t, i18n } = useTranslation(['labs', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const tenant = session.tenant;
  const filter = filterOf(search);
  const list = useQuery({ ...labOrdersQuery(filter), placeholderData: keepPreviousData });
  const labs = useQuery(labsQuery(true));
  const staff = useStaffNames();
  const itemText = useItemText();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const receivable = rows.filter((row) => row.status === 'at_lab');
  const chosen = receivable.filter((row) => selected.has(row.id));
  if (!tenant) return null;
  const today = todayIn(tenant.timeZone);
  const date = (value: string | null) => (value ? formatCalendarDate(value, locale) : '—');

  const receive = async () => {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    try {
      await receiveLabOrders({ orderIds: chosen.map((row) => row.id), receivedOn: today });
      await invalidateLabs(queryClient);
      setSelected(new Set());
      toast(t('labs:order.updated'), { tone: 'success' });
    } catch (failure) {
      toast(apiErrorMessage(failure, i18n), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={search.q ?? ''}
          onChange={(value) => {
            onSearch({ q: value === '' ? undefined : value });
          }}
          placeholder={t('labs:orders.search')}
          label={t('labs:orders.search')}
          maxLength={100}
        />
        <FilterChip
          label={t('labs:orders.status')}
          value={search.status ?? ''}
          options={[
            { value: '', label: t('labs:orders.open') },
            { value: 'all', label: t('labs:orders.allStatuses') },
            ...LAB_ORDER_STATUSES.map((value) => ({ value, label: t(`labs:status.${value}`) })),
          ]}
          onChange={(value) => {
            onSearch({
              status:
                value === 'all' ? 'all' : LAB_ORDER_STATUSES.find((status) => status === value),
            });
          }}
        />
        <FilterChip
          label={t('labs:orders.lab')}
          value={search.lab ?? ''}
          options={[
            { value: '', label: t('labs:orders.allLabs') },
            ...(labs.data ?? []).map((lab) => ({ value: lab.id, label: lab.name })),
          ]}
          onChange={(value) => {
            onSearch({ lab: value || undefined });
          }}
        />
        <FilterChip
          label={t('labs:orders.dentist')}
          value={search.dentist ?? ''}
          options={[
            { value: '', label: t('labs:orders.allDentists') },
            ...(staff.practitioners ?? []).map((item) => ({
              value: item.id,
              label: item.displayName,
            })),
          ]}
          onChange={(value) => {
            onSearch({ dentist: value || undefined });
          }}
        />
        {session.branches.length > 1 && (
          <FilterChip
            label={t('labs:orders.branch')}
            value={search.branch ?? ''}
            options={[
              { value: '', label: t('labs:orders.allBranches') },
              ...session.branches.map((branch) => ({ value: branch.id, label: branch.name })),
            ]}
            onChange={(value) => {
              onSearch({ branch: value || undefined });
            }}
          />
        )}
        <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
          <Switch
            checked={search.late === true}
            onCheckedChange={(checked) => {
              onSearch({ late: checked ? true : undefined });
            }}
            label={t('labs:orders.lateOnly')}
          />
          {t('labs:orders.lateOnly')}
        </label>
        <span className="ms-auto flex gap-2">
          {canManage && chosen.length > 0 && (
            <Button variant="outline" busy={busy} onClick={() => void receive()}>
              {t('labs:orders.receiveSelected', { count: chosen.length })}
            </Button>
          )}
          <Button variant="outline" onClick={() => void downloadLabOrders(filter)}>
            {t('labs:orders.export')}
          </Button>
          {canManage && (
            <Button variant="primary" onClick={onNew}>
              {t('labs:orders.new')}
            </Button>
          )}
        </span>
      </div>
      <TableCard minWidth={1060}>
        <div role="table" aria-label={t('labs:tabs.orders')} aria-busy={list.isPlaceholderData}>
          <TableHead
            columns={COLUMNS}
            labels={[
              <span key="select" className="sr-only">
                {t('labs:orders.selectAll')}
              </span>,
              t('labs:orders.columns.number'),
              t('labs:orders.columns.patient'),
              t('labs:orders.columns.lab'),
              t('labs:orders.columns.items'),
              t('labs:orders.columns.status'),
              t('labs:orders.columns.sent'),
              t('labs:orders.columns.expected'),
              t('labs:orders.columns.appointment'),
            ]}
          />
          {list.isPending ? (
            <SkeletonRows columns={COLUMNS} label={t('labs:loading')} />
          ) : list.isError && !list.data ? (
            <ErrorState
              title={t('labs:errorTitle')}
              body={t('labs:errorBody')}
              requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
              error={list.error}
              onRetry={() => void list.refetch()}
            />
          ) : rows.length === 0 ? (
            search.q || search.ids ? (
              <EmptyState
                title={t('labs:orders.noMatch.title')}
                body={t('labs:orders.noMatch.body')}
              />
            ) : (
              <EmptyState title={t('labs:orders.empty.title')} body={t('labs:orders.empty.body')} />
            )
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                role="row"
                className="grid min-h-12 cursor-pointer items-center gap-2.5 border-t border-row-divider px-3 text-[13px] hover:bg-faint"
                style={{ gridTemplateColumns: COLUMNS }}
                onClick={() => {
                  onSearch({ order: row.id });
                }}
              >
                <span
                  role="cell"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  {canManage && row.status === 'at_lab' && (
                    <input
                      type="checkbox"
                      aria-label={t('labs:orders.select', { number: orderNumber(row) })}
                      checked={selected.has(row.id)}
                      onChange={() => {
                        toggle(row.id);
                      }}
                    />
                  )}
                </span>
                <span role="cell" dir="ltr" className="font-mono text-[12.5px]">
                  {orderNumber(row)}
                </span>
                <span role="cell" className="truncate font-medium">
                  {row.patient.fullName}
                </span>
                <span role="cell" className="flex min-w-0 flex-col">
                  <span className="truncate">{row.labName}</span>
                  <span className="truncate text-[12px] text-ink-muted">{row.dentistName}</span>
                </span>
                <span role="cell" className="truncate" title={row.items.map(itemText).join(', ')}>
                  {row.items.map(itemText).join(', ')}
                </span>
                <span
                  role="cell"
                  className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5"
                >
                  {row.label ? (
                    <LabOrderLabelPill label={row.label} />
                  ) : (
                    <Pill tone="neutral">{t(`labs:status.${row.status}`)}</Pill>
                  )}
                  {row.priority === 'urgent' && (
                    <span className="text-[11.5px] font-semibold text-danger">
                      {t('labs:priority.urgent')}
                    </span>
                  )}
                </span>
                <span role="cell">{date(row.sentOn)}</span>
                <span role="cell" className={cn(row.label?.kind === 'late' && 'text-danger')}>
                  {date(row.expectedOn)}
                </span>
                <span role="cell" className="truncate">
                  {row.appointment
                    ? date(row.appointment.localDate)
                    : t('labs:orders.noAppointment')}
                </span>
              </div>
            ))
          )}
        </div>
      </TableCard>
    </>
  );
}
