import type {
  PatientChartResult,
  PatientPresenceResult,
  PlanPatientTreatmentInput,
  RecordPatientDiagnosisInput,
  SeenOnInput,
  SetPresenceOnPatientInput,
  UpdatePlanInput,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../../platform/clock/clock.module';
import { RequestContext } from '../../../../platform/cls/request-context';
import { TenantDb } from '../../../../platform/db/tenant-db';
import { EventBus } from '../../../../platform/events/event-bus';
import type { Clock } from '../../../../platform/kernel/clock';
import { localDate } from '../../../../platform/kernel/local-date';
import { ValidationFailedError } from '../../../../platform/kernel/validation-failed.error';
import { AuditService } from '../../../audit';
import { PatientArchivedError, PatientsService } from '../../../patients';
import { TenancyService } from '../../../tenancy';
import { UsersService } from '../../../users';
import { acceptancePatch, assertOpen } from '../../domain/plan-lifecycle';
import { isRemovableOutsideVisit } from '../../domain/record-rules';
import {
  DentistInvalidError,
  PlanNotOpenError,
  RecordDentistRequiredError,
  RecordNotFoundError,
  RecordNotRemovableError,
} from '../../domain/visit-errors';
import {
  TREATMENT_ACCEPTED,
  TREATMENT_CANCELLED,
  type TreatmentAccepted,
  type TreatmentCancelled,
} from '../../events/record-events';
import { PatientDiagnosesRepository } from '../../persistence/patient-diagnoses.repository';
import { ToothPresenceRepository } from '../../persistence/tooth-presence.repository';
import { TreatmentPlansRepository } from '../../persistence/treatment-plans.repository';
import { ChartService } from '../reads/chart.service';
import { planStatusOf } from '../plan/plan-unperformer';
import { PresenceWriter } from './presence-writer';
import { RecordWriter } from './record-writer';

/** What one change on the patient record sees: the patient (locked), the actor and the clock. */
interface Change {
  patientId: string;
  userId: string;
  now: Date;
}

const DIAGNOSIS = 'diagnosis_record';
const PLAN = 'treatment_plan';

/**
 * Charting on the patient record, outside a visit (docs/modules/clinical.md, ADR-0031): a dentist
 * records what they found and what they intend to do without starting a visit. Diagnoses are
 * recorded and, when recorded here, removed; plans are added, edited, cancelled and, when added
 * here, removed; and what is at a tooth position is set (feature 7): the
 * gaps and implants a new patient arrives with, a tooth lost between visits. Resolving a
 * diagnosis, performing a plan and services stay inside a visit (the charting services): they
 * describe what happened in the chair.
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
    private readonly tenancy: TenancyService,
    private readonly presences: ToothPresenceRepository,
    private readonly presence: PresenceWriter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Tooth presence ---

  /**
   * What is at one or several tooth positions (feature 7, H1, H3a): one row per tooth whose
   * presence changes, all with the same When — a date not after the tenant's today, or "before
   * first visit" (no date: it is not known, and is not invented) — the same optional reason and
   * the same dentist. Answers with the chart and the rows written, which is what Undo removes.
   */
  async setPresence(
    patientId: string,
    input: SetPresenceOnPatientInput,
  ): Promise<PatientPresenceResult> {
    const presenceIds: string[] = [];
    const result = await this.onPatient(patientId, async (change) => {
      const occurredOn = input.when.kind === 'date' ? input.when.date : null;
      if (occurredOn !== null) {
        const { timeZone } = await this.tenancy.currentTenant();
        if (occurredOn > localDate(change.now, timeZone)) {
          const message = 'Date cannot be in the future';
          throw new ValidationFailedError(message, [
            { path: 'when.date', code: 'future_date', message },
          ]);
        }
      }
      const dentistId = await this.dentistFor(change.userId, input.dentistId);
      const context = { patientId, visitId: null, occurredOn, dentistId, userId: change.userId };
      for (const tooth of input.teeth) {
        const row = await this.presence.set(context, { ...tooth, reason: input.reason });
        if (row) presenceIds.push(row.id);
      }
    });
    return { ...result, presenceIds };
  }

  /**
   * The Undo of `setPresence`: rows set on the patient record (409 `record.not_removable` for
   * one set in a visit, or caused by a service). Every id must be one of the patient's live rows
   * (404 `record.not_found`). Each tooth goes back to what it was before.
   */
  removePresence(patientId: string, ids: readonly string[]): Promise<PatientChartResult> {
    return this.onPatient(patientId, async ({ now }) => {
      const wanted = [...new Set(ids)];
      const rows = await this.presences.findLive(patientId, wanted);
      if (rows.length !== wanted.length) throw new RecordNotFoundError('Presence record not found');
      if (rows.some((row) => row.recordedInVisitId !== null)) {
        throw new RecordNotRemovableError(
          'Only a presence set on the patient record can be undone here',
        );
      }
      await this.presence.remove(rows, now);
    });
  }

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

  /**
   * What a diagnosis was seen on (ADR-0049), whichever visit (or none) recorded it: the clinical
   * exam, one of the patient's images, or null to unsay it.
   */
  setSeenOn(patientId: string, recordId: string, input: SeenOnInput): Promise<PatientChartResult> {
    return this.onPatient(patientId, async () => {
      const { record } = await this.diagnoses.lockForPatient(recordId, patientId);
      await this.writer.setSeenOn(record, input.seenOn);
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
   * The priority — the phase of the treatment plan it belongs to (ADR-0045) — and the note of an
   * open plan (planned or in progress), wherever it was made. A plan that is no longer open → 409
   * `plan.not_open`. Unchanged → no audit.
   */
  updatePlan(
    patientId: string,
    planId: string,
    input: UpdatePlanInput,
  ): Promise<PatientChartResult> {
    return this.onPatient(patientId, async () => {
      const before = await this.plans.lockForPatient(planId, patientId);
      assertOpen(before);
      if (input.priority !== undefined) await this.writer.prioritise(before, input.priority, null);
      if (input.note === undefined || input.note === before.note) return;
      const after = await this.plans.update(planId, { note: input.note });
      await this.audit.record({
        action: `${PLAN}.update`,
        resourceType: PLAN,
        resourceId: planId,
        before: { note: before.note },
        after: { note: after.note },
      });
    });
  }

  /**
   * The patient accepted a proposed treatment, or the acceptance is withdrawn (ADR-0045).
   * Accepting needs an open plan (409 `plan.not_open`); withdrawing one that is still only
   * planned (409 `plan.acceptance_locked`). Already so → nothing written. `TreatmentAccepted`.
   */
  setAcceptance(patientId: string, planId: string, accepted: boolean): Promise<PatientChartResult> {
    return this.onPatient(patientId, async ({ userId, now }) => {
      const before = await this.plans.lockForPatient(planId, patientId);
      const patch = acceptancePatch(before, accepted, { userId, now });
      if (!patch) return;
      const after = await this.plans.update(planId, patch);
      await this.audit.record({
        action: accepted ? `${PLAN}.accept` : `${PLAN}.unaccept`,
        resourceType: PLAN,
        resourceId: planId,
        before: { acceptedAt: before.acceptedAt },
        after: { acceptedAt: after.acceptedAt },
      });
      const event: TreatmentAccepted = this.events.create(TREATMENT_ACCEPTED, {
        planId,
        patientId,
        accepted,
      });
      await this.events.publish(event);
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
      await this.audit.about({ patientId: patient.id }, () =>
        work({ patientId: patient.id, userId, now: this.clock.now() }),
      );
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
