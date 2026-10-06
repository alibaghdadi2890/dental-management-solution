import { isOpenPlan, type ToothCode } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSurfaceLabel, useToothLabel } from '../chart/use-chart-settings';
import { chartQuery } from '../visits-api';
import {
  buildThreads,
  matchesFilter,
  type Thread,
  type ThreadFilter,
  type ThreadStep,
} from './build-threads';

const FILTERS: readonly ThreadFilter[] = ['active', 'planned', 'resolved'];

function Step({
  step,
  locale,
  onVisit,
}: {
  step: ThreadStep;
  locale: string;
  onVisit: (visitId: string) => void;
}) {
  const { t } = useTranslation('visits');
  return (
    <li className={cn('flex items-center gap-1.5', step.voided && 'line-through opacity-70')}>
      <span
        aria-hidden
        className={cn(
          'size-[7px] rounded-full',
          step.kind === 'performed' || step.kind === 'resolved'
            ? 'bg-success'
            : step.kind === 'cancelled'
              ? 'bg-border-strong'
              : 'bg-primary',
        )}
      />
      <span className="text-ink-secondary">
        {t(`clinical.step.${step.kind}`, { name: step.name ?? '' })}
      </span>
      {step.visitId === null ? (
        <span className="font-mono text-ink-muted">
          {formatCalendarDate(step.at.slice(0, 10), locale)}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => {
            if (step.visitId !== null) onVisit(step.visitId);
          }}
          className="cursor-pointer font-mono text-primary hover:underline"
        >
          {formatCalendarDate(step.at.slice(0, 10), locale)}
        </button>
      )}
      {step.voided && (
        <span className="text-[11px] text-ink-muted">{t('clinical.voidedVisit')}</span>
      )}
    </li>
  );
}

function ThreadRow({
  thread,
  locale,
  onTooth,
  onVisit,
}: {
  thread: Thread;
  locale: string;
  onTooth: (code: ToothCode) => void;
  onVisit: (visitId: string) => void;
}) {
  const { t } = useTranslation('visits');
  const toothLabel = useToothLabel();
  const surfaceLabel = useSurfaceLabel();
  const openPlan = thread.plans.find(isOpenPlan);
  return (
    <li className="border-t border-inner-divider px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {thread.toothCode === null ? (
          <span className="font-mono text-[12.5px] text-ink-muted">{t('panel.jaw')}</span>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (thread.toothCode) onTooth(thread.toothCode);
            }}
            className="cursor-pointer font-mono text-[13px] font-semibold text-primary hover:underline"
          >
            {toothLabel(thread.toothCode)}
          </button>
        )}
        {thread.surfaces.length > 0 && (
          <span className="font-mono text-[12px] text-ink-muted">
            {surfaceLabel.format(thread.surfaces)}
          </span>
        )}
        <span className="text-[13px] font-medium">{thread.title}</span>
        <span className="ms-auto text-[12px] text-ink-muted">{thread.dentistName}</span>
      </div>
      <ol className="m-0 mt-1.5 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px]">
        {thread.steps.map((step, index) => (
          <Step key={index} step={step} locale={locale} onVisit={onVisit} />
        ))}
      </ol>
      {thread.needsPlan && (
        <p className="m-0 mt-1.5 text-[12px] font-medium text-warning">{t('clinical.noPlan')}</p>
      )}
      {openPlan && (
        <p className="m-0 mt-1.5 text-[12px] text-ink-secondary">
          {t('clinical.next', { name: openPlan.name, price: formatMoney(openPlan.price, locale) })}
        </p>
      )}
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <h3 className="m-0 border-b border-inner-divider px-4 py-3 text-[13px] font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * The Clinical view (4b, D15, Option A): the patient's treatment threads — each problem as one
 * line, diagnosed → planned → performed, with the visit each step happened in (a date opens it in
 * the Visits view) and steps from voided visits struck through. *Needs attention* first (active
 * diagnoses, flagged when no plan is made; plans still open), then *Completed treatment*
 * (collapsed), then *Treatment without a diagnosis or plan* by tooth. Status chips and a tooth
 * select narrow the threads.
 */
export function ClinicalThreads({
  patientId,
  locale,
  onTooth,
  onVisit,
}: {
  patientId: string;
  locale: string;
  onTooth: (code: ToothCode) => void;
  onVisit: (visitId: string) => void;
}) {
  const { t } = useTranslation('visits');
  const toothLabel = useToothLabel();
  const chart = useQuery(chartQuery(patientId));
  const threads = useMemo(() => (chart.data ? buildThreads(chart.data) : null), [chart.data]);
  const [filter, setFilter] = useState<ThreadFilter | null>(null);
  const [tooth, setTooth] = useState<ToothCode | ''>('');
  const [showCompleted, setShowCompleted] = useState(false);

  if (chart.isPending) return <CardSkeleton label={t('clinical.loading')} />;
  if (!threads) {
    return (
      <p role="alert" className="text-[12.5px] text-ink-muted">
        {t('clinical.failed')}
      </p>
    );
  }

  const all = [...threads.needsAttention, ...threads.completed];
  if (all.length === 0 && threads.unplanned.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="m-0 mb-1.5 text-[15px] font-semibold">{t('clinical.emptyTitle')}</p>
        <p className="m-0 text-[13px] text-ink-tertiary">{t('clinical.emptyBody')}</p>
      </div>
    );
  }
  const teeth = [
    ...new Set(
      [
        ...all.map((thread) => thread.toothCode),
        ...threads.unplanned.map((g) => g.toothCode),
      ].filter((code): code is ToothCode => code !== null),
    ),
  ].sort();
  const keep = (thread: Thread) =>
    (filter === null || matchesFilter(thread, filter)) &&
    (tooth === '' || thread.toothCode === tooth);
  const attention = threads.needsAttention.filter(keep);
  const completed = threads.completed.filter(keep);
  const unplanned = threads.unplanned.filter(
    (group) => filter === null && (tooth === '' || group.toothCode === tooth),
  );

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((key) => {
          const on = filter === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setFilter(on ? null : key);
              }}
              className={cn(
                'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium',
                on
                  ? 'border-primary-tint-border bg-primary-tint text-primary'
                  : 'border-border-control bg-surface text-ink-secondary',
              )}
            >
              {t(`clinical.filter.${key}`)}
              <span className="font-mono text-[11.5px]">
                {all.filter((thread) => matchesFilter(thread, key)).length}
              </span>
            </button>
          );
        })}
        <select
          aria-label={t('clinical.tooth')}
          value={tooth}
          onChange={(event) => {
            setTooth(teeth.find((code) => code === event.target.value) ?? '');
          }}
          className="h-8 rounded-lg border border-border-control bg-surface px-2 text-[12.5px]"
        >
          <option value="">{t('clinical.allTeeth')}</option>
          {teeth.map((code) => (
            <option key={code} value={code}>
              {toothLabel(code)}
            </option>
          ))}
        </select>
      </div>
      <Group title={t('clinical.needsAttention', { count: attention.length })}>
        {attention.length > 0 ? (
          <ul className="m-0 list-none p-0">
            {attention.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                locale={locale}
                onTooth={onTooth}
                onVisit={onVisit}
              />
            ))}
          </ul>
        ) : (
          <p className="m-0 px-4 py-3 text-[12.5px] text-ink-muted">{t('clinical.nothingOpen')}</p>
        )}
      </Group>
      {completed.length > 0 && (
        <Group title={t('clinical.completed', { count: completed.length })}>
          {showCompleted ? (
            <ul className="m-0 list-none p-0">
              {completed.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  locale={locale}
                  onTooth={onTooth}
                  onVisit={onVisit}
                />
              ))}
            </ul>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowCompleted(true);
              }}
              className="w-full cursor-pointer px-4 py-3 text-start text-[12.5px] font-medium text-primary hover:underline"
            >
              {t('clinical.showCompleted')}
            </button>
          )}
        </Group>
      )}
      {unplanned.length > 0 && (
        <Group title={t('clinical.unplanned')}>
          <ul className="m-0 list-none p-0">
            {unplanned.map((group) => (
              <li
                key={group.toothCode ?? 'jaw'}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-inner-divider px-4 py-3 first:border-t-0 text-[12.5px]"
              >
                {group.toothCode === null ? (
                  <span className="font-mono text-ink-muted">{t('panel.jaw')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (group.toothCode) onTooth(group.toothCode);
                    }}
                    className="cursor-pointer font-mono font-semibold text-primary hover:underline"
                  >
                    {toothLabel(group.toothCode)}
                  </button>
                )}
                {group.services.map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => {
                      onVisit(service.visitId);
                    }}
                    className={cn(
                      'cursor-pointer text-ink-secondary hover:underline',
                      chart.data?.voidedVisitIds.includes(service.visitId) &&
                        'line-through opacity-70',
                    )}
                  >
                    {t('clinical.serviceOn', {
                      name: service.name,
                      date: formatCalendarDate(service.visitDate, locale),
                    })}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </Group>
      )}
    </div>
  );
}
