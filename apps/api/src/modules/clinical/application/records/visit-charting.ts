import type { Visit } from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../../platform/clock/clock.module';
import { RequestContext } from '../../../../platform/cls/request-context';
import { TenantDb } from '../../../../platform/db/tenant-db';
import type { Clock } from '../../../../platform/kernel/clock';
import { AuditService } from '../../../audit';
import { type StoredVisit, VisitsRepository } from '../../persistence/visits.repository';
import { VisitPresenter } from '../visits/visit-presenter';
import type { PresenceContext } from './presence-writer';
import type { RecordContext } from './record-writer';

/** What one charting change sees: the live visit (locked), the actor and the clock. */
export interface VisitChange {
  visit: StoredVisit;
  userId: string;
  now: Date;
}

/** A presence set in a visit is dated by the visit and is its dentist's. */
export const presenceContextOf = ({ visit, userId }: VisitChange): PresenceContext => ({
  patientId: visit.patientId,
  visitId: visit.id,
  occurredOn: visit.localDate,
  dentistId: visit.dentistId,
  userId,
});

/** The visit as the place a record is made: its patient and its dentist (W10). */
export const recordContextOf = ({ visit, userId, now }: VisitChange): RecordContext => ({
  patientId: visit.patientId,
  visitId: visit.id,
  dentistId: visit.dentistId,
  userId,
  now,
});

/**
 * Charting inside a live visit (docs/modules/clinical.md, Records in a visit), shared by
 * the charting services: every change re-checks `visit:write`, runs in one `TenantDb`
 * transaction, locks the visit `FOR UPDATE` and refuses unless it is live (409 `visit.not_live`),
 * and is audited as being about the visit and its patient (ADR-0037).
 */
@Injectable()
export class VisitCharting {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly visits: VisitsRepository,
    private readonly presenter: VisitPresenter,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Answers `{ visit, record }` with the visit as it is after `work`. */
  async run<TRecord>(
    visitId: string,
    work: (change: VisitChange) => Promise<TRecord>,
  ): Promise<{ visit: Visit; record: TRecord }> {
    this.context.requirePermission('visit:write');
    const userId = this.context.requireUserId();
    return this.tenantDb.run(async () => {
      const visit = await this.visits.lockLive(visitId);
      const record = await this.audit.about({ patientId: visit.patientId, visitId }, () =>
        work({ visit, userId, now: this.clock.now() }),
      );
      return { visit: await this.presenter.present(visit), record };
    });
  }
}
