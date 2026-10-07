import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import { AuditService } from '../../audit';
import { PATIENTS_MERGED, type PatientsMerged } from '../../patients';
import { PatientDiagnosesRepository } from '../persistence/patient-diagnoses.repository';
import { PlanGroupsRepository } from '../persistence/plan-groups.repository';
import { ToothPresenceRepository } from '../persistence/tooth-presence.repository';
import { TreatmentPlansRepository } from '../persistence/treatment-plans.repository';
import { VisitsRepository } from '../persistence/visits.repository';

/**
 * The clinical re-point of a patient merge (spec §Merge re-point, V10, W24): an in-transaction
 * handler of `PatientsMerged`, so it runs inside the merge's transaction, which already holds
 * both patients `FOR UPDATE`, and a failure here fails the merge. A visit's `patient_id` is
 * therefore always a live patient, and a charge posted at completion lands on the kept one.
 *
 * Visits move first: their row locks serialise the re-point against charting in flight (see
 * `VisitsRepository.repointPatient`). Then diagnoses, plans, named plans and the tooth presence
 * rows (feature 7: history, so all of them move). A merge chain (A into B, then B into C) needs nothing
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
    private readonly groups: PlanGroupsRepository,
    private readonly presences: ToothPresenceRepository,
  ) {}

  @OnDomainEventInTransaction(PATIENTS_MERGED)
  async onPatientsMerged(event: PatientsMerged): Promise<void> {
    const { keptId, droppedId } = event.payload;
    const visits = await this.visits.repointPatient(droppedId, keptId);
    const diagnoses = await this.diagnoses.repointPatient(droppedId, keptId);
    const plans = await this.plans.repointPatient(droppedId, keptId);
    const planGroups = await this.groups.repointPatient(droppedId, keptId);
    // History, not state: every row moves, and the last one recorded on a tooth, whichever
    // record it came from, is that tooth's presence on the kept patient.
    const toothPresences = await this.presences.repointPatient(droppedId, keptId);
    const counts = { visits, diagnoses, plans, planGroups, toothPresences };
    if (Object.values(counts).every((count) => count === 0)) return;
    await this.audit.record({
      action: 'clinical.repoint',
      resourceType: 'patient',
      resourceId: keptId,
      after: { droppedId, ...counts },
    });
  }
}
