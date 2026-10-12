import type { PresenceResult, SetPresenceInVisitInput, ToothCode } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RecordNotFoundError, RecordNotRemovableError } from '../../domain/visit-errors';
import { ToothPresenceRepository } from '../../persistence/tooth-presence.repository';
import { PresenceWriter } from './presence-writer';
import { RecordPresenter } from './record-presenter';
import { presenceContextOf, VisitCharting } from './visit-charting';

/** Tooth presence set by hand in a live visit (feature 7, H1; ADR-0034) and its Undo. */
@Injectable()
export class PresenceChartingService {
  constructor(
    private readonly charting: VisitCharting,
    private readonly presences: ToothPresenceRepository,
    private readonly presence: PresenceWriter,
    private readonly presenter: RecordPresenter,
  ) {}

  /**
   * What is at a tooth position, as seen in this visit (feature 7, H1): `missing`, `not_erupted`,
   * `implant`, or `present` again. Applied at once and dated by the visit; nothing is written
   * when the tooth already has that presence (`record: null`). `ToothPresenceChanged`.
   */
  setPresence(
    visitId: string,
    toothCode: ToothCode,
    input: SetPresenceInVisitInput,
  ): Promise<PresenceResult> {
    return this.charting.run(visitId, async (change) => {
      const row = await this.presence.set(presenceContextOf(change), {
        toothCode,
        presence: input.presence,
      });
      return row && this.presenter.presence(row, change.visit);
    });
  }

  /**
   * The Undo of `setPresence`: a row set by hand in this visit (409 `record.not_removable` for
   * one from another visit or the patient record, or one a service caused — remove the service).
   * The tooth goes back to what it was before.
   */
  removePresence(visitId: string, presenceId: string): Promise<PresenceResult> {
    return this.charting.run(visitId, async ({ visit, now }) => {
      const [row] = await this.presences.findLive(visit.patientId, [presenceId]);
      if (!row) throw new RecordNotFoundError('Presence record not found');
      if (row.recordedInVisitId !== visitId || row.serviceId !== null) {
        throw new RecordNotRemovableError(
          'Only a presence set by hand in this visit can be undone here',
        );
      }
      await this.presence.remove([row], now);
      return this.presenter.presence(row, visit);
    });
  }
}
