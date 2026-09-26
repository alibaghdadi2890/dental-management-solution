import { z } from 'zod';
import { idSchema } from './common.js';
import { permissionSchema } from './permissions.js';

/** Roles seeded in every tenant (D4). Tenants may add custom roles later (`system: false`). */
export const SYSTEM_ROLE_KEYS = ['owner', 'dentist', 'assistant', 'frontdesk'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/** Stable role handle within a tenant: lowercase letters, digits and underscores. */
export const roleKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Invalid role key');

export const roleSchema = z.object({
  id: idSchema,
  key: roleKeySchema,
  name: z.string(),
  system: z.boolean(),
  permissions: z.array(permissionSchema),
});
export type Role = z.infer<typeof roleSchema>;

/** A role as shown next to a user (pills in the users table). */
export const roleRefSchema = z.object({ key: roleKeySchema, name: z.string() });
export type RoleRef = z.infer<typeof roleRefSchema>;
