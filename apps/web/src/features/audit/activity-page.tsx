import {
  ACTIVITY_AREAS,
  type AuditEntry,
  formatVisitNumber,
  type Session,
  toothCodeSchema,
  toothLabel,
} from '@dcm/contracts';
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Fragment, type ReactNode, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/page';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  FilterChip,
  SearchInput,
  SkeletonRows,
  TableCard,
  TableHead,
} from '@/components/ui/list';
import { openPrintable, printPath } from '@/features/billing/payments-api';
import { useChartSettings } from '@/features/clinical/chart/use-chart-settings';
import { PatientAvatar } from '@/features/patients/patients-table';
import { useStaffNames } from '@/features/users/use-staff-names';
import { ApiError } from '@/lib/api';
import { formatDate, formatMoney, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  activityFeedQuery,
  type FeedFilters,
  patientNamesQuery,
  searchQuery,
  visitNumbersQuery,
} from './activity-api';
import {
  ACTIVITY_RANGES,
  ACTIVITY_SEARCH_DEFAULTS,
  type ActivitySearch,
  isFiltered,
  PLATFORM_ADMIN,
  rangeStart,
  searchTerm,
} from './activity-search';
import { type ChangeWords, changesOf } from './changes';
import { type Lookups, sentenceOf, type Subject } from './sentence';

type Tenant = NonNullable<Session['tenant']>;

const COLUMNS = '150px 200px minmax(300px,1fr) minmax(140px,240px) 36px';
const SEARCH_DEBOUNCE_MS = 300;
/** Stands where the subject goes in a translated sentence, so it can be rendered as a link. */
const SUBJECT = '\u0001';

interface ActivityPageProps {
  search: ActivitySearch;
  onSearch: (next: ActivitySearch, options?: { replace?: boolean }) => void;
  tenant: Tenant;
}

function SearchBox({ value, onCommit }: { value: string; onCommit: (q: string) => void }) {
  const { t } = useTranslation('activity');
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== text.trim()) setText(value);
  }
  const commit = useEffectEvent(onCommit);
  useEffect(() => {
    const next = text.trim();
    if (next === value) return undefined;
    const timer = setTimeout(() => {
      commit(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text, value]);
  return (
    <SearchInput
      value={text}
      onChange={setText}
      placeholder={t('search.placeholder')}
      label={t('search.label')}
      maxLength={100}
    />
  );
}

/**
 * The Activity screen (feature 7, H7): who did what in this clinic, read from the audit log as
 * sentences. Filters live in the URL; the list grows behind "Load more". A row expands to the
 * fields it changed. The names its rows need (patients, visits, staff) are looked up per page of
 * rows; a typed search is resolved to the record it names first, and narrows the feed to it.
 */
export function ActivityPage({ search, onSearch, tenant }: ActivityPageProps) {
  const { t, i18n } = useTranslation(['activity', 'billing', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const { notation } = useChartSettings();
  const { names: staff } = useStaffNames();
  const today = todayIn(tenant.timeZone);

  const term = search.q === undefined ? null : searchTerm(search.q);
  const match = useQuery(searchQuery(term, staff));
  // A search that names nothing shows nothing, rather than everything.
  const noMatch = term !== null && match.isSuccess && match.data === null;
  const filters: FeedFilters = {
    area: search.area,
    ...(search.person === PLATFORM_ADMIN
      ? { platformAdmin: true }
      : { actorUserId: search.person }),
    from: rangeStart(search.range, today, tenant.timeZone),
    patientId: search.patient,
    visitId: search.visit,
    ...match.data,
  };
  const feed = useInfiniteQuery({
    ...activityFeedQuery(filters),
    enabled: term === null || (match.isSuccess && match.data !== null),
  });
  const entries = useMemo(() => feed.data?.pages.flatMap((page) => page.items) ?? [], [feed.data]);

  // One lookup per page of rows, plus the record the screen is narrowed to: a page names at most
  // as many patients and visits as it has rows, and a page already looked up is never asked again
  // when "Load more" brings the next one.
  const idGroups = useMemo(() => {
    const pages = feed.data?.pages ?? [];
    const of = (key: 'patientId' | 'visitId', narrowed: string | undefined) => [
      ...pages.map((page) => page.items.flatMap((entry) => entry[key] ?? [])),
      ...(narrowed ? [[narrowed]] : []),
    ];
    return { patients: of('patientId', search.patient), visits: of('visitId', search.visit) };
  }, [feed.data, search.patient, search.visit]);
  const patients = useQueries({
    queries: idGroups.patients.map((ids) => patientNamesQuery(ids)),
    combine: (results) => results.flatMap((result) => result.data ?? []),
  });
  const visits = useQueries({
    queries: idGroups.visits.map((ids) => visitNumbersQuery(ids)),
    combine: (results) => results.flatMap((result) => result.data ?? []),
  });

  const lookups: Lookups = useMemo(() => {
    // Built at run time from the entry's own words, so they can't be typed resource keys.
    const translate = i18n.t.bind(i18n) as (key: string) => string;
    return {
      patients: new Map(patients.map((patient) => [patient.id, patient])),
      visits: new Map(visits.map((visit) => [visit.visitId, visit])),
      staff,
      money: (amount, currency) => formatMoney({ amount, currency }, locale),
      tooth: (code) => {
        const known = toothCodeSchema.safeParse(code);
        return known.success ? toothLabel(known.data, notation) : code;
      },
      label: (group, value) => {
        const key = {
          method: `billing:methods.${value}`,
          reason: `billing:adjust.reasons.${value}`,
          fileCategory: `files:category.${value}`,
          fileType: `files:subCategory.${value}`,
        }[group];
        return i18n.exists(key) ? translate(key) : value;
      },
    };
  }, [patients, visits, staff, locale, notation, i18n]);

  const set = (patch: Partial<ActivitySearch>) => {
    onSearch({ ...search, ...patch }, { replace: true });
  };
  const staffOptions = [...staff].sort(([, a], [, b]) => a.localeCompare(b, locale));
  const record = lookups.patients.get(search.patient ?? '');
  const visit = lookups.visits.get(search.visit ?? '');

  let body: ReactNode;
  if (noMatch) {
    body = <EmptyState title={t('noMatch.title')} body={t('noMatch.body', { q: search.q })} />;
  } else if (feed.isPending || match.isLoading) {
    body = <SkeletonRows columns={COLUMNS} label={t('loading')} />;
  } else if ((feed.isError && entries.length === 0) || match.isError) {
    const error = feed.error ?? match.error;
    body = (
      <ErrorState
        title={t('error.title')}
        body={t('error.body')}
        requestId={error instanceof ApiError ? error.requestId : undefined}
        onRetry={() => {
          void (match.isError ? match.refetch() : feed.refetch());
        }}
      />
    );
  } else if (entries.length === 0) {
    body = <EmptyState title={t('empty.title')} body={t('empty.body')} />;
  } else {
    body = (
      <div role="rowgroup">
        {entries.map((entry) => (
          <ActivityRow
            key={entry.id}
            entry={entry}
            lookups={lookups}
            tenant={tenant}
            locale={locale}
          />
        ))}
      </div>
    );
  }

  return (
    <Page title={t('title')} subtitle={t('subtitle')}>
      <div role="group" aria-label={t('filters.area')} className="mb-3 flex flex-wrap gap-1.5">
        {[undefined, ...ACTIVITY_AREAS].map((area) => {
          const on = search.area === area;
          return (
            <button
              key={area ?? 'all'}
              type="button"
              aria-pressed={on}
              onClick={() => {
                set({ area });
              }}
              className={cn(
                'h-[30px] cursor-pointer rounded-[15px] border px-3 text-[12.5px] leading-none font-medium',
                on
                  ? 'border-ink bg-ink text-white'
                  : 'border-border-control bg-surface text-ink-secondary hover:border-ink hover:text-ink',
              )}
            >
              {area === undefined ? t('areas.all') : t(`areas.${area}`)}
            </button>
          );
        })}
      </div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <SearchBox
          value={search.q ?? ''}
          onCommit={(q) => {
            set({ q: q === '' ? undefined : q });
          }}
        />
        <FilterChip
          label={t('filters.person')}
          value={search.person ?? ''}
          options={[
            { value: '', label: t('filters.anyone') },
            ...staffOptions.map(([id, name]) => ({ value: id, label: name })),
            { value: PLATFORM_ADMIN, label: t('platformAdmin') },
          ]}
          onChange={(person) => {
            set({ person: person === '' ? undefined : person });
          }}
        />
        <FilterChip
          label={t('filters.date')}
          value={search.range === ACTIVITY_SEARCH_DEFAULTS.range ? '' : search.range}
          options={ACTIVITY_RANGES.map((range) => ({
            value: range === ACTIVITY_SEARCH_DEFAULTS.range ? '' : range,
            label: t(`ranges.${range}`),
          }))}
          onChange={(range) => {
            set({
              range:
                ACTIVITY_RANGES.find((known) => known === range) ?? ACTIVITY_SEARCH_DEFAULTS.range,
            });
          }}
        />
        {(search.patient !== undefined || search.visit !== undefined) && (
          <span className="flex h-9 items-center gap-1.5 rounded-lg border border-primary-tint-border bg-primary-tint ps-[11px] pe-1.5 text-[12.5px] leading-none">
            <span className="text-ink-muted">
              {search.visit !== undefined ? t('filters.visit') : t('filters.patient')}
            </span>
            <span className="font-medium">
              {search.visit !== undefined
                ? visit
                  ? formatVisitNumber(visit.displayNumber)
                  : '…'
                : (record?.fullName ?? '…')}
            </span>
            <button
              type="button"
              aria-label={t('filters.removeRecord')}
              onClick={() => {
                set({ patient: undefined, visit: undefined });
              }}
              className="grid size-6 cursor-pointer place-items-center rounded border-0 bg-transparent text-ink-muted hover:text-ink"
            >
              <svg
                aria-hidden
                width="9"
                height="9"
                viewBox="0 0 10 10"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="m2 2 6 6M8 2 2 8" />
              </svg>
            </button>
          </span>
        )}
        {isFiltered(search) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onSearch({ ...ACTIVITY_SEARCH_DEFAULTS }, { replace: true });
            }}
          >
            {t('clear')}
          </Button>
        )}
      </div>
      <TableCard
        minWidth={880}
        footer={
          entries.length > 0 && !noMatch && (feed.hasNextPage || feed.isFetchNextPageError) ? (
            <div className="flex items-center justify-center gap-3 border-t border-border px-3 py-2.5">
              {feed.isFetchNextPageError && !feed.isFetchingNextPage && (
                <span role="alert" className="text-[12.5px] text-ink-muted">
                  {t('moreFailed')}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                busy={feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}
              >
                {feed.isFetchNextPageError ? t('common:tryAgain') : t('more')}
              </Button>
            </div>
          ) : undefined
        }
      >
        <div role="table" aria-label={t('title')}>
          <TableHead
            columns={COLUMNS}
            labels={[
              t('columns.when'),
              t('columns.who'),
              t('columns.what'),
              t('columns.reason'),
              <span key="expand" className="sr-only">
                {t('columns.details')}
              </span>,
            ]}
          />
          {body}
        </div>
      </TableCard>
    </Page>
  );
}

function SubjectLink({ subject, muted = false }: { subject: Subject; muted?: boolean }) {
  const className = cn(
    'hover:underline',
    muted ? 'text-ink-secondary hover:text-primary' : 'font-semibold text-ink hover:text-primary',
  );
  if (subject.kind === 'patient') {
    return (
      <Link to="/patients/$patientId" params={{ patientId: subject.id }} className={className}>
        {subject.label}
      </Link>
    );
  }
  if (subject.kind === 'visit') {
    return (
      <Link
        to="/visits/$visitId"
        params={{ visitId: subject.id }}
        className={cn(className, 'font-mono')}
      >
        {subject.label}
      </Link>
    );
  }
  if (subject.kind === 'receipt') {
    return (
      <button
        type="button"
        onClick={() => {
          openPrintable(printPath.receipt(subject.paymentId));
        }}
        className={cn(className, 'cursor-pointer border-0 bg-transparent p-0 font-mono')}
      >
        {subject.label}
      </button>
    );
  }
  if (subject.kind === 'file') {
    return (
      <Link
        to="/patients/$patientId"
        params={{ patientId: subject.patientId }}
        search={{ tab: 'files', file: subject.fileId }}
        className={className}
      >
        {subject.label}
      </Link>
    );
  }
  if (subject.kind === 'catalog') {
    return (
      <Link to="/catalog" className={cn(className, 'font-mono')}>
        {subject.label}
      </Link>
    );
  }
  return <span className={muted ? 'text-ink-secondary' : 'font-semibold'}>{subject.label}</span>;
}

function ActivityRow({
  entry,
  lookups,
  tenant,
  locale,
}: {
  entry: AuditEntry;
  lookups: Lookups;
  tenant: Tenant;
  locale: string;
}) {
  const { t, i18n } = useTranslation(['activity', 'common']);
  const [open, setOpen] = useState(false);
  const sentence = sentenceOf(entry, lookups);
  // The key comes from the entry's action, so it can't be one of the typed resource keys.
  const translate = i18n.t.bind(i18n) as (key: string, values: Record<string, string>) => string;
  const key = `activity:actions.${sentence.key}`;
  const [lead = '', tail = ''] = (
    i18n.exists(key)
      ? translate(key, { ...sentence.values, subject: sentence.subject ? SUBJECT : '' })
      : translate('activity:actions.fallback', { ...sentence.values, subject: '' })
  ).split(SUBJECT);

  const system = entry.actorKind === 'job' || entry.actorKind === 'system';
  const name = system
    ? t('system')
    : entry.actorPlatformAdmin
      ? t('platformAdmin')
      : ((entry.actorUserId ? lookups.staff.get(entry.actorUserId) : undefined) ??
        t('formerStaff'));
  const when = new Date(entry.occurredAt);
  const zone = { timeZone: tenant.timeZone, locale };
  const reason = entry.reason === null ? '' : lookups.label('reason', entry.reason);

  return (
    <>
      <div
        role="row"
        className="grid min-h-14 items-center gap-2.5 border-t border-row-divider px-3 py-2 text-[13px] first:border-t-0"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span role="cell" className="font-mono text-[12px] leading-snug text-ink-secondary">
          <span className="block">{formatDate(when, zone)}</span>
          <span className="block text-ink-muted">
            {new Intl.DateTimeFormat(locale, {
              timeZone: tenant.timeZone,
              hour: '2-digit',
              minute: '2-digit',
            }).format(when)}
          </span>
        </span>
        <span role="cell" className="flex min-w-0 items-center gap-2">
          <PatientAvatar name={name} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{name}</span>
            {entry.actorPlatformAdmin && !system && entry.actorKind !== 'agent' && (
              <span className="inline-block rounded-[4px] border border-warning-border bg-warning-bg px-1.5 text-[11px] leading-4 font-medium text-warning">
                {t('adminBadge')}
              </span>
            )}
          </span>
        </span>
        <span role="cell" className="min-w-0 leading-snug">
          {lead}
          {sentence.subject && <SubjectLink subject={sentence.subject} />}
          {tail}
          {sentence.about && (
            <>
              <span className="text-ink-muted">{' · '}</span>
              <SubjectLink subject={sentence.about} muted />
            </>
          )}
        </span>
        <span role="cell" className="min-w-0 truncate text-[12.5px] text-ink-muted" title={reason}>
          {reason}
        </span>
        <span role="cell" className="text-end">
          <button
            type="button"
            aria-expanded={open}
            aria-label={t(open ? 'collapse' : 'expand')}
            onClick={() => {
              setOpen((current) => !current);
            }}
            className="grid size-7 cursor-pointer place-items-center rounded-md border border-transparent bg-transparent text-ink-muted hover:border-border hover:bg-faint hover:text-ink"
          >
            <svg
              aria-hidden
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              className={cn('transition-transform rtl:-scale-x-100', open && 'rotate-90')}
            >
              <path d="m3.5 1.5 3.5 3.5-3.5 3.5" />
            </svg>
          </button>
        </span>
      </div>
      {open && <Changes entry={entry} currency={tenant.currency} locale={locale} />}
    </>
  );
}

function Changes({
  entry,
  currency,
  locale,
}: {
  entry: AuditEntry;
  currency: string;
  locale: string;
}) {
  const { t } = useTranslation(['activity', 'common']);
  const words: ChangeWords = {
    empty: '—',
    yes: t('yes'),
    no: t('no'),
    money: (amount, code) => formatMoney({ amount, currency: code }, locale),
  };
  const changes = changesOf(entry, currency, words);
  return (
    <div role="row" className="border-t border-row-divider bg-faint px-3 py-3 ps-[162px]">
      <div role="cell">
        {changes.length === 0 ? (
          <p className="m-0 text-[12.5px] text-ink-muted">{t('noChanges')}</p>
        ) : (
          <dl className="m-0 grid grid-cols-[minmax(110px,180px)_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            {changes.map((change) => (
              <Fragment key={change.field}>
                <dt className="text-ink-muted">{t(`fields.${change.field}`)}</dt>
                <dd className="m-0 min-w-0 break-words">
                  <span className="text-ink-secondary">{change.before}</span>
                  <span
                    aria-hidden
                    className="mx-1.5 text-ink-muted rtl:inline-block rtl:-scale-x-100"
                  >
                    {'→'}
                  </span>
                  <span className="sr-only">{t('becomes')}</span>
                  <span className="font-medium">{change.after}</span>
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
