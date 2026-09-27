import { SUPPORTED_COUNTRIES } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { countryOptions } from './tenant-options';

describe('countryOptions', () => {
  it('lists every supported country exactly once', () => {
    const options = countryOptions('en');
    expect(options).toHaveLength(SUPPORTED_COUNTRIES.length);
    expect(new Set(options.map((option) => option.code)).size).toBe(SUPPORTED_COUNTRIES.length);
  });

  it('labels a code in the given locale, e.g. LB is "Liban" in French', () => {
    const options = countryOptions('fr');
    expect(options.find((option) => option.code === 'LB')).toEqual({ code: 'LB', label: 'Liban' });
  });

  it('sorts by label', () => {
    const labels = countryOptions('en').map((option) => option.label);
    const sorted = [...labels].sort((a, b) => new Intl.Collator('en').compare(a, b));
    expect(labels).toEqual(sorted);
  });
});
