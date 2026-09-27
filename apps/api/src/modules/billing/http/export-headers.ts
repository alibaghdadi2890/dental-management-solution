import type { ExportLabels } from '../application/patient-export.service';

export const EXPORT_LOCALES = ['en', 'ar', 'fr'] as const;
export type ExportLocale = (typeof EXPORT_LOCALES)[number];

const FALLBACK: ExportLocale = 'en';

/** The CSV header row and sex values per language (the SPA's `patients` column names). */
const LABELS: Record<ExportLocale, ExportLabels> = {
  en: {
    patientId: 'Patient ID',
    name: 'Name',
    age: 'Age',
    sex: 'Sex',
    phone: 'Phone',
    lastVisit: 'Last visit',
    dentist: 'Dentist',
    visits: 'Visits',
    balance: 'Balance',
    sexes: { female: 'Female', male: 'Male', other: 'Other' },
  },
  ar: {
    patientId: 'رقم المريض',
    name: 'الاسم',
    age: 'العمر',
    sex: 'الجنس',
    phone: 'الهاتف',
    lastVisit: 'آخر زيارة',
    dentist: 'الطبيب',
    visits: 'الزيارات',
    balance: 'الرصيد',
    sexes: { female: 'أنثى', male: 'ذكر', other: 'آخر' },
  },
  fr: {
    patientId: 'N° patient',
    name: 'Nom',
    age: 'Âge',
    sex: 'Sexe',
    phone: 'Téléphone',
    lastVisit: 'Dernière visite',
    dentist: 'Dentiste',
    visits: 'Visites',
    balance: 'Solde',
    sexes: { female: 'Femme', male: 'Homme', other: 'Autre' },
  },
};

function isExportLocale(value: string): value is ExportLocale {
  return (EXPORT_LOCALES as readonly string[]).includes(value);
}

/**
 * The export language from `Accept-Language`: the supported primary tag (`ar-LB` → `ar`) with
 * the highest quality, earlier entries first on a tie; `q=0` means "not this one". `en` when
 * nothing matches or the header is absent.
 */
export function exportLocale(acceptLanguage: string | undefined): ExportLocale {
  if (!acceptLanguage) return FALLBACK;
  const ranges = acceptLanguage.split(',').flatMap((part, index) => {
    const [tag = '', ...params] = part.trim().split(';');
    const qParam = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
    const quality = qParam === undefined ? 1 : Number(qParam.slice(2));
    const primary = tag.trim().split('-')[0]?.toLowerCase() ?? '';
    if (!Number.isFinite(quality) || quality <= 0 || !isExportLocale(primary)) return [];
    return [{ locale: primary, quality, index }];
  });
  ranges.sort((a, b) => b.quality - a.quality || a.index - b.index);
  return ranges[0]?.locale ?? FALLBACK;
}

export function exportLabels(locale: ExportLocale): ExportLabels {
  return LABELS[locale];
}
