import {
  type FullVisitSummary,
  fromCents,
  toCents,
  type Visit,
  type VisitFinancialSummary,
} from '@dcm/contracts';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardSkeleton } from '@/components/ui/card';
import { openPrintable, printPath } from '@/features/billing/payments-api';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { VisitUnfinishedLines } from '../visit-unfinished-lines';
import { CheckoutDiscountEditor } from './checkout-discount-editor';
import type { VisitCheckout } from './use-visit-checkout';

const MICRO =
  'm-0 text-[11.5px] leading-none font-medium tracking-[.05em] uppercase [&:lang(ar)]:tracking-normal';
const FIGURE = 'font-mono leading-none tabular-nums';

const owes = (amount: string) => toCents(amount) > 0n;

/** **Unpaid**, **Partly paid** or **Paid in full**, once the figures are in. */
export function CheckoutStatusPill({ checkout }: { checkout: VisitCheckout }) {
  const { t } = useTranslation('clinical');
  const { summary } = checkout;
  if (!summary) return null;
  const partly = owes(summary.visit.paid);
  return (
    <span
      className={cn(
        'flex-none rounded-md border px-2.5 py-1 text-[12.5px] leading-none font-semibold whitespace-nowrap',
        checkout.visitPaid
          ? 'border-success-border bg-success-bg text-success'
          : partly
            ? 'border-warning-border bg-warning-bg text-warning'
            : 'border-danger-border bg-danger-bg text-danger',
      )}
    >
      {checkout.visitPaid
        ? t('postVisit.paid')
        : partly
          ? t('postVisit.partlyPaid')
          : t('postVisit.unpaid')}
    </span>
  );
}

/** The three blocks (This visit, Previous visits, Total outstanding), loading or failed. */
export function CheckoutBody({ checkout }: { checkout: VisitCheckout }) {
  const { t } = useTranslation('clinical');
  if (checkout.visit && checkout.summary) {
    return (
      <Figures
        visit={checkout.visit}
        summary={checkout.summary}
        discountable={checkout.discountable}
        discountLocked={checkout.discountLocked}
      />
    );
  }
  if (checkout.failed) {
    return (
      <p role="alert" className="m-0 py-6 text-center text-[12.5px] leading-snug text-ink-muted">
        {t('postVisit.failed')}
      </p>
    );
  }
  return <CardSkeleton label={t('postVisit.loading')} />;
}

/**
 * What follows the caller's own close button: "Handed to front desk for payment" (without
 * `payment:write`, F4), **Print invoice** (with the account's figures, `payment:read`), and while
 * owed **Record payment**, which the caller turns into its payment step (`onPay`).
 */
export function CheckoutActions({
  checkout,
  onPay,
}: {
  checkout: VisitCheckout;
  onPay: () => void;
}) {
  const { t } = useTranslation('clinical');
  const { visit, visitId, owing } = checkout;
  const payable = owing && checkout.canCollect && visit !== undefined;
  return (
    <>
      {owing && !checkout.canCollect && (
        <span className="text-[12.5px] leading-snug text-ink-muted">
          {t('postVisit.frontDesk')}
        </span>
      )}
      {checkout.summary && !checkout.summary.handedOff && (
        <Button
          variant="outline"
          className={cn('h-10 px-[15px] text-[13px]', !payable && 'ms-auto')}
          onClick={() => {
            openPrintable(printPath.invoice(visitId));
          }}
        >
          {t('postVisit.printInvoice')}
        </Button>
      )}
      {payable && (
        <Button variant="primary" className="ms-auto h-10 px-[15px] text-[13px]" onClick={onPay}>
          {t('postVisit.recordPayment')}
        </Button>
      )}
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

function Figures({
  visit,
  summary,
  discountable,
  discountLocked,
}: {
  visit: Visit;
  summary: VisitFinancialSummary;
  /** The caller may set the discount now (checkout handoff, C2, C5, C7). */
  discountable: boolean;
  /** It could be set now, but not by the caller (ADR-0055). */
  discountLocked: boolean;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const thisVisitId = useId();
  const [editing, setEditing] = useState(false);
  const format = (amount: string) => formatMoney({ amount, currency: summary.currency }, locale);
  const discounted = toCents(visit.money.discount) > 0n;
  // Paid in advance for the treatment plan (ADR-0051): what covered this visit, what is still held.
  const byAdvance = summary.handedOff
    ? 0n
    : summary.payments
        .filter((payment) => payment.fromAdvance)
        .reduce((sum, payment) => sum + toCents(payment.amount), 0n);

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
          <Row
            label={
              <>
                {t('postVisit.discount')}
                {discountLocked && (
                  <span className="ms-2 font-medium text-ink-muted">{t('askOwner')}</span>
                )}
                {discountable && !editing && (
                  <button
                    type="button"
                    aria-label={t('postVisit.editDiscount')}
                    className="ms-2 cursor-pointer font-medium text-primary hover:underline"
                    onClick={() => {
                      setEditing(true);
                    }}
                  >
                    {t('postVisit.edit')}
                  </button>
                )}
              </>
            }
          >
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
          {byAdvance > 0n && (
            <Row label={t('postVisit.coveredByAdvance')}>
              <span dir="ltr" className={cn(FIGURE, 'text-[12.5px] font-medium text-success')}>
                {format(fromCents(byAdvance))}
              </span>
            </Row>
          )}
          <Row
            label={<span className="font-semibold text-ink">{t('postVisit.outstanding')}</span>}
            className="mt-1 border-t border-primary-tint-border pt-2 pb-0.5"
          >
            <span dir="ltr" className={cn(FIGURE, 'text-[16px] font-bold')}>
              {format(summary.visit.outstanding)}
            </span>
          </Row>
        </dl>
        {discountable && editing && (
          <CheckoutDiscountEditor
            visit={visit}
            onDone={() => {
              setEditing(false);
            }}
          />
        )}
        <VisitUnfinishedLines patientId={visit.patientId} visitId={visit.id} className="mt-2" />
      </section>
      {!summary.handedOff && <Account summary={summary} format={format} />}
    </>
  );
}

/** The patient's account around this visit (with `payment:read` only, ADR-0055). */
function Account({
  summary,
  format,
}: {
  summary: FullVisitSummary;
  format: (amount: string) => string;
}) {
  const { t } = useTranslation('clinical');
  const previousId = useId();
  const clear = !owes(summary.totalOutstanding);
  return (
    <>
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
      {toCents(summary.held) > 0n && (
        <p className="m-0 mt-3.5 text-[12.5px] leading-normal text-ink-muted">
          {t('postVisit.held', { amount: format(summary.held) })}
        </p>
      )}
      {clear && (
        <p className="m-0 mt-3.5 rounded-lg border border-success-border bg-success-bg px-[13px] py-[11px] text-[12.5px] leading-normal font-medium text-success">
          {t('postVisit.settled')}
        </p>
      )}
    </>
  );
}
