import {
  toCents,
  validSurfaces,
  type ChargeUnit,
  type Jaw,
  type SurfaceKey,
  type ToothCode,
} from '@dcm/contracts';
import { ValidationFailedError } from '../../../platform/kernel/validation-failed.error';
import {
  CurrencyMismatchError,
  JawNotAllowedError,
  JawRequiredError,
  SurfacesInvalidError,
  ToothNotAllowedError,
  ToothRequiredError,
} from './visit-errors';

/**
 * Where a service, plan or diagnosis may be recorded (spec W11; levels L2). The target follows the
 * charge unit: a `per_tooth` item needs a tooth and no jaw, a `per_jaw` item a jaw and no tooth, a
 * `per_mouth` item neither. Surfaces must be ones the tooth has (`validSurfaces`: no `I` on a
 * posterior tooth, no `O` on an anterior one) — so a jaw- or mouth-level item has no surfaces.
 * Diagnoses always need a tooth: the service checks them as `per_tooth`.
 */
export function assertTarget(
  chargeUnit: ChargeUnit,
  toothCode: ToothCode | null | undefined,
  surfaces: readonly SurfaceKey[],
  jaw?: Jaw | null,
): void {
  if (chargeUnit === 'per_tooth') {
    if (jaw) throw new JawNotAllowedError('A per-tooth item is not recorded on a jaw');
    if (!toothCode) throw new ToothRequiredError('A per-tooth item needs a tooth');
    if (!validSurfaces(toothCode, surfaces)) {
      throw new SurfacesInvalidError(`Tooth ${toothCode} does not have these surfaces`);
    }
    return;
  }
  if (toothCode) {
    throw new ToothNotAllowedError('A jaw or whole-mouth item is not recorded on a tooth');
  }
  if (surfaces.length > 0) {
    throw new SurfacesInvalidError('A jaw or whole-mouth item has no surfaces');
  }
  if (chargeUnit === 'per_jaw') {
    if (!jaw) throw new JawRequiredError('A per-jaw item needs the upper or the lower jaw');
  } else if (jaw) {
    throw new JawNotAllowedError('A whole-mouth item is not recorded on a jaw');
  }
}

/**
 * Whether a diagnosis or plan may be removed from the patient record (ADR-0031, P2): only one
 * recorded there, outside a visit. One recorded in a visit is part of that visit's record: a
 * visit resolves the diagnosis, and the plan is cancelled.
 */
export function isRemovableOutsideVisit(record: { recordedInVisitId: string | null }): boolean {
  return record.recordedInVisitId === null;
}

/** Every price on a visit is in the visit's currency, fixed when it started (spec W12). */
export function assertCurrency(visitCurrency: string, priceCurrency: string): void {
  if (visitCurrency !== priceCurrency) {
    throw new CurrencyMismatchError(
      `The price is in ${priceCurrency}; this visit is in ${visitCurrency}`,
    );
  }
}

/**
 * A service's price after an edit (spec §VisitRecordsService): the line discount stays within the
 * base (`visit_services_discount_within_base`). A breach is reported at the field the edit
 * changed — the discount when it was sent, else the base that dropped below it.
 */
export function assertLinePrice(
  price: { baseAmount: string; discountAmount: string },
  changed: 'baseAmount' | 'discountAmount',
): void {
  if (toCents(price.discountAmount) > toCents(price.baseAmount)) {
    throw new ValidationFailedError('The discount is more than the price', [
      {
        path: changed,
        code: 'discount_above_base',
        message: 'The discount cannot be more than the price',
      },
    ]);
  }
}
