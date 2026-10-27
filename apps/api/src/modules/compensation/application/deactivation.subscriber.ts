import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import { STAFF_DEACTIVATED, type StaffDeactivated } from '../../users';
import { CompensationService } from './compensation.service';

/**
 * Deactivating a dentist ends their agreement on that day (C11): an in-transaction handler of
 * `StaffDeactivated`, so the agreement ends with the deactivation or not at all. His statements
 * stay readable by the owner. Not permission-gated: the deactivation already required `user:write`.
 */
@Injectable()
export class DeactivationSubscriber {
  constructor(private readonly compensation: CompensationService) {}

  @OnDomainEventInTransaction(STAFF_DEACTIVATED)
  async onStaffDeactivated(event: StaffDeactivated): Promise<void> {
    await this.compensation.endForDeactivation(event.payload.profileId, event.payload.date);
  }
}
