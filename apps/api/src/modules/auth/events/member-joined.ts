import type { DomainEvent } from '../../../platform/events/domain-event';

export const MEMBER_JOINED = 'MemberJoined';

/** A user became a member of the tenant in context (the organization mirror, ADR-0011). */
export type MemberJoined = DomainEvent<typeof MEMBER_JOINED, { userId: string }>;
