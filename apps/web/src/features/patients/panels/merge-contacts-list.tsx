import type { Patient } from '@dcm/contracts';
import { useQueries } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ContactRow } from '../contact-row';
import { rowOfLink } from '../contact-rows';
import { contactsQuery } from '../contacts-api';
import { mergeContacts } from '../merge-contacts';
import { LoadState } from './load-state';

/**
 * The merge panel's "Contacts — will be kept" (design addendum C8): both records' contacts, each
 * once, with the roles both records give it and which record(s) it comes from. A contact that is
 * one of the two records is set apart: the merge makes it the kept patient's own contact, so that
 * link goes.
 */
export function MergeContactsList({
  kept,
  dropped,
  country,
}: {
  kept: Patient;
  dropped: Patient;
  country: string;
}) {
  const { t } = useTranslation('patients');
  const headingId = useId();
  const [keptContacts, droppedContacts] = useQueries({
    queries: [contactsQuery(kept.id), contactsQuery(dropped.id)],
  });

  let body;
  if (!keptContacts.data || !droppedContacts.data) {
    body = (
      <LoadState
        error={keptContacts.isError || droppedContacts.isError}
        failed={t('contacts.merge.failed')}
        onRetry={() => {
          void keptContacts.refetch();
          void droppedContacts.refetch();
        }}
      />
    );
  } else {
    const result = mergeContacts(
      { patient: kept, contacts: keptContacts.data },
      { patient: dropped, contacts: droppedContacts.data },
    );
    body =
      result.kept.length === 0 && result.removed.length === 0 ? (
        <p className="m-0 text-[12.5px] leading-snug text-ink-muted">{t('contacts.merge.empty')}</p>
      ) : (
        <>
          {result.kept.length > 0 && (
            <ul aria-label={t('contacts.merge.title')} className="m-0 list-none p-0">
              {result.kept.map(({ link, from: [first = '', second] }) => (
                <ContactRow
                  key={link.contact.id}
                  row={rowOfLink(link)}
                  country={country}
                  note={
                    <span className="text-[11.5px] leading-snug text-ink-muted">
                      {second === undefined
                        ? t('contacts.merge.fromOne', { number: first })
                        : t('contacts.merge.fromBoth', { first, second })}
                    </span>
                  }
                />
              ))}
            </ul>
          )}
          {result.removed.map(({ contact, number }) => (
            <p key={contact.id} className="m-0 text-xs leading-snug text-ink-muted">
              {t('contacts.merge.selfLink', { name: contact.fullName, number })}
            </p>
          ))}
        </>
      );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <h3 id={headingId} className="m-0 text-[13px] leading-none font-semibold">
        {t('contacts.merge.title')}
      </h3>
      {body}
    </section>
  );
}
