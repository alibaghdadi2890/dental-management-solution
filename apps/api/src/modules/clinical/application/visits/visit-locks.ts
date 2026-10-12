import { Injectable } from '@nestjs/common';
import { PatientMergedError, PatientsService } from '../../../patients';
import { VisitMovedError, VisitNotFoundError } from '../../domain/visit-errors';
import { type StoredVisit, VisitsRepository } from '../../persistence/visits.repository';

/** Locks for a visit mutation that involves its patient (ADR-0023), in the caller's transaction. */
@Injectable()
export class VisitLocks {
  constructor(
    private readonly patients: PatientsService,
    private readonly visits: VisitsRepository,
  ) {}

  /**
   * The ADR-0023 lock order: the visit's patient `FOR SHARE` (`lockForDependentWrite`, so a merge
   * waits), then the visit `FOR UPDATE` through `lock` — live (`lockLive`) by default, any status
   * for amend and void. A merge that committed between the unlocked read and the patient lock has
   * re-pointed the visit (W24): the patient read first is merged away, and the visit is read
   * again, once.
   */
  async patientThenVisit(
    id: string,
    lock: (visitId: string) => Promise<StoredVisit> = (visitId) => this.visits.lockLive(visitId),
    retried = false,
  ): Promise<StoredVisit> {
    const snapshot = await this.visits.findById(id);
    if (!snapshot) throw new VisitNotFoundError('Visit not found');
    try {
      await this.patients.lockForDependentWrite(snapshot.patientId);
    } catch (error) {
      if (retried || !(error instanceof PatientMergedError)) throw error;
      return this.patientThenVisit(id, lock, true);
    }
    const visit = await lock(id);
    // Defensive only: should be unreachable since E3 re-points a visit inside the same
    // transaction that locks its old patient `FOR UPDATE`, which our `FOR SHARE` lock above
    // either blocks until we commit, or — if that merge already committed — makes
    // `lockForDependentWrite` throw `PatientMergedError` first (the branch above). If this still
    // fires, retry by throwing instead of recursing: recursing here would lock a new patient
    // while still holding this visit's `FOR UPDATE` lock, inverting the ADR-0023 lock order.
    if (visit.patientId !== snapshot.patientId) {
      throw new VisitMovedError('The visit moved to another patient; retry');
    }
    return visit;
  }
}
