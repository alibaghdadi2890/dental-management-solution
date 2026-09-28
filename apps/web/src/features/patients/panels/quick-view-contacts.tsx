import type { Patient } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ContactRow } from '../contact-row';
import { rowOfLink } from '../contact-rows';
import { contactsQuery } from '../contacts-api';
import { minorOn } from '../patient-form';
import { NoGuardianNote } from './contacts-section';
import { LoadState } from './load-state';

/**
 * The quick view's Contacts block (design addendum "Quick view"): one line per contact — name ·
 * relationship · role pills (the primary of each role marked) · Mono phone, and "Patient P-…"
 * linking to that record. "No contacts recorded" when there is none; a minor with no guardian gets
 * the amber "No guardian recorded" note instead.
 */
export function QuickViewContacts({
  patient,
  country,
  today,
}: {
  patient: Patient;
  country: string;
  /** Today in the tenant's time zone (a minor is under 18 there). */
  today: string;
}) {
  const { t } = useTranslation('patients');
  const headingId = useId();
  const contacts = useQuery(contactsQuery(patient.id));
  const minor = minorOn(patient.dateOfBirth, today);

  let body;
  if (!contacts.isSuccess) {
    body = (
      <LoadState
        error={contacts.isError}
        failed={t('contacts.current.failed')}
        onRetry={() => void contacts.refetch()}
      />
    );
  } else {
    const links = contacts.data;
    const noGuardian = minor && !links.some((link) => link.isGuardian);
    body = (
      <>
        {noGuardian && <NoGuardianNote hint={false} />}
        {links.length > 0 ? (
          <ul aria-label={t('contacts.quickView.title')} className="m-0 list-none p-0">
            {links.map((link) => (
              <ContactRow
                key={link.contact.id}
                row={rowOfLink(link)}
                country={country}
                patientLink
              />
            ))}
          </ul>
        ) : (
          !noGuardian && (
            <p className="m-0 text-[12.5px] leading-snug text-ink-muted">
              {t('contacts.quickView.empty')}
            </p>
          )
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <h3 id={headingId} className="m-0 text-[13px] leading-none font-semibold">
        {t('contacts.quickView.title')}
      </h3>
      {body}
    </section>
  );
}
