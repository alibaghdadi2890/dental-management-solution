import type { ContactView, PatientListItem } from '@dcm/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { initials } from '@/lib/initials';

/** A patient in the search: initials, name, number, phone and age, whose phone it was, and at
 * the end what the shell adds (the next appointment and the balance, search S10). */
export function PatientResult({
  patient,
  age,
  phone,
  end,
}: {
  patient: PatientListItem;
  age: number | null;
  /** Formatted for display; null for a minor recorded without one. */
  phone: string | null;
  end?: ReactNode;
}) {
  const { t } = useTranslation('patients');
  return (
    <>
      <span
        aria-hidden
        className="grid size-[34px] flex-none place-items-center rounded-full border border-border bg-subtle text-[12.5px] leading-none font-semibold text-ink-secondary"
      >
        {initials(patient.fullName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] leading-[1.3] font-medium">
          {patient.fullName}
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs leading-[1.4] text-ink-muted">
          <span dir="ltr" className="font-mono">
            {patient.displayNumber}
          </span>
          {phone !== null && (
            <span dir="ltr" className="font-mono tabular-nums">
              {phone}
            </span>
          )}
          <span>{age === null ? t('palette.ageUnknown') : t('palette.age', { age })}</span>
        </span>
        {/* Found through a contact's phone (design addendum P11, C7): whose phone it is. */}
        {patient.matchedContact && (
          <span className="mt-0.5 block truncate text-xs leading-[1.4] text-ink-muted">
            {t('palette.via', {
              name: patient.matchedContact.fullName,
              relationship: t(`contacts.relationships.${patient.matchedContact.relationship}`),
            })}
          </span>
        )}
      </span>
      {end}
    </>
  );
}

/** A contact who is no patient (families C): opens the contact panel. */
export function ContactResult({ contact, phone }: { contact: ContactView; phone: string | null }) {
  const { t } = useTranslation('patients');
  return (
    <>
      <span
        aria-hidden
        className="grid size-[34px] flex-none place-items-center rounded-full border border-dashed border-border bg-surface text-[12.5px] leading-none font-semibold text-ink-secondary"
      >
        {initials(contact.fullName)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] leading-[1.3] font-medium">
          {contact.fullName}
        </span>
        {phone !== null && (
          <span dir="ltr" className="mt-0.5 block font-mono text-xs leading-[1.4] text-ink-muted">
            {phone}
          </span>
        )}
      </span>
      <span className="flex-none text-xs leading-none text-ink-muted">{t('palette.contact')}</span>
    </>
  );
}
