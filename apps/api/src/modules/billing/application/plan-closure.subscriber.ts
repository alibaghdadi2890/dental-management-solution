import { toCents } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import {
  TREATMENT_CANCELLED,
  TREATMENT_REMOVED,
  type TreatmentCancelled,
  type TreatmentRemoved,
  VISIT_COMPLETED,
  VISIT_DISCARDED,
  type VisitCompleted,
  type VisitDiscarded,
} from '../../clinical';
import { PatientsService } from '../../patients';
import { HoldsRepository } from '../persistence/holds.repository';
import { Settlement } from './settlement';

/**
 * Plan work can end without a ledger write (ADR-0051 A7): the last item cancelled or removed, a
 * visit that planned it discarded, a visit completed at no charge. When the patient holds money for the plan,
 * these settle the account in the triggering transaction, so the holds end with the plan. A
 * charged completion is settled by `VisitChargeSubscriber` already.
 */
@Injectable()
export class PlanClosureSubscriber {
  constructor(
    private readonly patients: PatientsService,
    private readonly holds: HoldsRepository,
    private readonly settlement: Settlement,
  ) {}

  @OnDomainEventInTransaction(TREATMENT_CANCELLED)
  async onTreatmentCancelled(event: TreatmentCancelled): Promise<void> {
    await this.settleIfHeld(event.payload.patientId);
  }

  @OnDomainEventInTransaction(TREATMENT_REMOVED)
  async onTreatmentRemoved(event: TreatmentRemoved): Promise<void> {
    await this.settleIfHeld(event.payload.patientId);
  }

  @OnDomainEventInTransaction(VISIT_DISCARDED)
  async onVisitDiscarded(event: VisitDiscarded): Promise<void> {
    await this.settleIfHeld(event.payload.patientId);
  }

  @OnDomainEventInTransaction(VISIT_COMPLETED)
  async onVisitCompleted(event: VisitCompleted): Promise<void> {
    if (toCents(event.payload.total) !== 0n) return;
    await this.settleIfHeld(event.payload.patientId);
  }

  /** Under the account lock, so a plan advance recorded at the same time is either seen here or
   * sees the plan already closed. */
  private async settleIfHeld(patientId: string): Promise<void> {
    await this.patients.lockForDependentWrite(patientId);
    await this.settlement.lock([patientId]);
    if ((await this.holds.activeFor(patientId)).length === 0) return;
    await this.settlement.settle(patientId);
  }
}
