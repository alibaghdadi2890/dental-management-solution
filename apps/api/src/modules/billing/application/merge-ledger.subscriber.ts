import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import { AuditService } from '../../audit';
import { PATIENTS_MERGED, type PatientsMerged } from '../../patients';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';
import { PaymentsRepository } from '../persistence/payments.repository';
import { Settlement } from './settlement';

/**
 * The ledger re-point of a patient merge (feature 7, H8; ADR-0036): an in-transaction handler of
 * `PatientsMerged`, like `clinical`'s, so the dropped patient's entries and payments are on the
 * kept one when the merge commits, and a failure here fails the merge. The merge transaction
 * already holds both patients `FOR UPDATE`: ledger writes in flight (which hold `FOR SHARE`)
 * have committed, and none can start. The account locks are taken after the patient locks, the
 * order every ledger writer uses.
 *
 * P15: one account now — the settle lets the credit of one side meet the open charges of the
 * other. Audited as `ledger_entry.repoint` on the kept patient when anything moved. A merge chain
 * (A into B, then B into C) needs nothing more: each merge re-points in its own transaction.
 *
 * Not permission-gated: the merge already required `patient:write`.
 */
@Injectable()
export class MergeLedgerSubscriber {
  constructor(
    private readonly audit: AuditService,
    private readonly entries: LedgerEntriesRepository,
    private readonly payments: PaymentsRepository,
    private readonly settlement: Settlement,
  ) {}

  @OnDomainEventInTransaction(PATIENTS_MERGED)
  async onPatientsMerged(event: PatientsMerged): Promise<void> {
    const { keptId, droppedId } = event.payload;
    await this.settlement.lock([droppedId, keptId]);
    const count = await this.entries.repointPatient(droppedId, keptId);
    const payments = await this.payments.repointPatient(droppedId, keptId);
    if (count === 0 && payments === 0) return;
    await this.audit.record({
      action: 'ledger_entry.repoint',
      resourceType: 'patient',
      resourceId: keptId,
      after: { droppedId, keptId, count, payments },
    });
    await this.settlement.settle(keptId);
  }
}
