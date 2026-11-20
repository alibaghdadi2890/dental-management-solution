import {
  changeOf,
  type DashboardQuery,
  type OperationalAppointments,
  ratio,
  type ResolvedPeriod,
  type Session,
  VISIT_TYPES,
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
  HeatGrid,
  OUTCOME,
  rampOf,
  SegmentedBar,
  SERIES,
} from '@/components/charts';
import { ChangeChip, FigureTile } from '@/components/ui/figure-tile';
import type { GoodWhen } from '@/components/ui/figure-tone';
import { formatCount, formatDayMonth, formatPercent, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { stateOf, tileState } from './card-state';
import { formatSpan } from './format-span';
import { cardQuery } from './dashboards-api';
import * as drill from './drill';
import { monthLabel, monthTitle, weekdayLabel } from './months';

type Counts = OperationalAppointments['counts']['current'];
const OUTCOMES = ['completed', 'cancelled', 'noShow', 'unresolved'] as const;
type AttentionKey =
  | 'unresolved'
  | 'openVisits'
  | 'acceptedUnbooked'
  | 'followUpsOverdue'
  | 'openingsToFill'
  | 'labLate'
  | 'labArrived'
  | 'stockOut'
  | 'stockLow'
  | 'stockExpired'
  | 'incomplete';
type SortKey =
  | 'name'
  | 'visits'
  | 'bookedMinutes'
  | 'avgVisitMinutes'
  | 'noShowRate'
  | 'acceptance'
  | 'medianWaitMinutes';

/**
 * The Operational tab (feature 19, Part C): how the schedule, the chairs, the patients, the plans
 * and the labs are doing — counts, rates and times, never money. Plan figures and registrations
 * belong to no branch: with a branch they step aside.
 */
export function OperationalTab({
  session,
  query,
  period,
}: {
  session: Session;
  query: DashboardQuery;
  period: ResolvedPeriod;
}) {
  const { t, i18n } = useTranslation('dashboards');
  const { t: clinicalT } = useTranslation('clinical');
  const navigate = useNavigate();
  const locale = i18n.language;
  const can = (permission: Session['permissions'][number]) =>
    session.permissions.includes(permission);
  const branch = query.branchId !== undefined;
  const aside = t('allBranchesOnly');
  const span = { from: period.from, to: period.to };
  const today = session.tenant ? todayIn(session.tenant.timeZone) : span.to;

  const appointments = useQuery(cardQuery('operational/appointments', query));
  const visits = useQuery(cardQuery('operational/visits', query));
  const patients = useQuery(cardQuery('operational/patients', query));
  const plans = useQuery({ ...cardQuery('operational/plans', query), enabled: !branch });
  const attention = useQuery(cardQuery('operational/attention', query));
  const busy = useQuery(cardQuery('operational/busy-hours', query));
  const dentists = useQuery(cardQuery('operational/dentists', query));
  const labs = useQuery({
    ...cardQuery('operational/labs', query),
    enabled: can('lab:read') && !branch && query.dentistId === undefined,
  });
  const followUps = useQuery(cardQuery('operational/follow-ups', query));
  const [busyView, setBusyView] = useState<'booked' | 'noShows'>('booked');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'visits', desc: true });

  const count = (value: number) => formatCount(value, locale);
  const pct = (value: number | null) => formatPercent(value, locale);
  const minutes = (value: number | null) =>
    value === null ? '—' : t('minutes', { count: Math.round(value) });
  const against = t('vs', { span: formatSpan(period.compare, locale) });
  const chip = (current: number | null, previous: number | null, goodWhen: GoodWhen) => (
    <ChangeChip change={changeOf(current, previous)} goodWhen={goodWhen} against={against} />
  );
  const a = appointments.data;
  const v = visits.data;
  const pa = patients.data;
  const pl = plans.data;
  const rateOf = (counts: Counts, key: 'noShow' | 'cancelled') => ratio(counts[key], counts.due);
  const weekSpark = (key: 'noShow' | 'cancelled') =>
    a && {
      color: OUTCOME[key],
      points: a.weeks.map((week) => ({
        label: formatDayMonth(week.week, locale),
        value: rateOf(week, key),
        display: pct(rateOf(week, key)),
      })),
    };
  const roomUse = (which: 'current' | 'previous') =>
    a ? ratio(a.roomUse[which].bookedMinutes, a.roomUse[which].capacityMinutes) : null;
  const acceptance = (which: 'current' | 'previous') =>
    pl ? ratio(pl[which].accepted, pl[which].recorded) : null;

  const tiles: { key: string; node: (first: boolean) => ReactNode }[] = [
    {
      key: 'visits',
      node: (first) => (
        <FigureTile
          label={t('tiles.visits')}
          info={t('info.visits')}
          state={tileState(visits)}
          value={v ? count(v.visits.current) : ''}
          change={v && chip(v.visits.current, v.visits.previous, 'up')}
          spark={
            first && v
              ? {
                  color: SERIES.production,
                  points: v.months.map((row) => ({
                    label: monthTitle(row.month, locale),
                    value: row.visits,
                    display: count(row.visits),
                  })),
                }
              : undefined
          }
          link={drill.linkTo(drill.finishedVisits(span, query))}
          onRetry={() => void visits.refetch()}
        />
      ),
    },
    {
      key: 'noShow',
      node: (first) => (
        <FigureTile
          label={t('tiles.noShowRate')}
          info={t('info.noShowRate')}
          state={tileState(appointments)}
          value={a ? pct(rateOf(a.counts.current, 'noShow')) : ''}
          change={
            a &&
            chip(rateOf(a.counts.current, 'noShow'), rateOf(a.counts.previous, 'noShow'), 'down')
          }
          spark={first ? (weekSpark('noShow') ?? undefined) : undefined}
          link={drill.linkTo(drill.scheduleList(span, query, { status: 'no_show' }))}
          onRetry={() => void appointments.refetch()}
        />
      ),
    },
    {
      key: 'cancelled',
      node: (first) => (
        <FigureTile
          label={t('tiles.cancellationRate')}
          info={t('info.cancellationRate')}
          state={tileState(appointments)}
          value={a ? pct(rateOf(a.counts.current, 'cancelled')) : ''}
          change={
            a &&
            chip(
              rateOf(a.counts.current, 'cancelled'),
              rateOf(a.counts.previous, 'cancelled'),
              'down',
            )
          }
          spark={first ? (weekSpark('cancelled') ?? undefined) : undefined}
          link={drill.linkTo(drill.scheduleList(span, query, { status: 'cancelled' }))}
          onRetry={() => void appointments.refetch()}
        />
      ),
    },
    {
      key: 'new',
      node: (first) => (
        <FigureTile
          label={t('tiles.newPatients')}
          info={t('info.newPatients')}
          state={tileState(patients)}
          value={pa ? count(pa.newPatients.current) : ''}
          change={pa && chip(pa.newPatients.current, pa.newPatients.previous, 'up')}
          spark={
            first && pa
              ? {
                  color: SERIES.production,
                  points: pa.months.map((row) => ({
                    label: monthTitle(row.month, locale),
                    value: row.new,
                    display: count(row.new),
                  })),
                }
              : undefined
          }
          link={drill.linkTo(
            drill.cohort('first_seen', {
              from: span.from,
              to: span.to,
              ...(query.branchId ? { cohortBranch: query.branchId } : {}),
              ...(query.dentistId ? { cohortDentist: query.dentistId } : {}),
            }),
          )}
          onRetry={() => void patients.refetch()}
        />
      ),
    },
    {
      key: 'roomUse',
      node: () => (
        <FigureTile
          label={t('tiles.roomUse')}
          info={t('info.roomUse')}
          state={tileState(appointments)}
          value={pct(roomUse('current'))}
          change={a && chip(roomUse('current'), roomUse('previous'), 'up')}
          link={drill.linkTo(drill.scheduleList(span, query, { due: true }))}
          onRetry={() => void appointments.refetch()}
        />
      ),
    },
    {
      key: 'wait',
      node: () => (
        <FigureTile
          label={t('tiles.wait')}
          info={t('info.wait')}
          state={tileState(visits)}
          value={v ? minutes(v.wait.current.medianMinutes) : ''}
          change={
            v && (
              <>
                {v.wait.current.count > 0 && (
                  <span className="text-[11.5px] text-ink-muted">
                    {t('over15', {
                      share: pct(ratio(v.wait.current.over15, v.wait.current.count)),
                    })}
                  </span>
                )}
                {chip(v.wait.current.medianMinutes, v.wait.previous.medianMinutes, 'down')}
              </>
            )
          }
          link={drill.linkTo(drill.finishedVisits(span, query))}
          onRetry={() => void visits.refetch()}
        />
      ),
    },
    {
      key: 'acceptance',
      node: () => (
        <FigureTile
          label={t('tiles.planAcceptance')}
          info={t('info.planAcceptance')}
          state={branch ? 'aside' : tileState(plans)}
          aside={aside}
          value={pct(acceptance('current'))}
          change={pl && chip(acceptance('current'), acceptance('previous'), 'up')}
          link={drill.linkTo(drill.cohort('proposed', { from: span.from, to: span.to }))}
          onRetry={() => void plans.refetch()}
        />
      ),
    },
    {
      key: 'active',
      node: () => (
        <FigureTile
          label={t('tiles.activePatients')}
          info={t('info.activePatients')}
          now
          state={tileState(patients)}
          value={pa ? count(pa.active) : ''}
          link={drill.linkTo(
            drill.cohort('seen', {
              ...(query.branchId ? { cohortBranch: query.branchId } : {}),
              ...(query.dentistId ? { cohortDentist: query.dentistId } : {}),
            }),
          )}
          onRetry={() => void patients.refetch()}
        />
      ),
    },
  ];

  // --- Appointments by week ---
  const outcomeSeries = OUTCOMES.map((key) => ({
    key,
    label: t(`outcomes.${key}`),
    color: OUTCOME[key],
  }));
  const weekRows = (a?.weeks ?? []).map((week) => ({
    label: formatDayMonth(week.week, locale),
    title: t('weekOf', { date: formatDayMonth(week.week, locale) }),
    values: {
      completed: week.completed,
      cancelled: week.cancelled,
      noShow: week.noShow,
      unresolved: week.unresolved,
    },
  }));
  const weekTable: ChartTable | undefined = a && {
    columns: [t('table.week'), ...outcomeSeries.map((item) => item.label)],
    rows: a.weeks.map((week) => ({
      cells: [formatDayMonth(week.week, locale), ...OUTCOMES.map((key) => count(week[key]))],
    })),
  };

  // --- Needs attention ---
  const at = attention.data;
  const candidates: { key: AttentionKey; value: number | null; target: drill.DrillTarget }[] = at
    ? [
        {
          key: 'unresolved' as const,
          value: at.unresolved,
          target: drill.scheduleList({ from: '2000-01-01', to: today }, query, {
            status: 'unresolved',
          }),
        },
        {
          key: 'openVisits' as const,
          value: at.openVisits,
          target: {
            to: '/visits',
            search: {
              tab: 'in_progress',
              range: 'all',
              branch: query.branchId ?? 'all',
              ...(query.dentistId ? { dentist: query.dentistId } : {}),
            },
          },
        },
        {
          key: 'acceptedUnbooked' as const,
          value: at.acceptedUnbooked,
          target: drill.cohort('accepted_unbooked'),
        },
        { key: 'followUpsOverdue' as const, value: at.followUpsOverdue, target: { to: '/today' } },
        // Today's *Openings to fill* (feature 21, C6): the same count, the same list.
        { key: 'openingsToFill' as const, value: at.openingsToFill, target: { to: '/today' } },
        {
          key: 'labLate' as const,
          value: at.labLate,
          target: {
            to: '/lab',
            search: {
              late: true,
              ...(query.branchId ? { branch: query.branchId } : {}),
              ...(query.dentistId ? { dentist: query.dentistId } : {}),
            },
          },
        },
        {
          key: 'labArrived' as const,
          value: at.labArrivedUnbooked?.count ?? null,
          target: {
            to: '/lab',
            search: { status: 'all', ids: at.labArrivedUnbooked?.orderIds.join(',') ?? '' },
          },
        },
        ...(['stockOut', 'stockLow', 'stockExpired'] as const).map((key) => ({
          key,
          value: at[key],
          target: {
            to: '/inventory',
            search: {
              status: key === 'stockOut' ? 'out' : key === 'stockLow' ? 'low' : 'expired',
              ...(query.branchId ? { branch: query.branchId } : {}),
            },
          },
        })),
        { key: 'incomplete' as const, value: at.incomplete, target: drill.cohort('incomplete') },
      ]
    : [];
  const lines = candidates.flatMap((line) =>
    line.value !== null && line.value > 0 ? [{ ...line, value: line.value }] : [],
  );

  // --- Busy hours ---
  const b = busy.data;
  const cellOf = (weekday: number, hour: number) =>
    b?.cells.find((cell) => cell.weekday === weekday && cell.hour === hour);
  const busyMax = Math.max(
    0,
    ...(b?.cells.map((cell) => (busyView === 'booked' ? cell.booked : cell.noShows)) ?? []),
  );

  // --- Treatment plans ---
  const stages = pl
    ? ([
        ['recorded', pl.current.recorded, null],
        ['accepted', pl.current.accepted, pl.current.recorded],
        ['started', pl.current.started, pl.current.accepted],
        ['completed', pl.current.completed, pl.current.started],
      ] as const)
    : [];

  // --- Dentists ---
  const rows = (dentists.data?.rows ?? []).map((row) => ({
    ...row,
    noShowRate: ratio(row.noShows, row.due),
    acceptance: ratio(row.plansAccepted, row.plansRecorded),
  }));
  const sorted = [...rows].sort((x, y) => {
    const valueOf = (row: (typeof rows)[number]) =>
      sort.key === 'name' ? row.name : (row[sort.key] ?? -1);
    const left = valueOf(x);
    const right = valueOf(y);
    const order =
      typeof left === 'string' ? left.localeCompare(String(right)) : left - (right as number);
    return sort.desc ? -order : order;
  });
  const columns: { key: SortKey; label: string }[] = [
    { key: 'name', label: t('table.dentist') },
    { key: 'visits', label: t('dentists.visits') },
    { key: 'bookedMinutes', label: t('dentists.bookedHours') },
    { key: 'avgVisitMinutes', label: t('dentists.avgLength') },
    { key: 'noShowRate', label: t('dentists.noShowRate') },
    { key: 'acceptance', label: t('dentists.acceptance') },
    { key: 'medianWaitMinutes', label: t('dentists.wait') },
  ];

  const cards: ReactNode[] = [];
  cards.push(
    <ChartCard
      key="busy"
      className="col-span-12 lg:col-span-6"
      title={t('cards.busyHours')}
      info={t('info.busyHours')}
      state={stateOf(busy, (data) => data.cells.length === 0)}
      action={
        <span className="flex rounded-md border border-border-control p-0.5 text-[11.5px]">
          {(['booked', 'noShows'] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={busyView === view}
              onClick={() => {
                setBusyView(view);
              }}
              className={cn(
                'cursor-pointer rounded-[4px] px-2 py-0.5',
                busyView === view ? 'bg-subtle font-medium text-ink' : 'text-ink-muted',
              )}
            >
              {t(`switch.${view}`)}
            </button>
          ))}
        </span>
      }
      table={
        b && {
          columns: [t('table.hour'), ...b.weekdays.map((weekday) => weekdayLabel(weekday, locale))],
          rows: b.hours.map((hour) => ({
            cells: [
              `${String(hour).padStart(2, '0')}:00`,
              ...b.weekdays.map((weekday) => {
                const cell = cellOf(weekday, hour);
                return count(busyView === 'booked' ? (cell?.booked ?? 0) : (cell?.noShows ?? 0));
              }),
            ],
          })),
        }
      }
      exportName="busy-hours"
      canExport
    >
      {b && (
        <HeatGrid
          columns={b.weekdays.map((weekday) => ({
            key: String(weekday),
            label: weekdayLabel(weekday, locale),
          }))}
          rows={b.hours.map((hour) => ({
            key: String(hour),
            label: String(hour).padStart(2, '0'),
          }))}
          cell={(hour, weekday) => {
            const cell = cellOf(Number(weekday), Number(hour));
            const value = busyView === 'booked' ? (cell?.booked ?? 0) : (cell?.noShows ?? 0);
            return {
              value,
              display: `${weekdayLabel(Number(weekday), locale)} ${hour}:00 · ${count(value)}`,
              color: rampOf(value, busyMax),
              link:
                value > 0
                  ? drill.linkTo(
                      drill.scheduleList(span, query, {
                        weekday: Number(weekday),
                        hour: Number(hour),
                        due: true,
                        ...(busyView === 'noShows' ? { status: 'no_show' } : {}),
                      }),
                    )
                  : undefined,
            };
          }}
        />
      )}
    </ChartCard>,
  );

  cards.push(
    <ChartCard
      key="plans"
      className="col-span-12 lg:col-span-6"
      title={t('cards.treatmentPlans')}
      info={t('info.treatmentPlans')}
      state={
        branch
          ? { kind: 'aside', text: aside }
          : stateOf(plans, (data) => data.current.recorded === 0)
      }
      table={
        pl && {
          columns: [t('table.stage'), t('table.count'), t('table.passed')],
          rows: stages.map(([key, value, before]) => ({
            cells: [
              t(`stages.${key}`),
              count(value),
              before === null ? '—' : pct(ratio(value, before)),
            ],
          })),
        }
      }
      exportName="treatment-plans"
      canExport
    >
      <div className="grid grid-cols-4 items-end gap-3">
        {stages.map(([key, value, before]) => {
          const max = pl?.current.recorded ?? 0;
          const bar = (
            <span className="flex h-[150px] flex-col justify-end gap-1">
              <span
                dir="ltr"
                className="text-center font-mono text-[13px] font-semibold tabular-nums"
              >
                {count(value)}
              </span>
              <span
                className="mx-auto block w-full max-w-12 rounded-t-[3px]"
                style={{
                  height: `${String(max > 0 ? Math.max(2, (value / max) * 110) : 2)}px`,
                  background: SERIES.production,
                }}
              />
              <span className="text-center text-[11.5px] text-ink-secondary">
                {t(`stages.${key}`)}
              </span>
              <span dir="ltr" className="text-center text-[11px] text-ink-muted">
                {before === null ? ' ' : pct(ratio(value, before))}
              </span>
            </span>
          );
          const target =
            key === 'recorded'
              ? drill.cohort('proposed', { from: span.from, to: span.to })
              : key === 'accepted'
                ? drill.cohort('accepted')
                : null;
          const link = drill.linkTo(target);
          return (
            <div key={key}>
              {link
                ? link(
                    bar,
                    'block rounded-md hover:bg-faint focus-visible:outline-2 focus-visible:outline-ring',
                  )
                : bar}
            </div>
          );
        })}
      </div>
    </ChartCard>,
  );

  cards.push(
    <ChartCard
      key="types"
      className="col-span-12 lg:col-span-6"
      title={t('cards.visitTypes')}
      info={t('info.visitTypes')}
      state={stateOf(visits, (data) => data.types.every((row) => row.count === 0))}
      table={
        v && {
          columns: [t('table.type'), t('table.count'), t('table.booked'), t('table.taken')],
          rows: v.types.map((row) => ({
            cells: [
              clinicalT(`flow.types.${row.type}`),
              count(row.count),
              minutes(row.bookedMinutes),
              minutes(row.takenMinutes),
            ],
          })),
        }
      }
      exportName="visit-types"
      canExport
    >
      {v && (
        <ul className="flex flex-col gap-1">
          {VISIT_TYPES.map((type) => {
            const row = v.types.find((entry) => entry.type === type);
            const max = Math.max(1, ...v.types.map((entry) => entry.count));
            const content = (
              <span className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2.5 px-1 py-1 text-[12.5px]">
                <span className="truncate text-ink-secondary">
                  {clinicalT(`flow.types.${type}`)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-subtle">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${String(((row?.count ?? 0) / max) * 100)}%`,
                        background: SERIES.production,
                      }}
                    />
                  </span>
                  <span dir="ltr" className="w-8 text-end font-mono tabular-nums">
                    {count(row?.count ?? 0)}
                  </span>
                </span>
                <span className="text-[11.5px] whitespace-nowrap text-ink-muted">
                  {t('bookedTaken', {
                    booked: minutes(row?.bookedMinutes ?? null),
                    taken: minutes(row?.takenMinutes ?? null),
                  })}
                </span>
              </span>
            );
            const link =
              row && row.count > 0
                ? drill.linkTo(drill.finishedVisits(span, query, { type }))
                : undefined;
            return (
              <li key={type}>
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
      )}
    </ChartCard>,
  );

  cards.push(
    <ChartCard
      key="patients"
      className="col-span-12 lg:col-span-6"
      title={t('cards.patients')}
      info={t('info.patients')}
      keyItems={[
        { label: t('series.new'), color: SERIES.production },
        { label: t('series.returning'), color: SERIES.collected },
      ]}
      state={stateOf(patients, (data) => data.months.every((row) => row.new + row.returning === 0))}
      table={
        pa && {
          columns: [t('table.month'), t('series.new'), t('series.returning')],
          rows: pa.months.map((row) => ({
            cells: [monthTitle(row.month, locale), count(row.new), count(row.returning)],
          })),
        }
      }
      exportName="patients"
      canExport
    >
      {pa && (
        <div className="flex flex-col gap-3">
          <ColumnChart
            height={160}
            stacked
            rows={pa.months.map((row) => ({
              label: monthLabel(row.month, locale),
              title: monthTitle(row.month, locale),
              values: { new: row.new, returning: row.returning },
            }))}
            series={[
              { key: 'new', label: t('series.new'), color: SERIES.production },
              { key: 'returning', label: t('series.returning'), color: SERIES.collected },
            ]}
            format={count}
            formatTick={count}
            onSelect={(index) => {
              const row = pa.months[index];
              if (!row) return;
              const target = drill.cohort('first_seen', { ...drill.monthSpan(row.month) });
              void navigate({ to: target.to as never, search: target.search as never });
            }}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
            <span className="text-ink-muted">{t('cameBack')}</span>
            <span dir="ltr" className="font-mono font-semibold tabular-nums">
              {pct(ratio(pa.cameBack.returned, pa.cameBack.cohort))}
            </span>
          </div>
          <SegmentedBar
            segments={pa.reasons.map((row, index) => ({
              key: row.reason,
              label:
                row.reason === 'none' ? t('reasons.none') : clinicalT(`flow.types.${row.reason}`),
              value: row.count,
              display: count(row.count),
              color: rampOf(5 - index, 5),
            }))}
          />
        </div>
      )}
    </ChartCard>,
  );

  cards.push(
    <ChartCard
      key="dentists"
      className="col-span-12"
      title={t('cards.dentistsOps')}
      info={t('info.dentistsOps')}
      state={stateOf(dentists, (data) => data.rows.length === 0)}
      table={{
        columns: columns.map((column) => column.label),
        rows: sorted.map((row) => ({
          cells: [
            row.name,
            count(row.visits),
            t('hours', { count: Math.round(row.bookedMinutes / 6) / 10 }),
            minutes(row.avgVisitMinutes),
            pct(row.noShowRate),
            pct(row.acceptance),
            minutes(row.medianWaitMinutes),
          ],
        })),
      }}
      exportName="dentists-operations"
      canExport
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead>
            <tr className="border-b border-inner-divider text-ink-muted">
              {columns.map((column, index) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sort.key === column.key ? (sort.desc ? 'descending' : 'ascending') : 'none'
                  }
                  className={cn('py-1.5 font-medium', index === 0 ? 'text-start' : 'text-end')}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSort((current) => ({
                        key: column.key,
                        desc: current.key === column.key ? !current.desc : column.key !== 'name',
                      }));
                    }}
                    className="cursor-pointer hover:text-ink focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {column.label}
                    {sort.key === column.key && <span aria-hidden>{sort.desc ? ' ↓' : ' ↑'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.profileId}
                className="cursor-pointer border-b border-row-divider last:border-0 hover:bg-faint"
                onClick={() => {
                  const target = drill.finishedVisits(span, query, { dentist: row.profileId });
                  void navigate({ to: target.to as never, search: target.search as never });
                }}
              >
                <th scope="row" className="py-1.5 text-start font-normal">
                  {drill.linkTo(drill.finishedVisits(span, query, { dentist: row.profileId }))?.(
                    row.name,
                    'hover:underline focus-visible:outline-2 focus-visible:outline-ring',
                  )}
                </th>
                {[
                  count(row.visits),
                  t('hours', { count: Math.round(row.bookedMinutes / 6) / 10 }),
                  minutes(row.avgVisitMinutes),
                  pct(row.noShowRate),
                  pct(row.acceptance),
                  minutes(row.medianWaitMinutes),
                ].map((cell, index) => (
                  <td key={index} dir="ltr" className="py-1.5 text-end font-mono tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>,
  );

  if (can('lab:read')) {
    const l = labs.data;
    cards.push(
      <ChartCard
        key="labs"
        className="col-span-12 lg:col-span-6"
        title={t('cards.labs')}
        info={t('info.labs')}
        state={
          branch
            ? { kind: 'aside', text: aside }
            : query.dentistId
              ? { kind: 'aside', text: t('allDentistsOnly') }
              : stateOf(labs, (data) => data.rows.length === 0)
        }
        table={
          l && {
            columns: [t('table.lab'), t('labs.onTime'), t('labs.turnaround'), t('labs.remakes')],
            rows: l.rows.map((row) => ({
              cells: [
                row.name,
                pct(row.onTimeRate),
                t('labs.days', {
                  taken: row.avgTurnaroundDays === null ? '—' : row.avgTurnaroundDays.toFixed(1),
                  promised: row.promisedDays ?? '—',
                }),
                pct(row.remakeRate),
              ],
            })),
          }
        }
        exportName="labs"
        canExport
      >
        {l && (
          <BarList
            max={1}
            items={l.rows.map((row) => ({
              key: row.labId,
              label: row.name,
              value: row.onTimeRate ?? 0,
              display: `${pct(row.onTimeRate)} · ${t('labs.days', {
                taken: row.avgTurnaroundDays === null ? '—' : row.avgTurnaroundDays.toFixed(1),
                promised: row.promisedDays ?? '—',
              })} · ${t('labs.remakeShort', { rate: pct(row.remakeRate) })}`,
              color: SERIES.production,
              link: drill.linkTo({
                to: '/lab',
                search: { tab: 'reports', rfrom: span.from, rto: span.to },
              }),
            }))}
          />
        )}
      </ChartCard>,
    );
  }

  const f = followUps.data;
  cards.push(
    <ChartCard
      key="followUps"
      className="col-span-12 lg:col-span-6"
      title={t('cards.followUps')}
      info={t('info.followUps')}
      state={stateOf(
        followUps,
        (data) => data.booked + data.waiting + data.declined + data.expired === 0,
      )}
      table={
        f && {
          columns: [t('table.state'), t('table.count')],
          rows: (['booked', 'waiting', 'declined', 'expired'] as const).map((key) => ({
            cells: [t(`followUps.${key}`), count(f[key])],
          })),
        }
      }
      exportName="follow-ups"
      canExport
    >
      {f && (
        <SegmentedBar
          segments={(['booked', 'waiting', 'declined', 'expired'] as const).map((key, index) => ({
            key,
            label: t(`followUps.${key}`),
            value: f[key],
            display: count(f[key]),
            color: rampOf(5 - index, 5),
            link: key === 'waiting' ? drill.linkTo({ to: '/today' }) : undefined,
          }))}
        />
      )}
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
        className="col-span-12 lg:col-span-8"
        title={t('cards.appointmentsByWeek')}
        info={t('info.appointmentsByWeek')}
        keyItems={outcomeSeries}
        state={stateOf(appointments, (data) => data.weeks.every((week) => week.due === 0))}
        summary={a ? t('summary.appointments', { due: count(a.counts.current.due) }) : undefined}
        table={weekTable}
        exportName="appointments-by-week"
        canExport
      >
        <ColumnChart
          stacked
          rows={weekRows}
          series={outcomeSeries}
          format={count}
          formatTick={count}
          onSelect={(index) => {
            const week = a?.weeks[index];
            if (!week) return;
            const target = drill.scheduleList(drill.weekSpan(week.week), query, { due: true });
            void navigate({ to: target.to as never, search: target.search as never });
          }}
        />
      </ChartCard>
      <ChartCard
        className="col-span-12 lg:col-span-4"
        title={t('cards.attention')}
        info={t('info.attention')}
        state={stateOf(attention)}
      >
        {lines.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-success">{t('allClear')}</p>
        ) : (
          <ul className="flex flex-col">
            {lines.map((line) => (
              <li key={line.key} className="border-b border-row-divider last:border-0">
                {drill.linkTo(line.target)?.(
                  <span className="flex items-center justify-between gap-3 px-1 py-2 text-[13px]">
                    <span>{t(`attention.${line.key}`)}</span>
                    <span dir="ltr" className="font-mono font-semibold tabular-nums">
                      {count(line.value)}
                    </span>
                  </span>,
                  'block rounded-md hover:bg-faint focus-visible:outline-2 focus-visible:outline-ring',
                )}
              </li>
            ))}
          </ul>
        )}
      </ChartCard>
      {cards}
    </div>
  );
}
