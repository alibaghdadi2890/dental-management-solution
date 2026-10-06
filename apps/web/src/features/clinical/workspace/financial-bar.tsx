import { isOpenPlan, toCents, type Visit } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-context';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useFlushSaveGroups } from '../save-groups-context';
import { chartQuery } from '../visits-api';
import { plansTotal } from './tooth-panel/tooth-records';
import { DiscountControl } from './discount-control';
import { useLiveMoney, useVisitDiscount } from './visit-discount';

const MICRO =
  'mb-[5px] text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal';
const FIGURE = 'font-mono leading-none tabular-nums';

/** One cell of the left group: a micro label over its value, grouped under that label. */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId}>
      <div id={labelId} className={MICRO}>
        {label}
      </div>
      {children}
    </div>
  );
}

const Divider = () => <span aria-hidden className="h-8 w-px flex-none bg-inner-divider" />;

/**
 * The financial bar (spec §Visit Workspace → Financial bar): Services (the subtotal), Visit
 * discount (the control), Discount amount (`danger` when non-zero) and Visit total, then the
 * count line, **Save draft** (it sends the edits still waiting, then says the visit stays open —
 * or, when one fails, that the draft wasn't saved; nothing is recorded until completion) and
 * **Review & complete**. The figures are `useLiveMoney`: the server's arithmetic over what is typed now.
 *
 * The bar wraps (`flex-wrap`), and the count line and both buttons never shrink (`flex: none`,
 * `nowrap`): with `nowrap`, the over-discount warning would squeeze every item below its text
 * width. The warning itself takes a line of its own below the controls (`flex: 1 0 100%;
 * order: 9`). Read-only without `visit:write`: the discount can't be edited and both buttons are
 * disabled.
 */
export function FinancialBar({
  visit,
  canWrite,
  onReview,
}: {
  visit: Visit;
  canWrite: boolean;
  /** Opens the visit summary (Review & complete). */
  onReview: () => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const flush = useFlushSaveGroups();
  const [savingDraft, setSavingDraft] = useState(false);
  const discount = useVisitDiscount(visit);
  const money = useLiveMoney(visit, discount.value);
  const format = (amount: string) => formatMoney({ amount, currency: visit.currency }, locale);
  const discounted = toCents(money.discount) > 0n;
  const teeth = new Set(visit.services.flatMap((service) => service.toothCode ?? [])).size;
  // The patient's open plans (4a follow-up): what is still to do, apart from today's total.
  const chart = useQuery(chartQuery(visit.patientId));
  const openPlans = plansTotal(chart.data?.plans.filter(isOpenPlan) ?? []);

  const saveDraft = async () => {
    setSavingDraft(true);
    const saved = await flush();
    setSavingDraft(false);
    if (saved) {
      toast(t('money.draftSaved'), { tone: 'success', body: t('money.draftSavedBody') });
    } else {
      toast(t('money.draftFailed'), { tone: 'danger', body: t('money.draftFailedBody') });
    }
  };

  return (
    <footer
      aria-label={t('workspace.money')}
      className="flex flex-none flex-wrap items-center gap-x-[22px] gap-y-3.5 border-t border-border bg-surface px-[22px] py-3 shadow-[0_-4px_14px_rgba(27,26,31,.05)]"
    >
      <div className="flex flex-wrap items-center gap-5">
        <Cell label={t('money.subtotal')}>
          <div dir="ltr" className={cn(FIGURE, 'text-[15px] font-semibold')}>
            {format(money.subtotal)}
          </div>
        </Cell>
        <Divider />
        <Cell label={t('money.discount')}>
          <DiscountControl discount={discount} currency={visit.currency} readOnly={!canWrite} />
        </Cell>
        <Cell label={t('money.discountAmount')}>
          <div
            dir="ltr"
            className={cn(
              FIGURE,
              'text-[15px] font-semibold',
              discounted ? 'text-danger' : 'text-ink-muted',
            )}
          >
            {format(discounted ? `-${money.discount}` : money.discount)}
          </div>
        </Cell>
        <Divider />
        <Cell label={t('money.total')}>
          <div dir="ltr" className={cn(FIGURE, 'text-[21px] font-bold tracking-[-0.02em]')}>
            {format(money.total)}
          </div>
        </Cell>
      </div>
      {money.capped && (
        <p
          role="alert"
          className="order-9 m-0 flex flex-[1_0_100%] items-center gap-1.5 rounded-md border border-danger-border bg-danger-bg px-2.5 py-1.5 text-[11.5px] leading-[1.3] font-medium text-danger"
        >
          {t('money.capped')}
        </p>
      )}
      {openPlans && (
        <span className="text-[12.5px] leading-none text-ink-muted">
          {t('money.openPlans', { amount: formatMoney(openPlans, locale) })}
        </span>
      )}
      <div className="ms-auto flex flex-none items-center gap-2.5">
        <span className="flex-none text-[12.5px] leading-none whitespace-nowrap text-ink-muted">
          {t('money.count', {
            services: t('money.services', { count: visit.services.length }),
            teeth: t('money.teeth', { count: teeth }),
          })}
        </span>
        <Button
          variant="outline"
          busy={savingDraft}
          disabled={!canWrite}
          onClick={() => {
            void saveDraft();
          }}
          className="h-[38px] px-[15px] text-[13px]"
        >
          {t('money.saveDraft')}
        </Button>
        <Button
          variant="primary"
          disabled={!canWrite}
          onClick={onReview}
          className="h-[38px] px-[17px] text-[13px] font-semibold"
        >
          {t('money.review')}
        </Button>
      </div>
    </footer>
  );
}
