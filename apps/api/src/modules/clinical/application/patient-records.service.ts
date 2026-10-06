import type {
  PatientChartResult,
  PlanGroupInput,
  PlanPatientTreatmentInput,
  RecordPatientDiagnosisInput,
  UpdatePlanInput,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import { AuditService } from '../../audit';
import { PatientArchivedError, PatientsService } from '../../patients';
import { UsersService } from '../../users';
import { assertOpen } from '../domain/plan-lifecycle';
import { isRemovableOutsideVisit } from '../domain/record-rules';
import {
  DentistInvalidError,
  PlanNotOpenError,
  RecordDentistRequiredError,
  RecordNotRemovableError,
} from '../domain/visit-errors';
import { TREATMENT_CANCELLED, type TreatmentCancelled } from '../events/record-events';
import { PatientDiagnosesRepository } from '../persistence/patient-diagnoses.repository';
import { PlanGroupsRepository } from '../persistence/plan-groups.repository';
import { TreatmentPlansRepository } from '../persistence/treatment-plans.repository';
import { ChartService } from './chart.service';
import { planStatusOf } from './plan-unperformer';
import { RecordWriter } from './record-writer';

/** What one change on the patient record sees: the patient (locked), the actor and the clock. */
interface Change {
  patientId: string;
  userId: string;
  now: Date;
}

const DIAGNOSIS = 'diagnosis_record';
const PLAN = 'treatment_plan';
const GROUP = 'plan_group';

/**
 * Charting on the patient record, outside a visit (docs/modules/clinical.md, ADR-0031): a dentist
 * records what they found and what they intend to do without starting a visit. Diagnoses are
 * recorded and, when recorded here, removed; plans are added, edited, cancelled and, when added
 * here, removed; named plans group them. Resolving a diagnosis, performing a plan, services and
 * tooth presence stay inside a visit (`VisitRecordsService`): they describe what happened in the
 * chair.
 *
 * Every method re-checks `chart:write`, runs in one `TenantDb` transaction and locks the patient
 * `FOR SHARE` (`lockForDependentWrite`, so a merge waits): unknown → 404, merged → 409
 * `patient.merged`, archived → 409 `patient.archived`. The record's dentist is the given
 * `dentistId`, else the caller when they are a dentist (P4). Changes are audited like their
 * in-visit twins, with no visit, and answer with the patient's chart as it now is.
 */
@Injectable()
export class PatientRecordsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
    private readonly users: UsersService,
    private readonly chart: ChartService,
    private readonly writer: RecordWriter,
    private readonly diagnoses: PatientDiagnosesRepository,
    private readonly plans: TreatmentPlansRepository,
    private readonly groups: PlanGroupsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Diagnoses ---

  /** On a tooth always (W11), dated now. `DiagnosisRecorded` with no visit. */
  recordDiagnosis(
    patientId: string,
    input: RecordPatientDiagnosisInput,
  ): Promise<PatientChartResult> {
    return this.onPatient(patientId, async (change) => {
      const dentistId = await this.dentistFor(change.userId, input.dentistId);
      await this.writer.recordDiagnosis({ ...change, visitId: null, dentistId }, input);
    });
  }

  /**
   * Only a diagnosis recorded outside a visit that no visit has resolved since (else 409
   * `record.not_removable`: the resolution is part of that visit's record). Plans linked to it are
   * unlinked, then it is soft-deleted.
   */
  removeDiagnosis(patientId: string, recordId: string): Promise<PatientChartResult> {
    return this.onPatient(patientId, async ({ now }) => {
      const { record: before } = await this.diagnoses.lockForPatient(recordId, patientId);
      if (!isRemovableOutsideVisit(before) || before.status !== 'active') {
        throw new RecordNotRemovableError(
          'Only an active diagnosis recorded outside a visit can be removed here',
        );
      }
      const unlinkedPlanIds = await this.plans.unlinkDiagnosis(patientId, recordId);
      const after = await this.diagnoses.update(recordId, { deletedAt: now });
      await this.audit.record({
        action: `${DIAGNOSIS}.delete`,
        resourceType: DIAGNOSIS,
        resourceId: recordId,
        before,
        after: { deletedAt: after.deletedAt, unlinkedPlanIds },
      });
    });
  }

  // --- Plans ---

  /** A catalog service planned at its catalog price (a snapshot). `TreatmentPlanned`, no visit. */
  planTreatment(patientId: string, input: PlanPatientTreatmentInput): Promise<PatientChartResult> {
    return this.onPatient(patientId, async (change) => {
      const dentistId = await this.dentistFor(change.userId, input.dentistId);
      await this.writer.planTreatment({ ...change, visitId: null, dentistId }, input);
    });
  }

  /**
   * Moves an open plan (planned or in progress) into one of the patient's named plans (or out,
   * `groupId: null`) and edits its note. A plan that is no longer open → 409 `plan.not_open`.
   * Unchanged → no audit.
   */
  updatePlan(
    patientId: string,
    planId: string,
    input: UpdatePlanInput,
  ): Promise<PatientChartResult> {
    return this.onPatient(patientId, async () => {
      // The target group first, then the plan: `deleteGroup` locks in the same order.
      if (input.groupId) await this.groups.lockForPatient(input.groupId, patientId);
      const before = await this.plans.lockForPatient(planId, patientId);
      assertOpen(before);
      const groupId = input.groupId === undefined ? before.groupId : input.groupId;
      const note = input.note === undefined ? before.note : input.note;
      if (groupId === before.groupId && note === before.note) return;
      const after = await this.plans.update(planId, { groupId, note });
      await this.audit.record({
        action: `${PLAN}.update`,
        resourceType: PLAN,
        resourceId: planId,
        before: { groupId: before.groupId, note: before.note },
        after: { groupId: after.groupId, note: after.note },
      });
    });
  }

  /**
   * An open plan, whichever visit (or none) recorded it: planned, or abandoned while in progress
   * (nothing was charged for it, ADR-0032). `TreatmentCancelled`, no visit.
   */
  cancelPlan(patientId: string, planId: string): Promise<PatientChartResult> {
    return this.onPatient(patientId, async ({ now }) => {
      const before = await this.plans.lockForPatient(planId, patientId);
      assertOpen(before);
      const after = await this.plans.update(planId, { status: 'cancelled', cancelledAt: now });
      await this.audit.record({
        action: `${PLAN}.cancel`,
        resourceType: PLAN,
        resourceId: planId,
        before: planStatusOf(before),
        after: planStatusOf(after),
      });
      const event: TreatmentCancelled = this.events.create(TREATMENT_CANCELLED, {
        planId,
        visitId: null,
        patientId,
        toothCode: after.toothCode,
      });
      await this.events.publish(event);
    });
  }

  /**
   * Only a plan made outside a visit and still `planned` (else 409 `record.not_removable`, or 409
   * `plan.not_open`): one made in a visit is cancelled. Soft delete.
   */
  removePlan(patientId: string, planId: string): Promise<PatientChartResult> {
    return this.onPatient(patientId, async ({ now }) => {
      const before = await this.plans.lockForPatient(planId, patientId);
      if (!isRemovableOutsideVisit(before)) {
        throw new RecordNotRemovableError('A plan made in a visit is cancelled, not removed');
      }
      if (before.status !== 'planned') throw new PlanNotOpenError(`This plan is ${before.status}`);
      const after = await this.plans.update(planId, { deletedAt: now });
      await this.audit.record({
        action: `${PLAN}.delete`,
        resourceType: PLAN,
        resourceId: planId,
        before,
        after: { deletedAt: after.deletedAt },
      });
    });
  }

  // --- Named plans ---

  createGroup(patientId: string, input: PlanGroupInput): Promise<PatientChartResult> {
    return this.onPatient(patientId, async ({ userId }) => {
      const group = await this.groups.insert({
        patientId,
        title: input.title,
        note: input.note,
        createdBy: userId,
      });
      await this.audit.record({
        action: `${GROUP}.create`,
        resourceType: GROUP,
        resourceId: group.id,
        after: group,
      });
    });
  }

  /** The title and note. Unchanged → no audit. */
  updateGroup(
    patientId: string,
    groupId: string,
    input: PlanGroupInput,
  ): Promise<PatientChartResult> {
    return this.onPatient(patientId, async () => {
      const before = await this.groups.lockForPatient(groupId, patientId);
      if (before.title === input.title && before.note === input.note) return;
      const after = await this.groups.update(groupId, { title: input.title, note: input.note });
      await this.audit.record({
        action: `${GROUP}.update`,
        resourceType: GROUP,
        resourceId: groupId,
        before: { title: before.title, note: before.note },
        after: { title: after.title, note: after.note },
      });
    });
  }

  /** Ungroups its plans (they stay as they are), then soft-deletes the named plan. */
  deleteGroup(patientId: string, groupId: string): Promise<PatientChartResult> {
    return this.onPatient(patientId, async ({ now }) => {
      const before = await this.groups.lockForPatient(groupId, patientId);
      const ungroupedPlanIds = await this.plans.ungroup(patientId, groupId);
      const after = await this.groups.update(groupId, { deletedAt: now });
      await this.audit.record({
        action: `${GROUP}.delete`,
        resourceType: GROUP,
        resourceId: groupId,
        before,
        after: { deletedAt: after.deletedAt, ungroupedPlanIds },
      });
    });
  }

  // --- Shared rules ---

  /**
   * One change on the patient record: `chart:write`, one transaction, the patient locked
   * `FOR SHARE` and not archived, then `work`. Answers with the chart as it now is.
   */
  private async onPatient(
    patientId: string,
    work: (change: Change) => Promise<void>,
  ): Promise<PatientChartResult> {
    this.context.requirePermission('chart:write');
    const userId = this.context.requireUserId();
    return this.tenantDb.run(async () => {
      const patient = await this.patients.lockForDependentWrite(patientId);
      if (patient.archivedAt !== null) {
        throw new PatientArchivedError('Archived patients cannot be charted; restore them first');
      }
      await work({ patientId: patient.id, userId, now: this.clock.now() });
      return { chart: await this.chart.chart(patient.id) };
    });
  }

  /**
   * The record's dentist (P4), a staff profile id: `dentistId` when given — it must be an active
   * dentist of the clinic, else 422 `visit.dentist_invalid` — else the caller when they are one,
   * else 422 `record.dentist_required` (an owner who isn't a dentist, a platform admin).
   */
  private async dentistFor(userId: string, dentistId: string | undefined): Promise<string> {
    const dentists = await this.users.listPractitioners();
    if (dentistId !== undefined) {
      if (!dentists.some((dentist) => dentist.id === dentistId)) {
        throw new DentistInvalidError('Choose an active dentist of this clinic');
      }
      return dentistId;
    }
    const caller = dentists.find((dentist) => dentist.userId === userId);
    if (!caller) throw new RecordDentistRequiredError('Choose the dentist this record is for');
    return caller.id;
  }
}
