import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import { VISIT_REDATED, type VisitRedated } from '../../clinical';
import { CompensationService } from './compensation.service';

/**
 * A correction moving a finished visit to another day (ADR-0063) is vetoed when either day is in
 * a closed month of its dentist's pay: an in-transaction handler of `VisitRedated`, so the move
 * rolls back with it. The visit's per-visit and per-day lines were counted where it was.
 */
@Injectable()
export class VisitRedateSubscriber {
  constructor(private readonly compensation: CompensationService) {}

  @OnDomainEventInTransaction(VISIT_REDATED)
  async onVisitRedated(event: VisitRedated): Promise<void> {
    const { dentistId, from, to } = event.payload;
    await this.compensation.assertVisitMovable(dentistId, from, to);
  }
}
