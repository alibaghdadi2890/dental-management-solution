import { z } from 'zod';
import { emailSchema, passwordSchema } from './auth.js';
import {
  currencySchema,
  idSchema,
  isoDateTimeSchema,
  localeSchema,
  timeZoneSchema,
} from './common.js';
import { reasonSchema } from './audit.js';

/** Tenant defaults (D8); all editable per tenant. */
export const TENANT_DEFAULTS = { timeZone: 'Asia/Beirut', currency: 'USD', locale: 'en' } as const;

export const SLUG_MAX_LENGTH = 48;

/** URL-safe clinic handle: lowercase letters and digits separated by single hyphens. */
export const slugSchema = z
  .string()
  .min(3)
  .max(SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single hyphens');

/** Suggests a slug from a clinic name; the user may edit it. May return '' (e.g. Arabic names). */
export function deriveSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, '');
}

const nameSchema = z.string().trim().min(1).max(120);

/** Optional free text: blank input means "not set". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const tenantStatusSchema = z.enum(['active', 'suspended']);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const tenantSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  status: tenantStatusSchema,
  timeZone: timeZoneSchema,
  currency: currencySchema,
  locale: localeSchema,
  createdAt: isoDateTimeSchema,
});
export type Tenant = z.infer<typeof tenantSchema>;

export const tenantSettingsPatchSchema = z
  .object({
    name: nameSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    currency: currencySchema.optional(),
    locale: localeSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'Change at least one setting',
  });
export type TenantSettingsPatch = z.infer<typeof tenantSettingsPatchSchema>;

export const branchSchema = z.object({
  id: idSchema,
  name: z.string(),
  code: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  active: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type Branch = z.infer<typeof branchSchema>;

export const branchCreateSchema = z.object({
  name: nameSchema,
  code: optionalText(16),
  address: optionalText(240),
  phone: optionalText(40),
});
export type BranchCreate = z.infer<typeof branchCreateSchema>;

export const branchPatchSchema = branchCreateSchema
  .partial()
  .extend({ active: z.boolean().optional() });
export type BranchPatch = z.infer<typeof branchPatchSchema>;

/** A room is the physical unit a visit happens in; later a bookable resource (ADR-0007). */
export const roomSchema = z.object({
  id: idSchema,
  branchId: idSchema,
  name: z.string(),
  code: z.string().nullable(),
  active: z.boolean(),
});
export type Room = z.infer<typeof roomSchema>;

export const roomQuerySchema = z.object({ branchId: idSchema.optional() });

/** The Catalog-style save bar sends every changed or new room at once; `id` absent = new. */
export const roomBatchSchema = z.object({
  items: z
    .array(
      z.object({
        id: idSchema.optional(),
        branchId: idSchema,
        name: nameSchema,
        code: optionalText(16),
        active: z.boolean(),
      }),
    )
    .min(1)
    .max(200),
});
export type RoomBatch = z.infer<typeof roomBatchSchema>;

export const provisionTenantRequestSchema = z.object({
  clinic: z.object({
    name: nameSchema,
    slug: slugSchema,
    timeZone: timeZoneSchema.default(TENANT_DEFAULTS.timeZone),
    currency: currencySchema.default(TENANT_DEFAULTS.currency),
    locale: localeSchema.default(TENANT_DEFAULTS.locale),
  }),
  firstBranch: branchCreateSchema.omit({ code: true }),
  owner: z.object({
    displayName: nameSchema,
    email: emailSchema,
    temporaryPassword: passwordSchema,
  }),
});
export type ProvisionTenantRequest = z.infer<typeof provisionTenantRequestSchema>;

/** A row of the platform admin's tenants list. */
export const platformTenantSchema = tenantSchema.extend({
  branchCount: z.number().int().nonnegative(),
  userCount: z.number().int().nonnegative(),
});
export type PlatformTenant = z.infer<typeof platformTenantSchema>;

export const platformTenantQuerySchema = z.object({
  status: tenantStatusSchema.optional(),
  search: z.string().trim().max(120).optional(),
});
export type PlatformTenantQuery = z.infer<typeof platformTenantQuerySchema>;

/** Platform-admin APIs take the tenant in the body, never in the path (ADR-0008). */
export const tenantStatusChangeSchema = z.object({ tenantId: idSchema, reason: reasonSchema });
export type TenantStatusChange = z.infer<typeof tenantStatusChangeSchema>;
