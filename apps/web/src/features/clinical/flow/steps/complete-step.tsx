import { fromCents, type PatientChart, toCents, type Visit } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/features/auth/use-permission';
import { balanceQuery } from '@/features/billing/billing-api';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DiscountControl } from '../../workspace/discount-control';
import { NotesCard } from '../../workspace/notes-card';
import { TodaysServices } from '../../workspace/todays-services';
import { useLiveMoney, useVisitDiscount } from '../../workspace/visit-discount';
import { STEP_BODY } from '../flow-styles';
import { type ThisVisitSummary, thisVisitSummary } from '../this-visit-summary';
import { useTargetLabel } from '../use-target-label';

const ROW = 'flex items-baseline justify-between gap-3';
const FIGURE = 'font-mono leading-none tabular-nums';

/**
 * **Complete** (feature 10, V10), every visit's last step: the **This visit** block — what was
 * recorded, added to the plan, done today and what continues next visit, a part with nothing
 * left out — then Today's services, the clinical notes, the discount and totals, what the
 * patient owes with this visit, and what the next visit is for. The footer's **Complete visit**
 * runs the completion as ever; nothing here changes what is charged.
 */
export function CompleteStep({
  visit,
  chart,
  canWrite,
  onAddService,
}: {
  visit: Visit;
  chart: PatientChart | undefined;
  canWrite: boolean;
  onAddService: () => void;
}) {
  const { t } = useTranslation('clinical');
  const target = useTargetLabel();
  const summary = chart ? thisVisitSummary(visit, chart) : null;
  const next = summary?.next;
  return (
    <div data-step="complete" className={STEP_BODY}>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)]">
        <div className="flex min-w-0 flex-col">
          {summary && !summary.empty && <ThisVisit summary={summary} />}
          <TodaysServices visit={visit} chart={chart} canWrite={canWrite} onAdd={onAddService} />
          <NotesCard visit={visit} canWrite={canWrite} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Totals visit={visit} canWrite={canWrite} />
          {(visit.status === 'in_progress' || visit.status === 'paused') && (
            <Outstanding visit={visit} />
          )}
          {summary && (
            <p className="m-0 px-0.5 text-[13px] leading-[1.45] text-ink-secondary">
              {t('flow.complete.next')}{' '}
              <strong className="font-semibold text-ink">
                {next
                  ? t(`flow.complete.nextOf.${next.kind}`, {
                      name: next.plan.name,
                      target: target(next.plan),
                    })
                  : t('flow.complete.nextNone')}
              </strong>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ThisVisit({ summary }: { summary: ThisVisitSummary }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const target = useTargetLabel();
  const parts: { key: string; label: string; head: string; lines: ReactNode }[] = [];
  const line = (key: string, where: string, text: string) => (
    <span key={key} className="flex gap-2.5 text-[12.5px] leading-[1.4] text-ink-secondary">
      <span dir="ltr" className="w-[38px] flex-none font-mono font-bold text-primary">
        {where}
      </span>
      {text}
    </span>
  );
  if (summary.recorded.length > 0) {
    parts.push({
      key: 'recorded',
      label: t('flow.complete.recorded'),
      head: t('flow.complete.diagnoses', { count: summary.recorded.length }),
      lines: summary.recorded.map((record) => line(record.id, target(record), record.name)),
    });
  }
  if (summary.planned.total) {
    parts.push({
      key: 'planned',
      label: t('flow.complete.planned'),
      head: t('flow.complete.plannedHead', {
        items: t('flow.phase.items', { count: summary.planned.plans.length }),
        total: formatMoney(summary.planned.total, locale),
      }),
      lines: null,
    });
  }
  if (summary.done.count > 0) {
    parts.push({
      key: 'done',
      label: t('flow.complete.done'),
      head: t('flow.complete.doneHead', {
        services: t('money.services', { count: summary.done.count }),
        total: formatMoney(summary.done.total, locale),
      }),
      lines: null,
    });
  }
  if (summary.continues.length > 0) {
    parts.push({
      key: 'continues',
      label: t('flow.complete.continues'),
      head: summary.continues
        .map(({ plan }) => `${target(plan)} ${plan.name}`)
        .join(t('title.listSeparator')),
      lines: summary.continues.map(({ plan, session }) =>
        line(plan.id, target(plan), t('flow.complete.sessionNoCharge', { number: session })),
      ),
    });
  }
  return (
    <section
      aria-label={t('flow.complete.thisVisit')}
      className="mb-4 overflow-hidden rounded-xl border border-border bg-surface"
    >
      <div className="border-b border-inner-divider px-[18px] py-3.5">
        <h2 className="m-0 text-[14px] leading-none font-semibold">
          {t('flow.complete.thisVisit')}
        </h2>
      </div>
      <dl className="m-0">
        {parts.map((part, index) => (
          <div
            key={part.key}
            data-part={part.key}
            className={cn(
              'grid grid-cols-[150px_minmax(0,1fr)] gap-3 px-[18px] py-3',
              index > 0 && 'border-t border-row-divider',
            )}
          >
            <dt className="text-[12.5px] leading-[1.4] font-medium text-ink-muted">{part.label}</dt>
            <dd className="m-0 flex min-w-0 flex-col gap-1.5">
              <span className="text-[13px] leading-[1.4] font-semibold">{part.head}</span>
              {part.lines}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The discount and totals card: the financial bar's figures, for the step layout. */
function Totals({ visit, canWrite }: { visit: Visit; canWrite: boolean }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const discount = useVisitDiscount(visit);
  const money = useLiveMoney(visit, discount.value);
  const format = (amount: string) => formatMoney({ amount, currency: visit.currency }, locale);
  const discounted = toCents(money.discount) > 0n;
  return (
    <section
      aria-label={t('workspace.money')}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-[18px] py-4"
    >
      <div className={ROW}>
        <span className="text-[13px] leading-none text-ink-secondary">{t('money.subtotal')}</span>
        <span dir="ltr" className={cn(FIGURE, 'text-[13px] font-semibold')}>
          {format(money.subtotal)}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-[13px] leading-none text-ink-secondary">{t('money.discount')}</span>
        <span className="flex items-center gap-2">
          <DiscountControl discount={discount} currency={visit.currency} readOnly={!canWrite} />
          <span
            dir="ltr"
            className={cn(
              FIGURE,
              'min-w-[64px] text-end text-[13px] font-medium',
              discounted ? 'text-danger' : 'text-ink-muted',
            )}
          >
            {format(discounted ? `-${money.discount}` : money.discount)}
          </span>
        </span>
      </div>
      {money.capped && (
        <p
          role="alert"
          className="m-0 rounded-md border border-danger-border bg-danger-bg px-2.5 py-1.5 text-[11.5px] leading-[1.3] font-medium text-danger"
        >
          {t('money.capped')}
        </p>
      )}
      <div className={cn(ROW, 'border-t border-inner-divider pt-3')}>
        <span className="text-[13.5px] leading-none font-semibold">{t('money.total')}</span>
        <span dir="ltr" className={cn(FIGURE, 'text-[21px] font-bold tracking-[-0.02em]')}>
          {format(money.total)}
        </span>
      </div>
    </section>
  );
}

/**
 * What the patient owes once this visit is charged: this visit, what was owed before, and the
 * sum. From the balance (`payment:read`; nothing without it), in the visit's currency. Only for
 * a live visit: once completed, its charge is in the balance already.
 */
function Outstanding({ visit }: { visit: Visit }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const canRead = usePermission('payment:read');
  const balance = useQuery({ ...balanceQuery(visit.patientId), enabled: canRead });
  const discount = useVisitDiscount(visit);
  const money = useLiveMoney(visit, discount.value);
  if (!canRead || !balance.data) return null;
  const previous =
    balance.data.balances.find((entry) => entry.currency === visit.currency)?.amount ?? '0.00';
  const format = (amount: string) => formatMoney({ amount, currency: visit.currency }, locale);
  const total = fromCents(toCents(previous) + toCents(money.total));
  return (
    <section
      aria-label={t('flow.complete.outstanding')}
      className="flex flex-col gap-2.5 rounded-xl border border-border bg-faint px-[18px] py-4"
    >
      <div className={ROW}>
        <span className="text-[13px] leading-none text-ink-secondary">
          {t('flow.complete.thisVisit')}
        </span>
        <span dir="ltr" className={cn(FIGURE, 'text-[13px] font-semibold')}>
          {format(money.total)}
        </span>
      </div>
      <div className={ROW}>
        <span className="text-[13px] leading-none text-ink-secondary">
          {t('flow.complete.previous')}
        </span>
        <span dir="ltr" className={cn(FIGURE, 'text-[13px] font-semibold')}>
          {format(previous)}
        </span>
      </div>
      <div className={cn(ROW, 'border-t border-border-control pt-2.5')}>
        <span className="text-[13.5px] leading-none font-semibold">
          {t('flow.complete.outstanding')}
        </span>
        <span
          dir="ltr"
          className={cn(
            FIGURE,
            'text-[19px] font-bold',
            toCents(total) > 0n ? 'text-danger' : 'text-ink',
          )}
        >
          {format(total)}
        </span>
      </div>
    </section>
  );
}
