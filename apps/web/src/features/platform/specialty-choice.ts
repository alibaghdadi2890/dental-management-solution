import { DEFAULT_SPECIALTY, type Specialty } from '@dcm/contracts';

/** A dentist's specialties as the forms hold them (ADR-0050): the primary is among them. */
export interface SpecialtyChoice {
  primarySpecialty: Specialty | null;
  specialties: Specialty[];
}

export const NO_SPECIALTIES: SpecialtyChoice = { primarySpecialty: null, specialties: [] };

/** What a new dentist, or a person switched to dentist with nothing ticked, starts on. */
export const DEFAULT_SPECIALTIES: SpecialtyChoice = {
  primarySpecialty: DEFAULT_SPECIALTY,
  specialties: [DEFAULT_SPECIALTY],
};

/**
 * Ticks or unticks one specialty: the first one ticked becomes the primary; unticking the primary
 * hands it to the first still ticked.
 */
export function toggleSpecialty(choice: SpecialtyChoice, key: Specialty): SpecialtyChoice {
  if (!choice.specialties.includes(key)) {
    return {
      primarySpecialty: choice.primarySpecialty ?? key,
      specialties: [...choice.specialties, key],
    };
  }
  const specialties = choice.specialties.filter((value) => value !== key);
  return {
    primarySpecialty:
      choice.primarySpecialty === key ? (specialties[0] ?? null) : choice.primarySpecialty,
    specialties,
  };
}

/**
 * What a form sends for a practitioner type: a dentist's choice, none for anyone else. The form
 * keeps the choice while another type is selected, so switching back restores it.
 */
export function specialtiesForType(type: string, choice: SpecialtyChoice): SpecialtyChoice {
  return type === 'dentist' ? choice : NO_SPECIALTIES;
}

/** Switching to dentist with nothing ticked starts on General dentistry. */
export function choiceOnTypeChange(type: string, choice: SpecialtyChoice): SpecialtyChoice {
  return type === 'dentist' && choice.specialties.length === 0 ? DEFAULT_SPECIALTIES : choice;
}

export const sameSpecialties = (a: SpecialtyChoice, b: SpecialtyChoice) =>
  a.primarySpecialty === b.primarySpecialty &&
  a.specialties.length === b.specialties.length &&
  a.specialties.every((value, index) => value === b.specialties[index]);
