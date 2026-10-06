import type { PlanTreatmentInput, RecordDiagnosisInput } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../platform/events/event-bus';
import { AuditService } from '../../audit';
import { CatalogItemInactiveError } from '../domain/catalog-errors';
import { assertTarget } from '../domain/record-rules';
import {
  DIAGNOSIS_RECORDED,
  type DiagnosisRecorded,
  TREATMENT_PLANNED,
  type TreatmentPlanned,
} from '../events/record-events';
import {
  PatientDiagnosesRepository,
  type StoredDiagnosisRecord,
} from '../persistence/patient-diagnoses.repository';
import { PlanGroupsRepository } from '../persistence/plan-groups.repository';
import {
  type NewTreatmentPlan,
  type StoredTreatmentPlan,
  TreatmentPlansRepository,
} from '../persistence/treatment-plans.repository';
import type { StoredVisitService } from '../persistence/visit-services.repository';
import { CatalogService } from './catalog.service';

/** Where and by whom a record is made: in a live visit, or on the patient record (`visitId`
 * null, ADR-0031). `dentistId` is the clinically responsible dentist's staff profile id. */
export interface RecordContext {
  patientId: string;
  visitId: string | null;
  dentistId: string;
  userId: string;
  now: Date;
}

/**
 * Creating a diagnosis record or a plan, shared by charting in a visit (`VisitRecordsService`)
 * and on the patient record (`PatientRecordsService`): the same catalog snapshot, target rules,
 * audit entry and event either way. The caller has checked its permission and holds its locks;
 * this runs in the caller's transaction.
 */
@Injectable()
export class RecordWriter {
  constructor(
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly diagnoses: PatientDiagnosesRepository,
    private readonly plans: TreatmentPlansRepository,
    private readonly groups: PlanGroupsRepository,
  ) {}

  /** On a tooth always (W11); `DiagnosisRecorded`. */
  async recordDiagnosis(
    context: RecordContext,
    input: RecordDiagnosisInput,
  ): Promise<StoredDiagnosisRecord> {
    const item = await this.catalog.getDiagnosisForRecord(input.diagnosisId);
    if (!item.active) throw new CatalogItemInactiveError(`${item.name} is inactive`);
    assertTarget('per_tooth', input.toothCode, input.surfaces);
    const record = await this.diagnoses.insert({
      patientId: context.patientId,
      toothCode: input.toothCode,
      surfaces: input.surfaces,
      diagnosisId: item.id,
      code: item.code,
      name: item.name,
      category: item.category,
      note: input.note,
      dentistId: context.dentistId,
      recordedBy: context.userId,
      recordedInVisitId: context.visitId,
      recordedAt: context.now,
    });
    await this.audit.record({
      action: 'diagnosis_record.create',
      resourceType: 'diagnosis_record',
      resourceId: record.id,
      after: record,
    });
    const event: DiagnosisRecorded = this.events.create(DIAGNOSIS_RECORDED, {
      recordId: record.id,
      visitId: context.visitId,
      patientId: context.patientId,
      toothCode: record.toothCode,
      diagnosisId: record.diagnosisId,
    });
    await this.events.publish(event);
    return record;
  }

  /**
   * A catalog service planned on the patient at its catalog price (a snapshot), following the
   * charge unit (W11, L2). A per-tooth plan links the tooth's most recent active diagnosis; a
   * `groupId` must be one of the patient's named plans (404 `record.not_found`).
   * `TreatmentPlanned`.
   */
  async planTreatment(
    context: RecordContext,
    input: PlanTreatmentInput,
  ): Promise<StoredTreatmentPlan> {
    const item = await this.catalog.getServiceForRecord(input.procedureId);
    if (!item.active) throw new CatalogItemInactiveError(`${item.name} is inactive`);
    assertTarget(item.chargeUnit, input.toothCode, input.surfaces, input.jaw);
    if (input.groupId !== undefined) {
      await this.groups.lockForPatient(input.groupId, context.patientId);
    }
    return this.insertPlan(context, {
      toothCode: input.toothCode ?? null,
      jaw: input.jaw ?? null,
      surfaces: input.surfaces,
      procedureId: item.id,
      code: item.code,
      name: item.name,
      category: item.category,
      chargeUnit: item.chargeUnit,
      priceAmount: item.price.amount,
      priceCurrency: item.price.currency,
      note: input.note,
      groupId: input.groupId ?? null,
    });
  }

  /**
   * The plan behind a service that was not finished in its visit (unfinished spec U2): the
   * service's own snapshot, target and base price, so a catalog item changed or retired since
   * the service was added changes nothing. `TreatmentPlanned`.
   */
  planFromService(
    context: RecordContext,
    service: StoredVisitService,
    currency: string,
  ): Promise<StoredTreatmentPlan> {
    return this.insertPlan(context, {
      toothCode: service.toothCode,
      jaw: service.jaw,
      surfaces: service.surfaces,
      procedureId: service.procedureId,
      code: service.code,
      name: service.name,
      category: service.category,
      chargeUnit: service.chargeUnit,
      priceAmount: service.baseAmount,
      priceCurrency: currency,
      note: null,
      groupId: null,
    });
  }

  private async insertPlan(
    context: RecordContext,
    snapshot: Omit<
      NewTreatmentPlan,
      | 'patientId'
      | 'diagnosisRecordId'
      | 'dentistId'
      | 'recordedBy'
      | 'recordedInVisitId'
      | 'recordedAt'
    >,
  ): Promise<StoredTreatmentPlan> {
    const plan = await this.plans.insert({
      ...snapshot,
      patientId: context.patientId,
      diagnosisRecordId:
        snapshot.toothCode === null
          ? null
          : await this.diagnoses.latestActiveOnTooth(context.patientId, snapshot.toothCode),
      dentistId: context.dentistId,
      recordedBy: context.userId,
      recordedInVisitId: context.visitId,
      recordedAt: context.now,
    });
    await this.audit.record({
      action: 'treatment_plan.create',
      resourceType: 'treatment_plan',
      resourceId: plan.id,
      after: plan,
    });
    const event: TreatmentPlanned = this.events.create(TREATMENT_PLANNED, {
      planId: plan.id,
      visitId: context.visitId,
      patientId: context.patientId,
      toothCode: plan.toothCode,
      procedureId: plan.procedureId,
    });
    await this.events.publish(event);
    return plan;
  }
}
