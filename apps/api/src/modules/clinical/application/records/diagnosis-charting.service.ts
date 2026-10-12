import type { DiagnosisResult, RecordDiagnosisInput, SeenOnInput } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../../platform/events/event-bus';
import { AuditService } from '../../../audit';
import { RecordNotRemovableError } from '../../domain/visit-errors';
import {
  DIAGNOSIS_REOPENED,
  DIAGNOSIS_RESOLVED,
  type DiagnosisReopened,
  type DiagnosisResolved,
} from '../../events/record-events';
import {
  type DiagnosisRecordPatch,
  PatientDiagnosesRepository,
  type StoredDiagnosisRecord,
} from '../../persistence/patient-diagnoses.repository';
import { TreatmentPlansRepository } from '../../persistence/treatment-plans.repository';
import { RecordPresenter } from './record-presenter';
import { RecordWriter } from './record-writer';
import { recordContextOf, type VisitChange, VisitCharting } from './visit-charting';

const DIAGNOSIS = 'diagnosis_record';

/** The fields resolve and reopen change, for the audit's before/after. */
const resolutionOf = ({ status, resolvedInVisitId, resolvedAt }: StoredDiagnosisRecord) => ({
  status,
  resolvedInVisitId,
  resolvedAt,
});

/**
 * Diagnoses in a live visit (docs/modules/clinical.md, Records in a visit): record, resolve,
 * reopen, remove. The patient is always the visit's; another patient's record reads as not found.
 */
@Injectable()
export class DiagnosisChartingService {
  constructor(
    private readonly charting: VisitCharting,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly diagnoses: PatientDiagnosesRepository,
    private readonly plans: TreatmentPlansRepository,
    private readonly writer: RecordWriter,
    private readonly presenter: RecordPresenter,
  ) {}

  /** On a tooth always (W11); `DiagnosisRecorded`. */
  recordDiagnosis(visitId: string, input: RecordDiagnosisInput): Promise<DiagnosisResult> {
    return this.charting.run(visitId, async (change) => {
      const record = await this.writer.recordDiagnosis(recordContextOf(change), input);
      return this.presenter.diagnosis(record, change.visit.localDate);
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
   * What any of the patient's diagnoses was seen on (ADR-0049): the clinical exam, one of the
   * patient's images (422 `record.evidence_invalid` for another file), or null to unsay it.
   */
  setSeenOn(visitId: string, recordId: string, input: SeenOnInput): Promise<DiagnosisResult> {
    return this.charting.run(visitId, async ({ visit }) => {
      const { record, visitDate } = await this.diagnoses.lockForPatient(recordId, visit.patientId);
      return this.presenter.diagnosis(await this.writer.setSeenOn(record, input.seenOn), visitDate);
    });
  }

  /**
   * Only a diagnosis recorded in this visit (else 409 `record.not_removable`; older ones are
   * resolved, W13). Plans linked to it are unlinked, then it is soft-deleted.
   */
  removeDiagnosis(visitId: string, recordId: string): Promise<DiagnosisResult> {
    return this.charting.run(visitId, async ({ visit, now }) => {
      const { record: before, visitDate } = await this.diagnoses.lockForPatient(
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
      return this.presenter.diagnosis(after, visitDate);
    });
  }

  /** Resolve or reopen: the patient's diagnosis, locked; unchanged when already in that state. */
  private changeDiagnosis(
    visitId: string,
    recordId: string,
    verb: 'resolve' | 'reopen',
    patch: (change: VisitChange) => DiagnosisRecordPatch,
  ): Promise<DiagnosisResult> {
    return this.charting.run(visitId, async (change) => {
      const { visit } = change;
      const { record: before, visitDate } = await this.diagnoses.lockForPatient(
        recordId,
        visit.patientId,
      );
      const target = verb === 'resolve' ? 'resolved' : 'active';
      if (before.status === target) return this.presenter.diagnosis(before, visitDate);
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
      return this.presenter.diagnosis(after, visitDate);
    });
  }
}
