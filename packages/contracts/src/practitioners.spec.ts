import { describe, expect, it } from 'vitest';
import { specialtiesFit } from './practitioners.js';

describe('specialtiesFit', () => {
  it('needs a dentist to have a primary specialty among their specialties', () => {
    expect(specialtiesFit('dentist', 'general', ['general'])).toBe(true);
    expect(specialtiesFit('dentist', 'pediatric', ['general', 'pediatric'])).toBe(true);
    expect(specialtiesFit('dentist', null, [])).toBe(false);
    expect(specialtiesFit('dentist', 'cosmetic', ['general'])).toBe(false);
  });

  it('gives any other practitioner type no specialties', () => {
    expect(specialtiesFit('assistant', null, [])).toBe(true);
    expect(specialtiesFit('frontdesk', 'general', ['general'])).toBe(false);
    expect(specialtiesFit('other', null, ['general'])).toBe(false);
  });
});
