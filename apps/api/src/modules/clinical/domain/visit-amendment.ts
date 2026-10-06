import {
  fromCents,
  lineFinal,
  toCents,
  visitMoney,
  type AmendVisitInput,
  type ChargeUnit,
  type DiscountMode,
  type Jaw,
  type SurfaceKey,
  type ToothCode,
} from '@dcm/contracts';
import { assertTarget } from './record-rules';
import { AmendNoChangeError, AmendPlanLinkedError, AmendUnknownServiceError } from './visit-errors';

/** A service of the visit as amend sees it: what it may change and what prices it. */
export interface AmendableService {
  id: string;
  code: string;
  name: string;
  chargeUnit: ChargeUnit;
  toothCode: ToothCode | null;
  jaw: Jaw | null;
  surfaces: SurfaceKey[];
  baseAmount: string;
  discountAmount: string;
  planId: string | null;
}

export interface AmendableVisit {
  discountMode: DiscountMode;
  discountValue: string;
  services: AmendableService[];
}

/** One side of a `visit_amendments` row (spec §Data model): enough to show before → after. */
export interface AmendmentSnapshot {
  services: {
    id: string;
    code: string;
    name: string;
    toothCode: ToothCode | null;
    /** Absent on snapshots taken before service levels. */
    jaw?: Jaw | null;
    surfaces: SurfaceKey[];
    final: string;
  }[];
  discount: { mode: DiscountMode; value: string };
  subtotal: string;
  discountAmount: string;
  total: string;
}

export interface AmendmentPlan {
  /** Services to soft-delete, in the visit's order. */
  removed: AmendableService[];
  /** Kept services whose tooth or surfaces change. */
  edited: { id: string; toothCode: ToothCode | null; surfaces: SurfaceKey[] }[];
  /** Plans the removed services performed: they go back to `planned` (D2). */
  plansToReopen: string[];
  before: AmendmentSnapshot;
  after: AmendmentSnapshot;
  /** `after.total − before.total`: what `billing` posts (negative = a credit). */
  delta: string;
}

const sameSurfaces = (a: readonly SurfaceKey[], b: readonly SurfaceKey[]) =>
  [...a].sort().join() === [...b].sort().join();

function snapshot(
  services: AmendableService[],
  discount: { mode: DiscountMode; value: string },
): AmendmentSnapshot {
  const lines = services.map((service) => ({
    base: service.baseAmount,
    discount: service.discountAmount,
  }));
  const money = visitMoney(lines, discount.mode, discount.value);
  return {
    services: services.map((service) => ({
      id: service.id,
      code: service.code,
      name: service.name,
      toothCode: service.toothCode,
      jaw: service.jaw,
      surfaces: service.surfaces,
      final: lineFinal({ base: service.baseAmount, discount: service.discountAmount }),
    })),
    discount,
    subtotal: money.subtotal,
    discountAmount: money.discount,
    total: money.total,
  };
}

/**
 * What an amendment does to a completed visit (feature 4b, D1–D3). `input.services` is the whole
 * set that stays: a service left out is removed, and a per-tooth one may change tooth and surfaces
 * under the same rules as recording it (`assertTarget`). A service that performed a plan may be
 * removed — its plan returns to `planned` — but not re-toothed. Per-line prices are not
 * editable; the visit discount is, and the money is recomputed with `visitMoney` (a discount over
 * its cap is capped, as while the visit was live). At least one service stays (the schema's
 * `min(1)`; removing everything is a void).
 *
 * @throws AmendUnknownServiceError for an id the visit doesn't have, or one given twice.
 * @throws AmendPlanLinkedError when a plan-linked service's tooth or surfaces change.
 * @throws AmendNoChangeError when nothing changes.
 * @throws ToothRequiredError / ToothNotAllowedError / SurfacesInvalidError from `assertTarget`.
 */
export function planAmendment(
  visit: AmendableVisit,
  input: Pick<AmendVisitInput, 'discount' | 'services'>,
): AmendmentPlan {
  const current = new Map(visit.services.map((service) => [service.id, service]));
  const wanted = new Map<string, AmendVisitInput['services'][number]>();
  for (const entry of input.services) {
    if (!current.has(entry.id) || wanted.has(entry.id)) {
      throw new AmendUnknownServiceError('Each service must be one of this visit, listed once');
    }
    wanted.set(entry.id, entry);
  }

  const kept: AmendableService[] = [];
  const removed: AmendableService[] = [];
  const edited: AmendmentPlan['edited'] = [];
  for (const service of visit.services) {
    const entry = wanted.get(service.id);
    if (!entry) {
      removed.push(service);
      continue;
    }
    const toothCode = entry.toothCode ?? service.toothCode;
    const surfaces = entry.surfaces ?? service.surfaces;
    const changed = toothCode !== service.toothCode || !sameSurfaces(surfaces, service.surfaces);
    if (changed && service.planId !== null) {
      throw new AmendPlanLinkedError(
        `${service.name} performed a treatment plan; remove it instead of moving it`,
      );
    }
    assertTarget(service.chargeUnit, toothCode, surfaces, service.jaw);
    if (changed) edited.push({ id: service.id, toothCode, surfaces });
    kept.push({ ...service, toothCode, surfaces });
  }

  const discountChanged =
    input.discount.mode !== visit.discountMode ||
    toCents(input.discount.value) !== toCents(visit.discountValue);
  if (removed.length === 0 && edited.length === 0 && !discountChanged) {
    throw new AmendNoChangeError('The amendment changes nothing');
  }

  const before = snapshot(visit.services, {
    mode: visit.discountMode,
    value: visit.discountValue,
  });
  const after = snapshot(kept, { mode: input.discount.mode, value: input.discount.value });
  return {
    removed,
    edited,
    plansToReopen: removed.flatMap((service) => (service.planId === null ? [] : [service.planId])),
    before,
    after,
    delta: fromCents(toCents(after.total) - toCents(before.total)),
  };
}
