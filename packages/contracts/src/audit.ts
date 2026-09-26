import { z } from 'zod';
import { cursorPageQuerySchema, cursorPageSchema, idSchema, isoDateTimeSchema } from './common.js';

export const actorKindSchema = z.enum(['user', 'agent', 'system', 'job']);
export type ActorKind = z.infer<typeof actorKindSchema>;

/** One append-only audit row (CLAUDE.md §10). */
export const auditEntrySchema = z.object({
  id: idSchema,
  actorUserId: idSchema.nullable(),
  actorKind: actorKindSchema,
  /** A platform admin acting inside the clinic (ADR-0008). */
  actorPlatformAdmin: z.boolean(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  occurredAt: isoDateTimeSchema,
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditQuerySchema = cursorPageQuerySchema.extend({
  resourceType: z.string().min(1).max(64).optional(),
  resourceId: z.string().min(1).max(64).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditPageSchema = cursorPageSchema(auditEntrySchema);
export type AuditPage = z.infer<typeof auditPageSchema>;

/** Shared by every mutation that the POC guards with a reason dialog (≥ 3 characters). */
export const reasonSchema = z.string().trim().min(3).max(500);
