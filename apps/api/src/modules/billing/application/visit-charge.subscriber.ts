import { toCents } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import {
  VISIT_COMPLETED,
  type VisitChargeFacts,
  type VisitCompleted,
  VisitsService,
} from '../../clinical';
import { PatientsService } from '../../patients';
import { LedgerWriter } from './ledger-writer';

/**
 * Posts the visit charge (spec W2, ADR-0024): an in-transaction handler of `VisitCompleted`, so it
 * runs in the completing request's context and transaction, before commit. The completion and
 * its charge commit together, or a failure here rolls the completion back and the visit stays
 * live. A zero total posts nothing (W20: the ledger refuses 0). A second charge for one visit
 * violates `ledger_entries_visit_unique`; that can only be a bug, so it is raised, not ignored.
 *
 * Not gated by `payment:write`: an assistant completes visits without holding it, and the trigger
 * (`complete`) already required `visit:write`.
 */
@Injectable()
export class VisitChargeSubscriber {
  constructor(
    private readonly context: RequestContext,
    private readonly patients: PatientsService,
    private readonly visits: VisitsService,
    private readonly writer: LedgerWriter,
  ) {}

  @OnDomainEventInTransaction(VISIT_COMPLETED)
  async onVisitCompleted(event: VisitCompleted): Promise<void> {
    if (toCents(event.payload.total) === 0n) return;
    const facts = await this.visits.chargeFacts(event.payload.visitId);
    await this.recordVisitCharge(event.payload.visitId, facts);
  }

  /**
   * The `visit_charge` entry — the visit total, on its local date, by the completing user (W10) —
   * and its lines. The patient lock is already held by `complete` (re-entrant).
   */
  private async recordVisitCharge(visitId: string, facts: VisitChargeFacts): Promise<void> {
    await this.patients.lockForDependentWrite(facts.patientId);
    await this.writer.append(
      {
        patientId: facts.patientId,
        kind: 'visit_charge',
        amount: facts.total,
        currency: facts.currency,
        effectiveDate: facts.localDate,
        note: null,
        reason: null,
        createdBy: this.context.requireUserId(),
        visitId,
      },
      facts.lines.map((line, index) => ({
        position: index + 1,
        ...line,
        currency: facts.currency,
      })),
    );
  }
}
