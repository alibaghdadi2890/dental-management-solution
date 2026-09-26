import type { ActorKind } from '../cls/app-cls-store';

/**
 * Envelope for every domain event (CLAUDE.md §9). Modules declare their events in `events/` as
 * `DomainEvent<'AppointmentCompleted', { appointmentId: string }>` — payload is ids and minimal
 * facts, never full rows.
 */
export interface DomainEvent<TName extends string = string, TPayload extends object = object> {
  readonly id: string;
  readonly name: TName;
  readonly occurredAt: string;
  readonly tenantId: string | null;
  readonly actor: { readonly userId: string | null; readonly kind: ActorKind };
  readonly requestId: string | null;
  readonly payload: TPayload;
}
