import {
  type AmendVisitInput,
  type ChargeUnit,
  type DiscountMode,
  type Jaw,
  type ServiceItem,
  type SurfaceKey,
  type ToothCode,
  validSurfaces,
  type VisitListItem,
  visitMoney,
} from '@dcm/contracts';
import { isTimesDirty, type TimesDraft, timesDraftOf, timesOf, timesProblem } from './times-draft';

/** A service of the visit while correcting: kept or removed, its tooth and surfaces, its price. */
export interface KeptLine {
  kind: 'kept';
  key: string;
  removed: boolean;
  toothCode: ToothCode | null;
  surfaces: SurfaceKey[];
  /** The line's price as typed; it starts at the line's final price. */
  price: string;
}

/** A catalog service the correction adds (ADR-0062): placed by how it is charged. */
export interface AddedLine {
  kind: 'added';
  key: string;
  procedureId: string;
  name: string;
  chargeUnit: ChargeUnit;
  catalogPrice: string;
  toothCode: ToothCode | null;
  jaw: Jaw | null;
  surfaces: SurfaceKey[];
  price: string;
}

export type AmendLine = KeptLine | AddedLine;

/** The correction form's state (D1, ADR-0062): the services, the visit discount and the times. */
export interface AmendDraft {
  lines: AmendLine[];
  discount: { mode: DiscountMode; value: string };
  times: TimesDraft;
}

/** Correcting is offered only on a visit whose money the caller sees; this is for the type. */
const discountOf = (visit: VisitListItem) =>
  visit.discount ?? { mode: 'percent' as const, value: '0' };

const finalOf = (visit: VisitListItem, id: string) =>
  visit.services.find((service) => service.id === id)?.final?.amount ?? '0';

export function draftOf(visit: VisitListItem, timeZone: string): AmendDraft {
  return {
    lines: visit.services.map((service) => ({
      kind: 'kept',
      key: service.id,
      removed: false,
      toothCode: service.toothCode,
      surfaces: [...service.surfaces],
      price: service.final?.amount ?? '0',
    })),
    discount: { ...discountOf(visit) },
    times: timesDraftOf(visit, timeZone),
  };
}

let added = 0;

/** The draft with a catalog service added at its catalog price, not placed yet. */
export function withService(draft: AmendDraft, item: ServiceItem): AmendDraft {
  added += 1;
  return {
    ...draft,
    lines: [
      ...draft.lines,
      {
        kind: 'added',
        key: `added-${String(added)}`,
        procedureId: item.id,
        name: item.name,
        chargeUnit: item.chargeUnit,
        catalogPrice: item.price.amount,
        toothCode: null,
        jaw: null,
        surfaces: [],
        price: item.price.amount,
      },
    ],
  };
}

const sameSurfaces = (a: readonly SurfaceKey[], b: readonly SurfaceKey[]) =>
  [...a].sort().join() === [...b].sort().join();

const sameAmount = (a: string, b: string) => Number(a) === Number(b);

const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

const kept = (draft: AmendDraft) =>
  draft.lines.filter((line) => line.kind === 'added' || !line.removed);

/** The services or the money change: the correction is an amendment (not the times alone). */
export function isServicesDirty(draft: AmendDraft, visit: VisitListItem): boolean {
  const discountChanged =
    draft.discount.mode !== discountOf(visit).mode ||
    !sameAmount(draft.discount.value || '0', discountOf(visit).value);
  return (
    discountChanged ||
    draft.lines.some((line) => {
      if (line.kind === 'added') return true;
      const service = visit.services.find((candidate) => candidate.id === line.key);
      return (
        line.removed ||
        service === undefined ||
        line.toothCode !== service.toothCode ||
        !sameSurfaces(line.surfaces, service.surfaces) ||
        !sameAmount(line.price || '0', finalOf(visit, line.key))
      );
    })
  );
}

/** Anything changed from the visit as it is: Save stays disabled until then. */
export const isDirty = (draft: AmendDraft, visit: VisitListItem, timeZone: string) =>
  isServicesDirty(draft, visit) || isTimesDirty(draft.times, visit, timeZone);

export type AmendProblem =
  | 'noService'
  | 'tooth'
  | 'jaw'
  | 'price'
  | 'discount'
  | 'timesMissing'
  | 'timesOrder'
  | 'timesFuture';

const TIMES_PROBLEMS = {
  missing: 'timesMissing',
  order: 'timesOrder',
  future: 'timesFuture',
} as const;

/** Why Save can't go ahead yet, if anything: every service removed (void instead, D3), a
 * per-tooth service without a valid tooth and surfaces, a per-jaw one without its jaw, a price or
 * discount that isn't a number, or times the API would refuse. */
export function problemOf(
  draft: AmendDraft,
  visit: VisitListItem,
  timeZone: string,
  now: Date,
): AmendProblem | null {
  const lines = kept(draft);
  if (lines.length === 0) return 'noService';
  const needsTooth = (line: AmendLine) =>
    line.kind === 'added' ? line.chargeUnit === 'per_tooth' : line.toothCode !== null;
  if (
    lines.some(
      (line) =>
        needsTooth(line) &&
        (line.toothCode === null || !validSurfaces(line.toothCode, line.surfaces)),
    )
  ) {
    return 'tooth';
  }
  if (lines.some((line) => line.kind === 'added' && line.chargeUnit === 'per_jaw' && !line.jaw)) {
    return 'jaw';
  }
  if (lines.some((line) => !AMOUNT.test(line.price.trim()))) return 'price';
  const value = draft.discount.value.trim();
  if (value !== '' && !AMOUNT.test(value)) return 'discount';
  if (isTimesDirty(draft.times, visit, timeZone)) {
    const times = timesProblem(draft.times, visit, timeZone, now);
    if (times) return TIMES_PROBLEMS[times];
  }
  return null;
}

/** The visit total after the draft, with the server's arithmetic (`visitMoney`, cap included):
 * every line at its price, line discounts folded in. */
export function draftTotal(draft: AmendDraft): string {
  const lines = kept(draft).map((line) => ({ base: line.price.trim() || '0', discount: '0' }));
  return visitMoney(lines, draft.discount.mode, draft.discount.value.trim() || '0').total;
}

/**
 * The request body: the services that stay (per-tooth ones with their tooth and surfaces, a
 * price only when it was changed) and those added, the discount, and the times when they changed.
 */
export function amendInput(
  draft: AmendDraft,
  visit: VisitListItem,
  timeZone: string,
  reason: string,
): AmendVisitInput {
  const services = kept(draft).map((line) => {
    const price = line.price.trim();
    if (line.kind === 'added') {
      return {
        procedureId: line.procedureId,
        surfaces: line.surfaces,
        ...(line.toothCode && { toothCode: line.toothCode }),
        ...(line.jaw && { jaw: line.jaw }),
        ...(!sameAmount(price, line.catalogPrice) && { price }),
      };
    }
    return {
      id: line.key,
      ...(line.toothCode && { toothCode: line.toothCode, surfaces: line.surfaces }),
      ...(!sameAmount(price, finalOf(visit, line.key)) && { price }),
    };
  });
  const times = isTimesDirty(draft.times, visit, timeZone)
    ? timesOf(draft.times, visit, timeZone)
    : null;
  return {
    expectedUpdatedAt: visit.updatedAt,
    reason,
    discount: { mode: draft.discount.mode, value: draft.discount.value.trim() || '0' },
    services,
    ...(times && { times: { startedAt: times.startedAt, completedAt: times.completedAt } }),
  };
}
