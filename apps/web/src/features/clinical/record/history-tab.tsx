import type { Patient, ToothCode, VisitBalance, VisitListItem } from '@dcm/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { ErrorState, Pill } from '@/components/ui/list';
import { usePermission } from '@/features/auth/use-permission';
import type { HistoryView } from '@/features/patients/record/record-search';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSurfaceLabel, useToothLabel } from '../chart/use-chart-settings';
import { ToothHistoryDialog } from '../dialogs/tooth-history-dialog';
import { StartVisitPopover } from '../start-visit-popover';
import { patientVisitsQuery, visitBalancesQuery } from '../visits-list/visits-list-api';
import { VisitStatusPill } from '../visits-list/visits-table';
import { ClinicalThreads } from './clinical-threads';

/** One visit of the history: collapsed to a summary line, expanded to its services (tooth
 * links open the tooth's history), notes and money. Voided visits are struck through at 70 %. */
function HistoryRow({
  visit,
  balance,
  canPay,
  locale,
  expanded,
  onToggle,
  onTooth,
}: {
  visit: VisitListItem;
  /** Absent while balances load; a visit without ledger entries reads as nothing owed. */
  balance: Pick<VisitBalance, 'paid' | 'outstanding'> | undefined;
  canPay: boolean;
  locale: string;
  expanded: boolean;
  onToggle: () => void;
  onTooth: (code: ToothCode) => void;
}) {
  const { t } = useTranslation(['clinical', 'visits']);
  const toothLabel = useToothLabel();
  const surfaceLabel = useSurfaceLabel();
  const rowRef = useRef<HTMLLIElement>(null);
  const voided = visit.status === 'voided';
  const money = (amount: string) => formatMoney({ amount, currency: visit.currency }, locale);
  const owes = balance !== undefined && Number(balance.outstanding) > 0;
  // Only a visit expanded from the URL scrolls into view; a later toggle scrolls nothing.
  const [linked] = useState(expanded);
  useEffect(() => {
    if (linked) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [linked]);

  return (
    <li
      ref={rowRef}
      className={cn('rounded-xl border border-border bg-surface', voided && 'opacity-70')}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="grid w-full cursor-pointer grid-cols-[112px_1fr_auto_auto] items-center gap-[18px] px-[18px] py-4 text-start"
      >
        <span className="min-w-0">
          <span className="block font-mono text-[13px] font-semibold">
            {formatCalendarDate(visit.localDate, locale)}
          </span>
          <span className="block truncate text-[12px] text-ink-muted">{visit.dentist.name}</span>
        </span>
        <span className="flex min-w-0 flex-wrap gap-1.5">
          {visit.services.map((service) => (
            <span
              key={service.id}
              className={cn(
                'rounded-md border border-border bg-faint px-2 py-1 text-[12px] leading-none text-ink-secondary',
                voided && 'line-through',
              )}
            >
              {service.toothCode === null
                ? service.name
                : t('visits:history.chip', {
                    name: service.name,
                    tooth: toothLabel(service.toothCode),
                  })}
            </span>
          ))}
        </span>
        <span className="flex items-center gap-2">
          {visit.status !== 'completed' && <VisitStatusPill status={visit.status} />}
          {visit.amendmentCount > 0 && (
            <span className="text-[11.5px] text-ink-muted">
              {t('visits:history.amendedTimes', { count: visit.amendmentCount })}
            </span>
          )}
          {canPay && !voided && balance !== undefined && (
            <Pill tone={owes ? 'warning' : 'success'}>
              {owes ? t('visits:history.unpaid') : t('visits:paid')}
            </Pill>
          )}
        </span>
        <span className="flex items-center gap-3">
          <span className={cn('font-mono text-[14px] font-semibold', voided && 'line-through')}>
            {money(visit.total)}
          </span>
          <svg
            aria-hidden
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className={cn('text-ink-muted transition-transform', expanded && 'rotate-180')}
          >
            <path d="m2 3.5 3 3 3-3" />
          </svg>
        </span>
      </button>
      {expanded && (
        <div className="flex flex-wrap gap-6 border-t border-inner-divider px-[18px] py-4">
          <div className="min-w-0 flex-[2_1_380px]">
            <h3 className="mb-2 text-[12.5px] font-semibold">{t('visits:history.performed')}</h3>
            <ul className="m-0 list-none p-0">
              {visit.services.map((service) => (
                <li
                  key={service.id}
                  className="grid grid-cols-[1fr_72px_96px_88px] items-baseline gap-3 border-t border-inner-divider py-2 text-[12.5px] first:border-t-0"
                >
                  <span>{service.name}</span>
                  {service.toothCode === null ? (
                    <span className="text-ink-muted">{t('visits:panel.jaw')}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (service.toothCode) onTooth(service.toothCode);
                      }}
                      className="cursor-pointer text-start font-mono font-medium text-primary hover:underline"
                    >
                      {toothLabel(service.toothCode)}
                    </button>
                  )}
                  <span className="text-ink-muted">
                    {surfaceLabel.format(service.surfaces) || '—'}
                  </span>
                  <span className="text-end font-mono">{formatMoney(service.final, locale)}</span>
                </li>
              ))}
            </ul>
            {visit.notes.trim() && (
              <>
                <h3 className="mt-3 mb-1.5 text-[12.5px] font-semibold">
                  {t('visits:history.notes')}
                </h3>
                <p className="m-0 text-[12.5px] leading-[1.6] whitespace-pre-line text-ink-secondary">
                  {visit.notes}
                </p>
              </>
            )}
            {voided && (
              <p className="mt-3 text-[12px] text-ink-muted">
                {t('visits:history.voided', { reason: visit.voidReason ?? '' })}
              </p>
            )}
          </div>
          <dl className="m-0 flex min-w-[220px] flex-[1_1_220px] flex-col gap-1 text-[12.5px]">
            <div className="flex justify-between">
              <dt className="text-ink-secondary">{t('visits:panel.subtotal')}</dt>
              <dd className="m-0 font-mono">{money(visit.subtotal)}</dd>
            </div>
            {Number(visit.discountAmount) > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-secondary">{t('visits:panel.discount')}</dt>
                <dd className="m-0 font-mono text-danger">−{money(visit.discountAmount)}</dd>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-divider-strong pt-2">
              <dt className="font-semibold">{t('visits:history.visitTotal')}</dt>
              <dd className="m-0 font-mono text-[16px] font-bold">{money(visit.total)}</dd>
            </div>
            {canPay && !voided && balance !== undefined && (
              <>
                <div className="flex justify-between">
                  <dt className="text-ink-secondary">{t('visits:panel.paid')}</dt>
                  <dd className="m-0 font-mono text-success">{money(balance.paid)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-secondary">{t('visits:history.outstanding')}</dt>
                  <dd className={cn('m-0 font-mono', owes && 'text-danger')}>
                    {money(balance.outstanding)}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </div>
      )}
    </li>
  );
}

function VisitsView({
  patient,
  locale,
  visitId,
  onTooth,
}: {
  patient: Patient;
  locale: string;
  visitId: string | undefined;
  onTooth: (code: ToothCode) => void;
}) {
  const { t } = useTranslation(['visits', 'common']);
  const canPay = usePermission('payment:read');
  const canStart = usePermission('visit:write') && patient.archivedAt === null;
  const visits = useInfiniteQuery(patientVisitsQuery(patient.id));
  const items = visits.data?.pages.flatMap((page) => page.items) ?? [];
  const balances = useQuery(
    visitBalancesQuery(
      items.map((visit) => visit.id),
      canPay,
    ),
  );
  const NOTHING = { paid: '0.00', outstanding: '0.00' };
  const balanceOf = (id: string) =>
    balances.data
      ? (balances.data.find((balance) => balance.visitId === id) ?? NOTHING)
      : undefined;
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(visitId ? [visitId] : []));

  if (visits.isPending) return <CardSkeleton label={t('states.loading')} />;
  if (visits.isError && items.length === 0) {
    return (
      <ErrorState
        title={t('states.errorTitle')}
        body={t('states.errorBody')}
        onRetry={() => void visits.refetch()}
      />
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="m-0 mb-1.5 text-[15px] font-semibold">{t('states.emptyTitle')}</p>
        <p className="m-0 mb-4 text-[13px] text-ink-tertiary">{t('history.emptyBody')}</p>
        {canStart && (
          <StartVisitPopover patientId={patient.id}>
            <Button variant="primary">{t('history.startFirst')}</Button>
          </StartVisitPopover>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {items.map((visit) => (
          <HistoryRow
            key={visit.id}
            visit={visit}
            balance={balanceOf(visit.id)}
            canPay={canPay}
            locale={locale}
            expanded={open.has(visit.id)}
            onToggle={() => {
              const next = new Set(open);
              if (!next.delete(visit.id)) next.add(visit.id);
              setOpen(next);
            }}
            onTooth={onTooth}
          />
        ))}
      </ul>
      {visits.hasNextPage && (
        <Button
          variant="ghost"
          busy={visits.isFetchingNextPage}
          onClick={() => void visits.fetchNextPage()}
          className="self-start"
        >
          {t('history.more')}
        </Button>
      )}
    </div>
  );
}

/**
 * The record's Visits & history tab (4b, L5, D15–D16): a Visits | Clinical switch over the
 * patient's visits (every branch, completed, amended and voided) and their treatment threads.
 * Tooth links open the tooth-history dialog; a thread's date opens its visit in the Visits view.
 */
export function HistoryTab({
  patient,
  locale,
  view,
  visitId,
  onNavigate,
}: {
  patient: Patient;
  locale: string;
  view: HistoryView;
  visitId: string | undefined;
  onNavigate: (next: { view: HistoryView; visitId?: string | undefined }) => void;
}) {
  const { t } = useTranslation('visits');
  const [historyTooth, setHistoryTooth] = useState<ToothCode | null>(null);
  return (
    <div className="flex flex-col gap-3.5">
      <div
        role="group"
        aria-label={t('history.viewLabel')}
        className="flex gap-1 self-start rounded-lg border border-border bg-subtle p-0.5"
      >
        {(['visits', 'clinical'] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => {
              onNavigate({ view: key });
            }}
            className={cn(
              'h-[30px] cursor-pointer rounded-md px-3 text-[12.5px] font-medium',
              view === key ? 'bg-surface text-ink shadow-sm' : 'text-ink-secondary',
            )}
          >
            {t(`history.views.${key}`)}
          </button>
        ))}
      </div>
      {view === 'visits' ? (
        <VisitsView
          key={visitId ?? 'none'}
          patient={patient}
          locale={locale}
          visitId={visitId}
          onTooth={setHistoryTooth}
        />
      ) : (
        <ClinicalThreads
          patientId={patient.id}
          locale={locale}
          onTooth={setHistoryTooth}
          onVisit={(id) => {
            onNavigate({ view: 'visits', visitId: id });
          }}
        />
      )}
      <ToothHistoryDialog
        patientId={patient.id}
        patientName={patient.fullName}
        code={historyTooth}
        onCodeChange={setHistoryTooth}
        canStart={patient.archivedAt === null}
      />
    </div>
  );
}
