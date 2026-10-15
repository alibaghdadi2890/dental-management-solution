import { z } from 'zod';

/** What kind of clinician a staff user is; text + Zod so a tenant may extend it later. */
export const PRACTITIONER_TYPES = ['dentist', 'assistant', 'frontdesk', 'other'] as const;
export const practitionerTypeSchema = z.enum(PRACTITIONER_TYPES);
export type PractitionerType = z.infer<typeof practitionerTypeSchema>;

/**
 * A dentist's specialties (ADR-0050): a fixed list, because screens branch on these keys. A
 * dentist has at least one, one of them primary; any other practitioner type has none.
 */
export const SPECIALTIES = [
  'general',
  'orthodontics',
  'endodontics',
  'periodontics',
  'prosthodontics',
  'oral_surgery',
  'pediatric',
  'implantology',
  'cosmetic',
] as const;
export const specialtySchema = z.enum(SPECIALTIES);
export type Specialty = z.infer<typeof specialtySchema>;

/** What a new dentist starts on, and what every dentist before specialties was given. */
export const DEFAULT_SPECIALTY: Specialty = 'general';

/** Every specialty, the primary included, in the order chosen; no duplicates. */
export const specialtiesSchema = z
  .array(specialtySchema)
  .max(SPECIALTIES.length)
  .refine((values) => new Set(values).size === values.length, 'Duplicate specialty');

/** The primary and the list agree with each other, whatever the type. */
export function specialtiesAgree(
  primarySpecialty: Specialty | null,
  specialties: readonly Specialty[],
): boolean {
  return primarySpecialty === null
    ? specialties.length === 0
    : specialties.includes(primarySpecialty);
}

/** A dentist has a primary specialty among their specialties; anyone else has neither. */
export function specialtiesFit(
  practitionerType: PractitionerType,
  primarySpecialty: Specialty | null,
  specialties: readonly Specialty[],
): boolean {
  return (
    specialtiesAgree(primarySpecialty, specialties) &&
    (practitionerType === 'dentist') === (primarySpecialty !== null)
  );
}

/**
 * The specialties a create request may send: both or neither (a dentist sent without them starts
 * on `DEFAULT_SPECIALTY`), and when sent they fit the type.
 */
export function sentSpecialtiesFit(request: {
  practitionerType: PractitionerType;
  primarySpecialty?: Specialty | null | undefined;
  specialties?: readonly Specialty[] | undefined;
}): boolean {
  return request.specialties === undefined || request.primarySpecialty === undefined
    ? request.specialties === request.primarySpecialty
    : specialtiesFit(request.practitionerType, request.primarySpecialty, request.specialties);
}

/** The issue a schema raises when the specialties do not fit; on `specialties` for the forms. */
export const SPECIALTIES_MISFIT = {
  path: ['specialties'],
  message: 'A dentist needs a primary specialty among their specialties; no one else has any',
};

/** What kind of clinician the signed-in user is here (`GET /session`). */
export const practitionerProfileSchema = z.object({
  practitionerType: practitionerTypeSchema,
  primarySpecialty: specialtySchema.nullable(),
  specialties: z.array(specialtySchema),
});
export type PractitionerProfile = z.infer<typeof practitionerProfileSchema>;
