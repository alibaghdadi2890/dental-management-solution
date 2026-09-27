import { describe, expect, it } from 'vitest';
import { nameKey } from './name-key';

describe('nameKey', () => {
  it('lower-cases, trims and collapses internal whitespace', () => {
    expect(nameKey('  José   ÁLVAREZ ')).toBe('jose alvarez');
  });

  it('strips Arabic tashkeel (combining marks)', () => {
    expect(nameKey('مُحَمَّد')).toBe('محمد');
  });

  it('strips Latin diacritics without touching plain ASCII punctuation', () => {
    expect(nameKey('Zoë-Anne')).toBe('zoe-anne');
  });

  it('is stable for an already-plain name', () => {
    expect(nameKey('John Smith')).toBe('john smith');
  });

  it('collapses tabs and newlines like any other whitespace', () => {
    expect(nameKey('John\tSmith\n')).toBe('john smith');
  });
});
