import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import { AuditService } from '../../audit';
import { PATIENTS_MERGED, type PatientsMerged } from '../../patients';
import { PatientDiagnosesRepository } from '../persistence/patient-diagnoses.repository';
import { ToothStatusRepository } from '../persistence/tooth-status.repository';
import { TreatmentPlansRepository } from '../persistence/treatment-plans.repository';
import { VisitsRepository } from '../persistence/visits.repository';

/**
 * The clinical re-point of a patient merge (spec §Merge re-point, V10, W24): an in-transaction
 * handler of `PatientsMerged`, so it runs inside the merge's transaction, which already holds
 * both patients `FOR UPDATE`, and a failure here fails the merge. A visit's `patient_id` is
 * therefore always a live patient, and a charge posted at completion lands on the kept one.
 *
 * Visits move first: their row locks serialise the re-point against charting in flight (see
 * `VisitsRepository.repointPatient`). Then diagnoses, plans and tooth status, where the kept
 * patient's row wins at a shared position (the dropped rows it replaces are the audit's
 * `before`). A merge chain (A into B, then B into C) needs nothing
 * more: each merge re-points in its own transaction. Audited as `clinical.repoint` on the kept
 * patient, with the counts, when anything changed.
 *
 * Not permission-gated: the merge already required `patient:write`, and front desk merges
 * patients without holding `visit:write`.
 */
@Injectable()
export class MergeClinicalSubscriber {
  constructor(
    private readonly audit: AuditService,
    private readonly visits: VisitsRepository,
    private readonly diagnoses: PatientDiagnosesRepository,
    private readonly plans: TreatmentPlansRepository,
    private readonly teeth: ToothStatusRepository,
  ) {}

  @OnDomainEventInTransaction(PATIENTS_MERGED)
  async onPatientsMerged(event: PatientsMerged): Promise<void> {
    const { keptId, droppedId } = event.payload;
    const visits = await this.visits.repointPatient(droppedId, keptId);
    const diagnoses = await this.diagnoses.repointPatient(droppedId, keptId);
    const plans = await this.plans.repointPatient(droppedId, keptId);
    const teeth = await this.teeth.mergeInto(droppedId, keptId);
    const counts = {
      visits,
      diagnoses,
      plans,
      toothStatusMoved: teeth.moved,
      toothStatusDropped: teeth.dropped.length,
    };
    if (Object.values(counts).every((count) => count === 0)) return;
    await this.audit.record({
      action: 'clinical.repoint',
      resourceType: 'patient',
      resourceId: keptId,
      // The dropped patient's tooth status lost on a clash is gone; the audit keeps it.
      before: teeth.dropped.length > 0 ? { toothStatusDropped: teeth.dropped } : undefined,
      after: { droppedId, ...counts },
    });
  }
}
