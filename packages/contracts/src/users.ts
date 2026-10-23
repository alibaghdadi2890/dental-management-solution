import { z } from 'zod';
import { reasonSchema } from './audit.js';
import { emailSchema, passwordSchema } from './auth.js';
import { idSchema, isoDateTimeSchema, nameSchema, optionalText } from './common.js';
import {
  practitionerTypeSchema,
  SPECIALTIES_MISFIT,
  sentSpecialtiesFit,
  specialtiesAgree,
  specialtiesSchema,
  specialtySchema,
} from './practitioners.js';
import { grantablePermissionSchema, permissionSchema } from './permissions.js';
import { roleKeySchema, roleRefSchema } from './roles.js';
import { branchRefSchema } from './session.js';

/**
 * A clinic staff member. `id` is the global auth user id (D7); `profileId` is this tenant's
 * `staff_profiles.id` — the id a domain model refers to a staff member in a clinical role by
 * (e.g. a patient's primary dentist, ADR-0020).
 */
export const staffUserSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  email: z.email(),
  displayName: z.string(),
  title: z.string().nullable(),
  practitionerType: practitionerTypeSchema,
  /** Null and empty unless a dentist (ADR-0050). */
  primarySpecialty: specialtySchema.nullable(),
  specialties: z.array(specialtySchema),
  phone: z.string().nullable(),
  active: z.boolean(),
  roles: z.array(roleRefSchema),
  /** Per-user additional permissions (ADR-0055); null unless the caller holds `role:read`. */
  grants: z.array(grantablePermissionSchema).nullable(),
  /** Roles and grants: what the user may do; null unless the caller holds `role:read`. */
  effectivePermissions: z.array(permissionSchema).nullable(),
  branches: z.array(branchRefSchema),
  createdAt: isoDateTimeSchema,
});
export type StaffUser = z.infer<typeof staffUserSchema>;

const assignments = {
  roleKeys: z.array(roleKeySchema).min(1).max(20),
  branchIds: z.array(idSchema).min(1).max(100),
};

/** Created by a platform admin with a temporary password to change at first sign-in (D6). */
export const staffUserCreateSchema = z
  .object({
    displayName: nameSchema,
    email: emailSchema,
    title: optionalText(80),
    practitionerType: practitionerTypeSchema,
    /** Optional as a pair: a dentist created without them starts on `DEFAULT_SPECIALTY`. */
    primarySpecialty: specialtySchema.nullable().optional(),
    specialties: specialtiesSchema.optional(),
    phone: optionalText(40),
    ...assignments,
    temporaryPassword: passwordSchema,
  })
  .refine(sentSpecialtiesFit, SPECIALTIES_MISFIT);
export type StaffUserCreate = z.infer<typeof staffUserCreateSchema>;

/**
 * Profile, roles and branches; the email and password are not edited here. The specialties travel
 * as a pair; whether they fit the type is checked against the stored profile (`users` module).
 */
export const staffUserPatchSchema = z
  .object({
    displayName: nameSchema,
    title: optionalText(80),
    practitionerType: practitionerTypeSchema,
    primarySpecialty: specialtySchema.nullable(),
    specialties: specialtiesSchema,
    phone: optionalText(40),
    ...assignments,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Change at least one field' })
  .refine(
    (patch) =>
      patch.specialties === undefined || patch.primarySpecialty === undefined
        ? patch.specialties === patch.primarySpecialty
        : specialtiesAgree(patch.primarySpecialty, patch.specialties),
    SPECIALTIES_MISFIT,
  );
export type StaffUserPatch = z.infer<typeof staffUserPatchSchema>;

/** Body of `POST /users/:id/deactivate` and `/reactivate` (reason dialog). */
export const staffUserStatusChangeSchema = z.object({ reason: reasonSchema });
export type StaffUserStatusChange = z.infer<typeof staffUserStatusChangeSchema>;

/** Body of `POST /users/:id/reset-password`; the user must change it at next sign-in. */
export const resetPasswordRequestSchema = z.object({ temporaryPassword: passwordSchema });
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/**
 * A dentist a patient can be assigned to (`GET /users/practitioners`, feature 3 Q2). `id` is the
 * staff profile id — the key a domain model refers to a dentist by (ADR-0020, amends ADR-0016,
 * which stored the auth user id). `userId` is kept for links back to `users` (sign-in identity,
 * `GET /users/:id`).
 */
export const practitionerSchema = z.object({
  id: idSchema,
  userId: idSchema,
  displayName: z.string(),
  title: z.string().nullable(),
});
export type Practitioner = z.infer<typeof practitionerSchema>;

/**
 * Query for `GET /users/practitioners`. With `branchId`, only active dentists assigned to that
 * branch (`staff_branches`); without it, every active dentist of the tenant (unchanged).
 */
export const practitionerQuerySchema = z.object({ branchId: idSchema.optional() });
export type PractitionerQuery = z.infer<typeof practitionerQuerySchema>;
