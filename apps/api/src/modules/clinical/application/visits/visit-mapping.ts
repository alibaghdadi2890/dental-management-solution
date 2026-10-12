import {
  lineFinal,
  surfacesSchema,
  toothCodeSchema,
  type Visit,
  type VisitMoney,
  type VisitService,
  visitMoney,
} from '@dcm/contracts';
import type { WorklistRow } from '../../persistence/visit-plan-items.repository';
import type { StoredVisitService } from '../../persistence/visit-services.repository';
import type { StoredVisit } from '../../persistence/visits.repository';

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
    jaw: service.jaw,
    surfaces: surfacesSchema.parse(service.surfaces),
    base: { amount: service.baseAmount, currency },
    discount: { amount: service.discountAmount, currency },
    final: { amount: lineFinal(line), currency },
    planId: service.planId,
    autoAdded: service.autoAdded,
    recordedBy: service.recordedBy,
    createdAt: service.createdAt.toISOString(),
  };
}

/** The money computed from the services (the same `visitMoney` the SPA previews with). */
export function computedMoney(visit: StoredVisit, services: StoredVisitService[]): VisitMoney {
  return visitMoney(
    services.map((service) => ({ base: service.baseAmount, discount: service.discountAmount })),
    visit.discountMode,
    visit.discountValue,
  );
}

/** The visit's money: computed while it is live, the totals frozen at completion after. */
export function moneyOf(visit: StoredVisit, services: StoredVisitService[]): VisitMoney {
  const computed = computedMoney(visit, services);
  const { subtotal, discountAmount, total } = visit;
  return subtotal !== null && discountAmount !== null && total !== null
    ? { subtotal, discount: discountAmount, total, capped: computed.capped }
    : computed;
}

/** What a `Visit` shows beyond its own row. */
export interface VisitParts {
  services: StoredVisitService[];
  worklist: readonly WorklistRow[];
  /** The display name of who confirmed the medical history; unused when nobody has. */
  confirmedByName: string;
  now: Date;
}

/**
 * The `Visit` the API answers with: the row, its services, worklist and the money (`moneyOf`).
 * `serverNow` lets the client run the timer from an offset.
 */
export function toVisit(
  visit: StoredVisit,
  { services, worklist, confirmedByName, now }: VisitParts,
): Visit {
  return {
    id: visit.id,
    displayNumber: visit.displayNumber,
    patientId: visit.patientId,
    branchId: visit.branchId,
    roomId: visit.roomId,
    dentistId: visit.dentistId,
    startedBy: visit.startedBy,
    type: visit.type,
    currentStep: visit.currentStep,
    viewMode: visit.viewMode,
    reason: visit.reason,
    painScore: visit.painScore,
    painSince: visit.painSince,
    historyConfirmation:
      visit.historyConfirmedAt !== null && visit.historyConfirmedBy !== null
        ? {
            at: visit.historyConfirmedAt.toISOString(),
            by: visit.historyConfirmedBy,
            byName: confirmedByName,
          }
        : null,
    worklist: worklist.map(({ planId }) => ({ planId })),
    status: visit.status,
    localDate: visit.localDate,
    startedAt: visit.startedAt.toISOString(),
    pausedAt: visit.pausedAt?.toISOString() ?? null,
    pausedSeconds: visit.pausedSeconds,
    completedAt: visit.completedAt?.toISOString() ?? null,
    completedBy: visit.completedBy,
    durationMinutes: visit.durationMinutes,
    notes: visit.notes,
    discountMode: visit.discountMode,
    discountValue: visit.discountValue,
    currency: visit.currency,
    services: services.map((service) => toVisitService(service, visit.currency)),
    money: moneyOf(visit, services),
    voidedAt: visit.voidedAt?.toISOString() ?? null,
    voidReason: visit.voidReason,
    updatedAt: visit.updatedAt.toISOString(),
    serverNow: now.toISOString(),
  };
}
