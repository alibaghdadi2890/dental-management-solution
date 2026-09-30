import { validSurfaces, type ChargeUnit, type SurfaceKey, type ToothCode } from '@dcm/contracts';
import {
  CurrencyMismatchError,
  SurfacesInvalidError,
  ToothNotAllowedError,
  ToothRequiredError,
} from './visit-errors';

/**
 * Where a service, plan or diagnosis may be recorded (spec W11): a `per_tooth` item needs a tooth,
 * a `per_jaw` item has none, and surfaces must be ones the tooth has (`validSurfaces`: no `I` on a
 * posterior tooth, no `O` on an anterior one) — so a jaw-level item has no surfaces either.
 * Diagnoses always need a tooth: the service checks them as `per_tooth`.
 */
export function assertTarget(
  chargeUnit: ChargeUnit,
  toothCode: ToothCode | null | undefined,
  surfaces: readonly SurfaceKey[],
): void {
  if (chargeUnit === 'per_jaw') {
    if (toothCode) throw new ToothNotAllowedError('A per-jaw item is not recorded on a tooth');
    if (surfaces.length > 0) throw new SurfacesInvalidError('A per-jaw item has no surfaces');
    return;
  }
  if (!toothCode) throw new ToothRequiredError('A per-tooth item needs a tooth');
  if (!validSurfaces(toothCode, surfaces)) {
    throw new SurfacesInvalidError(`Tooth ${toothCode} does not have these surfaces`);
  }
}

/** Every price on a visit is in the visit's currency, fixed when it started (spec W12). */
export function assertCurrency(visitCurrency: string, priceCurrency: string): void {
  if (visitCurrency !== priceCurrency) {
    throw new CurrencyMismatchError(
      `The price is in ${priceCurrency}; this visit is in ${visitCurrency}`,
    );
  }
}
