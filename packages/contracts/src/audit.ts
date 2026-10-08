import { z } from 'zod';
import {
  blankToUndefined,
  cursorPageQuerySchema,
  cursorPageSchema,
  idSchema,
  isoDateTimeSchema,
  queryBooleanSchema,
} from './common.js';

export const actorKindSchema = z.enum(['user', 'agent', 'system', 'job']);
export type ActorKind = z.infer<typeof actorKindSchema>;

/**
 * The areas of the Activity screen (feature 7, H7): what a row of the log is about, in the
 * clinic's words. An audit row gets its area from its action when it is written (`areaOfAction`).
 */
export const ACTIVITY_AREAS = [
  'patients',
  'visits',
  'payments',
  'catalog',
  'users',
  'settings',
  'contacts',
  'files',
] as const;
export const activityAreaSchema = z.enum(ACTIVITY_AREAS);
export type ActivityArea = z.infer<typeof activityAreaSchema>;

/** The first segment of an action (`visit_service.create` → `visit_service`) to its area. */
const AREA_OF_PREFIX: Readonly<Record<string, ActivityArea>> = {
  patient: 'patients',
  contact: 'contacts',
  visit: 'visits',
  visit_service: 'visits',
  diagnosis_record: 'visits',
  treatment_plan: 'visits',
  plan_group: 'visits',
  tooth_status: 'visits',
  tooth_presence: 'visits',
  clinical: 'visits',
  payment: 'payments',
  ledger_entry: 'payments',
  catalog: 'catalog',
  file: 'files',
  user: 'users',
  role: 'users',
  tenant: 'settings',
  branch: 'settings',
  room: 'settings',
};

/**
 * The area an audit action belongs to, or null for a row the Activity screen never shows: a
 * stored domain event (`VisitVoided` has no `resource.verb` shape) or an action of no area.
 */
export function areaOfAction(action: string): ActivityArea | null {
  const dot = action.indexOf('.');
  if (dot <= 0) return null;
  return AREA_OF_PREFIX[action.slice(0, dot)] ?? null;
}

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
  /** The patient and the visit the change is about, when it is about one (H7). */
  patientId: idSchema.nullable(),
  visitId: idSchema.nullable(),
  /** Null on the rows the Activity screen leaves out (events, shadow ledger rows). */
  area: activityAreaSchema.nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/**
 * `GET /audit`. `resourceType` + `resourceId` read one record's rows (the timelines). The
 * Activity screen (H7) reads the feed — `feed=true`: only rows with an area — narrowed by `area`,
 * the actor (`actorUserId`, or `platformAdmin=true` for platform admins acting in the clinic),
 * `from` (rows at or after that instant), and the patient or visit the rows are about.
 */
export const auditQuerySchema = cursorPageQuerySchema.extend({
  resourceType: z.string().min(1).max(64).optional(),
  resourceId: z.string().min(1).max(64).optional(),
  feed: blankToUndefined(queryBooleanSchema),
  area: blankToUndefined(activityAreaSchema.optional()),
  actorUserId: blankToUndefined(idSchema.optional()),
  platformAdmin: blankToUndefined(queryBooleanSchema),
  from: blankToUndefined(isoDateTimeSchema.optional()),
  patientId: blankToUndefined(idSchema.optional()),
  visitId: blankToUndefined(idSchema.optional()),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const auditPageSchema = cursorPageSchema(auditEntrySchema);
export type AuditPage = z.infer<typeof auditPageSchema>;

/** Shared by every mutation that the POC guards with a reason dialog (≥ 3 characters). */
export const reasonSchema = z.string().trim().min(3).max(500);
