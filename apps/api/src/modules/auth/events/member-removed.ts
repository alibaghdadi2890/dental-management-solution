import type { DomainEvent } from '../../../platform/events/domain-event';

export const MEMBER_REMOVED = 'MemberRemoved';

/** A user stopped being a member of the tenant in context (deactivation). */
export type MemberRemoved = DomainEvent<typeof MEMBER_REMOVED, { userId: string }>;
