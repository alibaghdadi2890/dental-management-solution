import {
  type AppointmentListQuery,
  appointmentListPageSchema,
  type AppointmentListPage,
} from '@dcm/contracts';
import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/list';
import { useSession } from '@/features/auth/session';
import { actingTenantId } from '@/features/platform/acting-tenant';
import { ApiError, apiFetch } from '@/lib/api';
import { formatCalendarDate, formatCount, formatTime } from '@/lib/format';
import { AppointmentStatusPill } from './appointment-status';
import { schedulingKeys } from './scheduling-api';

/** The List view's filter (feature 19): a dashboard figure's appointments. */
export type ScheduleListFilter = Omit<AppointmentListQuery, 'cursor' | 'limit'>;

const PAGE = 50;
const COLUMNS = 'minmax(9rem,1fr) minmax(10rem,1.4fr) minmax(8rem,1fr) minmax(6rem,0.7fr) 7rem';

function listQuery(filter: ScheduleListFilter) {
  return infiniteQueryOptions({
    queryKey: [...schedulingKeys.all(actingTenantId()), 'list', filter] as const,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      const params = new URLSearchParams({ from: filter.from, to: filter.to, limit: String(PAGE) });
      if (filter.branchId) params.set('branchId', filter.branchId);
      if (filter.dentistId) params.set('dentistId', filter.dentistId);
      if (filter.status) params.set('status', filter.status);
      if (filter.weekday !== undefined) params.set('weekday', String(filter.weekday));
      if (filter.hour !== undefined) params.set('hour', String(filter.hour));
      if (filter.due) params.set('due', 'true');
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch(
        `/scheduling/appointments/list?${params.toString()}`,
        appointmentListPageSchema,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: AppointmentListPage) => page.nextCursor ?? undefined,
  });
}

/**
 * The Schedule's List view (feature 19): the appointments behind a dashboard figure — a period,
 * a status (_unresolved_ derived), a weekday × hour cell — oldest first, with how many in all.
 * Rescheduled bookings are never listed: their successor is. _Back to calendar_ leaves it.
 */
export function ScheduleList({
  filter,
  onClose,
}: {
  filter: ScheduleListFilter;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const locale = i18n.language;
  const timeZone = session?.tenant?.timeZone ?? 'UTC';
  const list = useInfiniteQuery(listQuery(filter));
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total;
  const branch = session?.branches.find((entry) => entry.id === filter.branchId);
  const parts = [
    `${formatCalendarDate(filter.from, locale)} – ${formatCalendarDate(filter.to, locale)}`,
    filter.status ? t(`status.${filter.status}`) : null,
    branch?.name ?? null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="h-full overflow-auto">
      <div className="px-[26px] pt-6 pb-10">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="mb-1 text-[21px] leading-tight font-semibold tracking-[-0.02em]">
              {t('list.title')}
            </h1>
            <p className="text-[13px] text-ink-tertiary">
              {parts.join(' · ')}
              {total !== undefined &&
                ` · ${t('list.count', { count: total, formatted: formatCount(total, locale) })}`}
            </p>
          </div>
          <Button variant="outline" onClick={onClose}>
            {t('list.backToCalendar')}
          </Button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <div className="min-w-[720px]">
            <div
              className="grid h-9 items-center gap-2.5 border-b border-border px-3 text-[12px] font-medium text-ink-muted"
              style={{ gridTemplateColumns: COLUMNS }}
            >
              <span>{t('list.when')}</span>
              <span>{t('list.patient')}</span>
              <span>{t('list.dentist')}</span>
              <span>{t('list.room')}</span>
              <span>{t('list.status')}</span>
            </div>
            {list.isPending && (
              <SkeletonRows columns={COLUMNS} rows={6} label={t('list.loading')} />
            )}
            {list.isError && (
              <ErrorState
                title={t('list.errorTitle')}
                body={t('list.errorBody')}
                requestId={list.error instanceof ApiError ? list.error.requestId : undefined}
                error={list.error}
                onRetry={() => void list.refetch()}
              />
            )}
            {list.isSuccess && items.length === 0 && (
              <EmptyState title={t('list.emptyTitle')} body={t('list.emptyBody')} />
            )}
            {items.map((appointment) => (
              <div
                key={appointment.id}
                className="grid min-h-12 items-center gap-2.5 border-t border-row-divider px-3 py-2 text-[13px] first:border-t-0"
                style={{ gridTemplateColumns: COLUMNS }}
              >
                <span dir="ltr" className="font-mono text-[12.5px] tabular-nums [text-align:start]">
                  {formatCalendarDate(appointment.localDate, locale)}{' '}
                  {formatTime(appointment.startsAt, { timeZone, locale })}
                </span>
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: appointment.patient.id }}
                  className="truncate font-medium hover:underline"
                >
                  {appointment.patient.fullName}
                </Link>
                <span className="truncate text-ink-secondary">{appointment.dentistName}</span>
                <span className="truncate text-ink-secondary">{appointment.roomName ?? '—'}</span>
                <span>
                  <AppointmentStatusPill appointment={appointment} />
                </span>
              </div>
            ))}
          </div>
        </div>
        {list.hasNextPage && (
          <div className="mt-3 flex justify-center">
            <Button
              variant="outline"
              busy={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t('list.more')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
