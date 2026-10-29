import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../audit';
import { acceptanceAfterUndo, statusWithSessions } from '../../domain/plan-lifecycle';
import { AmendPlanLinkedError } from '../../domain/visit-errors';
import { PlanSessionsRepository } from '../../persistence/plan-sessions.repository';
import {
  type StoredTreatmentPlan,
  TreatmentPlansRepository,
} from '../../persistence/treatment-plans.repository';

/** The fields start, perform, their undos and cancel change, for the audit's before/after: the
 * status pairs, and the acceptance that work records and its undo takes back (ADR-0045). */
export const planStatusOf = ({
  status,
  startedInVisitId,
  startedAt,
  performedInVisitId,
  performedAt,
  cancelledInVisitId,
  cancelledAt,
  acceptedAt,
  acceptedBy,
}: StoredTreatmentPlan) => ({
  status,
  startedInVisitId,
  startedAt,
  performedInVisitId,
  performedAt,
  cancelledInVisitId,
  cancelledAt,
  acceptedAt,
  acceptedBy,
});

/**
 * The undo of perform, shared by removing a service from a live visit (W13) and by amending a
 * completed one (4b, D2): the plan the removed service performed here goes back to `in_progress`
 * when visits worked on it before it was done (ADR-0032), else to `planned`, and its `performed_*`
 * pair is cleared, audited as `treatment_plan.unperform` (with the amendment's reason, if any).
 * The partial unique index no longer counts the removed service, so the plan can be performed
 * again. A service that only charges its plan — work started in its visit and still in progress,
 * finished in a later visit, or abandoned (ADR-0064) — leaves the plan as it is: the work is then
 * charged by the visit that completes it. Runs in the caller's transaction.
 */
@Injectable()
export class PlanUnperformer {
  constructor(
    private readonly plans: TreatmentPlansRepository,
    private readonly sessions: PlanSessionsRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * A correction may take off a service that charges work only while no later visit completed
   * that work (ADR-0064): its completion is reopened there first, else 422
   * `visit.amend_plan_linked`. Otherwise the work would be done and charged nowhere.
   */
  async assertRemovable(
    planId: string,
    visit: { id: string; patientId: string },
    name: string,
  ): Promise<void> {
    const plan = await this.plans.lockForPatient(planId, visit.patientId);
    if (plan.status === 'performed' && plan.performedInVisitId !== visit.id) {
      throw new AmendPlanLinkedError(
        `${name} was completed in a later visit; mark it not finished there first`,
      );
    }
  }

  async unperform(
    planId: string,
    visit: { id: string; patientId: string },
    reason?: string,
  ): Promise<void> {
    const before = await this.plans.lockForPatient(planId, visit.patientId);
    if (before.status !== 'performed' || before.performedInVisitId !== visit.id) return;
    const status = statusWithSessions(await this.sessions.countForPlan(planId));
    const after = await this.plans.update(planId, {
      status,
      performedInVisitId: null,
      performedAt: null,
      ...acceptanceAfterUndo(before, status, before.performedAt),
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

  /**
   * After a service of a live visit was removed and its plan put back: when this visit's session
   * is the plan's only one, the work was first added here (Not finished, then completed), so the
   * session goes too and the plan was never started — and a plan this visit recorded is removed
   * with it, as the service it stood for is gone.
   */
  async dropWorkStartedHere(
    planId: string,
    visit: { id: string; patientId: string },
    now: Date,
  ): Promise<void> {
    const before = await this.plans.lockForPatient(planId, visit.patientId);
    const session = await this.sessions.find(planId, visit.id);
    if (before.status !== 'in_progress' || !session) return;
    if ((await this.sessions.countForPlan(planId)) !== 1) return;
    await this.sessions.update(session.id, { deletedAt: now });
    const madeHere = before.recordedInVisitId === visit.id;
    const after = await this.plans.update(planId, {
      status: 'planned',
      startedInVisitId: null,
      startedAt: null,
      ...acceptanceAfterUndo(before, 'planned', before.startedAt),
      ...(madeHere && { deletedAt: now }),
    });
    await this.audit.record({
      action: 'treatment_plan.session_delete',
      resourceType: 'treatment_plan',
      resourceId: planId,
      before: { ...planStatusOf(before), visitId: visit.id, note: session.note },
      after: planStatusOf(after),
    });
    if (madeHere) {
      await this.audit.record({
        action: 'treatment_plan.delete',
        resourceType: 'treatment_plan',
        resourceId: planId,
        before,
        after: { deletedAt: after.deletedAt },
      });
    }
  }
}
