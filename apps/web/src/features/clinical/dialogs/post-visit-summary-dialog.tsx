import { Dialog } from 'radix-ui';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/session';
import { RecordPaymentForm } from '@/features/billing/payments/record-payment-dialog';
import { formatCalendarDate } from '@/lib/format';
import { useVisitCheckout } from './use-visit-checkout';
import { CheckoutActions, CheckoutBody, CheckoutStatusPill } from './visit-checkout';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** Set on the record's entry by the workspace when a visit it had open completes (W16): the
     * record opens that visit's post-visit summary, and clears it on close. */
    postVisit?: string | undefined;
  }
}

/**
 * The Post-Visit Financial Summary (spec §Post-Visit Financial Summary, "Visit recorded"), over
 * the record's Overview right after a visit completes (W16). The header: a ✓, the visit's date,
 * duration and service count (the completed visit), and its status pill — **Unpaid**, **Partly
 * paid** or **Paid in full**. The
 * body's three blocks come from `GET /billing/visits/:id/summary` (W2): This visit, Previous
 * visits and Total outstanding (`danger` while owed, `success` with the settled note when clear).
 * The footer is **Done** — shown once the figures are in — and, while owed and with
 * `payment:write`, **Record payment**: the dialog's next step, the payment form in place of the
 * figures (this visit is paid first). Recording the payment ends the checkout and closes the
 * dialog, like Done (the toast says what was taken); Cancel comes back to the figures. Done never asks who collects: the completer may leave it to the front desk, and
 * without `payment:write` a note says so. **Print invoice** is always there.
 *
 * Its body and actions are the visit's checkout (`visit-checkout.tsx`). With `visit:discount`, on
 * the visit's day and while the visit owes, the Discount row has **Edit**
 * (`CheckoutDiscountEditor`). The Today board opens the same dialog, under its own `title`, for a
 * visit someone else completed.
 *
 * A modal: focus is trapped and `Esc` closes it. After a completion nothing opened it, so on
 * close focus goes where `onCloseAutoFocus` puts it (the record's heading).
 */
export function PostVisitSummaryDialog({
  visitId,
  title,
  onClose,
  onCloseAutoFocus,
}: {
  visitId: string;
  /** Instead of "Visit recorded" (the Today board's "Checkout · <patient>"). */
  title?: string | undefined;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
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
        <Dialog.Content
          {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
          className="fixed start-1/2 top-1/2 z-50 w-[calc(100%-48px)] flex max-h-[calc(100%-48px)] max-w-[540px] -translate-x-1/2 -translate-y-1/2 animate-popin flex-col overflow-hidden rounded-xl bg-surface shadow-[0_18px_48px_rgba(27,26,31,.2)] rtl:translate-x-1/2"
        >
          <PostVisitContent visitId={visitId} title={title} onDone={onClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PostVisitContent({
  visitId,
  title,
  onDone,
}: {
  visitId: string;
  title: string | undefined;
  /** Closes the dialog: a recorded payment ends the checkout, like Done. */
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation(['clinical', 'billing']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const { data: session } = useSession();
  const checkout = useVisitCheckout(visitId);
  const { visit } = checkout;
  const [paying, setPaying] = useState(false);
  // The payment step keeps the size the figures had: the form scrolls inside it, never resizing
  // the dialog under the pointer.
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameHeight, setFrameHeight] = useState<number>();
  const paymentStep = paying && visit !== undefined && session?.tenant ? session.tenant : null;

  return (
    <div
      ref={frameRef}
      className="flex min-h-0 flex-col"
      style={paymentStep && frameHeight ? { height: frameHeight } : undefined}
    >
      <div className="flex flex-none items-start gap-3 border-b border-inner-divider px-[22px] pt-[18px] pb-[15px]">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-[9px]">
            <span
              aria-hidden
              className="grid size-5 flex-none place-items-center rounded-full border border-success-border bg-success-bg font-mono text-[12.5px] leading-none font-semibold text-success"
            >
              {'✓'}
            </span>
            <Dialog.Title className="m-0 text-[16.5px] leading-[1.2] font-semibold tracking-[-0.01em]">
              {title ?? t('postVisit.title')}
            </Dialog.Title>
          </div>
          <Dialog.Description className="m-0 min-h-[18px] text-[12.5px] leading-[1.45] text-ink-muted">
            {paymentStep
              ? t('billing:record.ruleVisit')
              : visit &&
                t('postVisit.meta', {
                  date: formatCalendarDate(visit.localDate, locale),
                  duration: t('postVisit.minutes', { minutes: visit.durationMinutes ?? 0 }),
                  services: t('money.services', { count: visit.services.length }),
                })}
          </Dialog.Description>
        </div>
        <CheckoutStatusPill checkout={checkout} />
      </div>
      {paymentStep && visit ? (
        <RecordPaymentForm
          options={{ patientId: visit.patientId, contextVisitId: visitId, onRecorded: onDone }}
          tenant={paymentStep}
          onClose={() => {
            setPaying(false);
          }}
        />
      ) : (
        <>
          <div className="min-h-0 overflow-auto px-[22px] py-[18px]">
            <CheckoutBody checkout={checkout} />
          </div>
          <div className="flex flex-none items-center gap-2.5 border-t border-inner-divider bg-sunken px-[22px] py-3.5">
            {checkout.settled ? (
              <Dialog.Close asChild>
                <Button variant="secondary" className="h-10 px-[15px] text-[13px]">
                  {t('postVisit.done')}
                </Button>
              </Dialog.Close>
            ) : (
              <span aria-hidden className="h-10" />
            )}
            <CheckoutActions
              checkout={checkout}
              onPay={() => {
                setFrameHeight(frameRef.current?.getBoundingClientRect().height);
                setPaying(true);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
