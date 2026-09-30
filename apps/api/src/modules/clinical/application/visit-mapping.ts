import {
  lineFinal,
  surfacesSchema,
  toothCodeSchema,
  type Visit,
  type VisitService,
  visitMoney,
} from '@dcm/contracts';
import type { StoredVisitService } from '../persistence/visit-services.repository';
import type { StoredVisit } from '../persistence/visits.repository';

/** A service line in the visit currency; `final` = base − line discount. */
export function toVisitService(service: StoredVisitService, currency: string): VisitService {
  const line = { base: service.baseAmount, discount: service.discountAmount };
  return {
    id: service.id,
    procedureId: service.procedureId,
    code: service.code,
    name: service.name,
    category: service.category,
    chargeUnit: service.chargeUnit,
    // The table's CHECKs admit exactly the contract's codes and surface keys.
    toothCode: service.toothCode === null ? null : toothCodeSchema.parse(service.toothCode),
    surfaces: surfacesSchema.parse(service.surfaces),
    base: { amount: service.baseAmount, currency },
    discount: { amount: service.discountAmount, currency },
    final: { amount: lineFinal(line), currency },
    planId: service.planId,
    recordedBy: service.recordedBy,
    createdAt: service.createdAt.toISOString(),
  };
}

/**
 * The `Visit` the API answers with: the row, its services and the money — computed from the
 * services while the visit is live (the same `visitMoney` the SPA previews with), the frozen
 * totals once it is completed. `serverNow` lets the client run the timer from an offset.
 */
export function toVisit(visit: StoredVisit, services: StoredVisitService[], now: Date): Visit {
  const computed = visitMoney(
    services.map((service) => ({ base: service.baseAmount, discount: service.discountAmount })),
    visit.discountMode,
    visit.discountValue,
  );
  const { subtotal, discountAmount, total } = visit;
  const money =
    subtotal !== null && discountAmount !== null && total !== null
      ? { subtotal, discount: discountAmount, total, capped: computed.capped }
      : computed;
  return {
    id: visit.id,
    patientId: visit.patientId,
    branchId: visit.branchId,
    roomId: visit.roomId,
    dentistId: visit.dentistId,
    startedBy: visit.startedBy,
    status: visit.status,
    localDate: visit.localDate,
    startedAt: visit.startedAt.toISOString(),
    pausedAt: visit.pausedAt?.toISOString() ?? null,
    pausedSeconds: visit.pausedSeconds,
    completedAt: visit.completedAt?.toISOString() ?? null,
    durationMinutes: visit.durationMinutes,
    notes: visit.notes,
    discountMode: visit.discountMode,
    discountValue: visit.discountValue,
    currency: visit.currency,
    services: services.map((service) => toVisitService(service, visit.currency)),
    money,
    serverNow: now.toISOString(),
  };
}
