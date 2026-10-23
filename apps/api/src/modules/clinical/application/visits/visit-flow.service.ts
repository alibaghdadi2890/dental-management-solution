import {
  hasStep,
  type VisitComplaintInput,
  type VisitReasonInput,
  type VisitResult,
  type VisitStepInput,
  type VisitViewInput,
  WORKLIST_MAX,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../../platform/clock/clock.module';
import { RequestContext } from '../../../../platform/cls/request-context';
import { TenantDb } from '../../../../platform/db/tenant-db';
import { EventBus } from '../../../../platform/events/event-bus';
import type { Clock } from '../../../../platform/kernel/clock';
import { AuditService } from '../../../audit';
import {
  ComplaintNotAllowedError,
  VisitPlanInvalidError,
  VisitPlansNotAllowedError,
  VisitStepInvalidError,
} from '../../domain/visit-errors';
import { MEDICAL_HISTORY_CONFIRMED, type MedicalHistoryConfirmed } from '../../events/visit-events';
import { TreatmentPlansRepository } from '../../persistence/treatment-plans.repository';
import { VisitPlanItemsRepository } from '../../persistence/visit-plan-items.repository';
import {
  type StoredVisit,
  type VisitPatch,
  VisitsRepository,
} from '../../persistence/visits.repository';
import { VisitPresenter } from './visit-presenter';
import { assertVisitInScope } from './visit-scope';

const VISIT = 'visit';

/** One flow change: the fields to write and how it is audited; null changes nothing. */
interface FlowChange {
  patch: VisitPatch;
  action: string;
  /** Navigation, not a clinical fact: in the log, out of the Activity feed. */
  hidden?: boolean;
}

/**
 * Where a live visit is in its flow and what it was told at the start of it (feature 10,
 * ADR-0044, ADR-0046, ADR-0048; docs/modules/clinical.md): the step and the Steps | All view, the
 * reason and an emergency's complaint, the dentist's confirmation of the medical history, and
 * which planned treatments are on its list for today. Every method runs in one `TenantDb` transaction, locks
 * the visit `FOR UPDATE` and refuses unless it is live (409 `visit.not_live`), is audited with
 * before/after, and answers `{ visit }`. A change that changes nothing writes and audits
 * nothing. Everything needs `visit:write` but the confirmation, a dentist's: `chart:write`.
 */
@Injectable()
export class VisitFlowService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly visits: VisitsRepository,
    private readonly plans: TreatmentPlansRepository,
    private readonly worklist: VisitPlanItemsRepository,
    private readonly presenter: VisitPresenter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Any step a visit of this type can show (422 `visit.step_invalid` otherwise), at any time:
   * the stepper is navigation, never a gate. Last write wins (W6).
   */
  setStep(id: string, input: VisitStepInput): Promise<VisitResult> {
    return this.change(id, 'visit:write', (visit) => {
      if (!hasStep(visit.type, input.step)) {
        throw new VisitStepInvalidError(`A ${visit.type} visit has no ${input.step} step`);
      }
      return visit.currentStep === input.step
        ? null
        : { patch: { currentStep: input.step }, action: 'visit.step', hidden: true };
    });
  }

  /** The Steps | All toggle, remembered with the visit. */
  setView(id: string, input: VisitViewInput): Promise<VisitResult> {
    return this.change(id, 'visit:write', (visit) =>
      visit.viewMode === input.viewMode
        ? null
        : { patch: { viewMode: input.viewMode }, action: 'visit.view', hidden: true },
    );
  }

  /** The chief complaint, as the patient put it; blank clears it. */
  setReason(id: string, input: VisitReasonInput): Promise<VisitResult> {
    return this.change(id, 'visit:write', (visit) =>
      visit.reason === input.reason
        ? null
        : { patch: { reason: input.reason }, action: 'visit.update' },
    );
  }

  /** An emergency's pain score and how long it has lasted (422 for another type of visit). */
  setComplaint(id: string, input: VisitComplaintInput): Promise<VisitResult> {
    return this.change(id, 'visit:write', (visit) => {
      if (visit.type !== 'emergency') {
        throw new ComplaintNotAllowedError('Only an emergency visit records a pain score');
      }
      return visit.painScore === input.painScore && visit.painSince === input.painSince
        ? null
        : {
            patch: { painScore: input.painScore, painSince: input.painSince },
            action: 'visit.update',
          };
    });
  }

  /**
   * "Confirmed with the patient": the dentist went through the medical history at this visit's
   * Intake (ADR-0046). A second confirmation keeps the first. `MedicalHistoryConfirmed`.
   */
  confirmHistory(id: string): Promise<VisitResult> {
    return this.change(id, 'chart:write', (visit, now) =>
      visit.historyConfirmedAt !== null
        ? null
        : {
            patch: { historyConfirmedAt: now, historyConfirmedBy: this.context.requireUserId() },
            action: 'visit.history_confirm',
          },
    );
  }

  /** Takes the confirmation back (the box unticked). */
  unconfirmHistory(id: string): Promise<VisitResult> {
    return this.change(id, 'chart:write', (visit) =>
      visit.historyConfirmedAt === null
        ? null
        : {
            patch: { historyConfirmedAt: null, historyConfirmedBy: null },
            action: 'visit.history_unconfirm',
          },
    );
  }

  /**
   * Today's work ticks a planned treatment onto the visit's list (`listed`) or off it
   * (ADR-0048). Only a treatment or hygiene visit keeps a list (422 `visit.plans_not_allowed`),
   * and only an open plan of the visit's patient goes on it (422 `visit.plan_invalid`); taking
   * one off needs nothing of the plan. A change that changes nothing writes nothing. It records
   * what the visit intends, not what it did: the audit row is hidden from the Activity feed.
   */
  async setWorkItem(id: string, planId: string, listed: boolean): Promise<VisitResult> {
    this.context.requirePermission('visit:write');
    return this.tenantDb.run(async () => {
      const visit = await this.visits.lockLive(id);
      assertVisitInScope(this.context, visit);
      const list = await this.worklist.listForVisit(id);
      const onList = list.some((item) => item.planId === planId);
      if (listed && !onList) {
        if (visit.type !== 'treatment' && visit.type !== 'hygiene') {
          throw new VisitPlansNotAllowedError('This type of visit keeps no list of planned work');
        }
        if (list.length >= WORKLIST_MAX) {
          throw new VisitPlanInvalidError('The list for today is full');
        }
        const open = await this.plans.listOpenForPatient(visit.patientId);
        if (!open.some((plan) => plan.id === planId)) {
          throw new VisitPlanInvalidError("Pick among the patient's open planned treatments");
        }
        await this.worklist.add(id, planId, this.context.requireUserId());
      }
      if (!listed && onList) await this.worklist.remove(id, planId);
      if (listed !== onList) {
        await this.audit.record({
          action: listed ? 'visit.worklist_add' : 'visit.worklist_remove',
          resourceType: VISIT,
          resourceId: id,
          patientId: visit.patientId,
          after: { planId },
          hidden: true,
        });
      }
      return { visit: await this.presenter.present(visit) };
    });
  }

  /** One flow change on the locked, live visit; see the class comment. */
  private async change(
    id: string,
    permission: 'visit:write' | 'chart:write',
    decide: (visit: StoredVisit, now: Date) => FlowChange | null,
  ): Promise<VisitResult> {
    this.context.requirePermission(permission);
    return this.tenantDb.run(async () => {
      const before = await this.visits.lockLive(id);
      assertVisitInScope(this.context, before);
      const change = decide(before, this.clock.now());
      if (!change) return { visit: await this.presenter.present(before) };
      const after = await this.visits.update(id, change.patch);
      const fields = Object.keys(change.patch) as (keyof VisitPatch)[];
      await this.audit.record({
        action: change.action,
        resourceType: VISIT,
        resourceId: id,
        patientId: before.patientId,
        before: Object.fromEntries(fields.map((field) => [field, before[field]])),
        after: Object.fromEntries(fields.map((field) => [field, after[field]])),
        hidden: change.hidden,
      });
      if (change.action === 'visit.history_confirm') {
        const event: MedicalHistoryConfirmed = this.events.create(MEDICAL_HISTORY_CONFIRMED, {
          visitId: id,
          patientId: after.patientId,
        });
        await this.events.publish(event);
      }
      return { visit: await this.presenter.present(after) };
    });
  }
}
