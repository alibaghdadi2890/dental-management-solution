import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit';
import {
  type StoredTreatmentPlan,
  TreatmentPlansRepository,
} from '../persistence/treatment-plans.repository';

/** The fields perform, its undo and cancel change, for the audit's before/after. */
export const planStatusOf = ({
  status,
  performedInVisitId,
  performedAt,
  cancelledInVisitId,
  cancelledAt,
}: StoredTreatmentPlan) => ({
  status,
  performedInVisitId,
  performedAt,
  cancelledInVisitId,
  cancelledAt,
});

/**
 * The undo of perform, shared by removing a service from a live visit (W13) and by amending a
 * completed one (4b, D2): the plan the removed service came from goes back to `planned` and its
 * `performed_*` pair is cleared, audited as `treatment_plan.unperform` (with the amendment's
 * reason, if any). The partial unique index no longer counts the removed service, so the plan can
 * be performed again. A service with a `plan_id` exists only while its plan is performed in the
 * service's visit (perform writes both, and only this undo reverts them), so anything else is a
 * broken invariant, not a user error. Runs in the caller's transaction.
 */
@Injectable()
export class PlanUnperformer {
  constructor(
    private readonly plans: TreatmentPlansRepository,
    private readonly audit: AuditService,
  ) {}

  async unperform(
    planId: string,
    visit: { id: string; patientId: string },
    reason?: string,
  ): Promise<void> {
    const before = await this.plans.lockForPatient(planId, visit.patientId);
    if (before.status !== 'performed' || before.performedInVisitId !== visit.id) {
      throw new Error(`plan ${planId} of a removed service is not performed in visit ${visit.id}`);
    }
    const after = await this.plans.update(planId, {
      status: 'planned',
      performedInVisitId: null,
      performedAt: null,
    });
    await this.audit.record({
      action: 'treatment_plan.unperform',
      resourceType: 'treatment_plan',
      resourceId: planId,
      before: planStatusOf(before),
      after: planStatusOf(after),
      reason,
    });
  }
}
