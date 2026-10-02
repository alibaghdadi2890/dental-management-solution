import {
  type AddServiceInput,
  type DiagnosisResult,
  type PermanentToothCode,
  type PlanResult,
  type PlanTreatmentInput,
  type RecordDiagnosisInput,
  type ServiceResult,
  type SetToothPresenceInput,
  toCents,
  type ToothPresenceResult,
  type UpdateServiceInput,
  type Visit,
} from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import type { Clock } from '../../../platform/kernel/clock';
import { AuditService } from '../../audit';
import { UsersService } from '../../users';
import { CatalogItemInactiveError } from '../domain/catalog-errors';
import { assertCurrency, assertLinePrice, assertTarget } from '../domain/record-rules';
import {
  PlanNotCancellableError,
  PlanNotOpenError,
  RecordNotRemovableError,
} from '../domain/visit-errors';
import {
  DIAGNOSIS_RECORDED,
  DIAGNOSIS_REOPENED,
  DIAGNOSIS_RESOLVED,
  type DiagnosisRecorded,
  type DiagnosisReopened,
  type DiagnosisResolved,
  TOOTH_STATUS_CHANGED,
  type ToothStatusChanged,
  TREATMENT_CANCELLED,
  TREATMENT_PERFORMED,
  TREATMENT_PLANNED,
  type TreatmentCancelled,
  type TreatmentPerformed,
  type TreatmentPlanned,
} from '../events/record-events';
import {
  type DiagnosisRecordPatch,
  PatientDiagnosesRepository,
  type StoredDiagnosisRecord,
} from '../persistence/patient-diagnoses.repository';
import { ToothStatusRepository } from '../persistence/tooth-status.repository';
import {
  type StoredTreatmentPlan,
  TreatmentPlansRepository,
} from '../persistence/treatment-plans.repository';
import {
  type StoredVisitService,
  VisitServicesRepository,
} from '../persistence/visit-services.repository';
import { type StoredVisit, VisitsRepository } from '../persistence/visits.repository';
import { CatalogService } from './catalog.service';
import { PlanUnperformer, planStatusOf } from './plan-unperformer';
import { toDiagnosisRecord, toTreatmentPlan } from './record-mapping';
import { toVisit, toVisitService } from './visit-mapping';

/** What one charting change sees: the live visit (locked), the actor and the clock. */
interface Change {
  visit: StoredVisit;
  userId: string;
  now: Date;
}

const DIAGNOSIS = 'diagnosis_record';
const PLAN = 'treatment_plan';
const SERVICE = 'visit_service';

/** The fields resolve and reopen change, for the audit's before/after. */
const resolutionOf = ({ status, resolvedInVisitId, resolvedAt }: StoredDiagnosisRecord) => ({
  status,
  resolvedInVisitId,
  resolvedAt,
});

const priceOf = ({ baseAmount, discountAmount }: StoredVisitService) => ({
  baseAmount,
  discountAmount,
});

/**
 * Charting inside a live visit (docs/modules/clinical.md, spec §VisitRecordsService): services,
 * diagnoses, plans and tooth presence. Every method re-checks `visit:write`, runs in one
 * `TenantDb` transaction, locks the visit `FOR UPDATE` and refuses unless it is live (409
 * `visit.not_live`), and answers with the updated `Visit` plus the affected record. The patient is
 * always the visit's; records of another patient read as not found. Catalog items must be active
 * (422 `catalog.inactive`) and are copied as snapshots. `recorded_by`/`changed_by` hold the auth
 * user id and `dentist_id` the visit's dentist (W10). Every change is audited with before/after;
 * diagnosis, plan and tooth changes also publish their event after commit (spec §Events).
 */
@Injectable()
export class VisitRecordsService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly catalog: CatalogService,
    private readonly visits: VisitsRepository,
    private readonly services: VisitServicesRepository,
    private readonly diagnoses: PatientDiagnosesRepository,
    private readonly plans: TreatmentPlansRepository,
    private readonly teeth: ToothStatusRepository,
    private readonly unperformer: PlanUnperformer,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // --- Services ---

  /** A catalog service at its catalog price, no line discount (W11, W12). */
  addService(visitId: string, input: AddServiceInput): Promise<ServiceResult> {
    return this.inVisit(visitId, async ({ visit, userId }) => {
      const item = await this.catalog.getServiceForRecord(input.procedureId);
      if (!item.active) throw new CatalogItemInactiveError(`${item.name} is inactive`);
      assertTarget(item.chargeUnit, input.toothCode, input.surfaces);
      assertCurrency(visit.currency, item.price.currency);
      const service = await this.services.insert({
        visitId,
        procedureId: item.id,
        code: item.code,
        name: item.name,
        category: item.category,
        chargeUnit: item.chargeUnit,
        toothCode: input.toothCode ?? null,
        surfaces: input.surfaces,
        baseAmount: item.price.amount,
        planId: null,
        recordedBy: userId,
      });
      await this.audit.record({
        action: `${SERVICE}.create`,
        resourceType: SERVICE,
        resourceId: service.id,
        after: service,
      });
      return toVisitService(service, visit.currency);
    });
  }

  /**
   * The base price and line discount; last write wins (W6). A discount above the base → 422
   * `validation_failed` at the field that broke it. An unchanged price changes and audits nothing.
   */
  updateService(
    visitId: string,
    serviceId: string,
    input: UpdateServiceInput,
  ): Promise<ServiceResult> {
    return this.inVisit(visitId, async ({ visit }) => {
      const before = await this.services.lockInVisit(serviceId, visitId);
      const price = {
        baseAmount: input.baseAmount ?? before.baseAmount,
        discountAmount: input.discountAmount ?? before.discountAmount,
      };
      assertLinePrice(price, input.discountAmount === undefined ? 'baseAmount' : 'discountAmount');
      if (
        toCents(price.baseAmount) === toCents(before.baseAmount) &&
        toCents(price.discountAmount) === toCents(before.discountAmount)
      ) {
        return toVisitService(before, visit.currency);
      }
      const after = await this.services.update(serviceId, price);
      await this.audit.record({
        action: `${SERVICE}.update`,
        resourceType: SERVICE,
        resourceId: serviceId,
        before: priceOf(before),
        after: priceOf(after),
      });
      return toVisitService(after, visit.currency);
    });
  }

  /**
   * Soft-deletes the service. One that performing a plan created puts the plan back to `planned`
   * (the Undo of perform, W13), audited as `treatment_plan.unperform`.
   */
  removeService(visitId: string, serviceId: string): Promise<ServiceResult> {
    return this.inVisit(visitId, async ({ visit, now }) => {
      const before = await this.services.lockInVisit(serviceId, visitId);
      const after = await this.services.update(serviceId, { deletedAt: now });
      await this.audit.record({
        action: `${SERVICE}.delete`,
        resourceType: SERVICE,
        resourceId: serviceId,
        before,
        after: { deletedAt: after.deletedAt },
      });
      if (before.planId !== null) await this.unperformer.unperform(before.planId, visit);
      return toVisitService(after, visit.currency);
    });
  }

  // --- Diagnoses ---

  /** On a tooth always (W11); `DiagnosisRecorded`. */
  recordDiagnosis(visitId: string, input: RecordDiagnosisInput): Promise<DiagnosisResult> {
    return this.inVisit(visitId, async ({ visit, userId, now }) => {
      const item = await this.catalog.getDiagnosisForRecord(input.diagnosisId);
      if (!item.active) throw new CatalogItemInactiveError(`${item.name} is inactive`);
      assertTarget('per_tooth', input.toothCode, input.surfaces);
      const record = await this.diagnoses.insert({
        patientId: visit.patientId,
        toothCode: input.toothCode,
        surfaces: input.surfaces,
        diagnosisId: item.id,
        code: item.code,
        name: item.name,
        category: item.category,
        note: input.note,
        dentistId: visit.dentistId,
        recordedBy: userId,
        recordedInVisitId: visitId,
        recordedAt: now,
      });
      await this.audit.record({
        action: `${DIAGNOSIS}.create`,
        resourceType: DIAGNOSIS,
        resourceId: record.id,
        after: record,
      });
      const event: DiagnosisRecorded = this.events.create(DIAGNOSIS_RECORDED, {
        recordId: record.id,
        visitId,
        patientId: visit.patientId,
        toothCode: record.toothCode,
        diagnosisId: record.diagnosisId,
      });
      await this.events.publish(event);
      return this.diagnosisRecord(record, visit.localDate);
    });
  }

  /**
   * Any of the patient's diagnoses, whichever visit recorded it; stamps this visit. Idempotent: a
   * resolved one is returned unchanged (no audit, no event).
   */
  resolveDiagnosis(visitId: string, recordId: string): Promise<DiagnosisResult> {
    return this.changeDiagnosis(visitId, recordId, 'resolve', ({ now }) => ({
      status: 'resolved',
      resolvedInVisitId: visitId,
      resolvedAt: now,
    }));
  }

  /** Clears both resolved fields. Idempotent like `resolveDiagnosis`. */
  reopenDiagnosis(visitId: string, recordId: string): Promise<DiagnosisResult> {
    return this.changeDiagnosis(visitId, recordId, 'reopen', () => ({
      status: 'active',
      resolvedInVisitId: null,
      resolvedAt: null,
    }));
  }

  /**
   * Only a diagnosis recorded in this visit (else 409 `record.not_removable`; older ones are
   * resolved, W13). Plans linked to it are unlinked, then it is soft-deleted.
   */
  removeDiagnosis(visitId: string, recordId: string): Promise<DiagnosisResult> {
    return this.inVisit(visitId, async ({ visit, now }) => {
      const { record: before, recordedInVisitDate } = await this.diagnoses.lockForPatient(
        recordId,
        visit.patientId,
      );
      if (before.recordedInVisitId !== visitId) {
        throw new RecordNotRemovableError(
          'Only a diagnosis recorded in this visit can be removed; resolve older ones',
        );
      }
      const unlinkedPlanIds = await this.plans.unlinkDiagnosis(visit.patientId, recordId);
      const after = await this.diagnoses.update(recordId, { deletedAt: now });
      await this.audit.record({
        action: `${DIAGNOSIS}.delete`,
        resourceType: DIAGNOSIS,
        resourceId: recordId,
        before,
        after: { deletedAt: after.deletedAt, unlinkedPlanIds },
      });
      return this.diagnosisRecord(after, recordedInVisitDate);
    });
  }

  // --- Plans ---

  /**
   * A catalog service planned on the patient at its catalog price (a snapshot), following the
   * charge unit (W11). A per-tooth plan links the tooth's most recent active diagnosis.
   * `TreatmentPlanned`.
   */
  planTreatment(visitId: string, input: PlanTreatmentInput): Promise<PlanResult> {
    return this.inVisit(visitId, async ({ visit, userId, now }) => {
      const item = await this.catalog.getServiceForRecord(input.procedureId);
      if (!item.active) throw new CatalogItemInactiveError(`${item.name} is inactive`);
      assertTarget(item.chargeUnit, input.toothCode, input.surfaces);
      const toothCode = input.toothCode ?? null;
      const plan = await this.plans.insert({
        patientId: visit.patientId,
        toothCode,
        surfaces: input.surfaces,
        procedureId: item.id,
        code: item.code,
        name: item.name,
        category: item.category,
        chargeUnit: item.chargeUnit,
        priceAmount: item.price.amount,
        priceCurrency: item.price.currency,
        diagnosisRecordId:
          toothCode === null
            ? null
            : await this.diagnoses.latestActiveOnTooth(visit.patientId, toothCode),
        note: input.note,
        dentistId: visit.dentistId,
        recordedBy: userId,
        recordedInVisitId: visitId,
        recordedAt: now,
      });
      await this.audit.record({
        action: `${PLAN}.create`,
        resourceType: PLAN,
        resourceId: plan.id,
        after: plan,
      });
      const event: TreatmentPlanned = this.events.create(TREATMENT_PLANNED, {
        planId: plan.id,
        visitId,
        patientId: visit.patientId,
        toothCode: plan.toothCode,
        procedureId: plan.procedureId,
      });
      await this.events.publish(event);
      return this.treatmentPlan(plan);
    });
  }

  /**
   * A `planned` plan (else 409 `plan.not_open`) becomes a service of this visit at the plan's
   * price, tooth and surfaces, and is marked performed here. The plan's currency must be the
   * visit's (W12). `TreatmentPerformed`; the new service is in the answer's visit.
   */
  performPlan(visitId: string, planId: string): Promise<PlanResult> {
    return this.inVisit(visitId, async ({ visit, userId, now }) => {
      const before = await this.plans.lockForPatient(planId, visit.patientId);
      if (before.status !== 'planned') {
        throw new PlanNotOpenError(`This plan is ${before.status}`);
      }
      assertCurrency(visit.currency, before.priceCurrency);
      const service = await this.services.insert({
        visitId,
        procedureId: before.procedureId,
        code: before.code,
        name: before.name,
        category: before.category,
        chargeUnit: before.chargeUnit,
        toothCode: before.toothCode,
        surfaces: before.surfaces,
        baseAmount: before.priceAmount,
        planId,
        recordedBy: userId,
      });
      const after = await this.plans.update(planId, {
        status: 'performed',
        performedInVisitId: visitId,
        performedAt: now,
      });
      await this.audit.record({
        action: `${SERVICE}.create`,
        resourceType: SERVICE,
        resourceId: service.id,
        after: service,
      });
      await this.audit.record({
        action: `${PLAN}.perform`,
        resourceType: PLAN,
        resourceId: planId,
        before: planStatusOf(before),
        after: { ...planStatusOf(after), serviceId: service.id },
      });
      const event: TreatmentPerformed = this.events.create(TREATMENT_PERFORMED, {
        planId,
        visitId,
        patientId: visit.patientId,
        serviceId: service.id,
        toothCode: after.toothCode,
      });
      await this.events.publish(event);
      return this.treatmentPlan(after);
    });
  }

  /**
   * A `planned` plan from an earlier visit (409 `plan.not_cancellable` for one made in this
   * visit, which is removed instead; W13). `TreatmentCancelled`.
   */
  cancelPlan(visitId: string, planId: string): Promise<PlanResult> {
    return this.inVisit(visitId, async ({ visit, now }) => {
      const before = await this.plans.lockForPatient(planId, visit.patientId);
      if (before.recordedInVisitId === visitId) {
        throw new PlanNotCancellableError('A plan made in this visit is removed, not cancelled');
      }
      if (before.status !== 'planned') {
        throw new PlanNotOpenError(`This plan is ${before.status}`);
      }
      const after = await this.plans.update(planId, {
        status: 'cancelled',
        cancelledInVisitId: visitId,
        cancelledAt: now,
      });
      await this.audit.record({
        action: `${PLAN}.cancel`,
        resourceType: PLAN,
        resourceId: planId,
        before: planStatusOf(before),
        after: planStatusOf(after),
      });
      const event: TreatmentCancelled = this.events.create(TREATMENT_CANCELLED, {
        planId,
        visitId,
        patientId: visit.patientId,
        toothCode: after.toothCode,
      });
      await this.events.publish(event);
      return this.treatmentPlan(after);
    });
  }

  /**
   * Only a plan made in this visit (else 409 `record.not_removable`; older ones are cancelled)
   * that is still `planned` (else 409 `plan.not_open`: undo the perform first). Soft delete.
   */
  removePlan(visitId: string, planId: string): Promise<PlanResult> {
    return this.inVisit(visitId, async ({ visit, now }) => {
      const before = await this.plans.lockForPatient(planId, visit.patientId);
      if (before.recordedInVisitId !== visitId) {
        throw new RecordNotRemovableError(
          'Only a plan made in this visit can be removed; cancel older ones',
        );
      }
      if (before.status !== 'planned') {
        throw new PlanNotOpenError(`This plan is ${before.status}`);
      }
      const after = await this.plans.update(planId, { deletedAt: now });
      await this.audit.record({
        action: `${PLAN}.delete`,
        resourceType: PLAN,
        resourceId: planId,
        before,
        after: { deletedAt: after.deletedAt },
      });
      return this.treatmentPlan(after);
    });
  }

  // --- Tooth presence ---

  /**
   * Which tooth is present at a succession position (W5), changed in this visit (W15): an upsert
   * on `(patient, position)`. An unchanged value changes, audits and emits nothing.
   * `ToothStatusChanged`.
   */
  setToothPresence(
    visitId: string,
    position: PermanentToothCode,
    input: SetToothPresenceInput,
  ): Promise<ToothPresenceResult> {
    return this.inVisit(visitId, async ({ visit, userId }) => {
      const before = await this.teeth.lockAt(visit.patientId, position);
      if (before?.present !== input.present) {
        const after = await this.teeth.upsert({
          patientId: visit.patientId,
          position,
          present: input.present,
          changedInVisitId: visitId,
          changedBy: userId,
        });
        await this.audit.record({
          action: 'tooth_status.set',
          resourceType: 'tooth_status',
          resourceId: after.id,
          before: before && { position, present: before.present },
          after: { position, present: after.present },
        });
        const event: ToothStatusChanged = this.events.create(TOOTH_STATUS_CHANGED, {
          visitId,
          patientId: visit.patientId,
          position,
          present: after.present,
        });
        await this.events.publish(event);
      }
      return { position, present: input.present };
    });
  }

  // --- Shared rules ---

  /**
   * One charting change: `visit:write`, one transaction, the visit locked `FOR UPDATE` and live
   * (`lockLive`), then `work`. Answers `{ visit, record }` with the visit as it now is.
   */
  private async inVisit<TRecord>(
    visitId: string,
    work: (change: Change) => Promise<TRecord>,
  ): Promise<{ visit: Visit; record: TRecord }> {
    this.context.requirePermission('visit:write');
    const userId = this.context.requireUserId();
    return this.tenantDb.run(async () => {
      const visit = await this.visits.lockLive(visitId);
      const now = this.clock.now();
      const record = await work({ visit, userId, now });
      return { visit: toVisit(visit, await this.services.listForVisit(visitId), now), record };
    });
  }

  /** Resolve or reopen: the patient's diagnosis, locked; unchanged when already in that state. */
  private changeDiagnosis(
    visitId: string,
    recordId: string,
    verb: 'resolve' | 'reopen',
    patch: (change: Change) => DiagnosisRecordPatch,
  ): Promise<DiagnosisResult> {
    return this.inVisit(visitId, async (change) => {
      const { visit } = change;
      const { record: before, recordedInVisitDate } = await this.diagnoses.lockForPatient(
        recordId,
        visit.patientId,
      );
      const target = verb === 'resolve' ? 'resolved' : 'active';
      if (before.status === target) return this.diagnosisRecord(before, recordedInVisitDate);
      const after = await this.diagnoses.update(recordId, patch(change));
      await this.audit.record({
        action: `${DIAGNOSIS}.${verb}`,
        resourceType: DIAGNOSIS,
        resourceId: recordId,
        before: resolutionOf(before),
        after: resolutionOf(after),
      });
      const payload = {
        recordId,
        visitId,
        patientId: visit.patientId,
        toothCode: after.toothCode,
      };
      const event: DiagnosisResolved | DiagnosisReopened =
        verb === 'resolve'
          ? this.events.create(DIAGNOSIS_RESOLVED, payload)
          : this.events.create(DIAGNOSIS_REOPENED, payload);
      await this.events.publish(event);
      return this.diagnosisRecord(after, recordedInVisitDate);
    });
  }

  private async dentistName(profileId: string): Promise<string> {
    const [dentist] = await this.users.practitionersByProfileIds([profileId]);
    return dentist?.displayName ?? '';
  }

  private async diagnosisRecord(record: StoredDiagnosisRecord, recordedInVisitDate: string) {
    return toDiagnosisRecord(record, recordedInVisitDate, await this.dentistName(record.dentistId));
  }

  private async treatmentPlan(plan: StoredTreatmentPlan) {
    return toTreatmentPlan(plan, await this.dentistName(plan.dentistId));
  }
}
