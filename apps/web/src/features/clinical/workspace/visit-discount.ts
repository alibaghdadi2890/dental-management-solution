import {
  type DiscountMode,
  type Visit,
  type VisitDiscountInput,
  type VisitMoney,
  visitMoney,
} from '@dcm/contracts';
import { MutationObserver, useQueryClient } from '@tanstack/react-query';
import { useUnsavedValues } from '../save-groups-context';
import { type SaveGroup, useSaveGroup } from '../use-save-group';
import { useVisitMutations } from '../visit-mutations';
import { servicePriceKey } from './charting-actions';
import { amountOf, moneyLineOf, type PriceDraft, priceDraftOf } from './tooth-panel/service-price';

/** The save group key of the visit discount (V6): the financial bar's control and the summary
 * dialog's edit one value, with one save queue. */
export const DISCOUNT_KEY = 'discount';

/** The visit discount as typed: the mode and the raw value (sanitised: digits, one dot), kept as
 * typed even above its cap (spec V7 invariant 2). */
export interface DiscountDraft {
  mode: DiscountMode;
  value: string;
}

/** A stored amount the way a person types it: `10.00` → `10`, `12.50` → `12.5`. */
export function plainAmount(amount: string): string {
  if (!amount.includes('.')) return amount;
  return amount.replace(/0+$/, '').replace(/\.$/, '');
}

export const discountDraftOf = (visit: Visit): DiscountDraft => ({
  mode: visit.discountMode,
  value: plainAmount(visit.discountValue),
});

/** What a draft saves: the raw value, never capped (the server stores the raw entry too). */
export const discountInputOf = (draft: DiscountDraft): VisitDiscountInput => ({
  mode: draft.mode,
  value: amountOf(draft.value),
});

/** The visit discount as one autosaved group (V6), keyed `discount`. */
export function useVisitDiscount(visit: Visit): SaveGroup<DiscountDraft> {
  const queryClient = useQueryClient();
  const { setDiscount } = useVisitMutations(visit.id);
  return useSaveGroup({
    key: DISCOUNT_KEY,
    serverValue: discountDraftOf(visit),
    // Outlives the component, like every save group's save (the group may flush after unmount).
    save: (draft) => new MutationObserver(queryClient, setDiscount).mutate(discountInputOf(draft)),
  });
}

/**
 * The visit's money as the workspace shows it now: `visitMoney` (the server's own arithmetic)
 * over each service's price as typed while its `service:<id>` group has unsaved edits, and over
 * `discount` (the discount group's current value), so the preview matches what the server will
 * compute once everything is saved.
 */
export function useLiveMoney(visit: Visit, discount: DiscountDraft): VisitMoney {
  const typed = useUnsavedValues<PriceDraft>(
    visit.services.map((service) => servicePriceKey(service.id)),
  );
  const lines = visit.services.map((service, index) =>
    moneyLineOf(typed[index] ?? priceDraftOf(service)),
  );
  return visitMoney(lines, discount.mode, amountOf(discount.value));
}
