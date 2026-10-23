import { z } from 'zod';
import { reasonSchema } from './audit.js';
import { idSchema, nameSchema, optionalText } from './common.js';
import { grantablePermissionSchema, permissionSchema } from './permissions.js';

/** Roles seeded in every tenant (D4). Tenants add custom roles (`system: false`, ADR-0055). */
export const SYSTEM_ROLE_KEYS = ['owner', 'dentist', 'assistant', 'frontdesk'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/** Stable role handle within a tenant: lowercase letters, digits and underscores. */
export const roleKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Invalid role key');

/** Generated for a custom role (names may be in any script): `custom_` + 8 hex digits. */
export const CUSTOM_ROLE_KEY_PREFIX = 'custom_';

const ROLE_DESCRIPTION_MAX = 300;

export const roleSchema = z.object({
  id: idSchema,
  key: roleKeySchema,
  name: z.string(),
  description: z.string().nullable(),
  system: z.boolean(),
  /** A deactivated custom role grants nothing and cannot be assigned; never deleted. */
  active: z.boolean(),
  permissions: z.array(permissionSchema),
  /** How many users hold it. */
  holders: z.number().int().nonnegative(),
});
export type Role = z.infer<typeof roleSchema>;

/**
 * A platform default role (ADR-0056): what new clinics are created with. The system templates
 * (dentist, assistant, front desk) are what a clinic's Reset to default restores; the others
 * become custom roles in every new clinic. `owner` is no template: it holds everything.
 */
export const roleTemplateSchema = roleSchema
  .omit({ holders: true })
  .extend({ permissions: z.array(grantablePermissionSchema) });
export type RoleTemplate = z.infer<typeof roleTemplateSchema>;

/** `POST /roles`: a custom role, empty or a copy of another role's permissions. */
export const roleCreateSchema = z.object({
  name: nameSchema,
  description: optionalText(ROLE_DESCRIPTION_MAX),
  copyFrom: roleKeySchema.optional(),
});
export type RoleCreate = z.infer<typeof roleCreateSchema>;

/** `PATCH /roles/:id`: the name and description of a custom role; the permissions of any but
 * `owner`. The permissions are the whole new set, closed under `implies` by the server. */
export const roleUpdateSchema = z
  .object({
    name: nameSchema,
    description: optionalText(ROLE_DESCRIPTION_MAX),
    permissions: z.array(grantablePermissionSchema).max(100),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Change at least one field' });
export type RoleUpdate = z.infer<typeof roleUpdateSchema>;

/** `PUT /users/:id/grants`: the user's whole set of additional permissions (additive only). */
export const userGrantsUpdateSchema = z.object({
  permissions: z.array(grantablePermissionSchema).max(100),
  reason: reasonSchema.optional(),
});
export type UserGrantsUpdate = z.infer<typeof userGrantsUpdateSchema>;

/** A role as shown next to a user (pills in the users table). */
export const roleRefSchema = z.object({ key: roleKeySchema, name: z.string() });
export type RoleRef = z.infer<typeof roleRefSchema>;
