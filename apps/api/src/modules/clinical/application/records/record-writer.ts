import type {
  DiagnosisEvidence,
  PlanPriority,
  PlanTreatmentInput,
  RecordDiagnosisInput,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../../platform/events/event-bus';
import { AuditService } from '../../../audit';
import { CatalogItemInactiveError } from '../../domain/catalog-errors';
import { assertOpen } from '../../domain/plan-lifecycle';
import { assertTarget } from '../../domain/record-rules';
import { DiagnosisLinkInvalidError, RecordNotFoundError } from '../../domain/visit-errors';
import {
  DIAGNOSIS_EVIDENCE_CITED,
  DIAGNOSIS_RECORDED,
  type DiagnosisEvidenceCited,
  type DiagnosisRecorded,
  TREATMENT_PLANNED,
  TREATMENT_PRIORITISED,
  type TreatmentPlanned,
  type TreatmentPrioritised,
} from '../../events/record-events';
import {
  PatientDiagnosesRepository,
  type StoredDiagnosisRecord,
} from '../../persistence/patient-diagnoses.repository';
import {
  type NewTreatmentPlan,
  type StoredTreatmentPlan,
  TreatmentPlansRepository,
} from '../../persistence/treatment-plans.repository';
import { ProceduresRepository } from '../../persistence/procedures.repository';
import type { StoredVisitService } from '../../persistence/visit-services.repository';
import { CatalogService } from '../catalog/catalog.service';
import { seenOnColumns, seenOnOf } from './record-mapping';

/** Where and by whom a record is made: in a live visit, or on the patient record (`visitId`
 * null, ADR-0031). `dentistId` is the clinically responsible dentist's staff profile id. */
export interface RecordContext {
  patientId: string;
  visitId: string | null;
  dentistId: string;
  userId: string;
  now: Date;
}

/** The plan a service not finished in its visit becomes, when it had none: work already begun. */
const UNPLANNED_WORK_PRIORITY: PlanPriority = 'high';

/**
 * Creating a diagnosis record or a plan — and saying what a diagnosis was seen on, or which
 * phase a plan belongs to — shared by charting in a visit (the charting services) and on the
 * patient record (`PatientRecordsService`): the same catalog snapshot, target rules, audit entry
 * and event either way. The caller has checked its permission and holds its locks;
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
    private readonly procedures: ProceduresRepository,
  ) {}

  /**
   * On a tooth always (W11); `DiagnosisRecorded`. An image it was seen on must be one of the
   * patient's files: `files` checks it in this transaction (`DiagnosisEvidenceCited`, ADR-0049).
   */
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
      ...seenOnColumns(input.seenOn),
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
    await this.cite(record);
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
   * charge unit (W11, L2), in the phase its priority says (ADR-0045). A per-tooth plan is for the
   * diagnosis named — the patient's active diagnosis on that tooth, else 422
   * `record.diagnosis_link_invalid` — or, when none is, the tooth's most recent active one. The
   * catalog's usual number of sessions is copied with the price. `TreatmentPlanned`.
   */
  async planTreatment(
    context: RecordContext,
    input: PlanTreatmentInput,
  ): Promise<StoredTreatmentPlan> {
    const item = await this.catalog.getServiceForRecord(input.procedureId);
    if (!item.active) throw new CatalogItemInactiveError(`${item.name} is inactive`);
    assertTarget(item.chargeUnit, input.toothCode, input.surfaces, input.jaw);
    const toothCode = input.toothCode ?? null;
    const diagnosisRecordId =
      input.diagnosisRecordId === undefined
        ? undefined
        : await this.linkedDiagnosis(context.patientId, input.diagnosisRecordId, toothCode);
    return this.insertPlan(context, diagnosisRecordId, {
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
      priority: input.priority,
      estimatedSessions: item.typicalSessions,
      note: input.note,
    });
  }

  /**
   * The plan behind a service that was not finished in its visit (unfinished spec U2): the
   * service's own snapshot, target and base price, so a catalog item changed or retired since
   * the service was added changes nothing. `TreatmentPlanned`.
   */
  async planFromService(
    context: RecordContext,
    service: StoredVisitService,
    currency: string,
  ): Promise<StoredTreatmentPlan> {
    return this.insertPlan(context, undefined, {
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
      priority: UNPLANNED_WORK_PRIORITY,
      estimatedSessions: await this.procedures.typicalSessionsOf(service.procedureId),
      note: null,
    });
  }

  /**
   * What a diagnosis was seen on (ADR-0049), or null to unsay it. Unchanged → nothing written.
   * Audited `diagnosis_record.seen_on`; an image is checked by `files` in this transaction.
   */
  async setSeenOn(
    before: StoredDiagnosisRecord,
    seenOn: DiagnosisEvidence | null,
  ): Promise<StoredDiagnosisRecord> {
    const columns = seenOnColumns(seenOn);
    if (before.seenOn === columns.seenOn && before.seenOnFileId === columns.seenOnFileId) {
      return before;
    }
    const after = await this.diagnoses.update(before.id, columns);
    await this.audit.record({
      action: 'diagnosis_record.seen_on',
      resourceType: 'diagnosis_record',
      resourceId: before.id,
      before: { seenOn: seenOnOf(before) },
      after: { seenOn: seenOnOf(after) },
    });
    await this.cite(after);
    return after;
  }

  /**
   * Moves an open plan (409 `plan.not_open` otherwise) to another phase of the treatment plan
   * (ADR-0045). Unchanged → nothing written. Audited `treatment_plan.prioritise`;
   * `TreatmentPrioritised`.
   */
  async prioritise(
    before: StoredTreatmentPlan,
    priority: PlanPriority,
    visitId: string | null,
  ): Promise<StoredTreatmentPlan> {
    assertOpen(before);
    if (before.priority === priority) return before;
    const after = await this.plans.update(before.id, { priority });
    await this.audit.record({
      action: 'treatment_plan.prioritise',
      resourceType: 'treatment_plan',
      resourceId: before.id,
      before: { priority: before.priority },
      after: { priority: after.priority },
    });
    const event: TreatmentPrioritised = this.events.create(TREATMENT_PRIORITISED, {
      planId: before.id,
      visitId,
      patientId: before.patientId,
      priority,
    });
    await this.events.publish(event);
    return after;
  }

  /** Tells `files` that `record` cites one of its files, inside this transaction. */
  private async cite(record: StoredDiagnosisRecord): Promise<void> {
    if (record.seenOnFileId === null) return;
    const event: DiagnosisEvidenceCited = this.events.create(DIAGNOSIS_EVIDENCE_CITED, {
      recordId: record.id,
      patientId: record.patientId,
      fileId: record.seenOnFileId,
    });
    await this.events.publish(event);
  }

  /** The diagnosis a plan is said to be for: the patient's, active, and on the plan's tooth. */
  private async linkedDiagnosis(
    patientId: string,
    recordId: string,
    toothCode: string | null,
  ): Promise<string> {
    const invalid = () =>
      new DiagnosisLinkInvalidError("Choose one of this tooth's active diagnoses");
    try {
      const { record } = await this.diagnoses.lockForPatient(recordId, patientId);
      if (record.status !== 'active' || record.toothCode !== toothCode) throw invalid();
      return record.id;
    } catch (error) {
      throw error instanceof RecordNotFoundError ? invalid() : error;
    }
  }

  private async insertPlan(
    context: RecordContext,
    /** The diagnosis it is for; undefined links the tooth's most recent active one. */
    diagnosisRecordId: string | undefined,
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
        diagnosisRecordId ??
        (snapshot.toothCode === null
          ? null
          : await this.diagnoses.latestActiveOnTooth(context.patientId, snapshot.toothCode)),
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
