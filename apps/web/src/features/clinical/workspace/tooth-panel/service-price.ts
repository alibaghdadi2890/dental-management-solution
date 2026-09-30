import { lineFinal, toCents, type UpdateServiceInput, type VisitService } from '@dcm/contracts';
import { type SaveGroup, useSaveGroup } from '../../use-save-group';
import { servicePriceKey, useChartingActions } from '../charting-actions';

/** One service's Base and Discount inputs as typed (already sanitised: digits, one dot). */
export interface PriceDraft {
  base: string;
  discount: string;
}

export const priceDraftOf = (service: VisitService): PriceDraft => ({
  base: service.base.amount,
  discount: service.discount.amount,
});

/** A typed amount as a decimal the API accepts: blank or a bare dot is 0, `12.` is `12`. */
function amountOf(typed: string): string {
  const [whole = '', fraction = ''] = typed.split('.');
  const units = whole.replace(/^0+(?=\d)/, '') || '0';
  return fraction ? `${units}.${fraction}` : units;
}

/** What a draft saves and costs: the discount is capped at the base (the POC's `min(disc, base)`,
 * the same invariant `visit_services` enforces), so the typed value is kept while typing and the
 * cap applies to what is sent. */
export function priceOf(draft: PriceDraft): { patch: UpdateServiceInput; final: string } {
  const base = amountOf(draft.base);
  const typedDiscount = amountOf(draft.discount);
  const discount = toCents(typedDiscount) > toCents(base) ? base : typedDiscount;
  return {
    patch: { baseAmount: base, discountAmount: discount },
    final: lineFinal({ base, discount }),
  };
}

/** A service's price as one autosaved group (V6), keyed `service:<id>`: every place that edits
 * it shares the value, the save state and the queue. */
export function useServicePrice(service: VisitService): SaveGroup<PriceDraft> {
  const { saveServicePrice } = useChartingActions();
  return useSaveGroup({
    key: servicePriceKey(service.id),
    serverValue: priceDraftOf(service),
    save: (draft) => saveServicePrice(service.id, priceOf(draft).patch),
  });
}
