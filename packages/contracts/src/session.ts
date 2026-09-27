import { z } from 'zod';
import { countrySchema, currencySchema, idSchema, localeSchema, timeZoneSchema } from './common.js';
import { permissionSchema } from './permissions.js';

export const branchRefSchema = z.object({ id: idSchema, name: z.string() });
export type BranchRef = z.infer<typeof branchRefSchema>;

/** What the SPA knows about the signed-in user (`GET /session`). */
export const sessionSchema = z.object({
  user: z.object({
    id: idSchema,
    displayName: z.string(),
    email: z.email(),
  }),
  /** Back-office operator; holds no clinic membership (D9). */
  platformAdmin: z.boolean(),
  /** First sign-in with a temporary password: the app is locked until it is changed. */
  mustChangePassword: z.boolean(),
  /** Null for platform admins who are not acting inside a clinic. */
  tenant: z
    .object({
      id: idSchema,
      name: z.string(),
      slug: z.string(),
      timeZone: timeZoneSchema,
      currency: currencySchema,
      locale: localeSchema,
      country: countrySchema,
    })
    .nullable(),
  /** Active branch; the sidebar shows a switcher when `branches` has more than one entry. */
  branch: branchRefSchema.nullable(),
  branches: z.array(branchRefSchema),
  roleNames: z.array(z.string()),
  permissions: z.array(permissionSchema),
  /** Server-enforced idle timeout; null for sessions on a trusted workstation. */
  idleTimeoutSeconds: z.number().int().positive().nullable(),
});
export type Session = z.infer<typeof sessionSchema>;

/** Body of `POST /session/branch`. */
export const switchBranchRequestSchema = z.object({ branchId: idSchema });
export type SwitchBranchRequest = z.infer<typeof switchBranchRequestSchema>;
