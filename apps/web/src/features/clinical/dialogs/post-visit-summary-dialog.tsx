import { toCents, type Visit, type VisitFinancialSummary } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { useVisitSummary } from '@/features/billing/billing-api';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { visitQuery } from '../visits-api';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** Set on the record's entry by the workspace when a visit it had open completes (W16): the
     * record opens that visit's post-visit summary, and clears it on close. */
    postVisit?: string | undefined;
  }
}

const MICRO =
  'm-0 text-[11.5px] leading-none font-medium tracking-[.05em] uppercase [&:lang(ar)]:tracking-normal';
const FIGURE = 'font-mono leading-none tabular-nums';

const owes = (amount: string) => toCents(amount) > 0n;

/**
 * The Post-Visit Financial Summary (spec §Post-Visit Financial Summary, "Visit recorded"), over
 * the record's Overview right after a visit completes (W16). The header: a ✓, the visit's date,
 * duration and service count (the completed visit), and its status pill — **Unpaid** while this
 * visit is owed, **Paid in full** otherwise (partly paid arrives with payments, feature 5). The
 * body's three blocks come from `GET /billing/visits/:id/summary` (W2): This visit, Previous
 * visits and Total outstanding (`danger` while owed, `success` with the settled note when clear).
 * The footer is **Pay later**, or **Done** when nothing is owed; **Record payment** arrives with
 * feature 5. A modal: focus is trapped and `Esc` closes it.
 */
export function PostVisitSummaryDialog({
  visitId,
  onClose,
}: {
  visitId: string;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadein bg-[rgba(27,26,31,.34)]" />
        <Dialog.Content className="fixed start-1/2 top-1/2 z-50 w-[calc(100%-48px)] max-w-[540px] -translate-x-1/2 -translate-y-1/2 animate-popin overflow-hidden rounded-xl bg-surface shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2">
          <PostVisitContent visitId={visitId} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PostVisitContent({ visitId }: { visitId: string }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const visit = useQuery(visitQuery(visitId));
  const summary = useVisitSummary(visitId);
  const owing = summary.data ? owes(summary.data.totalOutstanding) : false;

  let body: ReactNode;
  if (visit.data && summary.data) {
    body = <Figures visit={visit.data} summary={summary.data} />;
  } else if (visit.isError || summary.isError) {
    body = (
      <p role="alert" className="m-0 py-6 text-center text-[12.5px] leading-snug text-ink-muted">
        {t('postVisit.failed')}
      </p>
    );
  } else {
    body = <CardSkeleton label={t('postVisit.loading')} />;
  }

  return (
    <>
      <div className="flex items-start gap-3 border-b border-inner-divider px-[22px] pt-[18px] pb-[15px]">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-[9px]">
            <span
              aria-hidden
              className="grid size-5 flex-none place-items-center rounded-full border border-success-border bg-success-bg font-mono text-[12.5px] leading-none font-semibold text-success"
            >
              {'✓'}
            </span>
            <Dialog.Title className="m-0 text-[16.5px] leading-[1.2] font-semibold tracking-[-0.01em]">
              {t('postVisit.title')}
            </Dialog.Title>
          </div>
          <Dialog.Description className="m-0 min-h-[18px] text-[12.5px] leading-[1.45] text-ink-muted">
            {visit.data &&
              t('postVisit.meta', {
                date: formatCalendarDate(visit.data.localDate, locale),
                duration: t('postVisit.minutes', { minutes: visit.data.durationMinutes ?? 0 }),
                services: t('money.services', { count: visit.data.services.length }),
              })}
          </Dialog.Description>
        </div>
        {summary.data && (
          <span
            className={cn(
              'flex-none rounded-md border px-2.5 py-1 text-[12.5px] leading-none font-semibold whitespace-nowrap',
              owes(summary.data.visit.outstanding)
                ? 'border-danger-border bg-danger-bg text-danger'
                : 'border-success-border bg-success-bg text-success',
            )}
          >
            {owes(summary.data.visit.outstanding) ? t('postVisit.unpaid') : t('postVisit.paid')}
          </span>
        )}
      </div>
      <div className="px-[22px] py-[18px]">{body}</div>
      <div className="flex items-center gap-2.5 border-t border-inner-divider bg-sunken px-[22px] py-3.5">
        <Dialog.Close asChild>
          <Button variant="secondary" className="h-10 px-[15px] text-[13px]">
            {owing ? t('postVisit.payLater') : t('postVisit.done')}
          </Button>
        </Dialog.Close>
      </div>
    </>
  );
}

/** One label and its figure. */
function Row({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1', className)}>
      <dt className="text-[12.5px] leading-none text-ink-secondary">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

function Figures({ visit, summary }: { visit: Visit; summary: VisitFinancialSummary }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const thisVisitId = useId();
  const previousId = useId();
  const format = (amount: string) => formatMoney({ amount, currency: summary.currency }, locale);
  const discounted = toCents(visit.money.discount) > 0n;
  const clear = !owes(summary.totalOutstanding);

  return (
    <>
      <section aria-labelledby={thisVisitId} className="mb-4">
        <h3 id={thisVisitId} className={cn(MICRO, 'mb-2.5 text-primary')}>
          {t('postVisit.thisVisit')}
        </h3>
        <dl className="m-0 rounded-[9px] border border-primary-tint-border bg-selected px-4 py-3.5">
          <Row label={t('postVisit.services')}>
            <span dir="ltr" className={cn(FIGURE, 'text-[12.5px] font-medium')}>
              {format(visit.money.subtotal)}
            </span>
          </Row>
          <Row label={t('postVisit.discount')}>
            <span dir="ltr" className={cn(FIGURE, 'text-[12.5px] font-medium text-danger')}>
              {format(discounted ? `-${visit.money.discount}` : visit.money.discount)}
            </span>
          </Row>
          <Row
            label={<span className="font-semibold text-ink">{t('postVisit.visitTotal')}</span>}
            className="mt-1 border-t border-primary-tint-border pt-2"
          >
            <span dir="ltr" className={cn(FIGURE, 'text-[15px] font-bold')}>
              {format(summary.visit.total)}
            </span>
          </Row>
          <Row label={t('postVisit.paidNow')}>
            <span dir="ltr" className={cn(FIGURE, 'text-[12.5px] font-medium text-success')}>
              {format(summary.visit.paid)}
            </span>
          </Row>
          <Row
            label={<span className="font-semibold text-ink">{t('postVisit.outstanding')}</span>}
            className="mt-1 border-t border-primary-tint-border pt-2 pb-0.5"
          >
            <span dir="ltr" className={cn(FIGURE, 'text-[16px] font-bold')}>
              {format(summary.visit.outstanding)}
            </span>
          </Row>
        </dl>
      </section>
      <section aria-labelledby={previousId} className="mb-4">
        <h3 id={previousId} className={cn(MICRO, 'mb-2.5 text-ink-muted')}>
          {t('postVisit.previous')}
        </h3>
        <dl className="m-0 rounded-[9px] border border-border bg-sunken px-4 py-2">
          <Row label={t('postVisit.previousLine')}>
            <span dir="ltr" className={cn(FIGURE, 'text-[15px] font-semibold')}>
              {format(summary.previous)}
            </span>
          </Row>
        </dl>
      </section>
      <dl className="m-0 flex items-center justify-between gap-3.5 rounded-[10px] border border-divider-strong bg-faint px-[18px] py-4">
        <dt>
          <span className="block text-[14px] leading-[1.3] font-semibold">
            {t('postVisit.total')}
          </span>
          <span className="mt-[3px] block text-[12.5px] leading-[1.4] text-ink-muted">
            {t('postVisit.totalHint')}
          </span>
        </dt>
        <dd
          dir="ltr"
          className={cn(
            FIGURE,
            'm-0 text-[26px] font-bold tracking-[-0.02em]',
            clear ? 'text-success' : 'text-danger',
          )}
        >
          {format(summary.totalOutstanding)}
        </dd>
      </dl>
      {clear && (
        <p className="m-0 mt-3.5 rounded-lg border border-success-border bg-success-bg px-[13px] py-[11px] text-[12.5px] leading-normal font-medium text-success">
          {t('postVisit.settled')}
        </p>
      )}
    </>
  );
}
