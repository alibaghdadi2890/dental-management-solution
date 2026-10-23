import {
  type PatientName,
  type ToothNotation,
  toothCodeSchema,
  toothLabel,
  type VisitNumber,
} from '@dcm/contracts';
import type { i18n as I18n } from 'i18next';
import { formatMoney } from '@/lib/format';
import type { Lookups } from './sentence';

/**
 * What the Activity sentences need to name a row's records in one clinic: its patients, visits
 * and staff (the log holds ids), its money, its tooth notation and the labels of stored values.
 * The clinic's Activity builds one; the platform's (ADR-0057) one per clinic on the page.
 */
export function buildLookups({
  patients,
  visits,
  staff,
  notation,
  locale,
  i18n,
}: {
  patients: readonly PatientName[];
  visits: readonly VisitNumber[];
  staff: ReadonlyMap<string, string>;
  notation: ToothNotation;
  locale: string;
  i18n: I18n;
}): Lookups {
  // Built at run time from the entry's own words, so they can't be typed resource keys.
  const translate = i18n.t.bind(i18n) as (key: string) => string;
  return {
    patients: new Map(patients.map((patient) => [patient.id, patient])),
    visits: new Map(visits.map((visit) => [visit.visitId, visit])),
    staff,
    money: (amount, currency) => formatMoney({ amount, currency }, locale),
    tooth: (code) => {
      const known = toothCodeSchema.safeParse(code);
      return known.success ? toothLabel(known.data, notation) : code;
    },
    label: (group, value) => {
      const key = {
        method: `billing:methods.${value}`,
        reason: `billing:adjust.reasons.${value}`,
        fileCategory: `files:category.${value}`,
        fileType: `files:subCategory.${value}`,
        visitType: `clinical:flow.types.${value}`,
        priority: `clinical:flow.priority.${value}`,
      }[group];
      return i18n.exists(key) ? translate(key) : value;
    },
  };
}
