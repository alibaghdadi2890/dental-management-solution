import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import { AuditService } from '../../audit';
import { PATIENTS_MERGED, type PatientsMerged } from '../../patients';
import { FilesRepository } from '../persistence/files.repository';

/**
 * The files re-point of a patient merge (feature 8, F12): an in-transaction handler of
 * `PatientsMerged`, like `clinical`'s and `billing`'s, so the dropped patient's files are on the
 * kept one when the merge commits and a failure here fails the merge. Every row moves — archived
 * files, and uploads still pending — and no object does: a storage key names the file, not the
 * patient. Audited as `file.repoint` on the kept patient when anything moved.
 *
 * Not permission-gated: the merge already required `patient:write`.
 */
@Injectable()
export class MergeFilesSubscriber {
  constructor(
    private readonly audit: AuditService,
    private readonly files: FilesRepository,
  ) {}

  @OnDomainEventInTransaction(PATIENTS_MERGED)
  async onPatientsMerged(event: PatientsMerged): Promise<void> {
    const { keptId, droppedId } = event.payload;
    const count = await this.files.repointPatient(droppedId, keptId);
    if (count === 0) return;
    await this.audit.record({
      action: 'file.repoint',
      resourceType: 'patient',
      resourceId: keptId,
      after: { droppedId, keptId, count },
    });
  }
}
