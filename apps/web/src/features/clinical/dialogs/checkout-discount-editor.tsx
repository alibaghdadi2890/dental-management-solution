import { type Visit, visitMoney } from '@dcm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatMoney } from '@/lib/format';
import { checkoutDiscount, invalidateVisitData } from '../visits-list/visits-list-api';
import { DiscountControl } from '../workspace/discount-control';
import { amountOf } from '../workspace/tooth-panel/service-price';
import {
  type DiscountDraft,
  discountDraftOf,
  discountInputOf,
  sameDiscount,
} from '../workspace/visit-discount';

/** The shortest reason the API takes (`reasonSchema`); none at all is fine too. */
const MIN_REASON = 3;

/**
 * The visit discount at checkout (checkout handoff, C3–C5): the workspace's discount control, the
 * visit total it would give, an optional reason, and Apply. Applying posts
 * `POST /visits/:id/checkout-discount` and refreshes the visit and its money; a refusal (the
 * visit changed, the day is over) is shown here and the data is reloaded.
 */
export function CheckoutDiscountEditor({ visit, onDone }: { visit: Visit; onDone: () => void }) {
  const { t, i18n } = useTranslation(['clinical', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [draft, setDraft] = useState<DiscountDraft>(() => discountDraftOf(visit));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const money = visitMoney(
    visit.services.map((service) => ({
      base: service.base.amount,
      discount: service.discount.amount,
    })),
    draft.mode,
    amountOf(draft.value),
  );
  const trimmed = reason.trim();
  const unchanged = sameDiscount(draft, discountDraftOf(visit));
  const reasonTooShort = trimmed.length > 0 && trimmed.length < MIN_REASON;

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await checkoutDiscount(visit.id, {
        expectedUpdatedAt: visit.updatedAt,
        discount: discountInputOf(draft),
        ...(trimmed ? { reason: trimmed } : {}),
      });
      await invalidateVisitData(queryClient);
      onDone();
    } catch (failure) {
      setError(apiErrorMessage(failure, i18n));
      setBusy(false);
      void invalidateVisitData(queryClient);
    }
  };

  return (
    <div className="mt-2.5 flex flex-col gap-2.5 rounded-[9px] border border-border bg-surface px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DiscountControl
          discount={{ value: draft, setValue: setDraft }}
          currency={visit.currency}
          readOnly={busy}
        />
        <span className="text-[12.5px] leading-none text-ink-secondary">
          {t('postVisit.newTotal')}{' '}
          <span dir="ltr" className="font-mono font-semibold text-ink tabular-nums">
            {formatMoney({ amount: money.total, currency: visit.currency }, locale)}
          </span>
        </span>
      </div>
      {money.capped && (
        <p className="m-0 text-[11.5px] leading-[1.3] font-medium text-danger">
          {t('money.capped')}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={reasonId} className="text-[11.5px] leading-none text-ink-muted">
          {t('postVisit.discountReason')}
        </label>
        <input
          id={reasonId}
          aria-invalid={reasonTooShort}
          aria-describedby={reasonTooShort ? `${reasonId}-hint` : undefined}
          value={reason}
          maxLength={500}
          readOnly={busy}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          className="h-8 rounded-md border border-border-control bg-surface px-2.5 text-[12.5px] focus:border-primary"
        />
        {reasonTooShort && (
          <span id={`${reasonId}-hint`} className="text-[11.5px] leading-[1.3] text-danger">
            {t('postVisit.discountReasonShort')}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 text-[12px] leading-snug text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" disabled={busy} onClick={onDone}>
          {t('common:cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          busy={busy}
          disabled={unchanged || reasonTooShort}
          onClick={() => {
            void apply();
          }}
        >
          {t('postVisit.applyDiscount')}
        </Button>
      </div>
    </div>
  );
}
