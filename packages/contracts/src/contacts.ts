import { z } from 'zod';
import { optionalEmailSchema } from './auth.js';
import { displayNumberSchema, idSchema, isoDateSchema, nameSchema } from './common.js';

/**
 * Contacts & family (`patients`, design addendum C1–C7): people known to the clinic who relate to
 * patients as guardians, billing contacts or emergency contacts, and who may themselves be
 * patients. Deliberately imports nothing from `patients.ts` (which imports this file).
 */

/** The contact's relation *to the patient* (a mother is the child's `parent`). */
export const CONTACT_RELATIONSHIPS = [
  'parent',
  'spouse',
  'child',
  'sibling',
  'caregiver',
  'other',
] as const;
export const contactRelationshipSchema = z.enum(CONTACT_RELATIONSHIPS);
export type ContactRelationship = z.infer<typeof contactRelationshipSchema>;

const ROLE_REQUIRED = 'Give the contact at least one role';

const roleFields = {
  isGuardian: z.boolean().default(false),
  isBillingContact: z.boolean().default(false),
  isEmergencyContact: z.boolean().default(false),
};

function hasRole(roles: {
  isGuardian: boolean;
  isBillingContact: boolean;
  isEmergencyContact: boolean;
}): boolean {
  return roles.isGuardian || roles.isBillingContact || roles.isEmergencyContact;
}

/** The three role flags of a link; absent means false, and at least one must be true. */
export const contactRolesSchema = z
  .object(roleFields)
  .refine(hasRole, { message: ROLE_REQUIRED, path: ['isGuardian'] });
export type ContactRoles = z.infer<typeof contactRolesSchema>;

/** Raw phone as typed (required): the server normalises it against the tenant's country. */
const contactPhoneSchema = z.string().trim().min(1).max(40);

/** A contact created on the spot by the search-or-create control. */
export const newContactSchema = z.object({
  fullName: nameSchema,
  phone: contactPhoneSchema,
  email: optionalEmailSchema,
});
export type NewContact = z.infer<typeof newContactSchema>;

/**
 * Who is linked — exactly one of: an existing contact; a patient (their linked contact, reused or
 * created); a new contact. Strict objects, so a target naming two of them matches none.
 */
export const contactLinkTargetSchema = z.union([
  z.strictObject({ contactId: idSchema }),
  z.strictObject({ patientId: idSchema }),
  z.strictObject({ newContact: newContactSchema }),
]);
export type ContactLinkTarget = z.infer<typeof contactLinkTargetSchema>;

/**
 * Links a contact to a patient (`POST /patients/:id/contacts`, and `contacts` of a create). The
 * primaries are never chosen here: the first holder of a role becomes its primary (addendum C2).
 */
export const contactLinkInputSchema = z
  .object({
    target: contactLinkTargetSchema,
    relationship: contactRelationshipSchema,
    ...roleFields,
  })
  .refine(hasRole, { message: ROLE_REQUIRED, path: ['isGuardian'] });
export type ContactLinkInput = z.infer<typeof contactLinkInputSchema>;

/**
 * Changes a link (`PATCH /patients/:id/contacts/:contactId`). A primary flag can only be set to
 * `true`: the contact becomes that role's primary and the previous one stops being it. There is
 * no "no primary" while the role has holders, so `false` is refused rather than ignored.
 */
export const contactLinkPatchSchema = z
  .object({
    relationship: contactRelationshipSchema,
    isGuardian: z.boolean(),
    isBillingContact: z.boolean(),
    isEmergencyContact: z.boolean(),
    isPrimaryGuardian: z.literal(true),
    isPrimaryBilling: z.literal(true),
    isPrimaryEmergency: z.literal(true),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Change at least one field' })
  .refine(
    (patch) =>
      !(
        patch.isGuardian === false &&
        patch.isBillingContact === false &&
        patch.isEmergencyContact === false
      ),
    { message: ROLE_REQUIRED, path: ['isGuardian'] },
  )
  .superRefine((patch, context) => {
    const pairs = [
      ['isGuardian', 'isPrimaryGuardian'],
      ['isBillingContact', 'isPrimaryBilling'],
      ['isEmergencyContact', 'isPrimaryEmergency'],
    ] as const;
    for (const [role, primary] of pairs) {
      if (patch[role] === false && patch[primary] === true) {
        context.addIssue({
          code: 'custom',
          message: 'A primary contact must hold the role',
          path: [primary],
        });
      }
    }
  });
export type ContactLinkPatch = z.infer<typeof contactLinkPatchSchema>;

/** Edits an unlinked contact (`PATCH /contacts/:id`); a linked one is edited as its patient. */
export const contactPatchSchema = z
  .object({ fullName: nameSchema, phone: contactPhoneSchema, email: optionalEmailSchema })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Change at least one field' });
export type ContactPatch = z.infer<typeof contactPatchSchema>;

/**
 * A contact as read (addendum C6): a contact linked to a patient shows that patient's name, phone
 * and e-mail; `linkedPatient.archived` is true for an archived (or merged-away) patient (C9).
 */
export const contactViewSchema = z.object({
  id: idSchema,
  fullName: z.string(),
  /** E.164; null only for a contact linked to a patient who has no phone (a minor). */
  phone: z.string().nullable(),
  email: z.string().nullable(),
  linkedPatient: z
    .object({ id: idSchema, displayNumber: displayNumberSchema, archived: z.boolean() })
    .nullable(),
});
export type ContactView = z.infer<typeof contactViewSchema>;

/** One contact of a patient (`GET /patients/:id/contacts`). */
export const patientContactSchema = z.object({
  contact: contactViewSchema,
  relationship: contactRelationshipSchema,
  isGuardian: z.boolean(),
  isBillingContact: z.boolean(),
  isEmergencyContact: z.boolean(),
  isPrimaryGuardian: z.boolean(),
  isPrimaryBilling: z.boolean(),
  isPrimaryEmergency: z.boolean(),
});
export type PatientContact = z.infer<typeof patientContactSchema>;

/** `GET /contacts/lookup?q=`: by name, or by at least 2 phone digits. */
export const contactLookupQuerySchema = z.object({ q: z.string().trim().min(1).max(100) });
export type ContactLookupQuery = z.infer<typeof contactLookupQuerySchema>;

/** A lookup hit: a contact, or a patient not yet anyone's contact (search-or-create, C5). */
export const contactLookupItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('contact'), contact: contactViewSchema }),
  z.object({
    kind: z.literal('patient'),
    patient: z.object({
      id: idSchema,
      displayNumber: displayNumberSchema,
      fullName: z.string(),
      phone: z.string().nullable(),
      dateOfBirth: isoDateSchema.nullable(),
    }),
  }),
]);
export type ContactLookupItem = z.infer<typeof contactLookupItemSchema>;

/** A list item's primary guardian, resolved (addendum C7). */
export const primaryGuardianSchema = z.object({
  contactId: idSchema,
  fullName: z.string(),
  phone: z.string().nullable(),
  relationship: contactRelationshipSchema,
});
export type PrimaryGuardian = z.infer<typeof primaryGuardianSchema>;

/** The contact through whose phone a search matched a patient (the palette's "via" line, C7). */
export const matchedContactSchema = z.object({
  fullName: z.string(),
  relationship: contactRelationshipSchema,
});
export type MatchedContact = z.infer<typeof matchedContactSchema>;
