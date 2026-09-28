import type { Patient } from '@dcm/contracts';
import { useQueries } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { SHIMMER } from '@/components/ui/list';
import { cn } from '@/lib/utils';
import { ContactRow } from '../contact-row';
import type { ContactRowModel } from '../contact-rows';
import { contactsQuery } from '../contacts-api';
import { type KeptContact, mergeContacts } from '../merge-contacts';

function rowOf({ contact, relationship, roles }: KeptContact): ContactRowModel {
  return {
    key: contact.id,
    fullName: contact.fullName,
    phone: contact.phone,
    patient: contact.linkedPatient && {
      id: contact.linkedPatient.id,
      number: contact.linkedPatient.displayNumber,
      archived: contact.linkedPatient.archived,
    },
    relationship,
    roles,
    // The server settles the primaries (the kept record's win); the list shows the roles.
    primary: null,
  };
}

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
  const { t } = useTranslation(['patients', 'common']);
  const headingId = useId();
  const [keptContacts, droppedContacts] = useQueries({
    queries: [contactsQuery(kept.id), contactsQuery(dropped.id)],
  });

  let body;
  if (keptContacts.isError || droppedContacts.isError) {
    body = (
      <div role="alert" className="flex items-center gap-2">
        <span className="text-[12.5px] leading-snug text-ink-secondary">
          {t('contacts.merge.failed')}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="px-0"
          onClick={() => {
            void keptContacts.refetch();
            void droppedContacts.refetch();
          }}
        >
          {t('common:tryAgain')}
        </Button>
      </div>
    );
  } else if (!keptContacts.data || !droppedContacts.data) {
    body = (
      <span
        role="status"
        aria-label={t('contacts.current.loading')}
        className={cn('block h-9 w-full', SHIMMER)}
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
              {result.kept.map((contact) => {
                const [first = '', second] = contact.from;
                return (
                  <ContactRow
                    key={contact.contact.id}
                    row={rowOf(contact)}
                    country={country}
                    note={
                      <span className="text-[11.5px] leading-snug text-ink-muted">
                        {second === undefined
                          ? t('contacts.merge.fromOne', { number: first })
                          : t('contacts.merge.fromBoth', { first, second })}
                      </span>
                    }
                  />
                );
              })}
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
