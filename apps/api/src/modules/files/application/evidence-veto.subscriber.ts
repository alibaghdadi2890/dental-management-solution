import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import {
  DIAGNOSIS_EVIDENCE_CITED,
  type DiagnosisEvidenceCited,
  EvidenceInvalidError,
} from '../../clinical';
import { FilesRepository } from '../persistence/files.repository';

/**
 * A diagnosis may cite only one of its own patient's images (feature 10, ADR-0049). `clinical`
 * stores the citation but cannot read `files`, so it publishes `DiagnosisEvidenceCited` inside
 * its transaction and this handler refuses a file that is not a saved, unarchived image of that
 * patient: the refusal rolls the diagnosis write back (422 `record.evidence_invalid`), the way
 * `billing` vetoes a void (ADR-0026). A file archived later stays cited.
 *
 * Not permission-gated: the write it guards already was.
 */
@Injectable()
export class EvidenceVetoSubscriber {
  constructor(private readonly files: FilesRepository) {}

  @OnDomainEventInTransaction(DIAGNOSIS_EVIDENCE_CITED)
  async onDiagnosisEvidenceCited(event: DiagnosisEvidenceCited): Promise<void> {
    const { fileId, patientId } = event.payload;
    const file = await this.files.findSaved(fileId);
    if (file?.patientId !== patientId || file.archivedAt !== null || file.kind !== 'image') {
      throw new EvidenceInvalidError("Choose one of this patient's images");
    }
  }
}
