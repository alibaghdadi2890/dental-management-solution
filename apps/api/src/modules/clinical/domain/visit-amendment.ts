import {
  fromCents,
  lineFinal,
  toCents,
  visitMoney,
  type AmendAddedService,
  type AmendKeptService,
  type AmendVisitInput,
  type ChargeUnit,
  type DiscountMode,
  type Jaw,
  type SurfaceKey,
  type ToothCode,
} from '@dcm/contracts';
import { CatalogItemInactiveError } from './catalog-errors';
import { assertCurrency, assertTarget } from './record-rules';
import { AmendPlanLinkedError, AmendUnknownServiceError } from './visit-errors';

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
  currency: string;
  discountMode: DiscountMode;
  discountValue: string;
  services: AmendableService[];
}

/** A catalog service as a correction may add it: the catalog's row now (ADR-0062). */
export interface AddableService {
  id: string;
  code: string;
  name: string;
  category: string | null;
  chargeUnit: ChargeUnit;
  price: { amount: string; currency: string };
  active: boolean;
}

/** A service the correction adds, with the id it will be stored under. */
export interface AddedService {
  id: string;
  procedureId: string;
  code: string;
  name: string;
  category: string | null;
  chargeUnit: ChargeUnit;
  toothCode: ToothCode | null;
  jaw: Jaw | null;
  surfaces: SurfaceKey[];
  baseAmount: string;
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
  /** The visit's start and end, on a correction that changed them too (ADR-0062). */
  startedAt?: string;
  completedAt?: string;
}

export interface AmendmentPlan {
  /** Services to soft-delete, in the visit's order. */
  removed: AmendableService[];
  /** Kept services whose tooth or surfaces change. */
  edited: { id: string; toothCode: ToothCode | null; surfaces: SurfaceKey[] }[];
  /** Kept services whose price is set: the base becomes the price, the line discount 0. */
  priced: { id: string; baseAmount: string }[];
  /** Catalog services to add, in the order given. */
  added: AddedService[];
  /** Plans the removed services performed: they go back to `planned` (D2). */
  plansToReopen: string[];
  before: AmendmentSnapshot;
  after: AmendmentSnapshot;
  /** `after.total − before.total`: what `billing` posts (negative = a credit). */
  delta: string;
  /** A price typed or the visit discount changed: that needs `visit:discount` (ADR-0055). */
  pricingChanged: boolean;
  /** Anything about the services or the money changes. */
  changed: boolean;
}

export interface AmendmentContext {
  /** The catalog services the input adds, by id. */
  catalog: ReadonlyMap<string, AddableService>;
  newId: () => string;
}

const sameSurfaces = (a: readonly SurfaceKey[], b: readonly SurfaceKey[]) =>
  [...a].sort().join() === [...b].sort().join();

const isKept = (entry: AmendKeptService | AmendAddedService): entry is AmendKeptService =>
  'id' in entry;

type Priced = Pick<
  AmendableService,
  'id' | 'code' | 'name' | 'toothCode' | 'jaw' | 'surfaces' | 'baseAmount' | 'discountAmount'
>;

function snapshot(
  services: readonly Priced[],
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
 * What a correction does to a completed visit's services and money (feature 4b, D1–D3;
 * ADR-0062). `input.services` is the whole set: an existing service left out is removed; one kept
 * may change tooth and surfaces under the recording rules (`assertTarget`) and take a `price`
 * (base = price, line discount 0); an entry with a `procedureId` adds that catalog service at its
 * catalog price unless a price is given, placed under the same rules. A service that performed a
 * plan may be removed — its plan returns to `planned` — or repriced, but not re-toothed. The money
 * is recomputed with `visitMoney` (a discount over its cap is capped, as while the visit was
 * live). At least one service stays (the schema's `min(1)`; removing everything is a void).
 * `changed` is false when nothing about the services or the money changes.
 *
 * @throws AmendUnknownServiceError for an id the visit doesn't have, one given twice, or a
 *   catalog service the context doesn't hold.
 * @throws AmendPlanLinkedError when a plan-linked service's tooth or surfaces change.
 * @throws CatalogItemInactiveError when an added service is inactive.
 * @throws CurrencyMismatchError when an added service is priced in another currency.
 * @throws ToothRequiredError / ToothNotAllowedError / SurfacesInvalidError / Jaw…Error from
 *   `assertTarget`.
 */
export function planAmendment(
  visit: AmendableVisit,
  input: Pick<AmendVisitInput, 'discount' | 'services'>,
  context: AmendmentContext = { catalog: new Map(), newId: () => '' },
): AmendmentPlan {
  const current = new Map(visit.services.map((service) => [service.id, service]));
  const wanted = new Map<string, AmendKeptService>();
  const additions: AmendAddedService[] = [];
  for (const entry of input.services) {
    if (!isKept(entry)) {
      additions.push(entry);
      continue;
    }
    if (!current.has(entry.id) || wanted.has(entry.id)) {
      throw new AmendUnknownServiceError('Each service must be one of this visit, listed once');
    }
    wanted.set(entry.id, entry);
  }

  const kept: AmendableService[] = [];
  const removed: AmendableService[] = [];
  const edited: AmendmentPlan['edited'] = [];
  const priced: AmendmentPlan['priced'] = [];
  let pricingChanged = false;
  for (const service of visit.services) {
    const entry = wanted.get(service.id);
    if (!entry) {
      removed.push(service);
      continue;
    }
    const toothCode = entry.toothCode ?? service.toothCode;
    const surfaces = entry.surfaces ?? service.surfaces;
    const moved = toothCode !== service.toothCode || !sameSurfaces(surfaces, service.surfaces);
    if (moved && service.planId !== null) {
      throw new AmendPlanLinkedError(
        `${service.name} performed a treatment plan; remove it instead of moving it`,
      );
    }
    assertTarget(service.chargeUnit, toothCode, surfaces, service.jaw);
    if (moved) edited.push({ id: service.id, toothCode, surfaces });
    const repriced =
      entry.price !== undefined &&
      (toCents(entry.price) !== toCents(service.baseAmount) ||
        toCents(service.discountAmount) !== 0n);
    if (repriced) {
      const baseAmount = fromCents(toCents(entry.price ?? '0'));
      priced.push({ id: service.id, baseAmount });
      pricingChanged = true;
      kept.push({ ...service, toothCode, surfaces, baseAmount, discountAmount: '0.00' });
    } else {
      kept.push({ ...service, toothCode, surfaces });
    }
  }

  const added = additions.map((entry): AddedService => {
    const item = context.catalog.get(entry.procedureId);
    if (!item) throw new AmendUnknownServiceError('This service is not in the catalog');
    if (!item.active) throw new CatalogItemInactiveError(`${item.name} is inactive`);
    assertCurrency(visit.currency, item.price.currency);
    assertTarget(item.chargeUnit, entry.toothCode, entry.surfaces, entry.jaw);
    if (entry.price !== undefined && toCents(entry.price) !== toCents(item.price.amount)) {
      pricingChanged = true;
    }
    return {
      id: context.newId(),
      procedureId: item.id,
      code: item.code,
      name: item.name,
      category: item.category,
      chargeUnit: item.chargeUnit,
      toothCode: entry.toothCode ?? null,
      jaw: entry.jaw ?? null,
      surfaces: entry.surfaces,
      baseAmount: fromCents(toCents(entry.price ?? item.price.amount)),
    };
  });

  const discountChanged =
    input.discount.mode !== visit.discountMode ||
    toCents(input.discount.value) !== toCents(visit.discountValue);

  const before = snapshot(visit.services, {
    mode: visit.discountMode,
    value: visit.discountValue,
  });
  const after = snapshot(
    [...kept, ...added.map((service) => ({ ...service, discountAmount: '0.00' }))],
    { mode: input.discount.mode, value: input.discount.value },
  );
  return {
    removed,
    edited,
    priced,
    added,
    plansToReopen: removed.flatMap((service) => (service.planId === null ? [] : [service.planId])),
    before,
    after,
    delta: fromCents(toCents(after.total) - toCents(before.total)),
    pricingChanged: pricingChanged || discountChanged,
    changed:
      removed.length > 0 ||
      edited.length > 0 ||
      priced.length > 0 ||
      added.length > 0 ||
      discountChanged,
  };
}
