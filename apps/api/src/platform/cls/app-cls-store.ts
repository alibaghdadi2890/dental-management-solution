import type { ClsStore } from 'nestjs-cls';

export type ActorKind = 'user' | 'agent' | 'system' | 'job';

/**
 * Per-request / per-job context (CLAUDE.md §5). Set once at the edge (auth guard, job worker),
 * read everywhere else through `RequestContext`. The request id is the CLS id (`cls.getId()`).
 */
export interface AppClsStore extends ClsStore {
  tenantId?: string;
  userId?: string;
  branchId?: string;
  actorKind?: ActorKind;
  platformAdmin?: boolean;
}
