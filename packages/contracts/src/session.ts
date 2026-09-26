import { z } from 'zod';
import { currencySchema, idSchema, timeZoneSchema } from './common.js';
import { permissionSchema } from './permissions.js';

/** What the SPA knows about the signed-in user. Served by the `auth` module. */
export const sessionSchema = z.object({
  user: z.object({
    id: idSchema,
    displayName: z.string(),
    email: z.email(),
  }),
  /** Null for platform admins who are not acting inside a clinic. */
  tenant: z
    .object({
      id: idSchema,
      name: z.string(),
      timeZone: timeZoneSchema,
      currency: currencySchema,
    })
    .nullable(),
  branch: z.object({ id: idSchema, name: z.string() }).nullable(),
  roleNames: z.array(z.string()),
  permissions: z.array(permissionSchema),
});
export type Session = z.infer<typeof sessionSchema>;
