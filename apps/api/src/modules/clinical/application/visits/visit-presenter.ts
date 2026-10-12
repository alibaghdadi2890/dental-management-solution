import type { Visit } from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../../platform/clock/clock.module';
import type { Clock } from '../../../../platform/kernel/clock';
import { UsersService } from '../../../users';
import { VisitPlanItemsRepository } from '../../persistence/visit-plan-items.repository';
import { VisitServicesRepository } from '../../persistence/visit-services.repository';
import type { StoredVisit } from '../../persistence/visits.repository';
import { toVisit } from './visit-mapping';

/**
 * The `Visit` the API answers with, for a stored row: its services, its worklist, who confirmed
 * the medical history, and the server's now. Every service that answers with a visit reads it
 * here, in the caller's transaction.
 */
@Injectable()
export class VisitPresenter {
  constructor(
    private readonly services: VisitServicesRepository,
    private readonly worklist: VisitPlanItemsRepository,
    private readonly users: UsersService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async present(visit: StoredVisit): Promise<Visit> {
    const confirmedBy = visit.historyConfirmedBy;
    const names = confirmedBy === null ? null : await this.users.namesByUserIds([confirmedBy]);
    return toVisit(visit, {
      services: await this.services.listForVisit(visit.id),
      worklist: await this.worklist.listForVisit(visit.id),
      confirmedByName: (confirmedBy !== null && names?.get(confirmedBy)) || '',
      now: this.clock.now(),
    });
  }
}
