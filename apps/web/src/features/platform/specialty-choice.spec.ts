import { describe, expect, it } from 'vitest';
import {
  choiceOnTypeChange,
  DEFAULT_SPECIALTIES,
  NO_SPECIALTIES,
  specialtiesForType,
  toggleSpecialty,
} from './specialty-choice';

describe('toggleSpecialty', () => {
  it('makes the first one ticked the primary and keeps it as more are ticked', () => {
    const ortho = toggleSpecialty(NO_SPECIALTIES, 'orthodontics');
    expect(ortho).toEqual({ primarySpecialty: 'orthodontics', specialties: ['orthodontics'] });
    expect(toggleSpecialty(ortho, 'general')).toEqual({
      primarySpecialty: 'orthodontics',
      specialties: ['orthodontics', 'general'],
    });
  });

  it('hands the primary to the first still ticked when it is unticked', () => {
    const both = {
      primarySpecialty: 'orthodontics' as const,
      specialties: ['orthodontics' as const, 'general' as const],
    };
    expect(toggleSpecialty(both, 'orthodontics')).toEqual(DEFAULT_SPECIALTIES);
    expect(toggleSpecialty(both, 'general')).toEqual({
      primarySpecialty: 'orthodontics',
      specialties: ['orthodontics'],
    });
    expect(toggleSpecialty(DEFAULT_SPECIALTIES, 'general')).toEqual(NO_SPECIALTIES);
  });
});

describe('the practitioner type', () => {
  it('sends the choice for a dentist only', () => {
    expect(specialtiesForType('dentist', DEFAULT_SPECIALTIES)).toEqual(DEFAULT_SPECIALTIES);
    expect(specialtiesForType('frontdesk', DEFAULT_SPECIALTIES)).toEqual(NO_SPECIALTIES);
  });

  it('starts a new dentist with nothing ticked on General dentistry, and keeps a choice', () => {
    expect(choiceOnTypeChange('dentist', NO_SPECIALTIES)).toEqual(DEFAULT_SPECIALTIES);
    const endo = {
      primarySpecialty: 'endodontics' as const,
      specialties: ['endodontics' as const],
    };
    expect(choiceOnTypeChange('dentist', endo)).toBe(endo);
    expect(choiceOnTypeChange('other', endo)).toBe(endo);
  });
});
