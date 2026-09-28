import { z } from 'zod';
import { reasonSchema } from './audit.js';
import { emailSchema, passwordSchema } from './auth.js';
import { idSchema, isoDateTimeSchema, nameSchema, optionalText } from './common.js';
import { roleKeySchema, roleRefSchema } from './roles.js';
import { branchRefSchema } from './session.js';

/** What kind of clinician a staff user is; text + Zod so a tenant may extend it later. */
export const PRACTITIONER_TYPES = ['dentist', 'assistant', 'frontdesk', 'other'] as const;
export const practitionerTypeSchema = z.enum(PRACTITIONER_TYPES);
export type PractitionerType = z.infer<typeof practitionerTypeSchema>;

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
  phone: z.string().nullable(),
  active: z.boolean(),
  roles: z.array(roleRefSchema),
  branches: z.array(branchRefSchema),
  createdAt: isoDateTimeSchema,
});
export type StaffUser = z.infer<typeof staffUserSchema>;

const assignments = {
  roleKeys: z.array(roleKeySchema).min(1).max(20),
  branchIds: z.array(idSchema).min(1).max(100),
};

/** Created by a platform admin with a temporary password to change at first sign-in (D6). */
export const staffUserCreateSchema = z.object({
  displayName: nameSchema,
  email: emailSchema,
  title: optionalText(80),
  practitionerType: practitionerTypeSchema,
  phone: optionalText(40),
  ...assignments,
  temporaryPassword: passwordSchema,
});
export type StaffUserCreate = z.infer<typeof staffUserCreateSchema>;

/** Profile, roles and branches; the email and password are not edited here. */
export const staffUserPatchSchema = z
  .object({
    displayName: nameSchema,
    title: optionalText(80),
    practitionerType: practitionerTypeSchema,
    phone: optionalText(40),
    ...assignments,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Change at least one field' });
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
