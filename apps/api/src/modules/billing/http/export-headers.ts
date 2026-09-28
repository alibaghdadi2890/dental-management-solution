import { EXPORT_LANGUAGES, type ExportLanguage } from '@dcm/contracts';
import type { ExportLabels } from '../application/patient-export.service';

const FALLBACK: ExportLanguage = 'en';

/** The CSV header row and sex values per language (the SPA's `patients` column names). */
const LABELS: Record<ExportLanguage, ExportLabels> = {
  en: {
    patientId: 'Patient ID',
    name: 'Name',
    age: 'Age',
    sex: 'Sex',
    phone: 'Phone',
    guardianName: 'Guardian name',
    guardianPhone: 'Guardian phone',
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
    guardianName: 'اسم ولي الأمر',
    guardianPhone: 'هاتف ولي الأمر',
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
    guardianName: 'Nom du tuteur',
    guardianPhone: 'Téléphone du tuteur',
    lastVisit: 'Dernière visite',
    dentist: 'Dentiste',
    visits: 'Visites',
    balance: 'Solde',
    sexes: { female: 'Femme', male: 'Homme', other: 'Autre' },
  },
};

function isExportLanguage(value: string): value is ExportLanguage {
  return (EXPORT_LANGUAGES as readonly string[]).includes(value);
}

/**
 * The export language from `Accept-Language` (the query's `lang` overrides it, in the controller): the supported primary tag (`ar-LB` → `ar`) with
 * the highest quality, earlier entries first on a tie; `q=0` means "not this one". `en` when
 * nothing matches or the header is absent.
 */
export function exportLocale(acceptLanguage: string | undefined): ExportLanguage {
  if (!acceptLanguage) return FALLBACK;
  const ranges = acceptLanguage.split(',').flatMap((part, index) => {
    const [tag = '', ...params] = part.trim().split(';');
    const qParam = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
    const quality = qParam === undefined ? 1 : Number(qParam.slice(2));
    const primary = tag.trim().split('-')[0]?.toLowerCase() ?? '';
    if (!Number.isFinite(quality) || quality <= 0 || !isExportLanguage(primary)) return [];
    return [{ locale: primary, quality, index }];
  });
  ranges.sort((a, b) => b.quality - a.quality || a.index - b.index);
  return ranges[0]?.locale ?? FALLBACK;
}

export function exportLabels(locale: ExportLanguage): ExportLabels {
  return LABELS[locale];
}
