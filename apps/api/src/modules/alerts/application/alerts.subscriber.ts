import { Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../platform/events/domain-event';
import { OnDomainEvent } from '../../../platform/events/event-bus';
import {
  VISIT_COMPLETED,
  VISIT_DISCARDED,
  VISIT_LINKED_TO_APPOINTMENT,
  VISIT_PAUSED,
  VISIT_RESUMED,
  VISIT_STARTED,
} from '../../clinical';
import {
  APPOINTMENT_CANCELLED,
  APPOINTMENT_CHECK_IN_UNDONE,
  APPOINTMENT_CHECKED_IN,
} from '../../scheduling';
import { AlertHub } from './alert-hub';

/**
 * After the commit (so a refetch sees the change), every event that adds a patient to a tray or
 * takes one off pings the tenant's streams (D6).
 */
@Injectable()
export class AlertsSubscriber {
  constructor(private readonly hub: AlertHub) {}

  @OnDomainEvent(APPOINTMENT_CHECKED_IN)
  @OnDomainEvent(APPOINTMENT_CHECK_IN_UNDONE)
  @OnDomainEvent(APPOINTMENT_CANCELLED)
  @OnDomainEvent(VISIT_STARTED)
  @OnDomainEvent(VISIT_LINKED_TO_APPOINTMENT)
  @OnDomainEvent(VISIT_PAUSED)
  @OnDomainEvent(VISIT_RESUMED)
  @OnDomainEvent(VISIT_DISCARDED)
  @OnDomainEvent(VISIT_COMPLETED)
  onTrayChanged(event: DomainEvent): void {
    if (event.tenantId !== null) this.hub.ping(event.tenantId);
  }
}
