import {
  lineFinal,
  type MoneyLine,
  toCents,
  type UpdateServiceInput,
  type VisitService,
} from '@dcm/contracts';
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

/** A typed amount (sanitised: digits, one dot) as a decimal the API accepts: blank or a bare dot
 * is 0, `12.` is `12`. */
export function amountOf(typed: string): string {
  const [whole = '', fraction = ''] = typed.split('.');
  const units = whole.replace(/^0+(?=\d)/, '') || '0';
  return fraction ? `${units}.${fraction}` : units;
}

/** Two typed amounts that are the same money (`10.`, `10` and `10.00`). */
export const sameAmount = (a: string, b: string): boolean =>
  toCents(amountOf(a)) === toCents(amountOf(b));

/** Whether a draft as typed and one read back from the server are the same price, so the refetch
 * after a save leaves the typed text alone (`useSaveGroup`'s `sameValue`). */
export const samePrice = (local: PriceDraft, server: PriceDraft): boolean =>
  sameAmount(local.base, server.base) && sameAmount(local.discount, server.discount);

/** A draft as the line `visitMoney` sums: the discount is capped at the base (the POC's
 * `min(disc, base)`, the same invariant `visit_services` enforces), so the typed value is kept
 * while typing and the cap applies to what is sent and counted. */
export function moneyLineOf(draft: PriceDraft): MoneyLine {
  const base = amountOf(draft.base);
  const typedDiscount = amountOf(draft.discount);
  return { base, discount: toCents(typedDiscount) > toCents(base) ? base : typedDiscount };
}

/** What a draft saves and costs (`moneyLineOf`). */
export function priceOf(draft: PriceDraft): { patch: UpdateServiceInput; final: string } {
  const line = moneyLineOf(draft);
  return {
    patch: { baseAmount: line.base, discountAmount: line.discount },
    final: lineFinal(line),
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
    sameValue: samePrice,
  });
}
