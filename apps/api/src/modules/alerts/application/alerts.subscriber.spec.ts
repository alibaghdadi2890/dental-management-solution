import { EVENT_LISTENER_METADATA } from '@nestjs/event-emitter/dist/constants';
import { describe, expect, it } from 'vitest';
import { AlertHub } from './alert-hub';
import { AlertsSubscriber } from './alerts.subscriber';

describe('AlertsSubscriber', () => {
  it('pings on every event that adds a patient to a tray or takes one off', () => {
    const metadata = Reflect.getMetadata(
      EVENT_LISTENER_METADATA,
      AlertsSubscriber.prototype.onTrayChanged,
    ) as { event: string }[];
    expect(metadata.map((listener) => listener.event).sort()).toEqual([
      'AppointmentCancelled',
      'AppointmentCheckInUndone',
      'AppointmentCheckedIn',
      'AppointmentRestored',
      'VisitCompleted',
      'VisitDiscarded',
      'VisitLinkedToAppointment',
      'VisitPaused',
      'VisitResumed',
      'VisitStarted',
    ]);
  });

  it("pings the event's tenant, and nothing for an event without one", () => {
    const hub = new AlertHub();
    const pinged: string[] = [];
    hub.subscribe('a', () => pinged.push('a'));
    const subscriber = new AlertsSubscriber(hub);
    const event = {
      id: 'e',
      name: 'AppointmentCheckedIn',
      occurredAt: '',
      actor: { userId: null, kind: 'user' as const, platformAdmin: false },
      requestId: null,
      payload: {},
    };
    subscriber.onTrayChanged({ ...event, tenantId: 'a' });
    subscriber.onTrayChanged({ ...event, tenantId: null });
    expect(pinged).toEqual(['a']);
  });
});
