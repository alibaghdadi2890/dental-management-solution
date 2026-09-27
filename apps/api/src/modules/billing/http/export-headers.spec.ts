import { describe, expect, it } from 'vitest';
import { exportLabels, exportLocale } from './export-headers';

describe('exportLocale', () => {
  it('takes the primary tag of the first supported language', () => {
    expect(exportLocale('ar-LB,ar;q=0.9')).toBe('ar');
    expect(exportLocale('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr');
    expect(exportLocale('de-DE,ar;q=0.5')).toBe('ar');
    expect(exportLocale('EN-us')).toBe('en');
  });

  it('prefers the highest quality, then the earlier entry', () => {
    expect(exportLocale('fr;q=0.5, ar;q=0.9')).toBe('ar');
    expect(exportLocale('fr;q=0.8, ar;q=0.8')).toBe('fr');
    expect(exportLocale('ar;q=0, fr')).toBe('fr');
  });

  it('falls back to en for unsupported, malformed or missing headers', () => {
    expect(exportLocale('de')).toBe('en');
    expect(exportLocale('*')).toBe('en');
    expect(exportLocale('ar;q=abc')).toBe('en');
    expect(exportLocale('')).toBe('en');
    expect(exportLocale(undefined)).toBe('en');
  });
});

describe('exportLabels', () => {
  it('has every column and sex label in each language', () => {
    for (const locale of ['en', 'ar', 'fr'] as const) {
      const labels = exportLabels(locale);
      const values = [
        labels.patientId,
        labels.name,
        labels.age,
        labels.sex,
        labels.phone,
        labels.lastVisit,
        labels.dentist,
        labels.visits,
        labels.balance,
        ...Object.values(labels.sexes),
      ];
      expect(values.every((value) => value.length > 0)).toBe(true);
    }
    expect(exportLabels('ar').name).toBe('الاسم');
    expect(exportLabels('en').lastVisit).toBe('Last visit');
  });
});
